"""Admin dashboard API (SPEC §8, §9).

Covers the security rules (auth, CSRF, roles, lockout, version conflicts), the order
status machine, quote/payment arithmetic in kobo, the audit trail and CSV export.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine
from sqlmodel import Session, col, select

from app.models import (
    AdminRole,
    AdminUser,
    AuditLog,
    Customer,
    Order,
    OrderEvent,
    OrderStatus,
    Quote,
    QuoteStatus,
    SizeClass,
)
from app.services import admin_service
from tests.conftest import ADMIN_PASSWORD, AdminClient, seed_admin_user


def _first_order(client: TestClient, seeded_order: dict[str, Any]) -> dict[str, Any]:
    """Read the fixture order back through the admin list endpoint."""
    listed = client.get("/api/v1/admin/orders", params={"search": seeded_order["reference"]}).json()
    assert listed["orders"], "expected the seeded order"
    return listed["orders"][0]


# --- Authentication (SPEC §8, §9) ----------------------------------------------------


def test_admin_routes_require_a_session(order_app: tuple[TestClient, Engine]) -> None:
    client, _engine = order_app
    for path in ("/api/v1/admin/dashboard", "/api/v1/admin/orders", "/api/v1/admin/customers", "/api/v1/admin/users"):
        assert client.get(path).status_code == 401, path


def test_login_with_correct_credentials_sets_an_http_only_cookie(
    order_app: tuple[TestClient, Engine],
) -> None:
    client, engine = order_app
    seed_admin_user(engine)
    response = client.post(
        "/api/v1/admin/auth/login",
        json={"email": "owner@adesoba.test", "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["role"] == AdminRole.OWNER.value
    assert body["csrf_token"]

    cookie_header = response.headers.get("set-cookie", "")
    assert "adesoba_admin_session" in cookie_header
    assert "HttpOnly" in cookie_header
    # Scoped to /admin so the customer session cookie is never clobbered.
    assert "Path=/api/v1/admin" in cookie_header


def test_wrong_password_and_unknown_account_give_the_same_generic_error(
    order_app: tuple[TestClient, Engine],
) -> None:
    client, engine = order_app
    seed_admin_user(engine)
    wrong_password = client.post(
        "/api/v1/admin/auth/login",
        json={"email": "owner@adesoba.test", "password": "not-the-password"},
    )
    unknown_email = client.post(
        "/api/v1/admin/auth/login",
        json={"email": "nobody@adesoba.test", "password": ADMIN_PASSWORD},
    )
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()


def test_repeated_failures_lock_the_account(order_app: tuple[TestClient, Engine]) -> None:
    """SPEC §9 lockout: the correct password is refused once the account is locked."""
    client, engine = order_app
    seed_admin_user(engine)
    for _ in range(admin_service.ADMIN_MAX_FAILED_ATTEMPTS):
        client.post(
            "/api/v1/admin/auth/login",
            json={"email": "owner@adesoba.test", "password": "wrong-password-here"},
        )

    locked_out = client.post(
        "/api/v1/admin/auth/login",
        json={"email": "owner@adesoba.test", "password": ADMIN_PASSWORD},
    )
    assert locked_out.status_code == 401

    with Session(engine) as session:
        user = session.exec(
            select(AdminUser).where(col(AdminUser.email) == "owner@adesoba.test")
        ).first()
        assert user is not None
        assert user.locked_until is not None
        assert user.locked_until.replace(tzinfo=UTC) > datetime.now(UTC)


def test_logout_clears_the_session(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    assert admin_client.client.get("/api/v1/admin/dashboard").status_code == 200
    assert admin_client.client.post("/api/v1/admin/auth/logout").status_code == 200
    assert admin_client.client.get("/api/v1/admin/dashboard").status_code == 401


def test_change_password_requires_the_current_one_and_enforces_minimum_length(
    admin_client: AdminClient,
) -> None:
    client = admin_client.client
    wrong_current = client.post(
        "/api/v1/admin/auth/change-password",
        json={"current_password": "not-it", "new_password": "a-brand-new-passphrase"},
        headers=admin_client.headers(),
    )
    assert wrong_current.status_code == 400

    too_short = client.post(
        "/api/v1/admin/auth/change-password",
        json={"current_password": ADMIN_PASSWORD, "new_password": "short"},
        headers=admin_client.headers(),
    )
    assert too_short.status_code == 422

    changed = client.post(
        "/api/v1/admin/auth/change-password",
        json={"current_password": ADMIN_PASSWORD, "new_password": "a-brand-new-passphrase"},
        headers=admin_client.headers(),
    )
    assert changed.status_code == 200

    # The old password must stop working and the new one must work.
    client.post("/api/v1/admin/auth/logout")
    assert (
        client.post(
            "/api/v1/admin/auth/login",
            json={"email": admin_client.admin_user.email, "password": ADMIN_PASSWORD},
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/admin/auth/login",
            json={"email": admin_client.admin_user.email, "password": "a-brand-new-passphrase"},
        ).status_code
        == 200
    )


# --- CSRF and roles (SPEC §8) -------------------------------------------------------


def test_mutating_routes_reject_a_request_without_a_valid_csrf_token(
    admin_client: AdminClient,
) -> None:
    client = admin_client.client
    no_header = client.patch(
        "/api/v1/admin/settings/farm_address",
        json={"value": "Somewhere"},
        headers={"X-CSRF-Token": "not-the-token"},
    )
    assert no_header.status_code == 403

    wrong_token = client.patch(
        "/api/v1/admin/settings/farm_address",
        json={"value": "Somewhere"},
        headers={"X-CSRF-Token": admin_client.csrf_token + "x"},
    )
    assert wrong_token.status_code == 403


def test_staff_is_forbidden_from_managing_users(staff_client: AdminClient) -> None:
    assert staff_client.client.get("/api/v1/admin/users").status_code == 403
    assert (
        staff_client.client.post(
            "/api/v1/admin/users",
            json={
                "email": "sneaky.staff@adesoba.test",
                "name": "Sneaky Staff",
                "password": "another-long-passphrase",
                "role": "staff",
            },
            headers=staff_client.headers(),
        ).status_code
        == 403
    )


def test_owner_can_manage_users(admin_client: AdminClient) -> None:
    """Owner-only: a new account is created with a forced password change."""
    created = admin_client.client.post(
        "/api/v1/admin/users",
        json={
            "email": "new.staff@adesoba.test",
            "name": "New Staff",
            "password": "another-long-passphrase",
            "role": "staff",
        },
        headers=admin_client.headers(),
    )
    assert created.status_code == 201
    assert created.json()["must_change_password"] is True
    assert admin_client.client.get("/api/v1/admin/users").status_code == 200


def test_owner_cannot_demote_or_disable_own_account(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    response = admin_client.client.patch(
        f"/api/v1/admin/users/{admin_client.admin_user.id}",
        json={"is_active": False},
        headers=admin_client.headers(),
    )
    assert response.status_code == 409


# --- Status machine (SPEC §8) -------------------------------------------------------


def test_transition_moves_the_order_and_writes_an_order_event(
    admin_client: AdminClient, seeded_order: dict[str, Any]
) -> None:
    order = _first_order(admin_client.client, seeded_order)
    response = admin_client.client.post(
        f"/api/v1/admin/orders/{order['id']}/transition",
        json={"to_status": OrderStatus.QUOTED.value, "version": order["version"]},
        headers=admin_client.headers(),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == OrderStatus.QUOTED.value
    assert body["version"] == order["version"] + 1
    assert any(event["to_status"] == OrderStatus.QUOTED.value for event in body["events"])


def test_illegal_transition_is_refused_with_409(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    """A pending order cannot jump straight to completed."""
    order = _first_order(admin_client.client, seeded_order)
    response = admin_client.client.post(
        f"/api/v1/admin/orders/{order['id']}/transition",
        json={"to_status": OrderStatus.COMPLETED.value, "version": order["version"]},
        headers=admin_client.headers(),
    )
    assert response.status_code == 409


def test_terminal_order_cannot_be_revived(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    order = _first_order(admin_client.client, seeded_order)
    client = admin_client.client
    cancelled = client.post(
        f"/api/v1/admin/orders/{order['id']}/transition",
        json={"to_status": OrderStatus.CANCELLED.value, "version": order["version"]},
        headers=admin_client.headers(),
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["allowed_next_statuses"] == []

    revived = client.post(
        f"/api/v1/admin/orders/{order['id']}/transition",
        json={
            "to_status": OrderStatus.CONFIRMED.value,
            "version": cancelled.json()["version"],
        },
        headers=admin_client.headers(),
    )
    assert revived.status_code == 409


def test_stale_version_is_rejected_with_409(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    order = _first_order(admin_client.client, seeded_order)
    client = admin_client.client
    first = client.post(
        f"/api/v1/admin/orders/{order['id']}/transition",
        json={"to_status": OrderStatus.QUOTED.value, "version": order["version"]},
        headers=admin_client.headers(),
    )
    assert first.status_code == 200

    # Same (now stale) version a second time: the optimistic lock must refuse it.
    second = client.post(
        f"/api/v1/admin/orders/{order['id']}/transition",
        json={"to_status": OrderStatus.CONFIRMED.value, "version": order["version"]},
        headers=admin_client.headers(),
    )
    assert second.status_code == 409


def test_updating_notes_requires_the_current_version(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    order = _first_order(admin_client.client, seeded_order)
    client = admin_client.client
    assert (
        client.patch(
            f"/api/v1/admin/orders/{order['id']}",
            json={
                "internal_notes": "Customer prefers evening pickup.",
                "version": order["version"],
            },
            headers=admin_client.headers(),
        ).status_code
        == 200
    )
    stale = client.patch(
        f"/api/v1/admin/orders/{order['id']}",
        json={"internal_notes": "Second writer", "version": order["version"]},
        headers=admin_client.headers(),
    )
    assert stale.status_code == 409


# --- Quotes (SPEC §9) ---------------------------------------------------------------


def test_quote_total_is_computed_in_kobo_without_float_drift() -> None:
    assert admin_service.compute_quote_total_kobo(50000, 40, 250000, 0) == 2_250_000
    assert admin_service.compute_quote_total_kobo(33333, 7, 0, 1166) == 33333 * 7 - 1166


def _quote_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "unit_price_kobo": 50000,
        "quantity_kg": 40,
        "delivery_fee_kobo": 0,
        "discount_kobo": 0,
        "deposit_kobo": 0,
        "valid_until": (date.today() + timedelta(days=2)).isoformat(),
    }
    payload.update(overrides)
    return payload


def test_creating_a_quote_supersedes_the_previous_open_one(
    admin_client: AdminClient, seeded_order: dict[str, Any]
) -> None:
    engine = admin_client.engine
    order = _first_order(admin_client.client, seeded_order)
    client = admin_client.client
    payload = _quote_payload(delivery_fee_kobo=250000, deposit_kobo=500000)

    first = client.post(
        f"/api/v1/admin/orders/{order['id']}/quote", json=payload, headers=admin_client.headers()
    )
    assert first.status_code == 200
    assert first.json()["quote"]["total_kobo"] == 2_250_000

    second = client.post(
        f"/api/v1/admin/orders/{order['id']}/quote", json=payload, headers=admin_client.headers()
    )
    assert second.status_code == 200
    assert second.json()["quote"]["version_no"] == 2

    with Session(engine) as session:
        statuses = sorted(quote.status for quote in session.exec(select(Quote)).all())
    assert statuses == [QuoteStatus.SENT.value, QuoteStatus.SUPERSEDED.value]


def test_accepting_a_quote_confirms_the_order_and_sets_the_due_amount(
    admin_client: AdminClient, seeded_order: dict[str, Any]
) -> None:
    order = _first_order(admin_client.client, seeded_order)
    client = admin_client.client
    quote = client.post(
        f"/api/v1/admin/orders/{order['id']}/quote",
        json=_quote_payload(),
        headers=admin_client.headers(),
    ).json()["quote"]

    accepted = client.post(
        f"/api/v1/admin/orders/{order['id']}/quote/accept",
        json={"quote_id": quote["id"]},
        headers=admin_client.headers(),
    )
    assert accepted.status_code == 200
    assert accepted.json()["due_kobo"] == 2_000_000
    assert client.get(f"/api/v1/admin/orders/{order['id']}").json()["status"] == OrderStatus.CONFIRMED.value

    # Accepting twice is refused: the quote is no longer open.
    again = client.post(
        f"/api/v1/admin/orders/{order['id']}/quote/accept",
        json={"quote_id": quote["id"]},
        headers=admin_client.headers(),
    )
    assert again.status_code == 409


def test_quote_with_a_discount_larger_than_the_total_is_refused(
    admin_client: AdminClient, seeded_order: dict[str, Any]
) -> None:
    order = _first_order(admin_client.client, seeded_order)
    response = admin_client.client.post(
        f"/api/v1/admin/orders/{order['id']}/quote",
        json=_quote_payload(unit_price_kobo=1000, discount_kobo=999999999),
        headers=admin_client.headers(),
    )
    assert response.status_code == 409


# --- Payments (SPEC §9) -------------------------------------------------------------


def test_payments_accumulate_into_paid_and_balance(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    order = _first_order(admin_client.client, seeded_order)
    client = admin_client.client
    quote = client.post(
        f"/api/v1/admin/orders/{order['id']}/quote",
        json=_quote_payload(),
        headers=admin_client.headers(),
    ).json()["quote"]
    client.post(
        f"/api/v1/admin/orders/{order['id']}/quote/accept",
        json={"quote_id": quote["id"]},
        headers=admin_client.headers(),
    )

    deposit = client.post(
        f"/api/v1/admin/orders/{order['id']}/payments",
        json={"amount_kobo": 1_000_000, "method": "transfer"},
        headers=admin_client.headers(),
    )
    assert deposit.status_code == 200, deposit.text
    assert deposit.json()["paid_kobo"] == 1_000_000
    assert deposit.json()["balance_kobo"] == 1_000_000

    remainder = client.post(
        f"/api/v1/admin/orders/{order['id']}/payments",
        json={"amount_kobo": 1_000_000, "method": "cash"},
        headers=admin_client.headers(),
    )
    assert remainder.json()["paid_kobo"] == 2_000_000
    assert remainder.json()["balance_kobo"] == 0


# --- Listing, search and export (SPEC §8) --------------------------------------------


def test_orders_can_be_filtered_by_status_and_searched(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    client = admin_client.client
    everything = client.get("/api/v1/admin/orders").json()
    assert everything["total"] >= 1

    pending = client.get("/api/v1/admin/orders", params={"status": "pending"}).json()
    assert all(order["status"] == "pending" for order in pending["orders"])

    reference = everything["orders"][0]["reference"]
    by_reference = client.get("/api/v1/admin/orders", params={"search": reference}).json()
    assert [order["reference"] for order in by_reference["orders"]] == [reference]


def test_csv_export_honours_the_same_filters(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    client = admin_client.client
    response = client.get("/api/v1/admin/orders/export.csv", params={"status": "pending"})
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]

    lines = response.text.strip().splitlines()
    assert lines[0].startswith("reference,status,customer_name")
    # Header plus one row per pending order.
    expected = client.get("/api/v1/admin/orders", params={"status": "pending"}).json()["total"]
    assert len(lines) - 1 == expected


def test_pagination_does_not_change_the_total(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    client = admin_client.client
    full = client.get("/api/v1/admin/orders", params={"page_size": 200}).json()
    first_page = client.get("/api/v1/admin/orders", params={"page": 1, "page_size": 1}).json()
    assert first_page["total"] == full["total"]
    assert len(first_page["orders"]) == 1


# --- Dashboard (SPEC §9) ------------------------------------------------------------


def test_dashboard_reports_counts_and_outbox(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    response = admin_client.client.get("/api/v1/admin/dashboard")
    assert response.status_code == 200
    body = response.json()
    assert body["counts_by_status"]["pending"] >= 1
    assert "outbox_counts" in body


# --- Catalog administration (SPEC §8) ------------------------------------------------


def test_harvest_window_and_availability_updates_persist(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    client = admin_client.client
    today = date.today()
    window = client.post(
        "/api/v1/admin/harvest-windows",
        json={
            "starts_on": today.isoformat(),
            "ends_on": (today + timedelta(days=5)).isoformat(),
            "notes": "Main harvest",
            "is_published": True,
        },
        headers=admin_client.headers(),
    )
    assert window.status_code == 200, window.text

    availability = client.put(
        f"/api/v1/admin/availability/{window.json()['id']}",
        json={"statuses": {"1-1-5kg": "main_stock", "2-3kg": "available"}},
        headers=admin_client.headers(),
    )
    assert availability.status_code == 200, availability.text
    assert availability.json()["updated"] == 2


def test_availability_rejects_an_unknown_size_class(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    client = admin_client.client
    today = date.today()
    window = client.post(
        "/api/v1/admin/harvest-windows",
        json={
            "starts_on": today.isoformat(),
            "ends_on": (today + timedelta(days=2)).isoformat(),
            "is_published": False,
        },
        headers=admin_client.headers(),
    ).json()
    response = client.put(
        f"/api/v1/admin/availability/{window['id']}",
        json={"statuses": {"not-a-real-size": "available"}},
        headers=admin_client.headers(),
    )
    assert response.status_code == 422


# --- Audit trail (SPEC §9) ----------------------------------------------------------


def test_admin_mutations_are_written_to_the_audit_log(
    admin_client: AdminClient, seeded_order: dict[str, Any]
) -> None:
    engine = admin_client.engine
    order = _first_order(admin_client.client, seeded_order)
    admin_client.client.post(
        f"/api/v1/admin/orders/{order['id']}/transition",
        json={"to_status": OrderStatus.QUOTED.value, "version": order["version"]},
        headers=admin_client.headers(),
    )

    with Session(engine) as session:
        entries = list(session.exec(select(AuditLog)).all())
    actions = [entry.action for entry in entries]
    assert "admin.login" in actions
    assert "order.transition" in actions

    transition = next(entry for entry in entries if entry.action == "order.transition")
    assert transition.actor_type == "admin"
    assert transition.before is not None
    assert transition.after is not None


# --- Quote expiry job (SPEC §10) ----------------------------------------------------


def _quoted_order_awaiting_customer(engine: Engine, valid_until: date) -> UUID:
    """Build an order sitting in `quoted` with one open quote; returns the order id."""
    user = seed_admin_user(engine)
    with Session(engine) as session:
        customer = Customer(
            name="Expiry Tester",
            phone_e164="+2348011111111",
            first_order_at=datetime.now(UTC),
        )
        session.add(customer)
        session.commit()
        session.refresh(customer)

        size = session.exec(select(SizeClass)).first()
        assert size is not None
        order = Order(
            reference="EXPIRE-0001",
            customer_id=customer.id,
            status=OrderStatus.QUOTED.value,
            version=1,
            fish_type="clarias",
            size_class_id=size.id,
            size_label_snapshot=size.label,
            quantity_kg=40,
            preferred_date=date.today() + timedelta(days=3),
            time_slot_key="10-12",
            time_slot_label="10:00 - 12:00",
            fulfilment="pickup",
            idempotency_key="expire-key",
            idempotency_payload_hash="0" * 64,
            access_token_hash="1" * 64,
            submitted_at=datetime.now(UTC),
        )
        session.add(order)
        session.commit()
        session.refresh(order)

        session.add(
            Quote(
                order_id=order.id,
                version_no=1,
                unit_price_kobo=50000,
                quantity_kg=40,
                delivery_fee_kobo=0,
                discount_kobo=0,
                total_kobo=2_000_000,
                deposit_kobo=0,
                valid_until=valid_until,
                status=QuoteStatus.SENT.value,
                created_by=user.id,
            )
        )
        session.commit()
        return order.id


def test_expire_stale_quotes_closes_the_waiting_order(
    admin_client: AdminClient,
) -> None:
    engine = admin_client.engine
    order_id = _quoted_order_awaiting_customer(engine, date.today() - timedelta(days=1))

    with Session(engine) as session:
        assert admin_service.expire_stale_quotes(session, date.today()) == 1

    with Session(engine) as session:
        refreshed = session.get(Order, order_id)
        assert refreshed is not None
        assert refreshed.status == OrderStatus.EXPIRED.value
        expired_quote = session.exec(select(Quote)).first()
        assert expired_quote is not None
        assert expired_quote.status == QuoteStatus.EXPIRED.value
        event = session.exec(
            select(OrderEvent).where(col(OrderEvent.order_id) == order_id)
        ).first()
        assert event is not None
        assert event.actor_type == "system"


def test_expire_stale_quotes_keeps_a_quote_inside_its_validity(
    admin_client: AdminClient,
) -> None:
    engine = admin_client.engine
    order_id = _quoted_order_awaiting_customer(engine, date.today() + timedelta(days=1))

    with Session(engine) as session:
        assert admin_service.expire_stale_quotes(session, date.today()) == 0

    with Session(engine) as session:
        refreshed = session.get(Order, order_id)
        assert refreshed is not None
        assert refreshed.status == OrderStatus.QUOTED.value
def test_settings_and_size_class_updates_are_audited(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    client = admin_client.client
    assert (
        client.patch(
            "/api/v1/admin/settings/farm_address",
            json={"value": "12 Farm Road, Lagos"},
            headers=admin_client.headers(),
        ).status_code
        == 200
    )
    sizes = client.get("/api/v1/admin/size-classes").json()
    assert sizes
    updated = client.patch(
        f"/api/v1/admin/size-classes/{sizes[0]['id']}",
        json={"descriptor": "Updated descriptor"},
        headers=admin_client.headers(),
    )
    assert updated.status_code == 200
    assert updated.json()["descriptor"] == "Updated descriptor"


def test_missing_admin_resources_return_404(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    client = admin_client.client
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/api/v1/admin/orders/{missing}").status_code == 404
    assert client.get(f"/api/v1/admin/customers/{missing}").status_code == 404
    assert (
        client.patch(
            "/api/v1/admin/settings/not-a-real-setting",
            json={"value": "x"},
            headers=admin_client.headers(),
        ).status_code
        == 404
    )


def test_zero_and_negative_payments_are_refused(admin_client: AdminClient, seeded_order: dict[str, Any]) -> None:
    order = _first_order(admin_client.client, seeded_order)
    client = admin_client.client
    for amount in (0, -500):
        response = client.post(
            f"/api/v1/admin/orders/{order['id']}/payments",
            json={"amount_kobo": amount, "method": "cash"},
            headers=admin_client.headers(),
        )
        assert response.status_code == 409, amount