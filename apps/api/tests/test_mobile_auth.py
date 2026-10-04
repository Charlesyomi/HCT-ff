"""Mobile Google sign-in: redirect allowlist, single-use codes and token exchange."""

import hashlib
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine
from sqlmodel import Session, select

from app.config import settings
from app.models import Account, AccountSession
from app.services.auth_service import (
    STATE_COOKIE_NAME,
    generate_pkce_pair,
    read_state_cookie,
)
from tests.mobile_helpers import (
    MOBILE_REDIRECT,
    SESSION_COOKIE_NAME,
    auth_header,
    complete_mobile_sign_in,
    expire_mobile_codes,
    mobile_auth_config,  # noqa: F401  imported for its autouse-fixture side effect
    mobile_token,
    mock_google,
    start_mobile_sign_in,
    stored_mobile_codes,
)


# --- Redirect allowlist ---


def test_mobile_start_rejects_a_redirect_uri_outside_the_allowlist(
    order_app: tuple[TestClient, Engine],
) -> None:
    client, _engine = order_app
    _verifier, challenge = generate_pkce_pair()

    response = client.get(
        "/api/v1/auth/google/start",
        params={
            "client": "mobile",
            "redirect_uri": "https://evil.example/steal",
            "code_challenge": challenge,
        },
        follow_redirects=False,
    )

    assert response.status_code == 400
    assert "not allowed" in response.json()["error"]["message"]


def test_mobile_start_requires_a_redirect_uri(
    order_app: tuple[TestClient, Engine],
) -> None:
    client, _engine = order_app
    _verifier, challenge = generate_pkce_pair()

    response = client.get(
        "/api/v1/auth/google/start",
        params={"client": "mobile", "code_challenge": challenge},
        follow_redirects=False,
    )

    assert response.status_code == 400


def test_mobile_start_requires_a_pkce_code_challenge(
    order_app: tuple[TestClient, Engine],
) -> None:
    client, _engine = order_app

    response = client.get(
        "/api/v1/auth/google/start",
        params={"client": "mobile", "redirect_uri": MOBILE_REDIRECT},
        follow_redirects=False,
    )

    assert response.status_code == 400
    assert "code_challenge" in response.json()["error"]["message"]


def test_mobile_start_accepts_an_allowlisted_redirect_uri(
    order_app: tuple[TestClient, Engine],
) -> None:
    client, _engine = order_app
    _verifier, challenge = generate_pkce_pair()

    stored = start_mobile_sign_in(client, code_challenge=challenge)

    assert stored["client"] == "mobile"
    assert stored["redirect_uri"] == MOBILE_REDIRECT
    assert stored["mobile_challenge"] == challenge


def test_exp_prefix_is_only_a_development_convenience(
    order_app: tuple[TestClient, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An `exp://` prefix entry matches in development but never in production."""
    client, _engine = order_app
    _verifier, challenge = generate_pkce_pair()
    monkeypatch.setattr(settings, "mobile_redirect_allowlist", "adesoba://auth,exp://")
    params = {
        "client": "mobile",
        "redirect_uri": "exp://192.168.1.5:8081",
        "code_challenge": challenge,
    }

    production = client.get("/api/v1/auth/google/start", params=params, follow_redirects=False)
    monkeypatch.setattr(settings, "app_env", "development")
    development = client.get("/api/v1/auth/google/start", params=params, follow_redirects=False)

    assert production.status_code == 400
    assert development.status_code == 307


def test_web_start_is_unaffected_by_the_mobile_parameters(
    order_app: tuple[TestClient, Engine],
) -> None:
    """`client=mobile` is opt-in, so the plain browser flow carries no mobile state."""
    client, _engine = order_app

    response = client.get(
        "/api/v1/auth/google/start", params={"next": "/my-orders"}, follow_redirects=False
    )
    assert response.status_code == 307
    cookie = client.cookies.get(STATE_COOKIE_NAME)
    assert cookie is not None
    stored = read_state_cookie(cookie)
    assert stored is not None
    assert stored.get("client") is None
    assert stored.get("redirect_uri") is None


# --- Callback, code issuance and exchange ---


def sign_in_and_get_code(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[str, str]:
    """Run the mocked mobile Google flow end to end; returns (code, verifier)."""
    verifier, challenge = generate_pkce_pair()
    stored = start_mobile_sign_in(client, code_challenge=challenge)
    mock_google(monkeypatch, nonce=str(stored["nonce"]))
    return complete_mobile_sign_in(client, stored), verifier


def test_mobile_callback_redirects_to_the_app_with_a_code(
    order_app: tuple[TestClient, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, engine = order_app
    verifier, challenge = generate_pkce_pair()
    stored = start_mobile_sign_in(client, code_challenge=challenge)
    mock_google(monkeypatch, nonce=str(stored["nonce"]))

    code = complete_mobile_sign_in(client, stored)

    assert code
    # The app gets a bearer session, never a browser cookie.
    assert client.cookies.get(SESSION_COOKIE_NAME) is None
    with Session(engine) as session:
        assert len(session.exec(select(Account)).all()) == 1
    codes = stored_mobile_codes(engine)
    assert len(codes) == 1
    assert codes[0].challenge == challenge
    # Only the hash is persisted; the raw code is never stored.
    assert codes[0].code_hash == hashlib.sha256(code.encode()).hexdigest()


def test_mobile_auth_code_is_single_use(
    order_app: tuple[TestClient, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _engine = order_app
    code, verifier = sign_in_and_get_code(client, monkeypatch)

    first = mobile_token(client, code, verifier)
    second = mobile_token(client, code, verifier)

    assert first.status_code == 200
    assert second.status_code == 400
    assert "already been used" in second.json()["error"]["message"]


def test_mobile_token_exchange_returns_a_usable_bearer_token(
    order_app: tuple[TestClient, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, engine = order_app
    code, verifier = sign_in_and_get_code(client, monkeypatch)

    exchanged = mobile_token(client, code, verifier)

    assert exchanged.status_code == 200
    assert exchanged.json()["token_type"] == "Bearer"
    access_token = exchanged.json()["access_token"]
    assert datetime.fromisoformat(exchanged.json()["expires_at"]) > datetime.now(UTC)

    me = client.get("/api/v1/auth/me", headers=auth_header(access_token))
    assert me.status_code == 200
    assert me.json()["email"] == "mobile@example.com"
    with Session(engine) as session:
        records = session.exec(select(AccountSession)).all()
        assert len(records) == 1
        # The raw token is never persisted.
        assert records[0].token_hash != access_token


def test_mobile_auth_code_rejects_the_wrong_verifier(
    order_app: tuple[TestClient, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _engine = order_app
    code, _verifier = sign_in_and_get_code(client, monkeypatch)
    other_verifier, _other_challenge = generate_pkce_pair()

    response = mobile_token(client, code, other_verifier)

    assert response.status_code == 400
    assert "verifier" in response.json()["error"]["message"]


def test_expired_mobile_auth_code_is_rejected(
    order_app: tuple[TestClient, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, engine = order_app
    code, verifier = sign_in_and_get_code(client, monkeypatch)
    expire_mobile_codes(engine)

    response = mobile_token(client, code, verifier)

    assert response.status_code == 400
    assert "expired" in response.json()["error"]["message"]


def test_unknown_mobile_auth_code_is_rejected(order_app: tuple[TestClient, Engine]) -> None:
    client, _engine = order_app
    verifier, _challenge = generate_pkce_pair()

    response = mobile_token(client, "never-issued", verifier)

    assert response.status_code == 400
    assert "not valid" in response.json()["error"]["message"]


def test_logout_revokes_the_mobile_access_token(
    order_app: tuple[TestClient, Engine],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _engine = order_app
    code, verifier = sign_in_and_get_code(client, monkeypatch)
    access_token = mobile_token(client, code, verifier).json()["access_token"]
    headers = auth_header(access_token)

    logout = client.post("/api/v1/auth/logout", headers=headers)
    after = client.get("/api/v1/auth/me", headers=headers)

    assert logout.status_code == 200
    assert logout.json() == {"signed_out": True}
    assert after.status_code == 401