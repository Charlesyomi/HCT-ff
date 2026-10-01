"""Outbox worker entry point (Addendum 001 §A3).

Run it as a long-lived loop inside the API process (see app.main lifespan) or as a one-shot
cron job: `npm run email:worker -- --once`.
"""

import argparse
import logging
import time

from sqlmodel import Session

from app.config import settings
from app.db import engine
from app.services.email.factory import build_email_provider
from app.services.email.outbox import process_pending

logger = logging.getLogger("adesoba.email.worker")


def run_once(limit: int = 10) -> dict[str, int]:
    provider = build_email_provider()
    with Session(engine) as session:
        return process_pending(session, provider=provider, limit=limit)


def main() -> None:
    parser = argparse.ArgumentParser(description="Send pending transactional emails.")
    parser.add_argument("--once", action="store_true", help="Process one batch and exit.")
    parser.add_argument("--limit", type=int, default=10, help="Maximum rows per batch.")
    parser.add_argument("--interval", type=int, default=settings.email_worker_interval_seconds)
    arguments = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    if arguments.once:
        logger.info("Email worker batch: %s", run_once(arguments.limit))
        return

    logger.info("Email worker started (provider=%s)", settings.email_provider)
    while True:
        try:
            run_once(arguments.limit)
        except Exception:
            logger.exception("Email worker batch failed; retrying after the interval")
        time.sleep(max(5, arguments.interval))


if __name__ == "__main__":
    main()
