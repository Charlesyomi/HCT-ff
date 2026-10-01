# Runbook

## Local development

1. Install dependencies with `npm install`.
2. Start Postgres with `docker compose up -d postgres`.
3. Run the API and web apps with the project Makefile or Docker Compose.

## Owner checklist — Cloudflare Turnstile (order + contact spam protection)

The API verifies Turnstile only when `TURNSTILE_SECRET_KEY` is set, so the site works without it; turn it on before launch.

1. Create a Cloudflare account and open **Turnstile** in the dashboard.
2. Create a widget (sitekey + secret key) with the **Invisible** appearance for the order form; add a second managed widget if you want the contact form separately.
3. Add every hostname that will serve the site (e.g. `localhost` for dev, the production domain) under **Widget → Hostnames**. A missing hostname makes the widget fail in the browser.
4. Put the widget **Sitekey** in `NEXT_PUBLIC_TURNSTILE_SITE_KEY` for the web app.
5. Put the widget **Secret key** in `TURNSTILE_SECRET_KEY` for the API (never commit it; set it in the deployment secret store).
6. Verify: submit the order form in a browser with the widget enabled, then submit again with a replayed token — the second submission must return HTTP 422. With no secret key set the check is skipped (development default).

## Owner checklist — transactional email (Addendum §A3)

Nothing is sent until a provider is chosen; `EMAIL_PROVIDER=console` only logs the message.

1. Create the provider account early — Brevo reportedly reviews accounts before allowing sends, so do this well before a demo.
2. Verify the sender address or domain. Prefer a domain you own with SPF and DKIM (and DMARC) records; free-mail From addresses (gmail, yahoo) are rejected or land in spam.
3. Set `EMAIL_FROM_ADDRESS` (the verified sender), `EMAIL_FROM_NAME=Adesoba Farm` and `FARM_NOTIFY_EMAIL` (the farm inbox that receives "New order request AF-…").
4. Set `EMAIL_PROVIDER=brevo` with `BREVO_API_KEY`, or `EMAIL_PROVIDER=mailgun` with `MAILGUN_API_KEY` + `MAILGUN_DOMAIN` (+ `MAILGUN_BASE_URL` for the EU region), or `EMAIL_PROVIDER=smtp` with the `SMTP_*` values. No code change is needed to switch.
5. Check whether the free plan adds provider branding to outgoing mail.
6. Mailgun: a sandbox domain only delivers to pre-authorised recipients, so verify a real domain before testing with customers.
7. Verify end to end: submit a test order, then run `npm run email:worker -- --once` (or wait for the in-process worker) and confirm the `email_outbox` rows reach `sent` with a `provider_message_id`.
8. Confirm the customer email contains the tracking link and **no** access token, and that no email failure ever blocks order creation.

## Owner checklist — Google sign-in (Addendum §A4)

Sign-in is optional: without these steps the checkout shows phone-number checkout only and nothing breaks.

1. Open the Google Cloud Console and create (or pick) a project for the farm.
2. Configure the OAuth consent screen: type **External**, app name, support email, developer contact email, and the authorised domain (the production web origin).
3. Add the app's homepage, privacy-policy URL and terms-of-service URL under **Authorized domains / Application home page** — Google requires links to both policies.
4. Add the scopes `openid`, `email`, `profile` (and nothing more).
5. Create an **OAuth client ID** of type **Web application** with these redirect URIs:
   - `https://<web-origin>/api/v1/auth/google/callback` (production, same origin via the Next rewrite)
   - `http://localhost:3000/api/v1/auth/google/callback` (development)
6. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` in the API environment, and `NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED=true` for the web app.
7. While the consent screen is in **Testing**, only listed test users can sign in — add your own Google account under **Test users**, then switch to **In production** before anyone else tries it.
8. Check in the console whether the basic `openid email profile` scopes need any verification step.
9. Set `SESSION_COOKIE_SECURE=true` behind HTTPS so the session cookie is never sent over plain HTTP.
10. Verify: sign in from `/checkout`, confirm the name/email are pre-filled and locked while the phone stays required, then `POST /api/v1/auth/logout` and confirm `/api/v1/auth/me` returns 401.

## Owner checklist — hosted Postgres (Supabase, Addendum §A2)

Plain Postgres only: no Supabase/Neon SDK, no Supabase Auth or Storage. Switching provider is an environment change.

1. Create **two separate projects**: one for the HNG/demo deployment and one for the business. Never point the concurrency tests at the business project.
2. Free projects pause after inactivity, so the API retries the first connect with backoff and `/ready` stays up while Postgres wakes. Confirm `/ready` returns 200 within a minute of the first request after a pause.
3. Copy the **transaction pooler** connection string (port 6543) into `DATABASE_URL`; it must end with `?sslmode=require` (or include `sslmode=require`).
4. Copy the **session/direct** connection string (port 5432 on the pooler host, or the direct host) into `DATABASE_URL_DIRECT`; Alembic uses it because DDL and session locks behave badly through the transaction pooler.
5. Check whether your network can reach the direct IPv6-only endpoint. If it cannot, use the session pooler string for `DATABASE_URL_DIRECT` and never the direct IPv6 host.
6. Keep `DATABASE_POOL_MAX_SIZE` small (5+5 overflow is plenty) — free tiers cap concurrent connections, and too large a pool exhausts them instantly.
7. Prepared statements are disabled automatically when the runtime URL uses port 6543; do not add `prepare_threshold` by hand.
8. Leave `DATABASE_URL_TEST` pointing at a throwaway database (or local Postgres), never at the hosted project.

## Owner checklist — Postgres for the concurrency tests

1. Create a throwaway database for tests (never the production or business database).
2. Export `DATABASE_URL_TEST` with that URL before running `npm test` (or `node scripts/python-tool.mjs pytest apps/api/tests`).
3. With the variable set, `test_orders.py` runs the concurrent-reference, concurrent-idempotency and `test_migrations.py` the upgrade/downgrade checks; without it those tests skip and only SQLite runs.
4. After running against a real pooler endpoint, record the result in `docs/DECISIONS.md` (Addendum §A2 requires this once).

## Production guidance

- Keep environment variables in secret storage.
- Run daily backups of Postgres.
- Validate health and readiness endpoints before deployment.
- Keep admin credentials rotated and stored outside the repo.
