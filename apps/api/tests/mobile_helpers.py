"""Helpers shared by the mobile-client tests (bearer sessions, carts, auth codes)."""

import time
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine
from sqlmodel import Session, select

from app.config import settings
from app.models import Account, AccountSession, Availability, MobileAuthCode, SizeClass
from app.services import auth_service
from app.services.auth_service import (
    SESSION_COOKIE_NAME,
    STATE_COOKIE_NAME,
    generate_pkce_pair,
    read_state_cookie,
)

CLIENT_ID = "test-client.apps.googleusercontent.com"
MOBILE_REDIRECT = "adesoba://auth"


class _TokenInfoResponse:
    def __init__(self, status_code: int, body: dict[str, Any]) -> None:
        self.status_code = status_code
        self._body = body

    def json(self) -> dict[str, Any]:
        return self._body


@pytest.fixture(autouse=True)
def mobile_auth_config(monkeypatch: pytest.MonkeyPatch) -> None:
    """Google credentials plus the mobile redirect allowlist, with no exp:// prefix match."""
    monkeypatch.setattr(settings, "google_client_id", CLIENT_ID)
    monkeypatch.setattr(settings, "google_client_secret", "secret")
    monkeypatch.setattr(
        settings, "google_redirect_uri", "http://localhost:3000/api/v1/auth/google/callback"
    )
    monkeypatch.setattr(settings, "session_cookie_secure", False)
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "mobile_redirect_allowlist", MOBILE_REDIRECT)


def valid_claims(**overrides: Any) -> dict[str, Any]:
    claims: dict[str, Any] = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": "google-sub-mobile",
        "email": "mobile@example.com",
        "email_verified": "true",
        "name": "Mobile Customer",
        "nonce": "nonce-value",
        "exp": int(time.time()) + 3600,
    }
    claims.update(overrides)
    return claims


def mock_google(monkeypatch: pytest.MonkeyPatch, nonce: str, **claim_overrides: Any) -> None:
    """Mock the Google token exchange and tokeninfo verification; no real Google call."""
    monkeypatch.setattr(
        auth_service, "exchange_code_for_id_token", lambda code, verifier: "id-token"
    )

    def fake_get(url: str, **kwargs: Any) -> _TokenInfoResponse:
        return _TokenInfoResponse(200, valid_claims(nonce=nonce, **claim_overrides))

    monkeypatch.setattr(auth_service.httpx, "get", fake_get)


def start_mobile_sign_in(
    client: TestClient,
    *,
    redirect_uri: str = MOBILE_REDIRECT,
    code_challenge: str | None = None,
) -> dict[str, Any]:
    """Start the mobile Google flow and return the stored (signed) state payload."""
    verifier, challenge = generate_pkce_pair()
    params: dict[str, str] = {"client": "mobile", "redirect_uri": redirect_uri}
    if code_challenge is not None:
        params["code_challenge"] = code_challenge
    response = client.get("/api/v1/auth/google/start", params=params, follow_redirects=False)
    assert response.status_code == 307, response.text
    state_cookie = client.cookies.get(STATE_COOKIE_NAME)
    assert state_cookie is not None
    stored = read_state_cookie(state_cookie)
    assert stored is not None
    return {**stored, "verifier": verifier, "challenge": challenge}


def complete_mobile_sign_in(client: TestClient, stored: dict[str, Any]) -> str:
    """Finish the mocked Google callback; returns the raw auth code handed to the app."""
    response = client.get(
        f"/api/v1/auth/google/callback?code=google-code&state={stored['state']}",
        follow_redirects=False,
    )
    assert response.status_code == 307, response.text
    location = response.headers["location"]
    assert location.startswith(f"{MOBILE_REDIRECT}?code=")
    return location.split("code=", 1)[1]


def mobile_token(client: TestClient, code: str, code_verifier: str) -> Any:
    return client.post(
        "/api/v1/auth/mobile/token",
        json={"code": code, "code_verifier": code_verifier},
    )


def sign_in_with_cookie(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Complete the browser Google flow so the session cookie is set."""
    response = client.get("/api/v1/auth/google/start", follow_redirects=False)
    assert response.status_code == 307, response.text
    state_cookie = client.cookies.get(STATE_COOKIE_NAME)
    assert state_cookie is not None
    stored = read_state_cookie(state_cookie)
    assert stored is not None
    mock_google(monkeypatch, nonce=str(stored["nonce"]))
    callback = client.get(
        f"/api/v1/auth/google/callback?code=auth-code&state={stored['state']}",
        follow_redirects=False,
    )
    assert callback.status_code == 307, callback.text
    assert client.cookies.get(SESSION_COOKIE_NAME) is not None


def seed_account(
    engine: Engine,
    *,
    google_sub: str = "google-sub-mobile",
    email: str = "mobile@example.com",
) -> Account:
    with Session(engine) as session:
        account = session.exec(select(Account).where(Account.email == email)).first()
        if account is None:
            account = Account(
                google_sub=google_sub,
                email=email,
                email_verified=True,
                name="Mobile Customer",
            )
            session.add(account)
            session.commit()
            session.refresh(account)
        return account


def issue_bearer_token(engine: Engine, account: Account) -> str:
    """Mint a real session row and return its raw (unhashed) bearer token."""
    with Session(engine) as session:
        raw_token, _csrf = auth_service.create_session(
            session, account, created_ip="127.0.0.1", user_agent="pytest"
        )
        return raw_token


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def csrf_token_for(client: TestClient) -> str:
    token = client.get("/api/v1/me/orders").json()["csrf_token"]
    assert token
    return str(token)


def stored_sessions(engine: Engine) -> list[AccountSession]:
    with Session(engine) as session:
        return list(session.exec(select(AccountSession)).all())


def stored_mobile_codes(engine: Engine) -> list[MobileAuthCode]:
    with Session(engine) as session:
        return list(session.exec(select(MobileAuthCode)).all())


def expire_mobile_codes(engine: Engine) -> None:
    """Age every outstanding auth code past its two-minute window."""
    past = datetime.now(UTC) - timedelta(seconds=1)
    with Session(engine) as session:
        for record in session.exec(select(MobileAuthCode)).all():
            record.expires_at = past
            session.add(record)
        session.commit()


def set_size_price(engine: Engine, size_slug: str, price_kobo: int | None) -> None:
    """Publish an indicative per-kg price for one size in the active harvest window."""
    with Session(engine) as session:
        size_class = session.exec(select(SizeClass).where(SizeClass.slug == size_slug)).one()
        for availability in session.exec(
            select(Availability).where(Availability.size_class_id == size_class.id)
        ).all():
            availability.indicative_price_per_kg_kobo = price_kobo
            availability.price_updated_at = datetime.now(UTC)
            session.add(availability)
        session.commit()


def cart_line(
    size: str = "2-3kg", quantity_kg: int = 100, fish_type: str = "clarias"
) -> dict[str, Any]:
    return {"fish_type": fish_type, "size": size, "quantity_kg": quantity_kg}


def order_item(
    size: str = "2-3kg", quantity_kg: int = 100, fish_type: str = "clarias"
) -> dict[str, Any]:
    return {"fish_type": fish_type, "size": size, "quantity_kg": quantity_kg}