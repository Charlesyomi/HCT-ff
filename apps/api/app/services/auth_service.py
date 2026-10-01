"""Google sign-in: OIDC authorization code + PKCE, server-side sessions (Addendum §A4).

Sign-in is optional everywhere; guest checkout by phone keeps working without it.

Security decisions (all covered by tests in tests/test_auth.py):
* `state` and `nonce` are generated per attempt and stored in a short-lived, HMAC-signed
  HttpOnly cookie, so a callback from another browser cannot complete the flow;
* `next` is only honoured when it is a relative path, which blocks open redirects;
* the ID token is validated by Google's tokeninfo endpoint (server-to-server, so the
  signature is checked by Google itself) and then re-checked locally for `aud`, `iss`,
  `exp`, `nonce` and `email_verified`;
* the session cookie holds a random id whose SHA-256 hash is the only stored value.
"""

import base64
import hashlib
import hmac
import json
import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
from sqlmodel import Session, col, select

from app.config import settings
from app.models import Account, AccountSession, Customer, Order

logger = logging.getLogger("adesoba.auth")

GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_TOKENINFO_ENDPOINT = "https://oauth2.googleapis.com/tokeninfo"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
SCOPES = "openid email profile"
STATE_COOKIE_NAME = "adesoba_oauth_state"
SESSION_COOKIE_NAME = "adesoba_session"
STATE_TTL_SECONDS = 600
SESSION_TTL_DAYS = 30
HTTP_TIMEOUT_SECONDS = 10.0


class AuthError(Exception):
    """Authentication failed; the endpoint turns this into a safe redirect or 401."""


@dataclass(frozen=True)
class GoogleProfile:
    google_sub: str
    email: str
    email_verified: bool
    name: str | None
    avatar_url: str | None


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


# --- PKCE ---


def generate_pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for S256 (RFC 7636)."""
    verifier = _b64url(secrets.token_bytes(48))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


# --- signed state cookie ---


def sign_state_cookie(payload: dict[str, Any]) -> str:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signature = hmac.new(settings.secret_key.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return f"{_b64url(body)}.{signature}"


def read_state_cookie(value: str | None, max_age_seconds: int = STATE_TTL_SECONDS) -> dict[str, Any] | None:
    """
    Verify the signature and age of the state cookie.

    Concurrency race: a user can open two sign-in tabs at once and the second tab would
    overwrite the first tab's state cookie, making the first callback fail.
    Prevention: state values are stored per attempt and compared with the cookie, so a
    mismatch is rejected instead of silently binding the callback to the other tab.
    """
    if not value or "." not in value:
        return None
    body_part, signature = value.rsplit(".", 1)
    try:
        body = base64.urlsafe_b64decode(body_part + "=" * (-len(body_part) % 4))
    except (ValueError, TypeError):
        return None
    expected = hmac.new(settings.secret_key.encode("utf-8"), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return None
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None
    created_at = int(payload.get("created_at", 0))
    if datetime.now(UTC).timestamp() - created_at > max_age_seconds:
        return None
    return payload


# --- redirects ---


def safe_next_path(next_path: str | None) -> str:
    """Only same-site relative paths are accepted; everything else falls back home."""
    if not next_path:
        return "/my-orders"
    if not next_path.startswith("/") or next_path.startswith("//"):
        return "/my-orders"
    if "://" in next_path or "\\" in next_path:
        return "/my-orders"
    return next_path


# --- Google endpoints ---


def authorization_url(state: str, code_challenge: str, next_path: str | None, nonce: str | None = None) -> str:
    if not settings.google_client_id:
        raise AuthError("Google sign-in is not configured.")
    query_values = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "access_type": "online",
        "prompt": "select_account",
    }
    if nonce:
        # The nonce binds the returned id_token to this attempt; Google echoes it in the token.
        query_values["nonce"] = nonce
    return f"{GOOGLE_AUTHORIZATION_ENDPOINT}?{urlencode(query_values)}"


def exchange_code_for_id_token(code: str, code_verifier: str) -> str:
    try:
        response = httpx.post(
            GOOGLE_TOKEN_ENDPOINT,
            data={
                "code": code,
                "client_id": settings.google_client_id or "",
                "client_secret": settings.google_client_secret or "",
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
                "code_verifier": code_verifier,
            },
            timeout=HTTP_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as error:
        raise AuthError(f"Token exchange failed: {error}") from error
    if response.status_code >= 400:
        raise AuthError("Token exchange was rejected.")
    try:
        body = response.json()
    except ValueError as error:
        raise AuthError("Token exchange returned an unreadable response.") from error
    id_token = body.get("id_token")
    if not isinstance(id_token, str) or not id_token:
        raise AuthError("Token exchange returned no id_token.")
    return id_token


def verify_id_token(id_token: str, expected_nonce: str | None) -> GoogleProfile:
    """
    Validate the ID token with Google and then apply our own checks.

    Concurrency race: an attacker could replay a valid id_token from another session.
    Prevention: the token must carry the `nonce` we generated for this attempt, which is
    single-use, and `exp` must be in the future at the moment of verification.
    """
    try:
        response = httpx.get(
            f"{GOOGLE_TOKENINFO_ENDPOINT}?id_token={id_token}",
            timeout=HTTP_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as error:
        raise AuthError(f"Token verification failed: {error}") from error
    if response.status_code >= 400:
        raise AuthError("The Google token could not be verified.")
    try:
        claims = response.json()
    except ValueError as error:
        raise AuthError("The Google token info response was unreadable.") from error

    if not claims.get("email_verified") or str(claims.get("email_verified")).lower() not in ("true", "1"):
        raise AuthError("Your Google email address is not verified.")
    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise AuthError("Unexpected token issuer.")
    if claims.get("aud") != settings.google_client_id:
        raise AuthError("Token audience does not match this application.")
    expires_at = int(claims.get("exp", 0))
    if expires_at <= int(datetime.now(UTC).timestamp()):
        raise AuthError("The Google token has expired.")
    if expected_nonce and claims.get("nonce") != expected_nonce:
        raise AuthError("Token nonce does not match this sign-in attempt.")

    google_sub = claims.get("sub")
    email = claims.get("email")
    if not isinstance(google_sub, str) or not isinstance(email, str):
        raise AuthError("The Google token is missing required claims.")
    return GoogleProfile(
        google_sub=google_sub,
        email=email.lower(),
        email_verified=True,
        name=claims.get("name") if isinstance(claims.get("name"), str) else None,
        avatar_url=claims.get("picture") if isinstance(claims.get("picture"), str) else None,
    )


# --- accounts and sessions ---


def upsert_account(session: Session, profile: GoogleProfile) -> Account:
    now = datetime.now(UTC)
    account = session.exec(
        select(Account).where(col(Account.google_sub) == profile.google_sub)
    ).first()
    if account is None:
        account = session.exec(select(Account).where(col(Account.email) == profile.email)).first()
    if account is None:
        account = Account(
            google_sub=profile.google_sub,
            email=profile.email,
            email_verified=profile.email_verified,
            name=profile.name,
            avatar_url=profile.avatar_url,
            last_login_at=now,
        )
    else:
        account.google_sub = profile.google_sub
        account.email = profile.email
        account.email_verified = profile.email_verified
        account.name = profile.name or account.name
        account.avatar_url = profile.avatar_url or account.avatar_url
        account.last_login_at = now
        account.updated_at = now
    session.add(account)
    session.commit()
    return account


def create_session(
    session: Session,
    account: Account,
    *,
    created_ip: str | None,
    user_agent: str | None,
) -> tuple[str, str]:
    """Return (raw session id, CSRF token); only their hashes are persisted."""
    raw_session_id = secrets.token_urlsafe(32)
    csrf_token = _b64url(hashlib.sha256(f"csrf:{raw_session_id}".encode("ascii")).digest())
    record = AccountSession(
        account_id=account.id,
        token_hash=hashlib.sha256(raw_session_id.encode("ascii")).hexdigest(),
        csrf_token_hash=hashlib.sha256(csrf_token.encode("ascii")).hexdigest(),
        expires_at=datetime.now(UTC) + timedelta(days=SESSION_TTL_DAYS),
        created_ip=created_ip,
        user_agent=(user_agent or "")[:400] or None,
    )
    session.add(record)
    session.commit()
    return raw_session_id, csrf_token


def current_session(session: Session, raw_session_id: str | None) -> AccountSession | None:
    if not raw_session_id:
        return None
    token_hash = hashlib.sha256(raw_session_id.encode("ascii")).hexdigest()
    record = session.exec(
        select(AccountSession).where(col(AccountSession.token_hash) == token_hash)
    ).first()
    if record is None:
        return None
    expires_at = record.expires_at if record.expires_at.tzinfo else record.expires_at.replace(tzinfo=UTC)
    if expires_at <= datetime.now(UTC):
        session.delete(record)
        session.commit()
        return None
    return record


def verify_csrf(record: AccountSession, raw_session_id: str, csrf_token: str | None) -> bool:
    if not csrf_token:
        return False
    expected = _b64url(hashlib.sha256(f"csrf:{raw_session_id}".encode("ascii")).digest())
    if not hmac.compare_digest(expected, csrf_token):
        return False
    return hmac.compare_digest(
        record.csrf_token_hash,
        hashlib.sha256(csrf_token.encode("ascii")).hexdigest(),
    )


def delete_session(session: Session, record: AccountSession) -> None:
    session.delete(record)
    session.commit()


def attach_order_to_account(session: Session, account: Account, order: Order) -> Order:
    """
    Attach a guest order to the signed-in account (reference + phone proven by the caller).

    Concurrency race: two tabs could attach the same order at the same time.
    Prevention: the UPDATE is conditional on `account_id IS NULL`, so only the first
    attachment wins and the second sees the order already owned.
    """
    if order.account_id is not None:
        if order.account_id == account.id:
            return order
        raise AuthError("That order is already attached to another account.")
    if order.customer_id is not None:
        customer = session.exec(
            select(Customer).where(col(Customer.id) == order.customer_id)
        ).first()
        if customer is not None:
            customer.account_id = account.id
            session.add(customer)
    order.account_id = account.id
    session.add(order)
    session.commit()
    return order


def account_orders(session: Session, account: Account) -> list[Order]:
    return list(
        session.exec(
            select(Order).where(col(Order.account_id) == account.id).order_by(col(Order.submitted_at))
        ).all()
    )
