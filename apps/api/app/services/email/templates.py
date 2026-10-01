"""HTML + plain-text templates rendered by our code (Addendum 001 §A3).

Access tokens are never included: the customer email links to the tracking lookup page,
which needs the reference and the phone number the customer already knows.
"""

from dataclasses import dataclass
from datetime import date
from typing import Any

BRAND_DARK = "#14342b"
BRAND_ACCENT = "#1f7a4d"
TEXT_DARK = "#22302b"
TEXT_MUTED = "#5b6b64"


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html_body: str
    text_body: str


def tracking_url(site_url: str, reference: str) -> str:
    return f"{site_url.rstrip('/')}/my-orders?reference={reference}"


def whatsapp_url(whatsapp_number: str | None, reference: str) -> str | None:
    if not whatsapp_number:
        return None
    digits = "".join(character for character in whatsapp_number if character.isdigit())
    if not digits:
        return None
    text = f"Hi Adesoba Farm, I just sent order request {reference}. Please confirm availability."
    return f"https://wa.me/{digits}?text={_url_encode(text)}"


def _url_encode(value: str) -> str:
    from urllib.parse import quote

    return quote(value, safe="")


def _escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _summary_rows(order: Any) -> list[tuple[str, str]]:
    return [
        ("Reference", order.reference),
        ("Fish type", str(order.fish_type)),
        ("Size", order.size_label_snapshot),
        ("Quantity", f"{order.quantity_kg:,} kg"),
        ("Preferred date", order.preferred_date.isoformat()),
        ("Time slot", order.time_slot_label),
        ("Fulfilment", "Delivery" if order.fulfilment == "delivery" else "Pickup"),
        (
            "Delivery address",
            order.delivery_address if order.fulfilment == "delivery" and order.delivery_address else "—",
        ),
        ("Notes", order.notes or "—"),
    ]


def _render_html(title: str, intro: str, rows: list[tuple[str, str]], footer: str) -> str:
    table_rows = "".join(
        f'<tr><td style="padding:6px 12px 6px 0;color:{TEXT_MUTED};font-size:14px;">{_escape(label)}</td>'
        f'<td style="padding:6px 0;color:{TEXT_DARK};font-size:14px;font-weight:600;">{_escape(value)}</td></tr>'
        for label, value in rows
    )
    return (
        "<!doctype html><html><body style=\"margin:0;padding:24px;background:#f5f8f6;"
        "font-family:Arial,Helvetica,sans-serif;\">"
        f'<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px;">'
        f'<h1 style="margin:0 0 12px;color:{BRAND_DARK};font-size:22px;">{_escape(title)}</h1>'
        f'<p style="margin:0 0 18px;color:{TEXT_DARK};font-size:15px;line-height:24px;">{_escape(intro)}</p>'
        f'<table style="border-collapse:collapse;width:100%;margin-bottom:18px;">{table_rows}</table>'
        f'<p style="margin:0;color:{TEXT_MUTED};font-size:13px;line-height:20px;">{footer}</p>'
        "</div></body></html>"
    )


def _render_text(title: str, intro: str, rows: list[tuple[str, str]], footer: str) -> str:
    body = "\n".join(f"{label}: {value}" for label, value in rows)
    return f"{title}\n\n{intro}\n\n{body}\n\n{footer}\n"


def render_order_received_customer(
    order: Any,
    customer_name: str,
    site_url: str,
    whatsapp_number: str | None = None,
) -> RenderedEmail:
    link = tracking_url(site_url, order.reference)
    whatsapp = whatsapp_url(whatsapp_number, order.reference)
    intro = (
        f"Hello {customer_name}, we have received your order request. You have not been charged; "
        "the farm will confirm availability and send your quote."
    )
    footer_parts = [f'Track this request: <a href="{_escape(link)}" style="color:{BRAND_ACCENT};">{_escape(link)}</a>']
    text_footer = f"Track this request: {link}"
    if whatsapp:
        footer_parts.append(
            f'Prefer to talk? <a href="{_escape(whatsapp)}" style="color:{BRAND_ACCENT};">WhatsApp the farm</a>'
        )
        text_footer = f"{text_footer}\nWhatsApp the farm: {whatsapp}"

    return RenderedEmail(
        subject=f"We received your catfish request {order.reference}",
        html_body=_render_html(
            "We received your order request",
            intro,
            _summary_rows(order),
            "<br>".join(footer_parts),
        ),
        text_body=_render_text(
            f"We received your order request {order.reference}",
            intro,
            _summary_rows(order),
            text_footer,
        ),
    )


def render_order_received_farm(
    order: Any,
    customer_name: str,
    customer_phone: str,
    site_url: str,
) -> RenderedEmail:
    admin_link = f"{site_url.rstrip('/')}/admin/orders"
    intro = (
        f"New order request from {customer_name} ({customer_phone}). "
        "Open the admin dashboard to send a quote."
    )
    rows = [("Customer", customer_name), ("Phone", customer_phone)] + _summary_rows(order)
    footer_html = f'Open the dashboard: <a href="{_escape(admin_link)}" style="color:{BRAND_ACCENT};">{_escape(admin_link)}</a>'
    return RenderedEmail(
        subject=f"New order request {order.reference}",
        html_body=_render_html("New order request", intro, rows, footer_html),
        text_body=_render_text(f"New order request {order.reference}", intro, rows, f"Open the dashboard: {admin_link}"),
    )


def outbox_payload(
    subject: str,
    html_body: str,
    text_body: str,
    context: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Store the finished message so the worker never needs a renderer or a template file."""
    payload: dict[str, Any] = {
        "subject": subject,
        "html_body": html_body,
        "text_body": text_body,
    }
    if context:
        payload["context"] = context
    return payload


def default_site_url() -> str:
    return "http://localhost:3000"


def today_iso() -> str:
    return date.today().isoformat()
