"""Brevo provider over the v3 SMTP/email HTTP API (Addendum 001 §A3, step 2).

No SDK is used: the request shape is the documented POST /v3/smtp/email body with the
`api-key` header. Transient failures are timeouts, 5xx and 429 (quota); everything else
that is not a 2xx is treated as permanent because retrying will not change the outcome.
"""

import httpx

from app.config import settings
from app.services.email.base import EmailMessage, EmailProvider, PermanentEmailError, TransientEmailError

BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email"
TRANSIENT_STATUSES = {408, 425, 429, 500, 502, 503, 504}


class BrevoProvider(EmailProvider):
    name = "brevo"

    def __init__(self, api_key: str | None = None, timeout: float = 10.0) -> None:
        self.api_key = api_key or settings.brevo_api_key
        self.timeout = timeout

    def send(self, message: EmailMessage) -> str:
        if not self.api_key:
            raise PermanentEmailError("BREVO_API_KEY is not configured.")

        sender = {"email": message.from_address, "name": message.from_name} if message.from_name else {"email": message.from_address}
        payload: dict[str, object] = {
            "sender": sender,
            "to": [{"email": message.to_email}],
            "subject": message.subject,
            "htmlContent": message.html_body,
            "textContent": message.text_body,
        }
        if message.reply_to:
            payload["replyTo"] = {"email": message.reply_to}
        if message.tags:
            payload["tags"] = message.tags

        try:
            response = httpx.post(
                BREVO_ENDPOINT,
                json=payload,
                headers={"api-key": self.api_key, "accept": "application/json"},
                timeout=self.timeout,
            )
        except httpx.HTTPError as error:
            raise TransientEmailError(f"Brevo request failed: {error}") from error

        if response.status_code in TRANSIENT_STATUSES:
            raise TransientEmailError(f"Brevo returned {response.status_code}.")
        if response.status_code >= 400:
            raise PermanentEmailError(f"Brevo rejected the message ({response.status_code}).")

        try:
            body = response.json()
        except ValueError:
            body = {}
        message_id = body.get("messageId") if isinstance(body, dict) else None
        return str(message_id) if message_id else "brevo-accepted"
