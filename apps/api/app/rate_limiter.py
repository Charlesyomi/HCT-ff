import threading
import time
from collections import defaultdict
from fastapi import HTTPException, Request, status

_LOCK = threading.Lock()
# key -> list of timestamps
_BUCKETS: dict[str, list[float]] = defaultdict(list)
_ENABLED: bool = True


def set_rate_limiting_enabled(enabled: bool) -> None:
    global _ENABLED
    _ENABLED = enabled


def reset_rate_limit_buckets() -> None:
    with _LOCK:
        _BUCKETS.clear()


def check_rate_limit(key: str, limit: int, window_seconds: int) -> None:
    if not _ENABLED:
        return

    now = time.monotonic()
    cutoff = now - window_seconds
    with _LOCK:
        timestamps = _BUCKETS[key]
        # Purge stale timestamps
        valid = [t for t in timestamps if t > cutoff]
        if len(valid) >= limit:
            _BUCKETS[key] = valid
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please slow down and try again later.",
            )
        valid.append(now)
        _BUCKETS[key] = valid


def get_client_ip(request: Request) -> str:
    # Use direct client host; if behind reverse proxy X-Forwarded-For could be checked
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "127.0.0.1"


def limit_order_creation_ip(request: Request) -> None:
    ip = get_client_ip(request)
    check_rate_limit(f"order_ip:{ip}", limit=5, window_seconds=3600)


def limit_order_lookup_ip(request: Request) -> None:
    ip = get_client_ip(request)
    check_rate_limit(f"lookup_ip:{ip}", limit=10, window_seconds=600)


def limit_contact_ip(request: Request) -> None:
    ip = get_client_ip(request)
    check_rate_limit(f"contact_ip:{ip}", limit=3, window_seconds=3600)
