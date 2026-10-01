import asyncio
import base64
import contextlib
import hashlib
import logging
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import Table, text
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import SQLModel, Session, col, select

from app.config import settings
from app.db import connect_with_retry, engine, get_session
from app.models import (
    Account,
    AccountSession,
    Availability,
    ContactMessage,
    Customer,
    FishType,
    HarvestWindow,
    Order,
    OrderEvent,
    SiteSetting,
    SizeClass,
)
from app.rate_limiter import (
    get_client_ip,
    limit_contact_ip,
    limit_order_creation_ip,
    limit_order_lookup_ip,
)
from app.schemas import (
    AccountMeResponse,
    AccountOrderItem,
    AccountOrdersResponse,
    AttachOrderRequest,
    AttachOrderResponse,
    CatalogResponse,
    CatalogSettingsPublic,
    ContactMessageCreate,
    ContactMessageCreated,
    FishTypePublic,
    HarvestWindowPublic,
    OrderCancelResponse,
    OrderCreateRequest,
    OrderCreateResponse,
    OrderEventPublic,
    OrderLookupRequest,
    OrderLookupResponse,
    OrderPublic,
    SizeClassPublic,
)
from app.services import auth_service
from app.services.auth_service import (
    SESSION_COOKIE_NAME,
    SESSION_TTL_DAYS,
    STATE_COOKIE_NAME,
    STATE_TTL_SECONDS,
    AuthError,
)
from app.services.email.factory import build_email_provider
from app.services.email.outbox import process_pending
from app.services.turnstile import enforce_turnstile
from app.services.order_service import (
    cancel_order_by_customer,
    create_order,
    get_public_order_by_token,
    lookup_order_by_phone,
    mask_phone_number,
    normalize_nigerian_phone,
)

logger = logging.getLogger("adesoba.api")

# Emails are sent from their own engine/session: a stuck or slow batch must never hold a
# pooled connection that an in-flight request needs.
WORKER_ENGINE = engine


async def _email_worker_loop(interval_seconds: int) -> None:
    """Background outbox worker (Addendum §A3). A batch failure is logged, never fatal."""
    provider = build_email_provider()
    while True:
        try:
            with Session(WORKER_ENGINE) as session:
                summary = process_pending(session, provider=provider)
            if any(summary.values()):
                logger.info("Email outbox batch: %s", summary)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Email outbox batch failed; retrying on the next tick")
        await asyncio.sleep(max(5, interval_seconds))


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Supabase free projects can be asleep: warm the pool in a thread so startup never blocks
    # and /ready keeps answering instead of the container flapping. Tests switch it off.
    if settings.database_warmup_on_startup:
        await asyncio.to_thread(connect_with_retry, engine)
    if not settings.email_worker_enabled:
        # Tests and one-off CLI runs turn the in-process worker off and use the CLI instead.
        yield
        return
    task = asyncio.create_task(_email_worker_loop(settings.email_worker_interval_seconds))
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="Adesoba API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Idempotency-Key", "X-Order-Token", "X-CSRF-Token"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    code_map = {
        400: "bad_request",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        422: "validation_error",
        429: "rate_limit_exceeded",
        500: "server_error",
        503: "service_unavailable",
    }
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": code_map.get(exc.status_code, "error"),
                "message": str(exc.detail),
            }
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    first_error = exc.errors()[0] if exc.errors() else {}
    msg = first_error.get("msg", "Invalid request input.")
    loc_parts = [str(part) for part in first_error.get("loc", []) if part != "body"]
    field_prefix = ".".join(loc_parts)
    if field_prefix:
        msg = f"{field_prefix}: {msg}"
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"error": {"code": "validation_error", "message": msg}},
    )

FISH_TYPE_TABLE: Table = SQLModel.metadata.tables["fish_types"]
SIZE_CLASS_TABLE: Table = SQLModel.metadata.tables["size_classes"]
HARVEST_WINDOW_TABLE: Table = SQLModel.metadata.tables["harvest_windows"]


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
def readiness(session: Session = Depends(get_session)) -> dict[str, str]:
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        raise HTTPException(status_code=503, detail="Database is unavailable") from error
    return {"status": "ready"}


@app.get("/api/v1/catalog")
def catalog(response: Response, session: Session = Depends(get_session)) -> CatalogResponse:
    response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=30"
    today_in_lagos = datetime.now(ZoneInfo("Africa/Lagos")).date()
    harvest_window = session.exec(
        select(HarvestWindow)
        .where(
            HARVEST_WINDOW_TABLE.c.is_published.is_(True),
            HARVEST_WINDOW_TABLE.c.ends_on >= today_in_lagos,
        )
        .order_by(HARVEST_WINDOW_TABLE.c.starts_on)
    ).first()

    fish_types = session.exec(
        select(FishType)
        .where(FISH_TYPE_TABLE.c.is_active.is_(True))
        .order_by(FISH_TYPE_TABLE.c.sort_order)
    ).all()
    size_classes = session.exec(
        select(SizeClass)
        .where(SIZE_CLASS_TABLE.c.is_active.is_(True))
        .order_by(SIZE_CLASS_TABLE.c.sort_order)
    ).all()

    availability_by_size: dict[str, str] = {}
    if harvest_window is not None:
        records = session.exec(
            select(Availability).where(Availability.harvest_window_id == harvest_window.id)
        ).all()
        availability_by_size = {
            str(record.size_class_id): record.status
            for record in records
            if record.fish_type_id is None
        }

    defaults: dict[str, object] = {
        "whatsapp_number": "+2348012345678",
        "phone_number": "+2348012345678",
        "farm_address": "[EDIT ME] Farm address, Ogun State, Nigeria",
        "farm_maps_url": None,
        "business_hours": ["Mon–Sat, 8:00 AM–6:00 PM"],
        "min_order_kg": 40,
        "max_order_kg": 20000,
        "min_lead_days": 1,
        "time_slots": [
            {"key": "8-10", "label": "8–10 AM"},
            {"key": "10-12", "label": "10 AM–12 PM"},
            {"key": "12-2", "label": "12–2 PM"},
            {"key": "2-4", "label": "2–4 PM"},
            {"key": "4-6", "label": "4–6 PM"},
        ],
        "delivery_notice": "Delivery fee and service area are confirmed with each quote.",
        "announcement_banner": None,
    }
    for setting in session.exec(select(SiteSetting)).all():
        defaults[setting.key] = setting.value

    public_sizes = [
        SizeClassPublic(
            slug=size.slug,
            label=size.label,
            descriptor=size.descriptor,
            min_kg=size.min_kg,
            max_kg=size.max_kg,
            image_path=size.image_path,
            is_featured=size.is_featured,
            is_smoking_size=size.is_smoking_size,
            sort_order=size.sort_order,
            status=(
                availability_by_size.get(str(size.id), "unavailable")
                if harvest_window is not None
                else "unavailable"
            ),
        )
        for size in size_classes
    ]

    return CatalogResponse(
        fish_types=[FishTypePublic.model_validate(fish_type) for fish_type in fish_types],
        size_classes=public_sizes,
        harvest_window=(
            HarvestWindowPublic.model_validate(harvest_window)
            if harvest_window is not None
            else None
        ),
        settings=CatalogSettingsPublic.model_validate(defaults),
    )


@app.post(
    "/api/v1/contact",
    response_model=ContactMessageCreated,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limit_contact_ip)],
)
def create_contact_message(
    message: ContactMessageCreate,
    request: Request,
    session: Session = Depends(get_session),
) -> ContactMessageCreated:
    # Spam protection: a filled honeypot or a failed Turnstile check is rejected
    # before any row is written, so spam never reaches the admin inbox.
    if message.website:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submission rejected.")
    enforce_turnstile(message.turnstile_token, get_client_ip(request))
    session.add(
        ContactMessage(
            name=message.name,
            phone=message.phone,
            message=message.message,
        )
    )
    session.commit()
    return ContactMessageCreated()


@app.post(
    "/api/v1/orders",
    response_model=OrderCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limit_order_creation_ip)],
)
def submit_order(
    payload: OrderCreateRequest,
    request: Request,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    session: Session = Depends(get_session),
) -> OrderCreateResponse:
    if not idempotency_key or not idempotency_key.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Idempotency-Key header is required.",
        )
    client_ip = get_client_ip(request)
    # Sign-in is optional: a live session attaches the order to the account, and the
    # REQUIRE_LOGIN_AT_CHECKOUT flag can turn it into a requirement for guest checkout.
    record = auth_service.current_session(session, request.cookies.get(SESSION_COOKIE_NAME))
    account_id: UUID | None = None
    if record is not None:
        account = session.exec(select(Account).where(Account.id == record.account_id)).first()
        account_id = account.id if account is not None else None
    if settings.require_login_at_checkout and account_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in with Google to place an order.",
        )
    order, access_token = create_order(
        session,
        payload,
        idempotency_key.strip(),
        client_ip,
        account_id=account_id,
    )
    submitted_at = order.submitted_at
    if submitted_at.tzinfo is None:
        # Some drivers (SQLite in tests) drop the timezone; the API contract is UTC ISO-8601.
        submitted_at = submitted_at.replace(tzinfo=UTC)
    return OrderCreateResponse(
        reference=order.reference,
        access_token=access_token,
        status=order.status,
        submitted_at=submitted_at,
    )


@app.get(
    "/api/v1/orders/{reference}",
    response_model=OrderPublic,
    status_code=status.HTTP_200_OK,
)
def get_order_details(
    reference: str,
    x_order_token: str = Header(..., alias="X-Order-Token"),
    session: Session = Depends(get_session),
) -> OrderPublic:
    order, customer = get_public_order_by_token(session, reference, x_order_token)
    events = session.exec(
        select(OrderEvent)
        .where(col(OrderEvent.order_id) == order.id)
        .order_by(col(OrderEvent.created_at))
    ).all()
    return OrderPublic(
        reference=order.reference,
        status=order.status,
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
        customer_name=customer.name,
        customer_phone_masked=mask_phone_number(customer.phone_e164),
        customer_email=customer.email,
        submitted_at=order.submitted_at,
        events=[OrderEventPublic.model_validate(e) for e in events],
    )


@app.post(
    "/api/v1/orders/lookup",
    response_model=OrderLookupResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(limit_order_lookup_ip)],
)
def lookup_order(
    payload: OrderLookupRequest,
    session: Session = Depends(get_session),
) -> OrderLookupResponse:
    order, customer, fresh_token = lookup_order_by_phone(session, payload.reference, payload.phone)
    events = session.exec(
        select(OrderEvent)
        .where(col(OrderEvent.order_id) == order.id)
        .order_by(col(OrderEvent.created_at))
    ).all()
    public_order = OrderPublic(
        reference=order.reference,
        status=order.status,
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
        customer_name=customer.name,
        customer_phone_masked=mask_phone_number(customer.phone_e164),
        customer_email=customer.email,
        submitted_at=order.submitted_at,
        events=[OrderEventPublic.model_validate(e) for e in events],
    )
    return OrderLookupResponse(order=public_order, access_token=fresh_token)


@app.post(
    "/api/v1/orders/{reference}/cancel",
    response_model=OrderCancelResponse,
    status_code=status.HTTP_200_OK,
)
def cancel_order(
    reference: str,
    x_order_token: str = Header(..., alias="X-Order-Token"),
    session: Session = Depends(get_session),
) -> OrderCancelResponse:
    order = cancel_order_by_customer(session, reference, x_order_token)
    return OrderCancelResponse(reference=order.reference, status=order.status)


# --- Google sign-in and account-scoped orders (Addendum 001 §A4) ---


def _require_account(
    request: Request,
    session: Session,
) -> tuple[AccountSession, Account, str]:
    """Resolve the session cookie to a live account, or raise 401."""
    raw_session_id = request.cookies.get(SESSION_COOKIE_NAME)
    record = auth_service.current_session(session, raw_session_id)
    if record is None or raw_session_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in with Google to use this feature.",
        )
    account = session.exec(select(Account).where(Account.id == record.account_id)).first()
    if account is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found.")
    return record, account, raw_session_id


def _csrf_for(raw_session_id: str) -> str:
    return base64.urlsafe_b64encode(
        hashlib.sha256(f"csrf:{raw_session_id}".encode("ascii")).digest()
    ).decode("ascii").rstrip("=")


@app.get("/api/v1/auth/google/start")
def google_start(
    request: Request,
    response: Response,
    next: str | None = None,
) -> RedirectResponse:
    """Begin the OIDC authorization-code + PKCE flow (Addendum §A4)."""
    try:
        verifier, challenge = auth_service.generate_pkce_pair()
    except AuthError as auth_error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign-in is not available right now. Continue with your phone number.",
        ) from auth_error
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    # The verifier and nonce are stored inside the signed state cookie so the callback needs
    # no server-side state, while a forged or stale cookie cannot be replayed.
    state_cookie = auth_service.sign_state_cookie(
        {
            "state": state,
            "verifier": verifier,
            "nonce": nonce,
            "next": auth_service.safe_next_path(next),
            "created_at": int(datetime.now(UTC).timestamp()),
        }
    )
    try:
        location = auth_service.authorization_url(
            state, challenge, auth_service.safe_next_path(next), nonce
        )
    except AuthError as auth_error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign-in is not available right now. Continue with your phone number.",
        ) from auth_error
    redirect_response = RedirectResponse(location, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    redirect_response.set_cookie(
        STATE_COOKIE_NAME,
        state_cookie,
        max_age=STATE_TTL_SECONDS,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/api/v1/auth",
    )
    return redirect_response


@app.get("/api/v1/auth/google/callback")
def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: Session = Depends(get_session),
) -> RedirectResponse:
    """Verify the callback, create the account session and return to a relative `next`."""
    if error is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Google returned an error: {error}.")
    stored = auth_service.read_state_cookie(request.cookies.get(STATE_COOKIE_NAME))
    if stored is None or not state or not code or stored.get("state") != state:
        # A mismatched or expired state means another browser (or an attacker) started the flow.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sign-in state is invalid or expired.")

    try:
        id_token = auth_service.exchange_code_for_id_token(code, str(stored.get("verifier", "")))
        profile = auth_service.verify_id_token(id_token, stored.get("nonce"))
    except AuthError as auth_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(auth_error)) from auth_error

    account = auth_service.upsert_account(session, profile)
    raw_session_id, _csrf = auth_service.create_session(
        session,
        account,
        created_ip=get_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    redirect_response = RedirectResponse(str(stored.get("next", "/my-orders")))
    redirect_response.set_cookie(
        SESSION_COOKIE_NAME,
        raw_session_id,
        max_age=SESSION_TTL_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )
    redirect_response.delete_cookie(STATE_COOKIE_NAME, path="/api/v1/auth")
    return redirect_response


@app.get("/api/v1/auth/me", response_model=AccountMeResponse)
def auth_me(request: Request, session: Session = Depends(get_session)) -> AccountMeResponse:
    _record, account, _raw = _require_account(request, session)
    return AccountMeResponse(
        id=str(account.id),
        email=account.email,
        name=account.name,
        avatar_url=account.avatar_url,
    )


@app.post("/api/v1/auth/logout")
def auth_logout(
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> dict[str, bool]:
    raw_session_id = request.cookies.get(SESSION_COOKIE_NAME)
    record = auth_service.current_session(session, raw_session_id)
    if record is not None:
        auth_service.delete_session(session, record)
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return {"signed_out": True}


@app.get("/api/v1/me/orders", response_model=AccountOrdersResponse)
def my_orders(request: Request, session: Session = Depends(get_session)) -> AccountOrdersResponse:
    """Third access path for My Orders: orders attached to the signed-in account."""
    record, account, raw_session_id = _require_account(request, session)
    orders = auth_service.account_orders(session, account)
    return AccountOrdersResponse(
        orders=[
            AccountOrderItem(
                reference=order.reference,
                status=order.status,
                fish_type=order.fish_type,
                size_label=order.size_label_snapshot,
                quantity_kg=order.quantity_kg,
                is_bulk=order.is_bulk,
                preferred_date=order.preferred_date,
                time_slot_label=order.time_slot_label,
                fulfilment=order.fulfilment,
                submitted_at=order.submitted_at,
            )
            for order in orders
        ],
        csrf_token=_csrf_for(raw_session_id),
    )


@app.post("/api/v1/me/orders/attach", response_model=AttachOrderResponse)
def attach_order(
    payload: AttachOrderRequest,
    request: Request,
    x_csrf_token: str = Header(..., alias="X-CSRF-Token"),
    session: Session = Depends(get_session),
) -> AttachOrderResponse:
    """Attach a guest order to the signed-in account using reference + phone (A4)."""
    record, account, raw_session_id = _require_account(request, session)
    if not auth_service.verify_csrf(record, raw_session_id, x_csrf_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token.")

    order = session.exec(select(Order).where(Order.reference == payload.reference)).first()
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.")
    customer = session.exec(select(Customer).where(Customer.id == order.customer_id)).first()
    try:
        phone_e164 = normalize_nigerian_phone(payload.phone)
    except HTTPException as phone_error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found or details do not match.") from phone_error
    if customer is None or customer.phone_e164 != phone_e164:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found or details do not match.")

    try:
        attached_order = auth_service.attach_order_to_account(session, account, order)
    except AuthError as auth_error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(auth_error)) from auth_error
    return AttachOrderResponse(
        reference=attached_order.reference,
        attached=True,
        status=attached_order.status,
    )
