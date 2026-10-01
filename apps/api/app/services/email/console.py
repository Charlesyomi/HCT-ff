"""Console provider: prints the message and is the default in dev and tests (A3.1)."""

import logging

from app.services.email.base import EmailMessage, EmailProvider

logger = logging.getLogger("adesoba.email.console")


class ConsoleProvider(EmailProvider):
    name = "console"

    def send(self, message: EmailMessage) -> str:
        logger.info(
            "Email to %s | subject: %s | text: %s",
            message.to_email,
            message.subject,
            message.text_body.replace("\n", " ")[:160],
        )
        return f"console-{abs(hash((message.to_email, message.subject))) % 10_000_000}"
