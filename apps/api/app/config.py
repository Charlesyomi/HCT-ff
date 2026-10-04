from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = Field(default="development", alias="APP_ENV")
    database_url: str = Field(
        default="postgresql+psycopg://postgres:postgres@localhost:5432/adesoba",
        alias="DATABASE_URL",
    )
    secret_key: str = Field(default="change-me", alias="SECRET_KEY")
    web_origin: str = Field(default="http://localhost:3000", alias="WEB_ORIGIN")
    database_url_test: str | None = Field(default=None, alias="DATABASE_URL_TEST")
    # Addendum §A2: migrations use the direct endpoint, runtime uses the pooled one.
    database_url_direct: str | None = Field(default=None, alias="DATABASE_URL_DIRECT")
    database_pool_max_size: int = Field(default=5, alias="DATABASE_POOL_MAX_SIZE")
    database_pool_max_overflow: int = Field(default=5, alias="DATABASE_POOL_MAX_OVERFLOW")
    database_pool_timeout_seconds: int = Field(default=10, alias="DATABASE_POOL_TIMEOUT_SECONDS")
    database_pool_recycle_seconds: int = Field(default=1800, alias="DATABASE_POOL_RECYCLE_SECONDS")
    database_connect_timeout_seconds: int = Field(
        default=10, alias="DATABASE_CONNECT_TIMEOUT_SECONDS"
    )
    database_connect_retries: int = Field(default=5, alias="DATABASE_CONNECT_RETRIES")
    database_connect_backoff_seconds: float = Field(
        default=2.0, alias="DATABASE_CONNECT_BACKOFF_SECONDS"
    )
    database_warmup_on_startup: bool = Field(default=True, alias="DATABASE_WARMUP_ON_STARTUP")
    turnstile_secret_key: str | None = Field(default=None, alias="TURNSTILE_SECRET_KEY")
    site_url: str = Field(default="http://localhost:3000", alias="SITE_URL")

    # Transactional email (Addendum §A3): provider-agnostic, console by default.
    email_provider: str = Field(default="console", alias="EMAIL_PROVIDER")
    email_from_address: str = Field(default="no-reply@example.com", alias="EMAIL_FROM_ADDRESS")
    email_from_name: str = Field(default="Adesoba Farm", alias="EMAIL_FROM_NAME")
    email_reply_to: str | None = Field(default=None, alias="EMAIL_REPLY_TO")
    farm_notify_email: str | None = Field(default=None, alias="FARM_NOTIFY_EMAIL")
    brevo_api_key: str | None = Field(default=None, alias="BREVO_API_KEY")
    mailgun_api_key: str | None = Field(default=None, alias="MAILGUN_API_KEY")
    mailgun_domain: str | None = Field(default=None, alias="MAILGUN_DOMAIN")
    mailgun_base_url: str | None = Field(default=None, alias="MAILGUN_BASE_URL")
    smtp_host: str | None = Field(default=None, alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT")
    smtp_user: str | None = Field(default=None, alias="SMTP_USER")
    smtp_password: str | None = Field(default=None, alias="SMTP_PASSWORD")
    smtp_starttls: bool = Field(default=True, alias="SMTP_STARTTLS")
    email_worker_interval_seconds: int = Field(default=30, alias="EMAIL_WORKER_INTERVAL_SECONDS")
    email_worker_enabled: bool = Field(default=True, alias="EMAIL_WORKER_ENABLED")

    # Google sign-in (Addendum §A4); unset means the feature is unavailable, never broken.
    google_client_id: str | None = Field(default=None, alias="GOOGLE_CLIENT_ID")
    google_client_secret: str | None = Field(default=None, alias="GOOGLE_CLIENT_SECRET")
    google_redirect_uri: str = Field(
        default="http://localhost:3000/api/v1/auth/google/callback",
        alias="GOOGLE_REDIRECT_URI",
    )
    session_cookie_secure: bool = Field(default=False, alias="SESSION_COOKIE_SECURE")

    # Mobile client redirect allowlist for the Google sign-in flow. Comma-separated entries are
    # matched exactly (`adesoba://auth`); an entry ending in `://` (e.g. `exp://`) is treated as
    # a development-only prefix so Expo dev builds can be pointed at a local machine.
    mobile_redirect_allowlist: str = Field(default="", alias="MOBILE_REDIRECT_ALLOWLIST")
    # Explicit opt-in that lets Expo (`exp://`) redirects match outside development too.
    mobile_allow_expo_redirects: bool = Field(default=False, alias="MOBILE_ALLOW_EXPO_REDIRECTS")

    # Shared secret for the API -> Next.js on-demand revalidation webhook (SPEC §8).
    revalidate_secret: str | None = Field(default=None, alias="REVALIDATE_SECRET")


settings = Settings()
