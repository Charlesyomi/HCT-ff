"""Google sign-in tests with a mocked provider (Addendum 001 §A4, §A6).

No real Google call happens here: the token exchange and the tokeninfo verification are
monkeypatched, and the OAuth consent screen lives in the owner's RUNBOOK checklist.
"""

import time
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine
from sqlmodel import Session, select

from app.config import settings
from app.models import Account, AccountSession, Order
from app.services import auth_service
from app.services.auth_service import (
    SESSION_COOKIE_NAME,
    STATE_COOKIE_NAME,
    AuthError,
    generate_pkce_pair,
    read_state_cookie,
    safe_next_path,
    sign_state_cookie,
)

CLIENT_ID = "test-client.apps.googleusercontent.com"


class _TokenInfoResponse:
    def __init__(self, status_code: int, body: dict[str, Any]) -> None:
        self.status_code = status_code
        self._body = body

    def json(self) -> dict[str, Any]:
        return self._body


@pytest.fixture(autouse=True)
def google_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "google_client_id", CLIENT_ID)
    monkeypatch.setattr(settings, "google_client_secret", "secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost:3000/api/v1/auth/google/callback")
    monkeypatch.setattr(settings, "session_cookie_secure", False)


def valid_claims(**overrides: Any) -> dict[str, Any]:
    claims: dict[str, Any] = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": "google-sub-123",
        "email": "Ada.Okafor@Example.com",
        "email_verified": "true",
        "name": "Ada Okafor",
        "picture": "https://lh3.googleusercontent.example/a.png",
        "nonce": "nonce-value",
        "exp": int(time.time()) + 3600,
    }
    claims.update(overrides)
    return claims


def mock_token_exchange(monkeypatch: pytest.MonkeyPatch, id_token: str = "id-token") -> None:
    monkeypatch.setattr(
        auth_service,
        "exchange_code_for_id_token",
        lambda code, verifier: id_token,
    )


def mock_tokeninfo(monkeypatch: pytest.MonkeyPatch, claims: dict[str, Any] | None, status_code: int = 200) -> None:
    def fake_get(url: str, **kwargs: Any) -> _TokenInfoResponse:
        return _TokenInfoResponse(status_code, claims or {})

    monkeypatch.setattr(auth_service.httpx, "get", fake_get)


def begin_sign_in(client: TestClient, next_path: str = "/my-orders") -> dict[str, str]:
    """Start the flow once and return the signed state payload plus the Google URL."""
    response = client.get(f"/api/v1/auth/google/start?next={next_path}", follow_redirects=False)
    assert response.status_code == 307
    state_cookie = client.cookies.get(STATE_COOKIE_NAME)
    assert state_cookie is not None
    stored = read_state_cookie(state_cookie)
    assert stored is not None
    return {**stored, "location": response.headers["location"]}


# --- PKCE and state cookie ---


def test_pkce_challenge_matches_the_s256_of_the_verifier() -> None:
    verifier, challenge = generate_pkce_pair()
    import base64
    import hashlib

    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).decode().rstrip("=")
    assert challenge == expected
    assert len(verifier) > 43


def test_state_cookie_rejects_tampering_and_expiry() -> None:
    signed = sign_state_cookie({"state": "abc", "created_at": int(time.time())})
    assert read_state_cookie(signed) is not None
    assert read_state_cookie(signed + "tampered") is None
    assert read_state_cookie("not-a-cookie") is None
    assert read_state_cookie(None) is None

    stale = sign_state_cookie({"state": "abc", "created_at": int(time.time()) - 5000})
    assert read_state_cookie(stale) is None


def test_start_redirects_to_google_with_state_challenge_and_nonce(
    order_app: tuple[TestClient, Engine],
) -> None:
    client, _ = order_app
    started = begin_sign_in(client)
    location = started["location"]

    assert "accounts.google.com" in location
    assert f"state={started['state']}" in location
    assert "code_challenge_method=S256" in location
    assert f"nonce={started['nonce']}" in location
    assert "scope=openid+email+profile" in location
    assert "code_verifier" not in location


def test_start_fails_clearly_when_google_is_not_configured(
    order_app: tuple[TestClient, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _ = order_app
    monkeypatch.setattr(settings, "google_client_id", None)

    response = client.get("/api/v1/auth/google/start", follow_redirects=False)

    # Sign-in is optional, so an unconfigured provider degrades to phone checkout.
    assert response.status_code == 503


# --- Callback validation ---


def test_callback_creates_an_account_session(order_app: tuple[TestClient, Engine], monkeypatch: pytest.MonkeyPatch) -> None:
    client, engine = order_app
    stored = begin_sign_in(client)
    mock_token_exchange(monkeypatch)
    mock_tokeninfo(monkeypatch, valid_claims(nonce=stored["nonce"]))

    response = client.get(
        f"/api/v1/auth/google/callback?code=auth-code&state={stored['state']}",
        follow_redirects=False,
    )

    assert response.status_code == 307
    assert response.headers["location"] == "/my-orders"
    assert SESSION_COOKIE_NAME in client.cookies

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "ada.okafor@example.com"
    assert me.json()["name"] == "Ada Okafor"

    with Session(engine) as session:
        accounts = list(session.exec(select(Account)).all())
        sessions = list(session.exec(select(AccountSession)).all())
    assert len(accounts) == 1
    assert accounts[0].google_sub == "google-sub-123"
    assert len(sessions) == 1
    # The raw cookie value is never stored: only its SHA-256 digest is.
    assert sessions[0].token_hash != client.cookies.get(SESSION_COOKIE_NAME)


def test_callback_rejects_a_mismatched_state(order_app: tuple[TestClient, Engine], monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = order_app
    begin_sign_in(client)
    mock_token_exchange(monkeypatch)
    mock_tokeninfo(monkeypatch, valid_claims())

    response = client.get("/api/v1/auth/google/callback?code=auth-code&state=attacker-state", follow_redirects=False)

    assert response.status_code == 400
    assert "state" in response.json()["error"]["message"]


def test_callback_rejects_a_missing_state_cookie(order_app: tuple[TestClient, Engine], monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = order_app
    mock_token_exchange(monkeypatch)
    mock_tokeninfo(monkeypatch, valid_claims())

    response = client.get("/api/v1/auth/google/callback?code=auth-code&state=whatever", follow_redirects=False)

    assert response.status_code == 400


def test_callback_rejects_a_nonce_mismatch(order_app: tuple[TestClient, Engine], monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = order_app
    stored = begin_sign_in(client)
    mock_token_exchange(monkeypatch)
    mock_tokeninfo(monkeypatch, valid_claims(nonce="a-different-nonce"))

    response = client.get(
        f"/api/v1/auth/google/callback?code=auth-code&state={stored['state']}",
        follow_redirects=False,
    )

    assert response.status_code == 400
    assert "nonce" in response.json()["error"]["message"]


def test_callback_rejects_a_wrong_audience(order_app: tuple[TestClient, Engine], monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = order_app
    stored = begin_sign_in(client)
    mock_token_exchange(monkeypatch)
    mock_tokeninfo(monkeypatch, valid_claims(aud="someone-else.apps.googleusercontent.com", nonce=stored["nonce"]))

    response = client.get(
        f"/api/v1/auth/google/callback?code=auth-code&state={stored['state']}",
        follow_redirects=False,
    )

    assert response.status_code == 400
    assert "audience" in response.json()["error"]["message"]


def test_callback_rejects_an_unverified_email(order_app: tuple[TestClient, Engine], monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = order_app
    stored = begin_sign_in(client)
    mock_token_exchange(monkeypatch)
    mock_tokeninfo(monkeypatch, valid_claims(email_verified="false", nonce=stored["nonce"]))

    response = client.get(
        f"/api/v1/auth/google/callback?code=auth-code&state={stored['state']}",
        follow_redirects=False,
    )

    assert response.status_code == 400
    assert "not verified" in response.json()["error"]["message"]


def test_callback_rejects_an_expired_token(order_app: tuple[TestClient, Engine], monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = order_app
    stored = begin_sign_in(client)
    mock_token_exchange(monkeypatch)
    mock_tokeninfo(
        monkeypatch,
        valid_claims(nonce=stored["nonce"], exp=int(time.time()) - 10),
    )

    response = client.get(
        f"/api/v1/auth/google/callback?code=auth-code&state={stored['state']}",
        follow_redirects=False,
    )

    assert response.status_code == 400
    assert "expired" in response.json()["error"]["message"]


def test_callback_rejects_an_unexpected_issuer(order_app: tuple[TestClient, Engine], monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = order_app
    stored = begin_sign_in(client)
    mock_token_exchange(monkeypatch)
    mock_tokeninfo(monkeypatch, valid_claims(iss="https://evil.example", nonce=stored["nonce"]))

    response = client.get(
        f"/api/v1/auth/google/callback?code=auth-code&state={stored['state']}",
        follow_redirects=False,
    )

    assert response.status_code == 400
    assert "issuer" in response.json()["error"]["message"]


@pytest.mark.parametrize(
    "next_path",
    ["https://evil.example/steal", "//evil.example", "/ok\\evil", "javascript:alert(1)"],
)
def test_open_redirect_attempts_fall_back_to_my_orders(next_path: str) -> None:
    assert safe_next_path(next_path) == "/my-orders"


def test_open_redirect_attempt_does_not_redirect_off_site(
    order_app: tuple[TestClient, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _ = order_app
    stored = begin_sign_in(client, next_path="https://evil.example/steal")
    mock_token_exchange(monkeypatch)
    mock_tokeninfo(monkeypatch, valid_claims(nonce=stored["nonce"]))

    response = client.get(
        f"/api/v1/auth/google/callback?code=auth-code&state={stored['state']}",
        follow_redirects=False,
    )

    assert response.status_code == 307
    assert response.headers["location"] == "/my-orders"


# --- Sessions, CSRF and account orders ---


def sign_in(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored = begin_sign_in(client)
    mock_token_exchange(monkeypatch)
    mock_tokeninfo(monkeypatch, valid_claims(nonce=stored["nonce"]))
    client.get(f"/api/v1/auth/google/callback?code=auth-code&state={stored['state']}", follow_redirects=False)


def test_auth_me_requires_a_session(order_app: tuple[TestClient, Engine]) -> None:
    client, _ = order_app
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/me/orders").status_code == 401


def test_logout_clears_the_session(order_app: tuple[TestClient, Engine], monkeypatch: pytest.MonkeyPatch) -> None:
    client, engine = order_app
    sign_in(client, monkeypatch)

    response = client.post("/api/v1/auth/logout")

    assert response.status_code == 200
    assert response.json() == {"signed_out": True}
    assert client.get("/api/v1/auth/me").status_code == 401
    with Session(engine) as session:
        assert list(session.exec(select(AccountSession)).all()) == []


def test_guest_orders_are_not_claimed_by_matching_email(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, engine = order_app
    client.post("/api/v1/orders", json=order_payload(), headers={"Idempotency-Key": "guest-order"})
    sign_in(client, monkeypatch)

    orders = client.get("/api/v1/me/orders").json()["orders"]

    assert orders == []
    with Session(engine) as session:
        order = session.exec(select(Order)).one()
        assert order.account_id is None


def test_signed_in_user_can_attach_a_guest_order_with_reference_and_phone(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, engine = order_app
    created = client.post(
        "/api/v1/orders",
        json=order_payload(),
        headers={"Idempotency-Key": "attach-order"},
    )
    reference = created.json()["reference"]
    sign_in(client, monkeypatch)
    csrf_token = client.get("/api/v1/me/orders").json()["csrf_token"]
    assert csrf_token

    missing_csrf = client.post(
        "/api/v1/me/orders/attach",
        json={"reference": reference, "phone": "0801 234 5678"},
        headers={"X-CSRF-Token": "wrong"},
    )
    assert missing_csrf.status_code == 403

    wrong_phone = client.post(
        "/api/v1/me/orders/attach",
        json={"reference": reference, "phone": "0809 999 8877"},
        headers={"X-CSRF-Token": csrf_token},
    )
    assert wrong_phone.status_code == 404

    attached = client.post(
        "/api/v1/me/orders/attach",
        json={"reference": reference, "phone": "0801 234 5678"},
        headers={"X-CSRF-Token": csrf_token},
    )
    assert attached.status_code == 200
    assert attached.json()["attached"] is True

    orders = client.get("/api/v1/me/orders").json()["orders"]
    assert [order["reference"] for order in orders] == [reference]
    with Session(engine) as session:
        order = session.exec(select(Order)).one()
        assert order.account_id is not None


def test_orders_placed_while_signed_in_are_linked_to_the_account(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, engine = order_app
    sign_in(client, monkeypatch)

    client.post("/api/v1/orders", json=order_payload(), headers={"Idempotency-Key": "signed-in-order"})

    orders = client.get("/api/v1/me/orders").json()["orders"]
    assert len(orders) == 1
    with Session(engine) as session:
        assert session.exec(select(Order)).one().account_id is not None


def test_verify_id_token_reports_provider_rejection() -> None:
    with pytest.raises(AuthError):
        auth_service.verify_id_token("id-token", None)
