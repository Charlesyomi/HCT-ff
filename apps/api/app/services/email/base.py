"""Email provider interface shared by every transport (Addendum 001 §A3)."""

from dataclasses import dataclass, field
from typing import Any


class TransientEmailError(Exception):
    """Timeouts, 5xx responses, quota/rate limits: the same message may succeed later."""


class PermanentEmailError(Exception):
    """Invalid recipient, rejected sender, bad credentials: retrying cannot help."""


@dataclass(frozen=True)
class EmailMessage:
    """A finished message; providers never render templates themselves."""

    to_email: str
    subject: str
    html_body: str
    text_body: str
    from_address: str
    from_name: str = ""
    reply_to: str | None = None
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


class EmailProvider:
    """Transport contract: `EMAIL_PROVIDER` selects the implementation, nothing else."""

    name = "base"

    def send(self, message: EmailMessage) -> str:
        """Deliver one message and return the provider's message id.

        Raises TransientEmailError for retryable/quota failures and PermanentEmailError
        for failures that must not be retried.
        """
        raise NotImplementedError
