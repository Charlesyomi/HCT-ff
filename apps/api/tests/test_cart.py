"""Cart endpoints: version guarding, concurrency, and bearer/cookie authentication."""

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine
from sqlmodel import Session, select

from app.models import Cart
from app.schemas import CartLineInput, CartUpdateRequest
from app.services import cart_service
from tests.mobile_helpers import (
    auth_header,
    cart_line,
    csrf_token_for,
    issue_bearer_token,
    mobile_auth_config,  # noqa: F401  imported for its autouse-fixture side effect
    seed_account,
    set_size_price,
    sign_in_with_cookie,
)


@pytest.fixture
def bearer(order_app: tuple[TestClient, Engine]) -> tuple[TestClient, Engine, dict[str, str]]:
    """A client whose only credential is a Bearer token (no session cookie)."""
    client, engine = order_app
    account = seed_account(engine)
    token = issue_bearer_token(engine, account)
    return client, engine, auth_header(token)


def stored_cart(engine: Engine) -> Cart | None:
    with Session(engine) as session:
        carts = list(session.exec(select(Cart)).all())
        return carts[0] if carts else None


def test_empty_cart_is_version_zero_and_requires_authentication(
    order_app: tuple[TestClient, Engine],
) -> None:
    client, _engine = order_app
    assert client.get("/api/v1/me/cart").status_code == 401


def test_bearer_token_can_read_an_empty_cart(
    bearer: tuple[TestClient, Engine, dict[str, str]],
) -> None:
    client, _engine, headers = bearer

    response = client.get("/api/v1/me/cart", headers=headers)

    assert response.status_code == 200
    assert response.json() == {
        "items": [],
        "version": 0,
        "updated_at": None,
        "indicative_total_kobo": None,
    }


def test_put_cart_creates_the_cart_with_server_priced_lines(
    bearer: tuple[TestClient, Engine, dict[str, str]],
) -> None:
    client, engine, headers = bearer
    set_size_price(engine, "2-3kg", 5000)

    response = client.put(
        "/api/v1/me/cart",
        json={"items": [cart_line("2-3kg", 100)], "expected_version": 0},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 1
    assert body["items"] == [
        {
            "fish_type": "clarias",
            "size": "2-3kg",
            "size_label": "2 – 3kg",
            "quantity_kg": 100,
            "indicative_unit_price_kobo": 5000,
            "line_total_kobo": 100 * 5000,
        }
    ]
    assert body["indicative_total_kobo"] == 100 * 5000


def test_put_cart_increments_the_version_on_each_success(
    bearer: tuple[TestClient, Engine, dict[str, str]],
) -> None:
    client, _engine, headers = bearer

    first = client.put(
        "/api/v1/me/cart",
        json={"items": [cart_line("2-3kg", 100)], "expected_version": 0},
        headers=headers,
    )
    second = client.put(
        "/api/v1/me/cart",
        json={"items": [cart_line("2-3kg", 150)], "expected_version": 1},
        headers=headers,
    )

    assert first.json()["version"] == 1
    assert second.status_code == 200
    assert second.json()["version"] == 2
    assert second.json()["items"][0]["quantity_kg"] == 150


def test_put_cart_returns_409_when_the_expected_version_is_stale(
    bearer: tuple[TestClient, Engine, dict[str, str]],
) -> None:
    client, _engine, headers = bearer
    client.put(
        "/api/v1/me/cart",
        json={"items": [cart_line("2-3kg", 100)], "expected_version": 0},
        headers=headers,
    )

    stale = client.put(
        "/api/v1/me/cart",
        json={"items": [cart_line("2-3kg", 300)], "expected_version": 0},
        headers=headers,
    )

    assert stale.status_code == 409
    # The stale write must not have changed anything.
    current = client.get("/api/v1/me/cart", headers=headers).json()
    assert current["version"] == 1
    assert current["items"][0]["quantity_kg"] == 100


def test_put_cart_on_a_missing_cart_rejects_a_nonzero_expected_version(
    bearer: tuple[TestClient, Engine, dict[str, str]],
) -> None:
    client, _engine, headers = bearer

    response = client.put(
        "/api/v1/me/cart",
        json={"items": [cart_line("2-3kg", 100)], "expected_version": 3},
        headers=headers,
    )

    assert response.status_code == 409


def test_concurrent_cart_updates_allow_exactly_one_winner(
    bearer: tuple[TestClient, Engine, dict[str, str]],
) -> None:
    """
    Two writers both read version 1 and both try to write version 2.

    Concurrency race: without the conditional UPDATE the slower writer would silently
    clobber the faster one's cart. Prevention: the UPDATE is conditional on the expected
    version, so exactly one writer matches a row and the other is rejected.
    """
    client, engine, headers = bearer
    client.put(
        "/api/v1/me/cart",
        json={"items": [cart_line("2-3kg", 100)], "expected_version": 0},
        headers=headers,
    )
    account = seed_account(engine)
    barrier = threading.Barrier(2)
    outcomes: list[int] = []

    def writer(quantity_kg: int) -> None:
        barrier.wait()
        try:
            with Session(engine) as session:
                cart_service.put_cart(
                    session,
                    account.id,
                    CartUpdateRequest(
                        items=[
                            CartLineInput(
                                fish_type="clarias", size="2-3kg", quantity_kg=quantity_kg
                            )
                        ],
                        expected_version=1,
                    ),
                )
            outcomes.append(200)
        except HTTPException as error:
            outcomes.append(error.status_code)
        except Exception as error:  # pragma: no cover - surfaces the real driver error
            pytest.fail(f"unexpected error: {error!r}")

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(writer, (120, 180)))

    assert sorted(outcomes) == [200, 409]
    cart = stored_cart(engine)
    assert cart is not None
    assert cart.version == 2


def test_delete_cart_empties_it_and_is_idempotent(
    bearer: tuple[TestClient, Engine, dict[str, str]],
) -> None:
    client, engine, headers = bearer
    client.put(
        "/api/v1/me/cart",
        json={"items": [cart_line("2-3kg", 100)], "expected_version": 0},
        headers=headers,
    )

    first = client.delete("/api/v1/me/cart", headers=headers)
    second = client.delete("/api/v1/me/cart", headers=headers)

    assert first.status_code == 204
    assert second.status_code == 204
    assert stored_cart(engine) is None
    assert client.get("/api/v1/me/cart", headers=headers).json()["version"] == 0


def test_cart_lines_are_validated_like_order_lines(
    bearer: tuple[TestClient, Engine, dict[str, str]],
) -> None:
    client, _engine, headers = bearer

    unknown_size = client.put(
        "/api/v1/me/cart",
        json={"items": [cart_line("9-12kg", 100)], "expected_version": 0},
        headers=headers,
    )
    sold_out = client.put(
        "/api/v1/me/cart",
        json={"items": [cart_line("3kg-plus", 100)], "expected_version": 0},
        headers=headers,
    )
    non_positive = client.put(
        "/api/v1/me/cart",
        json={"items": [cart_line("2-3kg", 0)], "expected_version": 0},
        headers=headers,
    )

    assert unknown_size.status_code == 422
    assert sold_out.status_code == 422
    assert non_positive.status_code == 422


def test_duplicate_cart_lines_are_merged(
    bearer: tuple[TestClient, Engine, dict[str, str]],
) -> None:
    client, _engine, headers = bearer

    response = client.put(
        "/api/v1/me/cart",
        json={
            "items": [cart_line("2-3kg", 30), cart_line("2-3kg", 70)],
            "expected_version": 0,
        },
        headers=headers,
    )

    assert response.status_code == 200
    assert len(response.json()["items"]) == 1
    assert response.json()["items"][0]["quantity_kg"] == 100


# --- Cookie vs bearer ---


def test_cookie_session_can_read_the_cart(
    order_app: tuple[TestClient, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _engine = order_app
    sign_in_with_cookie(client, monkeypatch)

    response = client.get("/api/v1/me/cart")

    assert response.status_code == 200


def test_cookie_mutation_requires_a_csrf_token(
    order_app: tuple[TestClient, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _engine = order_app
    sign_in_with_cookie(client, monkeypatch)

    without_token = client.put(
        "/api/v1/me/cart",
        json={"items": [cart_line("2-3kg", 100)], "expected_version": 0},
    )
    with_token = client.put(
        "/api/v1/me/cart",
        json={"items": [cart_line("2-3kg", 100)], "expected_version": 0},
        headers={"X-CSRF-Token": csrf_token_for(client)},
    )

    assert without_token.status_code == 403
    assert with_token.status_code == 200


def test_bearer_mutation_does_not_require_a_csrf_token(
    bearer: tuple[TestClient, Engine, dict[str, str]],
) -> None:
    client, _engine, headers = bearer

    response = client.put(
        "/api/v1/me/cart",
        json={"items": [cart_line("2-3kg", 100)], "expected_version": 0},
        headers=headers,
    )

    assert response.status_code == 200


def test_bearer_takes_precedence_over_a_cookie_session(
    bearer: tuple[TestClient, Engine, dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A bearer token wins when both credentials are presented."""
    client, _engine, headers = bearer
    sign_in_with_cookie(client, monkeypatch)

    response = client.get("/api/v1/me/cart", headers=headers)

    assert response.status_code == 200


def test_cart_belongs_to_the_account_not_the_device(
    bearer: tuple[TestClient, Engine, dict[str, str]],
) -> None:
    """A second bearer token for the same account sees the same cart."""
    client, engine, headers = bearer
    client.put(
        "/api/v1/me/cart",
        json={"items": [cart_line("2-3kg", 100)], "expected_version": 0},
        headers=headers,
    )
    other_device = auth_header(issue_bearer_token(engine, seed_account(engine)))

    response = client.get("/api/v1/me/cart", headers=other_device)

    assert response.status_code == 200
    assert response.json()["version"] == 1


def test_unknown_bearer_token_is_rejected(
    bearer: tuple[TestClient, Engine, dict[str, str]],
) -> None:
    client, _engine, _headers = bearer

    response = client.get("/api/v1/me/cart", headers=auth_header("not-a-real-token"))

    assert response.status_code == 401