"""Selects the email provider from EMAIL_PROVIDER (Addendum 001 §A3).

Switching provider (or region/credentials) is an environment change only; no application
code outside this module knows which transport is in use.
"""

from app.config import settings
from app.services.email.base import EmailProvider
from app.services.email.brevo import BrevoProvider
from app.services.email.console import ConsoleProvider
from app.services.email.mailgun import MailgunProvider
from app.services.email.smtp import SmtpProvider

PROVIDERS: dict[str, type[EmailProvider]] = {
    "console": ConsoleProvider,
    "brevo": BrevoProvider,
    "mailgun": MailgunProvider,
    "smtp": SmtpProvider,
}

_default_provider: EmailProvider | None = None


def build_email_provider(name: str | None = None) -> EmailProvider:
    """Instantiate the provider named by EMAIL_PROVIDER (defaults to console)."""
    provider_name = (name or settings.email_provider or "console").strip().lower()
    provider_class = PROVIDERS.get(provider_name)
    if provider_class is None:
        valid = ", ".join(sorted(PROVIDERS))
        raise ValueError(f"Unknown EMAIL_PROVIDER '{provider_name}'. Expected one of: {valid}.")
    return provider_class()


def get_email_provider() -> EmailProvider:
    if _default_provider is None:
        return build_email_provider()
    return _default_provider


def set_email_provider(provider: EmailProvider | None) -> None:
    """Inject a provider (tests use this to simulate quota and permanent failures)."""
    global _default_provider
    _default_provider = provider
