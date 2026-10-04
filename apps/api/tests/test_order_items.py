"""Multi-line orders and the legacy single-line payload (mobile client)."""

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine
from sqlmodel import Session, select

from app.models import Order, OrderItem
from tests.mobile_helpers import order_item, set_size_price

ORDER_KEY = {"Idempotency-Key": "multi-line-key"}


def error_message(response: Any) -> str:
    """The API returns a uniform {"error": {"message": ...}} envelope, never bare `detail`."""
    return str(response.json()["error"]["message"])


def multi_line_payload(
    order_payload: Callable[..., dict[str, Any]],
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Switch a valid payload from the single-line form to the multi-line form."""
    return order_payload(fish_type=None, size=None, quantity_kg=None, items=items)


def test_legacy_single_line_payload_still_creates_one_order_item(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app
    set_size_price(engine, "2-3kg", 5000)

    response = client.post(
        "/api/v1/orders", json=order_payload(quantity_kg=200), headers=ORDER_KEY
    )

    assert response.status_code == 201
    body = response.json()
    # The existing web contract is unchanged: the summary fields are still present.
    assert body["indicative_unit_price_kobo"] == 5000
    assert body["indicative_total_kobo"] == 200 * 5000
    assert body["items"] == [
        {
            "fish_type": "clarias",
            "size_label": "2 – 3kg",
            "quantity_kg": 200,
            "indicative_unit_price_kobo": 5000,
            "line_total_kobo": 200 * 5000,
        }
    ]
    with Session(engine) as session:
        assert len(session.exec(select(OrderItem)).all()) == 1


def test_multi_line_order_stores_every_line_with_server_priced_totals(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app
    set_size_price(engine, "2-3kg", 5000)
    set_size_price(engine, "1-5-2kg", 7000)

    response = client.post(
        "/api/v1/orders",
        json=multi_line_payload(
            order_payload,
            [order_item("2-3kg", 60), order_item("1-5-2kg", 40, fish_type="hybrid")],
        ),
        headers={"Idempotency-Key": "two-lines"},
    )

    assert response.status_code == 201
    items = response.json()["items"]
    assert [(item["size_label"], item["quantity_kg"]) for item in items] == [
        ("2 – 3kg", 60),
        ("1.5 – 2kg", 40),
    ]
    assert [item["line_total_kobo"] for item in items] == [60 * 5000, 40 * 7000]
    assert response.json()["indicative_total_kobo"] == 60 * 5000 + 40 * 7000
    # A mixed order has no single unit price; the summary total is still meaningful.
    assert response.json()["indicative_unit_price_kobo"] is None


def test_duplicate_lines_are_merged_by_summing_quantity(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app
    set_size_price(engine, "2-3kg", 5000)

    response = client.post(
        "/api/v1/orders",
        json=multi_line_payload(order_payload, [order_item("2-3kg", 30), order_item("2-3kg", 70)]),
        headers={"Idempotency-Key": "merge-me"},
    )

    assert response.status_code == 201
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["quantity_kg"] == 100
    assert items[0]["line_total_kobo"] == 100 * 5000


def test_multi_line_total_must_reach_the_minimum_order(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _engine = order_app

    response = client.post(
        "/api/v1/orders",
        json=multi_line_payload(
            order_payload, [order_item("2-3kg", 20), order_item("1-5-2kg", 15)]
        ),
        headers={"Idempotency-Key": "too-small"},
    )

    assert response.status_code == 422
    assert "between 40kg" in error_message(response)


def test_multi_line_order_rejects_more_than_ten_lines(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _engine = order_app

    response = client.post(
        "/api/v1/orders",
        json=multi_line_payload(
            order_payload, [order_item("2-3kg", 5) for _ in range(11)]
        ),
        headers={"Idempotency-Key": "too-many"},
    )

    assert response.status_code == 422


def test_multi_line_order_rejects_an_unknown_size_on_any_line(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _engine = order_app

    response = client.post(
        "/api/v1/orders",
        json=multi_line_payload(
            order_payload, [order_item("2-3kg", 50), order_item("9-12kg", 50)]
        ),
        headers={"Idempotency-Key": "bad-size"},
    )

    assert response.status_code == 422
    assert "available in the catalog" in error_message(response)


def test_multi_line_order_rejects_a_sold_out_size(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _engine = order_app
    # The seed marks `3kg-plus` as sold out in the active harvest window.
    response = client.post(
        "/api/v1/orders",
        json=multi_line_payload(
            order_payload, [order_item("2-3kg", 50), order_item("3kg-plus", 50)]
        ),
        headers={"Idempotency-Key": "sold-out-line"},
    )

    assert response.status_code == 422
    assert "unavailable" in error_message(response)


def test_idempotent_replay_of_a_multi_line_order_returns_the_same_items(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app
    set_size_price(engine, "2-3kg", 5000)
    set_size_price(engine, "1-5-2kg", 7000)
    payload = multi_line_payload(
        order_payload, [order_item("2-3kg", 60), order_item("1-5-2kg", 40)]
    )

    first = client.post("/api/v1/orders", json=payload, headers=ORDER_KEY)
    replay = client.post("/api/v1/orders", json=payload, headers=ORDER_KEY)

    assert first.status_code == 201
    assert replay.status_code == 201
    assert replay.json()["reference"] == first.json()["reference"]
    assert replay.json()["access_token"] == first.json()["access_token"]
    assert replay.json()["items"] == first.json()["items"]
    with Session(engine) as session:
        assert len(session.exec(select(Order)).all()) == 1
        assert len(session.exec(select(OrderItem)).all()) == 2


def test_order_details_include_the_items(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _engine = order_app
    set_size_price(_engine, "2-3kg", 5000)
    created = client.post(
        "/api/v1/orders",
        json=multi_line_payload(
            order_payload, [order_item("2-3kg", 60), order_item("1-5-2kg", 40)]
        ),
        headers={"Idempotency-Key": "details"},
    )
    body = created.json()

    details = client.get(
        f"/api/v1/orders/{body['reference']}",
        headers={"X-Order-Token": body["access_token"]},
    )
    lookup = client.post(
        "/api/v1/orders/lookup",
        json={"phone": "0801 234 5678", "reference": body["reference"]},
    )

    assert details.status_code == 200
    assert [item["quantity_kg"] for item in details.json()["items"]] == [60, 40]
    assert lookup.status_code == 200
    assert lookup.json()["order"]["items"] == details.json()["items"]


def test_missing_both_payload_forms_is_rejected(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _engine = order_app

    response = client.post(
        "/api/v1/orders",
        json=order_payload(fish_type=None, size=None, quantity_kg=None),
        headers={"Idempotency-Key": "no-lines"},
    )

    assert response.status_code == 422


def test_bulk_multi_line_order_is_flagged_as_bulk(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    response = client.post(
        "/api/v1/orders",
        json=multi_line_payload(
            order_payload, [order_item("2-3kg", 700), order_item("1-5-2kg", 400)]
        ),
        headers={"Idempotency-Key": "bulk"},
    )

    assert response.status_code == 201
    with Session(engine) as session:
        # The order summary keeps the total quantity, which drives the bulk flag.
        assert session.exec(select(Order)).one().is_bulk is True
        assert session.exec(select(Order)).one().quantity_kg == 1100