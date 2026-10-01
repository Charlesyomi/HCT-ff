"""Order API integration and unit tests (SPEC §6, §8, §12; Addendum §A2/A6)."""

from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine
from sqlmodel import Session, select

from app.models import Availability, Customer, HarvestWindow, Order, SizeClass
from app.schemas import OrderCreateRequest
from app.services import turnstile as turnstile_module
from app.services.order_service import (
    compute_payload_hash,
    create_order,
    derive_order_access_token,
    mask_phone_number,
    normalize_nigerian_phone,
)
from tests.conftest import (
    default_preferred_date,
    lagos_today,
    parallel_create_orders,
    reference_sequence,
    stored_events,
    stored_orders,
)

LAGOS = ZoneInfo("Africa/Lagos")


def post_order(
    client: TestClient,
    payload: dict[str, Any],
    key: str | None = "idem-1",
) -> Any:
    """POST an order, omitting the Idempotency-Key header when key is None."""
    headers = {"Idempotency-Key": key} if key is not None else {}
    return client.post("/api/v1/orders", json=payload, headers=headers)


# --- Creation, reference generation and events (SPEC §6.10, §8) ---


def test_order_creation_returns_reference_token_and_pending_status(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    response = post_order(client, order_payload(), "create-1")

    assert response.status_code == 201
    body = response.json()
    year = lagos_today().year
    assert body["reference"] == f"AF-{year}-0001"
    assert body["status"] == "pending"
    assert len(body["access_token"]) >= 32
    assert body["submitted_at"].endswith("+00:00") or body["submitted_at"].endswith("Z")

    order = stored_orders(engine)[0]
    assert order.size_label_snapshot == "2 – 3kg"
    assert order.time_slot_key == "10-12"
    assert order.time_slot_label == "10 AM–12 PM"
    assert order.is_bulk is False
    assert order.version == 1
    assert order.harvest_window_id is not None
    # The plaintext access token is never persisted, only its SHA-256 digest.
    assert body["access_token"] != order.access_token_hash

    events = stored_events(engine)
    assert len(events) == 1
    assert events[0].type == "created"
    assert events[0].from_status is None
    assert events[0].to_status == "pending"
    assert events[0].actor_type == "customer"


def test_reference_sequence_increments_per_submission(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    first = post_order(client, order_payload(phone="0801 234 5678"), "seq-1")
    second = post_order(client, order_payload(phone="0802 234 5678"), "seq-2")
    third = post_order(client, order_payload(phone="0803 234 5678"), "seq-3")

    year = lagos_today().year
    assert [first.json()["reference"], second.json()["reference"], third.json()["reference"]] == [
        f"AF-{year}-0001",
        f"AF-{year}-0002",
        f"AF-{year}-0003",
    ]
    assert reference_sequence([order.reference for order in stored_orders(engine)]) == [1, 2, 3]


def test_customer_is_reused_for_repeat_orders_from_the_same_phone(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    post_order(client, order_payload(customer_name="Ada Okafor"), "reuse-1")
    post_order(
        client,
        order_payload(customer_name="Ada Okafor", notes="Second visit"),
        "reuse-2",
    )

    with Session(engine) as session:
        customers = list(session.exec(select(Customer)).all())
    assert len(customers) == 1
    assert customers[0].phone_e164 == "+2348012345678"
    assert customers[0].name == "Ada Okafor"
    assert len(stored_orders(engine)) == 2


# --- Idempotency (SPEC §8) ---


def test_same_key_and_payload_replays_the_identical_response(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app
    payload = order_payload()

    first = post_order(client, payload, "replay-1")
    second = post_order(client, dict(payload), "replay-1")

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json() == first.json()
    assert len(stored_orders(engine)) == 1


def test_same_key_with_different_payload_is_rejected(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    first = post_order(client, order_payload(), "conflict-1")
    second = post_order(client, order_payload(quantity_kg=500), "conflict-1")

    assert first.status_code == 201
    assert second.status_code == 422
    assert "Idempotency-Key" in second.json()["error"]["message"]
    assert len(stored_orders(engine)) == 1


def test_missing_idempotency_key_is_rejected(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    response = post_order(client, order_payload(), None)

    assert response.status_code == 422
    assert stored_orders(engine) == []


# --- Business rules (SPEC §6) ---


def test_quantity_below_minimum_and_above_maximum_are_rejected(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _ = order_app

    too_small = post_order(client, order_payload(quantity_kg=39), "qty-low")
    too_large = post_order(client, order_payload(quantity_kg=20_001), "qty-high")

    assert too_small.status_code == 422
    assert "between 40kg and 20000kg" in too_small.json()["error"]["message"]
    assert too_large.status_code == 422


def test_bulk_orders_of_a_tonne_or_more_are_flagged(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    assert post_order(client, order_payload(quantity_kg=999), "bulk-999").status_code == 201
    second = post_order(
        client,
        order_payload(quantity_kg=1000, phone="0802 111 2233"),
        "bulk-1000",
    )
    assert second.status_code == 201

    flags = {order.quantity_kg: order.is_bulk for order in stored_orders(engine)}
    assert flags == {999: False, 1000: True}


def test_sold_out_size_is_rejected_with_a_clear_message(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _ = order_app

    response = post_order(client, order_payload(size="3kg-plus"), "sold-out")

    assert response.status_code == 422
    assert "currently unavailable" in response.json()["error"]["message"]


def test_unknown_or_inactive_size_is_rejected(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    unknown = post_order(client, order_payload(size="9-12kg"), "size-unknown")
    assert unknown.status_code == 422

    with Session(engine) as session:
        size = session.exec(select(SizeClass).where(SizeClass.slug == "1-5-2kg")).one()
        size.is_active = False
        session.add(size)
        session.commit()

    inactive = post_order(client, order_payload(size="1-5-2kg"), "size-inactive")
    assert inactive.status_code == 422
    assert "available in the catalog" in inactive.json()["error"]["message"]


def test_availability_unavailable_for_the_window_is_rejected(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    with Session(engine) as session:
        record = session.exec(select(Availability).where(Availability.status == "limited")).one()
        record.status = "unavailable"
        session.add(record)
        session.commit()

    response = post_order(client, order_payload(size="1-1-5kg"), "window-unavailable")

    assert response.status_code == 422
    assert "unavailable" in response.json()["error"]["message"]


def test_preferred_date_must_respect_lead_time_and_the_ninety_day_horizon(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _ = order_app
    today = lagos_today()

    too_soon = post_order(client, order_payload(preferred_date=today.isoformat()), "date-soon")
    too_far = post_order(
        client,
        order_payload(preferred_date=(today + timedelta(days=91)).isoformat()),
        "date-far",
    )

    assert too_soon.status_code == 422
    assert too_far.status_code == 422
    assert "within 90 days" in too_far.json()["error"]["message"]


def test_date_outside_the_harvest_window_is_accepted_and_linked_to_it(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app
    outside_window = (lagos_today() + timedelta(days=60)).isoformat()

    response = post_order(client, order_payload(preferred_date=outside_window), "hint")

    assert response.status_code == 201
    with Session(engine) as session:
        window = session.exec(select(HarvestWindow)).one()
        order = session.exec(select(Order)).one()
    assert order.harvest_window_id == window.id


def test_invalid_time_slot_is_rejected(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _ = order_app

    response = post_order(client, order_payload(time_slot="6-8"), "slot-invalid")

    assert response.status_code == 422
    assert "time slot" in response.json()["error"]["message"]


def test_delivery_requires_an_address_and_pickup_never_stores_one(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    missing_address = post_order(
        client,
        order_payload(fulfilment="delivery", delivery_address="short"),
        "delivery-short",
    )
    assert missing_address.status_code == 422
    assert "8 characters" in missing_address.json()["error"]["message"]

    delivered = post_order(
        client,
        order_payload(
            fulfilment="delivery",
            delivery_address="12 Unity Crescent, Ikeja",
            delivery_landmark="Opposite the market",
            phone="0802 444 5566",
        ),
        "delivery-ok",
    )
    assert delivered.status_code == 201

    pickup = post_order(
        client,
        order_payload(
            fulfilment="pickup",
            delivery_address="12 Unity Crescent, Ikeja",
            phone="0803 444 5566",
        ),
        "pickup-ok",
    )
    assert pickup.status_code == 201

    with Session(engine) as session:
        orders = {order.fulfilment: order for order in session.exec(select(Order)).all()}
    assert orders["delivery"].delivery_address == "12 Unity Crescent, Ikeja"
    assert orders["delivery"].delivery_landmark == "Opposite the market"
    assert orders["pickup"].delivery_address is None


def test_invalid_phone_numbers_are_rejected_before_an_order_is_written(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    response = post_order(client, order_payload(phone="0801 234"), "phone-bad")

    assert response.status_code == 422
    assert "valid Nigerian phone" in response.json()["error"]["message"]
    assert stored_orders(engine) == []


def test_notes_are_trimmed_and_stored_as_plain_text(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    response = post_order(client, order_payload(notes="  please call me  "), "notes-clean")

    assert response.status_code == 201
    with Session(engine) as session:
        order = session.exec(select(Order)).one()
    assert order.notes == "please call me"


def test_fish_type_is_restricted_to_the_allowed_values(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _ = order_app

    for index, fish_type in enumerate(("clarias", "hybrid", "any")):
        response = post_order(
            client,
            order_payload(fish_type=fish_type, phone=f"0804 111 22{index}0"),
            f"fish-{fish_type}",
        )
        assert response.status_code == 201

    invalid = post_order(client, order_payload(fish_type="tilapia"), "fish-invalid")
    assert invalid.status_code == 422


def test_customer_name_is_trimmed_and_persisted(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    response = post_order(client, order_payload(customer_name="  Ada Okafor  "), "name-trim")

    assert response.status_code == 201
    with Session(engine) as session:
        customer = session.exec(select(Customer)).one()
    assert customer.name == "Ada Okafor"
    assert customer.email == "ada@example.com"


# --- Spam protection (SPEC §6.12) ---


def _fake_siteverify(success: bool) -> Any:
    class _Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "success": success,
                "error-codes": [] if success else ["invalid-input-response"],
            }

    return _Response()


def test_honeypot_submissions_are_rejected_without_creating_orders(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    response = post_order(client, order_payload(website="http://spam.example"), "honeypot")

    assert response.status_code == 400
    assert stored_orders(engine) == []


def test_turnstile_is_skipped_when_no_secret_key_is_configured(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _ = order_app

    assert turnstile_module.is_turnstile_enforced() is False
    assert post_order(client, order_payload(turnstile_token=None), "ts-off").status_code == 201


def test_turnstile_rejects_a_missing_token_when_enforced(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, engine = order_app
    monkeypatch.setattr(turnstile_module.settings, "turnstile_secret_key", "test-secret")

    response = post_order(client, order_payload(), "ts-missing")

    assert response.status_code == 422
    assert stored_orders(engine) == []


def test_turnstile_accepts_a_verified_token_and_blocks_replays(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, engine = order_app
    monkeypatch.setattr(turnstile_module.settings, "turnstile_secret_key", "test-secret")
    monkeypatch.setattr(
        turnstile_module.httpx,
        "post",
        lambda *args, **kwargs: _fake_siteverify(success=True),
    )

    accepted = post_order(client, order_payload(turnstile_token="token-abc"), "ts-ok")
    assert accepted.status_code == 201

    replayed = post_order(
        client,
        order_payload(turnstile_token="token-abc", phone="0802 999 8877"),
        "ts-replay",
    )
    assert replayed.status_code == 422
    assert len(stored_orders(engine)) == 1


def test_turnstile_rejection_from_the_provider_stops_the_order(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, engine = order_app
    monkeypatch.setattr(turnstile_module.settings, "turnstile_secret_key", "test-secret")
    monkeypatch.setattr(
        turnstile_module.httpx,
        "post",
        lambda *args, **kwargs: _fake_siteverify(success=False),
    )

    response = post_order(client, order_payload(turnstile_token="token-bad"), "ts-bad")

    assert response.status_code == 422
    assert stored_orders(engine) == []


def test_turnstile_verifier_failure_returns_a_retryable_error(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, engine = order_app
    monkeypatch.setattr(turnstile_module.settings, "turnstile_secret_key", "test-secret")

    def _boom(*args: Any, **kwargs: Any) -> Any:
        raise turnstile_module.httpx.ConnectError("verifier unreachable")

    monkeypatch.setattr(turnstile_module.httpx, "post", _boom)

    response = post_order(client, order_payload(turnstile_token="token-x"), "ts-down")

    assert response.status_code == 503
    assert stored_orders(engine) == []


# --- Rate limits (SPEC §6.11) ---


def test_order_creation_is_limited_to_five_requests_per_ip_per_hour(
    rate_limited_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _ = rate_limited_app

    statuses = [
        post_order(client, order_payload(phone=f"0810{index:07d}"), f"ip-{index}").status_code
        for index in range(6)
    ]

    assert statuses[:5] == [201] * 5
    assert statuses[5] == 429


def test_order_creation_is_limited_to_three_orders_per_phone_per_hour(
    rate_limited_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _ = rate_limited_app
    payload = order_payload()

    statuses = [post_order(client, payload, f"phone-{index}").status_code for index in range(4)]

    assert statuses[:3] == [201, 201, 201]
    assert statuses[3] == 429
    assert "phone number" in post_order(client, payload, "phone-4").json()["error"]["message"]


def test_order_lookup_is_limited_to_ten_requests_per_ip(
    rate_limited_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _ = rate_limited_app
    created = post_order(client, order_payload(), "lookup-created")
    reference = created.json()["reference"]

    statuses = [
        client.post(
            "/api/v1/orders/lookup",
            json={"reference": reference, "phone": "0801 234 5678"},
        ).status_code
        for _ in range(11)
    ]

    assert statuses[:10] == [200] * 10
    assert statuses[10] == 429


# --- Public read, lookup and cancel (SPEC §8) ---


def test_public_order_view_requires_a_matching_token_and_hides_internal_data(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app
    created = post_order(client, order_payload(notes="Call the gatehouse"), "read-1")
    reference = created.json()["reference"]
    token = created.json()["access_token"]

    unauthorised = client.get(
        f"/api/v1/orders/{reference}",
        headers={"X-Order-Token": "wrong-token"},
    )
    assert unauthorised.status_code == 401

    response = client.get(f"/api/v1/orders/{reference}", headers={"X-Order-Token": token})
    assert response.status_code == 200
    body = response.json()
    assert body["reference"] == reference
    assert body["status"] == "pending"
    assert body["customer_phone_masked"] == "+234801***5678"
    assert "access_token" not in body
    assert "internal_notes" not in body
    assert "idempotency_key" not in body
    assert body["events"][0]["type"] == "created"

    with Session(engine) as session:
        order = session.exec(select(Order)).one()
        order.internal_notes = "Farm-only pricing note"
        session.add(order)
        session.commit()

    after = client.get(f"/api/v1/orders/{reference}", headers={"X-Order-Token": token})
    assert "Farm-only pricing note" not in after.text


def test_lookup_returns_the_order_and_rotates_the_access_token(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, _ = order_app
    created = post_order(client, order_payload(), "lookup-order")
    reference = created.json()["reference"]
    original_token = created.json()["access_token"]

    wrong_phone = client.post(
        "/api/v1/orders/lookup",
        json={"reference": reference, "phone": "0809 999 8877"},
    )
    assert wrong_phone.status_code == 404

    unknown = client.post(
        "/api/v1/orders/lookup",
        json={"reference": "AF-1999-9999", "phone": "0801 234 5678"},
    )
    assert unknown.status_code == 404

    response = client.post(
        "/api/v1/orders/lookup",
        json={"reference": reference, "phone": "0801 234 5678"},
    )
    assert response.status_code == 200
    body = response.json()
    fresh_token = body["access_token"]
    assert fresh_token != original_token
    assert body["order"]["reference"] == reference

    # The rotated token replaces the previous one: the old token stops working.
    assert (
        client.get(
            f"/api/v1/orders/{reference}",
            headers={"X-Order-Token": original_token},
        ).status_code
        == 401
    )
    assert (
        client.get(
            f"/api/v1/orders/{reference}",
            headers={"X-Order-Token": fresh_token},
        ).status_code
        == 200
    )


def test_customer_can_cancel_only_from_pending_or_quoted(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app
    created = post_order(client, order_payload(), "cancel-1")
    reference = created.json()["reference"]
    headers = {"X-Order-Token": created.json()["access_token"]}

    wrong_token = client.post(
        f"/api/v1/orders/{reference}/cancel",
        headers={"X-Order-Token": "nope"},
    )
    assert wrong_token.status_code == 401

    cancelled = client.post(f"/api/v1/orders/{reference}/cancel", headers=headers)
    assert cancelled.status_code == 200
    assert cancelled.json() == {"reference": reference, "status": "cancelled"}

    repeated = client.post(f"/api/v1/orders/{reference}/cancel", headers=headers)
    assert repeated.status_code == 409
    assert "cancelled" in repeated.json()["error"]["message"]

    with Session(engine) as session:
        order = session.exec(select(Order)).one()
        assert order.status == "cancelled"
        assert order.version == 2
        assert order.closed_at is not None

    status_changes = [event for event in stored_events(engine) if event.type == "status_change"]
    assert len(status_changes) == 1
    assert status_changes[0].from_status == "pending"
    assert status_changes[0].to_status == "cancelled"
    assert status_changes[0].actor_type == "customer"


def test_confirmed_orders_cannot_be_cancelled_by_the_customer(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app
    created = post_order(client, order_payload(), "cancel-confirmed")
    reference = created.json()["reference"]
    token = created.json()["access_token"]

    with Session(engine) as session:
        order = session.exec(select(Order)).one()
        order.status = "confirmed"
        session.add(order)
        session.commit()

    response = client.post(f"/api/v1/orders/{reference}/cancel", headers={"X-Order-Token": token})

    assert response.status_code == 409
    assert "confirmed" in response.json()["error"]["message"]


# --- Unit-level helpers ---


@pytest.mark.parametrize(
    "raw",
    ["08012345678", "+2348012345678", "2348012345678", "0801 234 5678", "+234 801 234 5678"],
)
def test_phone_normalisation_accepts_nigerian_formats(raw: str) -> None:
    assert normalize_nigerian_phone(raw) == "+2348012345678"


@pytest.mark.parametrize("raw", ["12345", "not-a-number", "0801234"])
def test_phone_normalisation_rejects_broken_numbers(raw: str) -> None:
    with pytest.raises(HTTPException) as error:
        normalize_nigerian_phone(raw)
    assert error.value.status_code == 422


def test_phone_masking_hides_the_middle_digits() -> None:
    assert mask_phone_number("+2348012345678") == "+234801***5678"
    assert mask_phone_number("12345") == "12345"


def test_access_token_derivation_is_deterministic_and_secret_dependent() -> None:
    first = derive_order_access_token("secret-one", "AF-2026-0001", "idem-1")
    same = derive_order_access_token("secret-one", "AF-2026-0001", "idem-1")
    other_secret = derive_order_access_token("secret-two", "AF-2026-0001", "idem-1")
    other_reference = derive_order_access_token("secret-one", "AF-2026-0002", "idem-1")

    assert first == same
    assert first != other_secret
    assert first != other_reference


def test_payload_hash_ignores_insignificant_whitespace() -> None:
    base = OrderCreateRequest(
        fish_type="clarias",
        size="2-3kg",
        quantity_kg=200,
        preferred_date=lagos_today() + timedelta(days=3),
        time_slot="10-12",
        fulfilment="pickup",
        customer_name="Ada Okafor",
        phone="08012345678",
        notes="call me",
    )
    spaced = OrderCreateRequest(
        fish_type="clarias",
        size="2-3kg",
        quantity_kg=200,
        preferred_date=lagos_today() + timedelta(days=3),
        time_slot="10-12",
        fulfilment="pickup",
        customer_name="  Ada Okafor ",
        phone=" 08012345678 ",
        notes="  call me ",
    )
    changed = base.model_copy(update={"quantity_kg": 500})

    assert compute_payload_hash(base) == compute_payload_hash(spaced)
    assert compute_payload_hash(base) != compute_payload_hash(changed)


# --- Postgres-only concurrency guarantees (SPEC §12, Addendum §A2/A6) ---
# These run when DATABASE_URL_TEST is set; they are skipped on SQLite because
# SQLite serialises writers and cannot exercise SELECT ... FOR UPDATE.


def test_concurrent_order_creation_produces_unique_sequential_references(
    postgres_engine: Engine,
) -> None:
    references = parallel_create_orders(postgres_engine, 6)

    assert len(set(references)) == 6
    year = str(lagos_today().year)
    assert all(reference.startswith(f"AF-{year}-") for reference in references)
    assert reference_sequence(references) == [1, 2, 3, 4, 5, 6]
    assert reference_sequence([order.reference for order in stored_orders(postgres_engine)]) == [
        1,
        2,
        3,
        4,
        5,
        6,
    ]


def test_concurrent_requests_with_one_idempotency_key_create_exactly_one_order(
    postgres_engine: Engine,
) -> None:
    references = parallel_create_orders(
        postgres_engine,
        5,
        shared_idempotency_key="same-key-all-threads",
    )

    assert len(set(references)) == 1
    assert len(stored_orders(postgres_engine)) == 1


def test_reference_sequences_are_kept_per_calendar_year(
    postgres_engine: Engine,
) -> None:
    references = parallel_create_orders(postgres_engine, 2)
    assert reference_sequence(references) == [1, 2]

    next_year = datetime.now(LAGOS).year + 1
    with Session(postgres_engine) as session:
        order, _token = create_order(
            session,
            OrderCreateRequest(
                fish_type="clarias",
                size="2-3kg",
                quantity_kg=200,
                preferred_date=default_preferred_date(),
                time_slot="10-12",
                fulfilment="pickup",
                delivery_address="",
                delivery_landmark="",
                notes="",
                customer_name="Year Rollover",
                phone="0801 111 2233",
                email="",
            ),
            "year-rollover",
            "127.0.0.1",
        )

    assert order.reference == f"AF-{next_year}-0001"


def test_order_events_are_written_for_every_concurrently_created_order(
    postgres_engine: Engine,
) -> None:
    parallel_create_orders(postgres_engine, 3)

    events = stored_events(postgres_engine)
    assert len(events) == 3
    assert {event.to_status for event in events} == {"pending"}
    assert all(event.order_id is not None for event in events)


def test_postgres_round_trip_preserves_lagos_dates_and_utc_timestamps(
    postgres_engine: Engine,
) -> None:
    parallel_create_orders(postgres_engine, 1)

    with Session(postgres_engine) as session:
        order = session.exec(select(Order)).one()
        assert isinstance(order.preferred_date, date)
        assert order.submitted_at.tzinfo is not None
        assert order.preferred_date >= lagos_today()
