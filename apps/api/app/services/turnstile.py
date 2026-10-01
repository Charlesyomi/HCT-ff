import hashlib
import logging
import threading
import time
from dataclasses import dataclass

import httpx
from fastapi import HTTPException, status

from app.config import settings

logger = logging.getLogger("adesoba.turnstile")

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
VERIFY_TIMEOUT_SECONDS = 5.0
TOKEN_REUSE_WINDOW_SECONDS = 300.0

_seen_tokens: dict[str, float] = {}
_seen_lock = threading.Lock()


@dataclass(frozen=True)
class TurnstileResult:
    success: bool
    codes: list[str]
    token: str | None = None


def is_turnstile_enforced() -> bool:
    """Turnstile is feature-flagged: enforced only when a secret key is configured."""
    return bool(settings.turnstile_secret_key)


def _record_token_use(token_hash: str, now: float) -> bool:
    """Return False when this token hash was already seen inside the reuse window."""
    with _seen_lock:
        cutoff = now - TOKEN_REUSE_WINDOW_SECONDS
        for key in [k for k, seen_at in _seen_tokens.items() if seen_at <= cutoff]:
            del _seen_tokens[key]
        if token_hash in _seen_tokens:
            return False
        _seen_tokens[token_hash] = now
        return True


def reset_turnstile_state() -> None:
    with _seen_lock:
        _seen_tokens.clear()


def verify_turnstile(token: str | None, remote_ip: str | None = None) -> TurnstileResult:
    """
    Verify a Cloudflare Turnstile token against the siteverify endpoint.

    Concurrency race: parallel submissions can present the same token before the
    reuse guard records it, which would let one token create several orders.
    Prevention: the token hash is recorded under a lock before the network call
    returns, so only the first caller proceeds to order creation.
    """
    if not is_turnstile_enforced():
        return TurnstileResult(success=True, codes=["skipped"], token=token)

    if not token:
        return TurnstileResult(success=False, codes=["missing-input-response"], token=None)

    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    if not _record_token_use(token_hash, time.monotonic()):
        return TurnstileResult(success=False, codes=["token-replayed"], token=token)

    payload: dict[str, str] = {"secret": settings.turnstile_secret_key or "", "response": token}
    if remote_ip:
        payload["remoteip"] = remote_ip

    try:
        response = httpx.post(SITEVERIFY_URL, data=payload, timeout=VERIFY_TIMEOUT_SECONDS)
        response.raise_for_status()
        body = response.json()
    except (httpx.HTTPError, ValueError) as error:
        # Fail closed on an unreachable verifier so spam cannot bypass it by
        # breaking Cloudflare; the customer sees a retryable message.
        logger.warning("Turnstile verification failed to complete: %s", error)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Spam check is temporarily unavailable. Please try again.",
        ) from error

    success = bool(body.get("success"))
    codes = [str(code) for code in body.get("error-codes", [])]
    if not success:
        logger.info("Turnstile rejected a submission (codes=%s)", codes)
    return TurnstileResult(success=success, codes=codes, token=token)


def enforce_turnstile(token: str | None, remote_ip: str | None = None) -> None:
    result = verify_turnstile(token, remote_ip)
    if result.success:
        return
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="Spam check failed. Please refresh the page and try again.",
    )