"""Admin API routes (SPEC §8, §9).

Split out of `main.py` because this is a large, self-contained surface with its own
authentication rules. Every route depends on `require_admin`, so an unauthenticated call
never reaches business logic, and every mutating route additionally checks the CSRF token.
"""

import csv
import io
import logging
from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import JsonValue
from sqlmodel import Session, col, func, select

from app.config import settings
from app.db import get_session
from app.models import (
    AdminSession,
    AdminUser,
    Availability,
    ContactMessage,
    Customer,
    FishType,
    HarvestWindow,
    Order,
    OrderEvent,
    OrderStatus,
    Payment,
    Quote,
    SiteSetting,
    SizeClass,
)
from app.rate_limiter import check_rate_limit, get_client_ip
from app.schemas import (
    AdminAvailabilityUpdate,
    AdminChangePasswordRequest,
    AdminCustomerDetail,
    AdminCustomerOut,
    AdminCountsByStatus,
    AdminDashboardResponse,
    AdminFishTypeOut,
    AdminFishTypeUpdate,
    AdminHarvestWindowIn,
    AdminHarvestWindowOut,
    AdminLoginRequest,
    AdminLoginResponse,
    AdminMeResponse,
    AdminMessageOut,
    AdminMessageUpdate,
    AdminOrderDetail,
    AdminOrderListItem,
    AdminOrderListResponse,
    AdminOrderUpdateRequest,
    AdminPaymentOut,
    AdminPaymentRequest,
    AdminPaymentResponse,
    AdminQuoteAcceptRequest,
    AdminQuoteOut,
    AdminQuoteRequest,
    AdminQuoteResponse,
    AdminSettingsResponse,
    AdminSettingsUpdate,
    AdminSizeClassOut,
    AdminSizeClassUpdate,
    AdminTransitionRequest,
    AdminUserCreate,
    AdminUserSummary,
    AdminUserUpdate,
    OrderEventPublic,
)
from app.services import admin_service
from app.services.email.outbox import outbox_counts
from app.services.admin_service import (
    ADMIN_SESSION_COOKIE_NAME,
    AdminAuthError,
    AdminConflictError,
    AdminForbiddenError,
    AdminNotFoundError,
)

logger = logging.getLogger("adesoba.admin")

router = APIRouter(prefix="/admin", tags=["admin"])

LAGOS = ZoneInfo("Africa/Lagos")
# Login throttling: 5 attempts per IP per 15 minutes, on top of the per-account lockout.
ADMIN_LOGIN_LIMIT = 5
ADMIN_LOGIN_WINDOW_SECONDS = 15 * 60


def _admin_session_context(
    request: Request,
    session: Session = Depends(get_session),
) -> tuple[admin_service.AdminSession, AdminUser, str]:
    """Resolve the admin session or raise 401; every route depends on this."""
    raw_session_id = request.cookies.get(ADMIN_SESSION_COOKIE_NAME)
    resolved = admin_service.resolve_admin_session(session, raw_session_id)
    if resolved is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in required."
        )
    record, user = resolved
    return record, user, raw_session_id or ""


require_admin = Annotated[tuple, Depends(_admin_session_context)]


def _csrf_guard(context: tuple, csrf_token: str | None) -> None:
    record, _user, raw_session_id = context
    if not admin_service.verify_admin_csrf(record, raw_session_id, csrf_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token.")


def _client_ip(request: Request) -> str:
    return get_client_ip(request)


def _user_payload(user: AdminUser) -> AdminUserSummary:
    return AdminUserSummary(
        id=str(user.id),
        email=user.email,
        name=user.name,
        role=user.role,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        last_login_at=user.last_login_at,
    )


ALLOWED_STATUS_VALUES = tuple(status_value for status_value in admin_service.ALLOWED_TRANSITIONS)


# --- Auth (SPEC §8) ---------------------------------------------------------------


@router.post("/auth/login", response_model=AdminLoginResponse)
def admin_login(
    payload: AdminLoginRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> AdminLoginResponse:
    # Rate limit per IP so one attacker cannot grind many accounts; the per-account
    # lockout inside authenticate() is what protects a single account.
    check_rate_limit(
        f"admin_login_ip:{_client_ip(request)}",
        limit=ADMIN_LOGIN_LIMIT,
        window_seconds=ADMIN_LOGIN_WINDOW_SECONDS,
    )
    try:
        user = admin_service.authenticate(session, payload.email, payload.password)
    except AdminAuthError as auth_error:
        raise _translate(auth_error) from auth_error

    tokens = admin_service.create_admin_session(
        session,
        user,
        created_ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    admin_service.record_audit(
        session,
        admin_user=user,
        action="admin.login",
        entity="admin_user",
        entity_id=str(user.id),
        ip=_client_ip(request),
    )
    session.commit()

    response.set_cookie(
        ADMIN_SESSION_COOKIE_NAME,
        tokens.raw_session_id,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        max_age=admin_service.ADMIN_ABSOLUTE_TIMEOUT_SECONDS,
        path="/admin",
    )
    return AdminLoginResponse(
        user=_user_payload(user),
        csrf_token=tokens.csrf_token,
        must_change_password=user.must_change_password,
    )


@router.post("/auth/logout")
def admin_logout(
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> dict[str, bool]:
    raw_session_id = request.cookies.get(ADMIN_SESSION_COOKIE_NAME)
    resolved = admin_service.resolve_admin_session(session, raw_session_id)
    if resolved is not None:
        record, user = resolved
        admin_service.record_audit(
            session,
            admin_user=user,
            action="admin.logout",
            entity="admin_user",
            entity_id=str(user.id),
            ip=_client_ip(request),
        )
        admin_service.delete_admin_session(session, record)
    response.delete_cookie(ADMIN_SESSION_COOKIE_NAME, path="/admin")
    return {"signed_out": True}


@router.get("/auth/me", response_model=AdminMeResponse)
def admin_me(context: require_admin) -> AdminMeResponse:
    _record, user, _raw = context
    return AdminMeResponse(user=_user_payload(user), csrf_token=None)


@router.post("/auth/change-password")
def admin_change_password(
    payload: AdminChangePasswordRequest,
    request: Request,
    context: require_admin,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> dict[str, bool]:
    _record, user, _raw = context
    _csrf_guard(context, x_csrf_token)
    if not admin_service.verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect."
        )
    strength = admin_service.validate_password_strength(payload.new_password)
    if strength:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=strength)
    if payload.current_password == payload.new_password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose a password different from the current one.",
        )
    user.password_hash = admin_service.hash_password(payload.new_password)
    user.must_change_password = False
    user.updated_at = datetime.now(UTC)
    session.add(user)
    admin_service.record_audit(
        session,
        admin_user=user,
        action="admin.change_password",
        entity="admin_user",
        entity_id=str(user.id),
        ip=_client_ip(request),
    )
    session.commit()
    return {"password_changed": True}


# --- Dashboard (SPEC §9) -----------------------------------------------------------


@router.get("/dashboard", response_model=AdminDashboardResponse)
def admin_dashboard(
    request: Request,
    context: require_admin,
    session: Session = Depends(get_session),
) -> AdminDashboardResponse:
    """Counts for the dashboard cards. Cheap aggregate queries only."""
    _record, user, _raw = context
    today = datetime.now(LAGOS).date()
    week_end = today + timedelta(days=7)

    counts = {value: 0 for value in ALLOWED_STATUS_VALUES}
    for order_status, count in session.exec(
        select(Order.status, func.count()).group_by(Order.status)
    ).all():
        if order_status in counts:
            counts[order_status] = count

    open_statuses = (
        OrderStatus.CONFIRMED.value,
        OrderStatus.READY.value,
        OrderStatus.COMPLETED.value,
    )
    todays = list(
        session.exec(
            select(Order).where(
                col(Order.preferred_date) == today,
                col(Order.status).in_(open_statuses),
            )
        ).all()
    )
    week_volume: int | None = session.exec(
        select(func.sum(Order.quantity_kg)).where(
            col(Order.preferred_date) >= today,
            col(Order.preferred_date) <= week_end,
            col(Order.status) == OrderStatus.CONFIRMED.value,
        )
    ).one()
    bulk_upcoming = session.exec(
        select(func.count()).where(
            col(Order.is_bulk).is_(True),
            col(Order.preferred_date) >= today,
            col(Order.status).in_(
                [
                    OrderStatus.PENDING.value,
                    OrderStatus.QUOTED.value,
                    OrderStatus.CONFIRMED.value,
                ]
            ),
        )
    ).one()
    unhandled = session.exec(
        select(func.count()).where(col(ContactMessage.status) == "new")
    ).one()

    admin_service.record_audit(
        session,
        admin_user=user,
        action="dashboard.view",
        entity="dashboard",
        entity_id=None,
        ip=_client_ip(request),
    )
    session.commit()

    return AdminDashboardResponse(
        counts_by_status=AdminCountsByStatus(**counts),
        today_pickups=sum(1 for order in todays if order.fulfilment == "pickup"),
        today_deliveries=sum(1 for order in todays if order.fulfilment == "delivery"),
        week_confirmed_volume_kg=int(week_volume or 0),
        upcoming_bulk_orders=int(bulk_upcoming),
        unhandled_messages=int(unhandled),
        outbox_counts=outbox_counts(session),
    )


# --- Orders (SPEC §8, §9) ----------------------------------------------------------


def _apply_order_filters(
    session: Session,
    status_filter: str | None,
    from_date: date | None,
    to_date: date | None,
    fulfilment: str | None,
    size_class_id: UUID | None,
    bulk_only: bool | None,
    search: str | None,
    sort: str,
) -> list[Order]:
    statement = select(Order)
    if status_filter:
        statement = statement.where(col(Order.status) == status_filter)
    if from_date:
        statement = statement.where(col(Order.preferred_date) >= from_date)
    if to_date:
        statement = statement.where(col(Order.preferred_date) <= to_date)
    if fulfilment:
        statement = statement.where(col(Order.fulfilment) == fulfilment)
    if size_class_id:
        statement = statement.where(col(Order.size_class_id) == size_class_id)
    if bulk_only:
        statement = statement.where(col(Order.is_bulk).is_(True))

    orders = list(session.exec(statement).all())

    # Name and phone live on the customer row, so the search term needs a customer lookup
    # rather than a column filter; it is applied here so the list and the CSV export share
    # exactly one filtering implementation.
    if search:
        needle = search.strip().lower()
        customer_ids = {
            customer.id
            for customer in session.exec(select(Customer)).all()
            if needle in customer.name.lower()
            or needle in customer.phone_e164.lower()
            or needle in (customer.email or "").lower()
        }
        orders = [
            order
            for order in orders
            if needle in order.reference.lower() or order.customer_id in customer_ids
        ]

    if sort == "oldest":
        orders.sort(key=lambda order: order.submitted_at)
    elif sort == "preferred_date":
        orders.sort(key=lambda order: (order.preferred_date, order.submitted_at))
    elif sort == "quantity":
        orders.sort(key=lambda order: -order.quantity_kg)
    else:
        orders.sort(key=lambda order: order.submitted_at, reverse=True)
    return orders


def _list_items(session: Session, orders: list[Order]) -> list[AdminOrderListItem]:
    if not orders:
        return []
    customers = {
        customer.id: customer
        for customer in session.exec(
            select(Customer).where(col(Customer.id).in_([order.customer_id for order in orders]))
        ).all()
    }
    items = []
    for order in orders:
        customer = customers.get(order.customer_id)
        items.append(
            AdminOrderListItem(
                id=str(order.id),
                reference=order.reference,
                status=order.status,
                customer_name=customer.name if customer else "",
                customer_phone=customer.phone_e164 if customer else "",
                fish_type=order.fish_type,
                size_label=order.size_label_snapshot,
                quantity_kg=order.quantity_kg,
                is_bulk=order.is_bulk,
                preferred_date=order.preferred_date,
                time_slot_label=order.time_slot_label,
                fulfilment=order.fulfilment,
                submitted_at=order.submitted_at,
                version=order.version,
            )
        )
    return items


@router.get("/orders", response_model=AdminOrderListResponse)
def admin_list_orders(
    context: require_admin,
    status_filter: str | None = Query(default=None, alias="status"),
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    fulfilment: str | None = Query(default=None, pattern="^(pickup|delivery)$"),
    size_class_id: UUID | None = Query(default=None, alias="size"),
    bulk_only: bool | None = Query(default=None, alias="bulk"),
    search: str | None = Query(default=None, max_length=80),
    sort: str = Query(default="newest", pattern="^(newest|oldest|preferred_date|quantity)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    session: Session = Depends(get_session),
) -> AdminOrderListResponse:
    _record, _user, _raw = context
    orders = _apply_order_filters(
        session,
        status_filter,
        from_date,
        to_date,
        fulfilment,
        size_class_id,
        bulk_only,
        search,
        sort,
    )
    start = (page - 1) * page_size
    return AdminOrderListResponse(
        orders=_list_items(session, orders[start : start + page_size]),
        total=len(orders),
        page=page,
        page_size=page_size,
    )


@router.get("/orders/export.csv")
def admin_export_orders_csv(
    request: Request,
    context: require_admin,
    status_filter: str | None = Query(default=None, alias="status"),
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    fulfilment: str | None = Query(default=None, pattern="^(pickup|delivery)$"),
    size_class_id: UUID | None = Query(default=None, alias="size"),
    bulk_only: bool | None = Query(default=None, alias="bulk"),
    search: str | None = Query(default=None, max_length=80),
    sort: str = Query(default="newest", pattern="^(newest|oldest|preferred_date|quantity)$"),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """CSV export honouring exactly the same filters as the list endpoint (SPEC §8)."""
    _record, user, _raw = context
    orders = _apply_order_filters(
        session,
        status_filter,
        from_date,
        to_date,
        fulfilment,
        size_class_id,
        bulk_only,
        search,
        sort,
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "reference",
            "status",
            "customer_name",
            "customer_phone",
            "fish_type",
            "size",
            "quantity_kg",
            "preferred_date",
            "time_slot",
            "fulfilment",
            "is_bulk",
            "submitted_at",
        ]
    )
    for item in _list_items(session, orders):
        writer.writerow(
            [
                item.reference,
                item.status,
                item.customer_name,
                item.customer_phone,
                item.fish_type,
                item.size_label,
                item.quantity_kg,
                item.preferred_date.isoformat(),
                item.time_slot_label,
                item.fulfilment,
                "yes" if item.is_bulk else "no",
                item.submitted_at.isoformat(),
            ]
        )

    admin_service.record_audit(
        session,
        admin_user=user,
        action="orders.export_csv",
        entity="order",
        entity_id=None,
        after={"row_count": len(orders)},
        ip=_client_ip(request),
    )
    session.commit()

    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="orders.csv"'},
    )


def _parse_uuid_or_none(value: str | None) -> UUID | None:
    if not value:
        return None
    try:
        return UUID(value)
    except ValueError as invalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="assigned_to must be a valid UUID.",
        ) from invalid


def _quote_payload(quote: Quote) -> AdminQuoteOut:
    return AdminQuoteOut(
        id=str(quote.id),
        version_no=quote.version_no,
        unit_price_kobo=quote.unit_price_kobo,
        quantity_kg=quote.quantity_kg,
        delivery_fee_kobo=quote.delivery_fee_kobo,
        discount_kobo=quote.discount_kobo,
        total_kobo=quote.total_kobo,
        deposit_kobo=quote.deposit_kobo,
        valid_until=quote.valid_until,
        message_to_customer=quote.message_to_customer,
        status=quote.status,
        created_at=quote.created_at,
        accepted_at=quote.accepted_at,
    )


@router.get("/orders/{order_id}", response_model=AdminOrderDetail)
def admin_get_order(
    order_id: UUID,
    context: require_admin,
    session: Session = Depends(get_session),
) -> AdminOrderDetail:
    _record, _user, _raw = context
    try:
        order = admin_service.get_order_for_admin(session, order_id)
    except AdminNotFoundError as not_found:
        raise _translate(not_found) from not_found

    customer = session.exec(
        select(Customer).where(col(Customer.id) == order.customer_id)
    ).first()
    quotes = list(
        session.exec(
            select(Quote)
            .where(col(Quote.order_id) == order.id)
            .order_by(col(Quote.version_no).desc())
        ).all()
    )
    payments = list(
        session.exec(
            select(Payment)
            .where(col(Payment.order_id) == order.id)
            .order_by(col(Payment.received_at))
        ).all()
    )
    events = list(
        session.exec(
            select(OrderEvent)
            .where(col(OrderEvent.order_id) == order.id)
            .order_by(col(OrderEvent.created_at))
        ).all()
    )
    summary = admin_service.payment_summary(session, order.id)

    return AdminOrderDetail(
        id=str(order.id),
        reference=order.reference,
        status=order.status,
        version=order.version,
        allowed_next_statuses=admin_service.allowed_next_statuses(order.status),
        customer_name=customer.name if customer else "",
        customer_phone=customer.phone_e164 if customer else "",
        customer_email=customer.email if customer else None,
        customer_notes=customer.notes if customer else None,
        fish_type=order.fish_type,
        size_label=order.size_label_snapshot,
        quantity_kg=order.quantity_kg,
        is_bulk=order.is_bulk,
        preferred_date=order.preferred_date,
        time_slot_label=order.time_slot_label,
        fulfilment=order.fulfilment,
        delivery_address=order.delivery_address,
        delivery_landmark=order.delivery_landmark,
        notes=order.notes,
        internal_notes=order.internal_notes,
        assigned_to=str(order.assigned_to) if order.assigned_to else None,
        source_intent=order.source_intent,
        submitted_at=order.submitted_at,
        closed_at=order.closed_at,
        quotes=[_quote_payload(quote) for quote in quotes],
        payments=[
            AdminPaymentOut(
                id=str(payment.id),
                amount_kobo=payment.amount_kobo,
                method=payment.method,
                reference=payment.reference,
                note=payment.note,
                received_at=payment.received_at,
            )
            for payment in payments
        ],
        paid_kobo=summary.paid_kobo,
        due_kobo=summary.due_kobo,
        balance_kobo=summary.balance_kobo,
        events=[OrderEventPublic.model_validate(event) for event in events],
    )


@router.patch("/orders/{order_id}", response_model=AdminOrderDetail)
def admin_update_order(
    order_id: UUID,
    payload: AdminOrderUpdateRequest,
    request: Request,
    context: require_admin,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> AdminOrderDetail:
    """Internal notes and assignment. The caller's `version` guards against lost updates."""
    _record, user, _raw = context
    _csrf_guard(context, x_csrf_token)
    try:
        order = admin_service.get_order_for_admin(session, order_id)
        admin_service.update_order_notes(
            session,
            order,
            internal_notes=payload.internal_notes,
            assigned_to=_parse_uuid_or_none(payload.assigned_to),
            expected_version=payload.version,
            admin_user=user,
            ip=_client_ip(request),
        )
    except AdminNotFoundError as not_found:
        raise _translate(not_found) from not_found
    except AdminConflictError as conflict:
        raise _translate(conflict) from conflict
    return admin_get_order(order_id, context, session)


@router.post("/orders/{order_id}/transition", response_model=AdminOrderDetail)
def admin_transition_order(
    order_id: UUID,
    payload: AdminTransitionRequest,
    request: Request,
    context: require_admin,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> AdminOrderDetail:
    _record, user, _raw = context
    _csrf_guard(context, x_csrf_token)
    try:
        order = admin_service.get_order_for_admin(session, order_id)
        admin_service.transition_order(
            session,
            order,
            payload.to_status,
            expected_version=payload.version,
            admin_user=user,
            note=payload.note,
            ip=_client_ip(request),
        )
    except AdminNotFoundError as not_found:
        raise _translate(not_found) from not_found
    except AdminConflictError as conflict:
        raise _translate(conflict) from conflict
    return admin_get_order(order_id, context, session)


@router.post("/orders/{order_id}/quote", response_model=AdminQuoteResponse)
def admin_create_quote(
    order_id: UUID,
    payload: AdminQuoteRequest,
    request: Request,
    context: require_admin,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> AdminQuoteResponse:
    _record, user, _raw = context
    _csrf_guard(context, x_csrf_token)
    try:
        order = admin_service.get_order_for_admin(session, order_id)
        quote = admin_service.create_quote(
            session,
            order,
            unit_price_kobo=payload.unit_price_kobo,
            quantity_kg=payload.quantity_kg,
            delivery_fee_kobo=payload.delivery_fee_kobo,
            discount_kobo=payload.discount_kobo,
            deposit_kobo=payload.deposit_kobo,
            valid_until=payload.valid_until,
            message_to_customer=payload.message_to_customer,
            admin_user=user,
            ip=_client_ip(request),
        )
    except AdminNotFoundError as not_found:
        raise _translate(not_found) from not_found
    except AdminConflictError as conflict:
        raise _translate(conflict) from conflict
    summary = admin_service.payment_summary(session, order_id)
    return AdminQuoteResponse(
        quote=_quote_payload(quote),
        paid_kobo=summary.paid_kobo,
        due_kobo=summary.due_kobo,
        balance_kobo=summary.balance_kobo,
    )


@router.post("/orders/{order_id}/quote/accept", response_model=AdminQuoteResponse)
def admin_accept_quote(
    order_id: UUID,
    payload: AdminQuoteAcceptRequest,
    request: Request,
    context: require_admin,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> AdminQuoteResponse:
    _record, user, _raw = context
    _csrf_guard(context, x_csrf_token)
    try:
        order = admin_service.get_order_for_admin(session, order_id)
        try:
            quote_id = UUID(payload.quote_id)
        except ValueError as invalid:
            raise AdminNotFoundError("Quote not found.") from invalid
        quote = session.exec(select(Quote).where(col(Quote.id) == quote_id)).first()
        if quote is None:
            raise AdminNotFoundError("Quote not found.")
        accepted = admin_service.accept_quote(
            session, order, quote, admin_user=user, ip=_client_ip(request)
        )
    except AdminNotFoundError as not_found:
        raise _translate(not_found) from not_found
    except AdminConflictError as conflict:
        raise _translate(conflict) from conflict
    summary = admin_service.payment_summary(session, order_id)
    return AdminQuoteResponse(
        quote=_quote_payload(accepted),
        paid_kobo=summary.paid_kobo,
        due_kobo=summary.due_kobo,
        balance_kobo=summary.balance_kobo,
    )


@router.post("/orders/{order_id}/payments", response_model=AdminPaymentResponse)
def admin_record_payment(
    order_id: UUID,
    payload: AdminPaymentRequest,
    request: Request,
    context: require_admin,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> AdminPaymentResponse:
    _record, user, _raw = context
    _csrf_guard(context, x_csrf_token)
    try:
        order = admin_service.get_order_for_admin(session, order_id)
        payment = admin_service.record_payment(
            session,
            order,
            amount_kobo=payload.amount_kobo,
            method=payload.method,
            reference=payload.reference,
            note=payload.note,
            admin_user=user,
            received_at=payload.received_at,
            ip=_client_ip(request),
        )
    except AdminNotFoundError as not_found:
        raise _translate(not_found) from not_found
    except AdminConflictError as conflict:
        raise _translate(conflict) from conflict
    summary = admin_service.payment_summary(session, order_id)
    return AdminPaymentResponse(
        payment=AdminPaymentOut(
            id=str(payment.id),
            amount_kobo=payment.amount_kobo,
            method=payment.method,
            reference=payment.reference,
            note=payment.note,
            received_at=payment.received_at,
        ),
        paid_kobo=summary.paid_kobo,
        due_kobo=summary.due_kobo,
        balance_kobo=summary.balance_kobo,
    )


# --- Availability & harvest (SPEC §8, §9) -----------------------------------------


def _trigger_revalidation(reason: str) -> None:
    """
    Ask Next.js to revalidate the public pages after a catalog change (SPEC §8).

    Best-effort by design: the admin edit has already been committed, so a failed
    webhook must not roll it back. The public catalog has a short revalidate window as a
    backstop, so the worst case is a short delay rather than stale content forever.
    """
    import httpx

    if not settings.revalidate_secret or not settings.web_origin:
        logger.info("Revalidation webhook not configured; skipping (%s)", reason)
        return
    try:
        httpx.post(
            f"{settings.web_origin.rstrip('/')}/api/revalidate",
            json={"reason": reason},
            headers={"x-revalidate-secret": settings.revalidate_secret},
            timeout=5.0,
        )
    except Exception:
        logger.warning("Revalidation webhook failed for %s; catalog revalidates on schedule", reason)


@router.get("/harvest-windows", response_model=list[AdminHarvestWindowOut])
def admin_list_harvest_windows(
    context: require_admin,
    session: Session = Depends(get_session),
) -> list[AdminHarvestWindowOut]:
    _record, _user, _raw = context
    windows = session.exec(
        select(HarvestWindow).order_by(col(HarvestWindow.starts_on).desc())
    ).all()
    return [
        AdminHarvestWindowOut(
            id=str(window.id),
            starts_on=window.starts_on,
            ends_on=window.ends_on,
            notes=window.notes,
            is_published=window.is_published,
        )
        for window in windows
    ]


@router.post("/harvest-windows", response_model=AdminHarvestWindowOut)
def admin_create_harvest_window(
    payload: AdminHarvestWindowIn,
    request: Request,
    context: require_admin,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> AdminHarvestWindowOut:
    _record, user, _raw = context
    _csrf_guard(context, x_csrf_token)
    if payload.ends_on < payload.starts_on:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The end date cannot be before the start date.",
        )
    now = datetime.now(UTC)
    window = HarvestWindow(
        starts_on=payload.starts_on,
        ends_on=payload.ends_on,
        notes=payload.notes,
        is_published=payload.is_published,
        created_at=now,
        updated_at=now,
    )
    session.add(window)
    admin_service.record_audit(
        session,
        admin_user=user,
        action="harvest_window.create",
        entity="harvest_window",
        entity_id=None,
        after={
            "starts_on": payload.starts_on.isoformat(),
            "ends_on": payload.ends_on.isoformat(),
        },
        ip=_client_ip(request),
    )
    session.commit()
    _trigger_revalidation("harvest_window_created")
    return AdminHarvestWindowOut(
        id=str(window.id),
        starts_on=window.starts_on,
        ends_on=window.ends_on,
        notes=window.notes,
        is_published=window.is_published,
    )


@router.patch("/harvest-windows/{window_id}", response_model=AdminHarvestWindowOut)
def admin_update_harvest_window(
    window_id: UUID,
    payload: AdminHarvestWindowIn,
    request: Request,
    context: require_admin,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> AdminHarvestWindowOut:
    _record, user, _raw = context
    _csrf_guard(context, x_csrf_token)
    window = session.exec(select(HarvestWindow).where(col(HarvestWindow.id) == window_id)).first()
    if window is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Window not found.")
    if payload.ends_on < payload.starts_on:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The end date cannot be before the start date.",
        )
    before: dict[str, JsonValue] = {
        "starts_on": window.starts_on.isoformat(),
        "is_published": window.is_published,
    }
    window.starts_on = payload.starts_on
    window.ends_on = payload.ends_on
    window.notes = payload.notes
    window.is_published = payload.is_published
    window.updated_at = datetime.now(UTC)
    session.add(window)
    admin_service.record_audit(
        session,
        admin_user=user,
        action="harvest_window.update",
        entity="harvest_window",
        entity_id=str(window.id),
        before=before,
        after={
            "starts_on": window.starts_on.isoformat(),
            "is_published": window.is_published,
        },
        ip=_client_ip(request),
    )
    session.commit()
    _trigger_revalidation("harvest_window_updated")
    return AdminHarvestWindowOut(
        id=str(window.id),
        starts_on=window.starts_on,
        ends_on=window.ends_on,
        notes=window.notes,
        is_published=window.is_published,
    )


@router.put("/availability/{window_id}")
def admin_update_availability(
    window_id: UUID,
    payload: AdminAvailabilityUpdate,
    request: Request,
    context: require_admin,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> dict[str, int]:
    """Bulk update every size for one harvest window in a single call (SPEC §8)."""
    _record, user, _raw = context
    _csrf_guard(context, x_csrf_token)
    window = session.exec(select(HarvestWindow).where(col(HarvestWindow.id) == window_id)).first()
    if window is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Window not found.")

    sizes = list(session.exec(select(SizeClass)).all())
    by_slug = {size.slug: size for size in sizes}
    unknown = [slug for slug in payload.statuses if slug not in by_slug]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown size classes: {', '.join(sorted(unknown))}.",
        )

    now = datetime.now(UTC)
    existing = {
        row.size_class_id: row
        for row in session.exec(
            select(Availability).where(col(Availability.harvest_window_id) == window_id)
        ).all()
    }
    updated = 0
    for slug, new_status in payload.statuses.items():
        size = by_slug[slug]
        row = existing.get(size.id)
        if row is None:
            row = Availability(
                harvest_window_id=window_id,
                size_class_id=size.id,
                status=new_status,
                created_at=now,
                updated_at=now,
            )
            existing[size.id] = row
        else:
            row.status = new_status
            row.updated_at = now
        session.add(row)
        updated += 1

    admin_service.record_audit(
        session,
        admin_user=user,
        action="availability.bulk_update",
        entity="harvest_window",
        entity_id=str(window.id),
        after={"updated": updated, "statuses": dict(payload.statuses)},
        ip=_client_ip(request),
    )
    session.commit()
    _trigger_revalidation("availability_updated")
    return {"updated": updated}


# --- Fish types & size classes (SPEC §9) ------------------------------------------


@router.get("/size-classes", response_model=list[AdminSizeClassOut])
def admin_list_size_classes(
    context: require_admin,
    session: Session = Depends(get_session),
) -> list[AdminSizeClassOut]:
    _record, _user, _raw = context
    sizes = session.exec(select(SizeClass).order_by(col(SizeClass.sort_order))).all()
    return [AdminSizeClassOut.model_validate(size) for size in sizes]


@router.patch("/size-classes/{size_id}", response_model=AdminSizeClassOut)
def admin_update_size_class(
    size_id: UUID,
    payload: AdminSizeClassUpdate,
    request: Request,
    context: require_admin,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> AdminSizeClassOut:
    _record, user, _raw = context
    _csrf_guard(context, x_csrf_token)
    size = session.exec(select(SizeClass).where(col(SizeClass.id) == size_id)).first()
    if size is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Size class not found.")
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No fields to update."
        )
    before = {field: getattr(size, field) for field in changes}
    for field, value in changes.items():
        setattr(size, field, value)
    size.updated_at = datetime.now(UTC)
    session.add(size)
    admin_service.record_audit(
        session,
        admin_user=user,
        action="size_class.update",
        entity="size_class",
        entity_id=str(size.id),
        before=before,
        after=changes,
        ip=_client_ip(request),
    )
    session.commit()
    _trigger_revalidation("size_class_updated")
    return AdminSizeClassOut.model_validate(size)


@router.get("/fish-types", response_model=list[AdminFishTypeOut])
def admin_list_fish_types(
    context: require_admin,
    session: Session = Depends(get_session),
) -> list[AdminFishTypeOut]:
    _record, _user, _raw = context
    fish_types = session.exec(select(FishType).order_by(col(FishType.sort_order))).all()
    return [AdminFishTypeOut.model_validate(item) for item in fish_types]


@router.patch("/fish-types/{fish_type_id}", response_model=AdminFishTypeOut)
def admin_update_fish_type(
    fish_type_id: UUID,
    payload: AdminFishTypeUpdate,
    request: Request,
    context: require_admin,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> AdminFishTypeOut:
    _record, user, _raw = context
    _csrf_guard(context, x_csrf_token)
    fish_type = session.exec(
        select(FishType).where(col(FishType.id) == fish_type_id)
    ).first()
    if fish_type is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fish type not found.")
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No fields to update."
        )
    before = {field: getattr(fish_type, field) for field in changes}
    for field, value in changes.items():
        setattr(fish_type, field, value)
    fish_type.updated_at = datetime.now(UTC)
    session.add(fish_type)
    admin_service.record_audit(
        session,
        admin_user=user,
        action="fish_type.update",
        entity="fish_type",
        entity_id=str(fish_type.id),
        before=before,
        after=changes,
        ip=_client_ip(request),
    )
    session.commit()
    _trigger_revalidation("fish_type_updated")
    return AdminFishTypeOut.model_validate(fish_type)


# --- Settings, customers, messages (SPEC §9) ---------------------------------------


@router.get("/settings", response_model=list[AdminSettingsResponse])
def admin_list_settings(
    context: require_admin,
    session: Session = Depends(get_session),
) -> list[AdminSettingsResponse]:
    _record, _user, _raw = context
    rows = session.exec(select(SiteSetting)).all()
    return [AdminSettingsResponse.model_validate(row) for row in rows]


@router.patch("/settings/{key}", response_model=AdminSettingsResponse)
def admin_update_setting(
    key: str,
    payload: AdminSettingsUpdate,
    request: Request,
    context: require_admin,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> AdminSettingsResponse:
    _record, user, _raw = context
    _csrf_guard(context, x_csrf_token)
    row = session.exec(select(SiteSetting).where(col(SiteSetting.key) == key)).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Setting not found.")
    before = {"value": row.value}
    row.value = payload.value
    row.updated_at = datetime.now(UTC)
    session.add(row)
    admin_service.record_audit(
        session,
        admin_user=user,
        action="setting.update",
        entity="setting",
        entity_id=key,
        before=before,
        after={"value": payload.value},
        ip=_client_ip(request),
    )
    session.commit()
    _trigger_revalidation(f"setting_updated:{key}")
    return AdminSettingsResponse.model_validate(row)


@router.get("/customers", response_model=list[AdminCustomerOut])
def admin_list_customers(
    context: require_admin,
    search: str | None = Query(default=None, max_length=80),
    session: Session = Depends(get_session),
) -> list[AdminCustomerOut]:
    _record, _user, _raw = context
    customers = list(session.exec(select(Customer)).all())
    orders = list(session.exec(select(Order)).all())
    stats: dict[UUID, tuple[int, int]] = {}
    for order in orders:
        count, kilos = stats.get(order.customer_id, (0, 0))
        stats[order.customer_id] = (count + 1, kilos + order.quantity_kg)

    if search:
        needle = search.strip().lower()
        customers = [
            customer
            for customer in customers
            if needle in customer.name.lower()
            or needle in customer.phone_e164.lower()
            or needle in (customer.email or "").lower()
        ]
    customers.sort(key=lambda customer: customer.name.lower())

    return [
        AdminCustomerOut(
            id=str(customer.id),
            name=customer.name,
            phone_e164=customer.phone_e164,
            email=customer.email,
            notes=customer.notes,
            first_order_at=customer.first_order_at,
            order_count=stats.get(customer.id, (0, 0))[0],
            total_kg=stats.get(customer.id, (0, 0))[1],
        )
        for customer in customers
    ]


@router.get("/customers/{customer_id}", response_model=AdminCustomerDetail)
def admin_get_customer(
    customer_id: UUID,
    context: require_admin,
    session: Session = Depends(get_session),
) -> AdminCustomerDetail:
    _record, _user, _raw = context
    customer = session.exec(select(Customer).where(col(Customer.id) == customer_id)).first()
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found.")
    orders = list(
        session.exec(
            select(Order)
            .where(col(Order.customer_id) == customer_id)
            .order_by(col(Order.submitted_at).desc())
        ).all()
    )
    detail = AdminCustomerDetail(
        id=str(customer.id),
        name=customer.name,
        phone_e164=customer.phone_e164,
        email=customer.email,
        notes=customer.notes,
        first_order_at=customer.first_order_at,
        order_count=len(orders),
        total_kg=sum(order.quantity_kg for order in orders),
        orders=_list_items(session, orders),
    )
    return detail


@router.get("/messages", response_model=list[AdminMessageOut])
def admin_list_messages(
    context: require_admin,
    handled: bool | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[AdminMessageOut]:
    _record, _user, _raw = context
    statement = select(ContactMessage)
    if handled is not None:
        statement = statement.where(col(ContactMessage.status) == handled)
    messages = session.exec(
        statement.order_by(col(ContactMessage.created_at).desc())
    ).all()
    return [AdminMessageOut.model_validate(message) for message in messages]


@router.patch("/messages/{message_id}", response_model=AdminMessageOut)
def admin_update_message(
    message_id: UUID,
    payload: AdminMessageUpdate,
    request: Request,
    context: require_admin,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> AdminMessageOut:
    _record, user, _raw = context
    _csrf_guard(context, x_csrf_token)
    message = session.exec(
        select(ContactMessage).where(col(ContactMessage.id) == message_id)
    ).first()
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")
    before: dict[str, JsonValue] = {"status": message.status}
    message.status = payload.status
    message.updated_at = datetime.now(UTC)
    session.add(message)
    admin_service.record_audit(
        session,
        admin_user=user,
        action="message.update",
        entity="contact_message",
        entity_id=str(message.id),
        before=before,
        after={"status": payload.status},
        ip=_client_ip(request),
    )
    session.commit()
    return AdminMessageOut.model_validate(message)


# --- Users (owner only, SPEC §8, §9) ------------------------------------------------


@router.get("/users", response_model=list[AdminUserSummary])
def admin_list_users(
    context: require_admin,
    session: Session = Depends(get_session),
) -> list[AdminUserSummary]:
    _record, user, _raw = context
    try:
        admin_service.require_owner(user)
    except AdminForbiddenError as forbidden:
        raise _translate(forbidden) from forbidden
    rows = session.exec(select(AdminUser).order_by(col(AdminUser.created_at))).all()
    return [_user_payload(row) for row in rows]


@router.post("/users", response_model=AdminUserSummary, status_code=status.HTTP_201_CREATED)
def admin_create_user(
    payload: AdminUserCreate,
    request: Request,
    context: require_admin,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> AdminUserSummary:
    _record, user, _raw = context
    _csrf_guard(context, x_csrf_token)
    try:
        admin_service.require_owner(user)
    except AdminForbiddenError as forbidden:
        raise _translate(forbidden) from forbidden

    email = admin_service.normalize_email(payload.email)
    existing = session.exec(select(AdminUser).where(col(AdminUser.email) == email)).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="That email already has an account."
        )
    strength = admin_service.validate_password_strength(payload.password)
    if strength:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=strength)

    created = AdminUser(
        email=email,
        name=payload.name,
        password_hash=admin_service.hash_password(payload.password),
        role=payload.role,
        # A password chosen by an owner for someone else is still a temporary one.
        must_change_password=True,
    )
    session.add(created)
    admin_service.record_audit(
        session,
        admin_user=user,
        action="admin_user.create",
        entity="admin_user",
        entity_id=None,
        after={"email": email, "role": payload.role},
        ip=_client_ip(request),
    )
    session.commit()
    return _user_payload(created)


@router.patch("/users/{admin_user_id}", response_model=AdminUserSummary)
def admin_update_user(
    admin_user_id: UUID,
    payload: AdminUserUpdate,
    request: Request,
    context: require_admin,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> AdminUserSummary:
    _record, user, _raw = context
    _csrf_guard(context, x_csrf_token)
    try:
        admin_service.require_owner(user)
    except AdminForbiddenError as forbidden:
        raise _translate(forbidden) from forbidden

    target = session.exec(
        select(AdminUser).where(col(AdminUser.id) == admin_user_id)
    ).first()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    # Guard against an owner locking themselves (and possibly everyone) out.
    if target.id == user.id and (payload.is_active is False or payload.role == "staff"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot remove your own owner access.",
        )
    if payload.password is not None:
        strength = admin_service.validate_password_strength(payload.password)
        if strength:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=strength)

    before: dict[str, JsonValue] = {
        "name": target.name,
        "role": target.role,
        "is_active": target.is_active,
    }
    if payload.name is not None:
        target.name = payload.name
    if payload.role is not None:
        target.role = payload.role
    if payload.is_active is not None:
        target.is_active = payload.is_active
    if payload.password is not None:
        target.password_hash = admin_service.hash_password(payload.password)
        target.must_change_password = True
    target.updated_at = datetime.now(UTC)
    session.add(target)

    # A deactivated or demoted account must not keep using its existing session.
    if payload.is_active is False or (payload.role is not None and payload.role != target.role):
        for record in session.exec(
            select(AdminSession).where(col(AdminSession.admin_user_id) == target.id)
        ).all():
            session.delete(record)

    admin_service.record_audit(
        session,
        admin_user=user,
        action="admin_user.update",
        entity="admin_user",
        entity_id=str(target.id),
        before=before,
        after={
            "name": target.name,
            "role": target.role,
            "is_active": target.is_active,
            "password_reset": payload.password is not None,
        },
        ip=_client_ip(request),
    )
    session.commit()
    return _user_payload(target)


# --- Error translation ------------------------------------------------------------
# Defined after the routes on purpose: it is only referenced at request time, and keeping
# it at the bottom lets every handler read `raise _translate(exc)` the same way.


def _translate(exc: Exception) -> HTTPException:
    if isinstance(exc, AdminNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, AdminForbiddenError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if isinstance(exc, AdminConflictError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, AdminAuthError):
        return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc))
    raise exc
