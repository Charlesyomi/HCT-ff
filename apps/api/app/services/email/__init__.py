"""Provider-agnostic transactional email (Addendum 001 §A3)."""

from app.services.email.base import (
    EmailMessage,
    EmailProvider,
    PermanentEmailError,
    TransientEmailError,
)
from app.services.email.factory import build_email_provider, get_email_provider, set_email_provider

__all__ = [
    "EmailMessage",
    "EmailProvider",
    "PermanentEmailError",
    "TransientEmailError",
    "build_email_provider",
    "get_email_provider",
    "set_email_provider",
]
