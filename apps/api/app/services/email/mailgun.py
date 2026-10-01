"""Mailgun provider over the messages API (Addendum 001 §A3, step 4).

Kept last and small: the base URL differs between the US and EU regions, so it is read
from MAILGUN_BASE_URL and switching regions is an env change only.
"""

import httpx

from app.config import settings
from app.services.email.base import EmailMessage, EmailProvider, PermanentEmailError, TransientEmailError

TRANSIENT_STATUSES = {408, 425, 429, 500, 502, 503, 504}
DEFAULT_BASE_URL = "https://api.mailgun.net"


class MailgunProvider(EmailProvider):
    name = "mailgun"

    def __init__(
        self,
        api_key: str | None = None,
        domain: str | None = None,
        base_url: str | None = None,
        timeout: float = 10.0,
    ) -> None:
        self.api_key = api_key or settings.mailgun_api_key
        self.domain = domain or settings.mailgun_domain
        base = (base_url or settings.mailgun_base_url or DEFAULT_BASE_URL).rstrip("/")
        # MAILGUN_BASE_URL may or may not include the /v3 path; the endpoint adds it once.
        self.base_url = base[: -len("/v3")] if base.endswith("/v3") else base
        self.timeout = timeout

    def send(self, message: EmailMessage) -> str:
        if not self.api_key or not self.domain:
            raise PermanentEmailError("MAILGUN_API_KEY and MAILGUN_DOMAIN must be configured.")

        payload = {
            "from": f"{message.from_name} <{message.from_address}>" if message.from_name else message.from_address,
            "to": message.to_email,
            "subject": message.subject,
            "html": message.html_body,
            "text": message.text_body,
        }
        if message.reply_to:
            payload["h:Reply-To"] = message.reply_to

        try:
            response = httpx.post(
                f"{self.base_url}/v3/{self.domain}/messages",
                data=payload,
                auth=("api", self.api_key),
                timeout=self.timeout,
            )
        except httpx.HTTPError as error:
            raise TransientEmailError(f"Mailgun request failed: {error}") from error

        if response.status_code in TRANSIENT_STATUSES:
            raise TransientEmailError(f"Mailgun returned {response.status_code}.")
        if response.status_code >= 400:
            raise PermanentEmailError(f"Mailgun rejected the message ({response.status_code}).")

        try:
            body = response.json()
        except ValueError:
            body = {}
        message_id = body.get("id") if isinstance(body, dict) else None
        return str(message_id) if message_id else "mailgun-accepted"
