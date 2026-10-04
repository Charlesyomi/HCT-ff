"""Server-side cart for signed-in accounts (mobile client).

The cart stores validated lines only and is guarded by an optimistic `version`: a PUT that
carries a stale `expected_version` is rejected with 409, so two devices editing the same
cart cannot silently overwrite each other. Line validation and indicative pricing are the
same helpers the order flow uses, so a cart line is exactly an order line.
"""

from datetime import UTC, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import update as sa_update
from sqlmodel import SQLModel, Session, col, select

from app.models import Cart, HarvestWindow
from app.schemas import CartUpdateRequest
from app.services.order_service import PricedLine, merge_order_lines, resolve_order_lines


def _active_harvest_window(session: Session) -> HarvestWindow | None:
    today_lagos = datetime.now(ZoneInfo("Africa/Lagos")).date()
    return session.exec(
        select(HarvestWindow)
        .where(col(HarvestWindow.is_published).is_(True), HarvestWindow.ends_on >= today_lagos)
        .order_by(col(HarvestWindow.starts_on))
    ).first()


def _items_payload(lines: list[PricedLine]) -> list[dict[str, object]]:
    return [
        {
            "fish_type": line.fish_type,
            "size": line.size,
            "size_label": line.size_label,
            "quantity_kg": line.quantity_kg,
            "indicative_unit_price_kobo": line.indicative_unit_price_kobo,
            "line_total_kobo": line.line_total_kobo,
        }
        for line in lines
    ]


def get_cart(session: Session, account_id: UUID) -> Cart | None:
    return session.get(Cart, account_id)


def put_cart(session: Session, account_id: UUID, payload: CartUpdateRequest) -> Cart:
    """
    Replace the cart contents and bump its version.

    Concurrency race: two devices read the same version and PUT different contents; without
    a guard the second write would silently clobber the first.
    Prevention: the UPDATE is conditional on `version = expected_version`. A stale writer
    matches zero rows and gets 409 instead of overwriting the other device's cart.
    """
    raw_lines = merge_order_lines(
        [(item.fish_type, item.size, item.quantity_kg) for item in payload.items]
    )
    priced = resolve_order_lines(
        session,
        raw_lines,
        active_harvest_window=_active_harvest_window(session),
    )
    items = _items_payload(priced)
    now = datetime.now(UTC)

    current = session.get(Cart, account_id)
    if current is None:
        if payload.expected_version != 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Cart version mismatch."
            )
        cart = Cart(account_id=account_id, items=items, version=1, updated_at=now)
        session.add(cart)
        session.commit()
        session.refresh(cart)
        return cart

    if current.version != payload.expected_version:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cart version mismatch.")

    carts = SQLModel.metadata.tables["carts"]
    result = session.execute(
        sa_update(carts)
        .where(
            carts.c.account_id == account_id,
            carts.c.version == payload.expected_version,
        )
        .values(items=items, version=payload.expected_version + 1, updated_at=now)
    )
    if getattr(result, "rowcount", 0) == 0:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cart version mismatch.")
    session.commit()
    refreshed = session.get(Cart, account_id)
    assert refreshed is not None
    return refreshed


def delete_cart(session: Session, account_id: UUID) -> bool:
    cart = session.get(Cart, account_id)
    if cart is None:
        return False
    session.delete(cart)
    session.commit()
    return True
