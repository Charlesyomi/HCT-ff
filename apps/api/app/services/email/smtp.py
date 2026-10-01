"""Generic SMTP provider (Addendum 001 §A3, step 3).

Uses the standard library only (no extra dependency): the blocking smtplib call runs in a
worker thread. This is the safety net if an HTTP provider's API changes or is blocked.
"""

import asyncio
import smtplib
from email.message import EmailMessage as MimeMessage

from app.config import settings
from app.services.email.base import EmailMessage, EmailProvider, PermanentEmailError, TransientEmailError


class SmtpProvider(EmailProvider):
    name = "smtp"

    def __init__(
        self,
        host: str | None = None,
        port: int | None = None,
        user: str | None = None,
        password: str | None = None,
        starttls: bool | None = None,
        timeout: float = 15.0,
    ) -> None:
        self.host = host if host is not None else settings.smtp_host
        self.port = port if port is not None else settings.smtp_port
        self.user = user if user is not None else settings.smtp_user
        self.password = password if password is not None else settings.smtp_password
        self.starttls = settings.smtp_starttls if starttls is None else starttls
        self.timeout = timeout

    def send(self, message: EmailMessage) -> str:
        if not self.host:
            raise PermanentEmailError("SMTP_HOST is not configured.")

        mime = MimeMessage()
        mime["Subject"] = message.subject
        mime["From"] = (
            f"{message.from_name} <{message.from_address}>" if message.from_name else message.from_address
        )
        mime["To"] = message.to_email
        if message.reply_to:
            mime["Reply-To"] = message.reply_to
        mime.set_content(message.text_body)
        mime.add_alternative(message.html_body, subtype="html")

        try:
            with smtplib.SMTP(self.host, self.port, timeout=self.timeout) as client:
                if self.starttls:
                    client.starttls()
                if self.user and self.password:
                    client.login(self.user, self.password)
                client.send_message(mime)
        except (smtplib.SMTPAuthenticationError, smtplib.SMTPRecipientsRefused) as error:
            raise PermanentEmailError(f"SMTP rejected the message: {error}") from error
        except (smtplib.SMTPException, OSError) as error:
            raise TransientEmailError(f"SMTP send failed: {error}") from error

        return f"smtp-{abs(hash((message.to_email, message.subject))) % 10_000_000}"

    async def send_async(self, message: EmailMessage) -> str:
        """Async wrapper so the outbox worker does not block the event loop on SMTP."""
        return await asyncio.to_thread(self.send, message)
