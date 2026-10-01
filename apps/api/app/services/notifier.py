import logging
from abc import ABC, abstractmethod

from app.models import Customer, Order

logger = logging.getLogger("adesoba.notifier")


def _mask_for_log(phone_e164: str) -> str:
    """SPEC §11 forbids PII in logs: keep the country code and the last two digits only."""
    if len(phone_e164) <= 5:
        return "***"
    return f"{phone_e164[:5]}***{phone_e164[-2:]}"


class Notifier(ABC):
    @abstractmethod
    def send_order_created(self, order: Order, customer: Customer) -> None:
        """Send notifications when a new order is received."""
        ...


class ConsoleNotifier(Notifier):
    """Development and test notifier that writes order notifications to logs."""

    def send_order_created(self, order: Order, customer: Customer) -> None:
        logger.info(
            "New order received: ref=%s customer=%s phone=%s email=%s fish=%s %s %dkg preferred_date=%s",
            order.reference,
            customer.name,
            _mask_for_log(customer.phone_e164),
            customer.email or "none",
            order.fish_type,
            order.size_label_snapshot,
            order.quantity_kg,
            order.preferred_date,
        )


_default_notifier: Notifier = ConsoleNotifier()


def get_notifier() -> Notifier:
    return _default_notifier


def set_notifier(notifier: Notifier) -> None:
    global _default_notifier
    _default_notifier = notifier
