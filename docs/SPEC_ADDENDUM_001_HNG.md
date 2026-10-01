# Addendum 001 — HNG requirements (Neon/Supabase, transactional email, Google auth, Checkout)


**Precedence:** `docs/SPEC.md` is NOT edited. Where this addendum conflicts with it, this addendum wins. Everything here is **additive**: no existing table, column, endpoint, route, or test may be removed or renamed. Existing tests must stay green after every step. Schema changes are "expand only" migrations (new tables, new nullable columns).

---

## Step 0 — Status audit (do this first, change no code)

The earlier milestones were condensed and partly executed by a different agent. Before building anything:
1. Run lint, type-check and the full test suite; record results.
2. Write `docs/STATUS.md`: for each item in SPEC §15 (and each numbered rule in SPEC §6, §7, §8), mark **done / partial / missing / deviates**, with file paths as evidence.
3. Specifically verify and report: atomic order-reference generation, idempotency-key handling, the concurrent-creation test, optimistic-lock `version` on orders, the added "Your details" and delivery-address fields, and the status machine.
4. List anything built that the spec did not ask for.
Stop and report. Do not fix anything in this step.

---

## A. HNG requirements → how they map onto the existing spec

| HNG requirement | Effect on existing spec |
|---|---|
| Shop website | Already covered (order-request shop). No change. |
| Checkout page | Existing Review & Confirm becomes the `/checkout` route (A1). |
| Supabase/Neon persistence | Already plain Postgres. Config and driver hardening only (A2). |
| Confirmation emails (Mailgun named; Brevo suggested as a free alternative) | Provider-agnostic `EmailProvider` behind the existing `Notifier` interface, plus an email outbox (A3). Brevo is the default; Mailgun supported. |
| Google auth (Google Cloud Console) | Optional customer sign-in added next to the existing token/lookup access model (A4). |

### A1. Checkout page
- Routes: `/order` (form / wizard) → `/checkout` (Review & Confirm, page heading **"Checkout"**) → `/order/sent/[reference]` (Order Request Sent).
- Same content as SPEC §5.2 "Review & Confirm". Order state comes from the persisted `sessionStorage` store; visiting `/checkout` with no valid state redirects to `/order`. Refresh must not lose data.
- Keep the banner "You haven't been charged." No payment collection.
- Desktop stepper labels and mobile screens are unchanged.

### A2. Database on Supabase (chosen) or Neon
- Use **plain Postgres via `DATABASE_URL`**. Do not add Supabase or Neon client SDKs (no Supabase Auth, Storage or REST). Switching provider must be an env change only.
- **Supabase specifics (verify in the dashboard):** direct connections may be IPv6-only on free projects, which many home/WSL networks cannot reach. Use the **pooler** connection strings: transaction pooler (port 6543) for `DATABASE_URL` at runtime, and the session pooler (port 5432 on the pooler host) for `DATABASE_URL_DIRECT` (Alembic). Free projects can pause after inactivity; handle the first-connect retry below. Use a separate Supabase project for the HNG deployment and for the business deployment. Never run the concurrency/destructive tests against the business project; use local Postgres (`DATABASE_URL_TEST`) or a throwaway project.
- Two env vars: `DATABASE_URL` (pooled endpoint, runtime) and `DATABASE_URL_DIRECT` (non-pooled, used only by Alembic migrations and admin scripts).
- SSL required (`sslmode=require`).
- Behind a transaction pooler: disable prepared-statement caching in the driver (asyncpg `statement_cache_size=0`, or psycopg `prepare_threshold=None`); use no session-level features (session advisory locks, `LISTEN/NOTIFY`, temp tables). The `SELECT … FOR UPDATE` reference counter is transaction-scoped and is fine.
- Small pool sizes (free tiers have low connection limits). Retry with backoff on first connect (databases may be asleep); `/ready` tolerates a cold start without flapping.
- Run the **concurrent order creation test** against a real Postgres that goes through the same pooler type as production, at least once,, and record the result in `docs/DECISIONS.md`.

### A3. Transactional email (provider-agnostic; Brevo default, Mailgun supported)
HNG's brief names Mailgun; Brevo has since been suggested as a free alternative. Do not hard-code either. The application only knows an `EmailProvider` interface, and the provider is chosen by an environment variable. Switching provider must never require a code change outside the provider's own file.

- **Interface:** `EmailProvider.send(message) -> provider_message_id`. It raises `TransientEmailError` (timeouts, 5xx, rate-limit/quota responses such as HTTP 429) or `PermanentEmailError` (invalid recipient, rejected sender, bad credentials).
- **Config:** `EMAIL_PROVIDER=console|brevo|mailgun|smtp` (default `console`; `console` is used in dev and tests and prints the email), `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO`, `FARM_NOTIFY_EMAIL`. Provider-specific variables are namespaced and required **only when that provider is selected**: `BREVO_API_KEY`; `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_BASE_URL` (US or EU); `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_STARTTLS`.
- **Implement in this order:**
  1. `ConsoleProvider`.
  2. `BrevoProvider`: HTTP API via `httpx` (no SDK), `POST https://api.brevo.com/v3/smtp/email` with the `api-key` header. Verify the exact request shape against Brevo's current docs before coding.
  3. `SmtpProvider`: generic SMTP (`aiosmtplib` or stdlib). Brevo and Mailgun both offer SMTP relays, so this is the safety net if any provider's API changes or is blocked.
  4. `MailgunProvider`: HTTP API via `httpx`. Small; last.
- **Transactional outbox:** new table `email_outbox` (id, order_id nullable, provider, to_email, template, payload JSON, status `pending|sent|failed`, attempts, next_attempt_at, last_error, provider_message_id, created_at, updated_at) with `UNIQUE(order_id, template)`. The outbox row is inserted **in the same DB transaction as the order**. A background worker sends pending rows with exponential backoff and marks them. Email failure must never fail or roll back order creation.
- **Quota-aware retries:** free tiers cap sends per day (reported: Brevo about 300/day, Mailgun about 100/day), and each order sends up to two emails. A quota or 429 response is `TransientEmailError`: set `next_attempt_at` to the next hour (or the provider's reset time if given), do **not** count it toward the failure limit, and log a warning. Only `PermanentEmailError` or exhausted retries on real failures mark a row `failed`. The admin dashboard shows counts of pending and failed emails.
- **Templates (HTML + plain-text):** `order_received_customer` (reference, summary, "you haven't been charged", WhatsApp link, link to `/track`) and `order_received_farm` (summary + admin link). Do not put access tokens in emails; the link goes to the tracking lookup page. Templates are rendered by our code; providers receive finished HTML and text, with no dependence on provider-hosted templates.
- **Customer email policy:** **optional for guests** (label: "Email — we'll send your order confirmation"), **auto-filled and locked for Google-signed-in users**. If no email, only the farm email is sent.
- **Optional later:** provider webhooks for delivered/bounced events, with signature verification, behind the same provider interface.
- **RUNBOOK / owner checklist (before demoing):**
  - Create the provider account early. Brevo reportedly approves accounts before allowing sends, which can take time.
  - Verify the sender address or domain. Prefer a domain you own with SPF and DKIM (and DMARC) records set. Avoid free-mail addresses (gmail etc.) as the From address, since they may be rejected or land in spam.
  - Check whether the free plan adds provider branding to messages.
  - Mailgun: a sandbox domain only delivers to pre-authorised recipients.
  - Record the chosen provider, date and reason in `docs/DECISIONS.md`.

### A4. Google sign-in (optional for customers)
- Owned by the FastAPI backend: OpenID Connect Authorization Code flow with PKCE, scopes `openid email profile` only. Use `authlib` (or `google-auth` for ID-token verification).
- Endpoints: `GET /auth/google/start?next=`, `GET /auth/google/callback`, `POST /auth/logout`, `GET /auth/me`.
- Security: validate `state` and `nonce`; verify ID token signature, `iss`, `aud`, `exp`; require `email_verified=true`; `next` accepts **relative paths only** (open-redirect prevention).
- Sessions: server-side `sessions` table (hashed session id, account_id, expires_at, created_ip, user_agent). Cookie name `adesoba_session`, `HttpOnly; Secure; SameSite=Lax`, CSRF token on mutations. Distinct from the admin session (different cookie name and path). **Admin login stays email + password**, unchanged.
- Same-origin cookies: configure Next.js rewrites so the browser calls `/api/v1/*` on the web origin and it proxies to the API. Register the callback as `https://<web-origin>/api/v1/auth/google/callback` (plus `http://localhost:3000/...` for dev).
- New tables/columns (expand-only): `accounts` (id, google_sub UNIQUE, email, email_verified, name, avatar_url, created_at, last_login_at); `sessions`; `customers.account_id` nullable FK; `orders.account_id` nullable FK.
- Behaviour:
  - Sign-in is **optional and never blocks checkout**. Show two equal options at the top of checkout: "Continue with Google" and "Continue with phone number".
  - Google users get name/email prefilled; **phone number is still required** (the farm works by phone/WhatsApp).
  - My Orders (SPEC §5.4) gains a third access path: `GET /me/orders` for the signed-in account, alongside device tokens and reference+phone lookup. Guest orders are **not** auto-claimed by matching email (guest emails are unverified). A signed-in user may attach a guest order only via reference + phone lookup ("Add to my account").
  - Feature flag `REQUIRE_LOGIN_AT_CHECKOUT` (default `false`). If `true`, `/checkout` requires a session. Default stays false because the target customers order by phone and WhatsApp.
- RUNBOOK section for the owner (manual, in Google Cloud Console): create project → OAuth consent screen (External; app name, support email, authorised domain, links to Privacy Policy and Terms) → scopes `openid email profile` → OAuth client (Web application) with the redirect URIs above → set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. While the consent screen is in "Testing" only listed test users can sign in; set it to "In production" before anyone else tries it, and check in the console whether the basic scopes need any verification step.

### A5. Sections of SPEC.md this addendum amends
- §1 Non-goals: "customer accounts with passwords" stays true; Google sign-in is the only account type.
- §2 / §7: hosted Postgres = Supabase (chosen; Neon also works); new tables `email_outbox`, `accounts`, `sessions`; new nullable FKs listed above.
- §5.2 / §5.3: checkout route (A1).
- §5.4: third access path (A4).
- §6: customer email rule (A3).
- §8: new endpoints `/auth/*`, `/me/orders`, optional provider webhooks.
- §10: provider-agnostic email implementation and outbox (A3).
- §11: OAuth/session security (A4).
- §12 tests: see A6.
- §16 assumptions: sign-in optional; guests may omit email.

### A6. Tests to add
- OAuth callback (mock the provider; no real Google in CI): bad state, bad nonce, wrong audience, unverified email, expired token, open-redirect attempt.
- Outbox: order row and outbox row commit atomically; worker retry/backoff; `UNIQUE(order_id, template)` prevents duplicates; a provider failure does not affect the order response; a quota/429 response defers the email instead of failing it; changing `EMAIL_PROVIDER` requires no application code change.
- Migrations: upgrade and downgrade cleanly on a fresh DB; existing tests pass unchanged.
- E2E: guest checkout with email; Google-signed-in checkout (mocked OIDC); `/checkout` refresh keeps state; `/checkout` with empty state redirects to `/order`.

### A7. Safe rollout order (one commit/PR per step; all tests green before the next)
1. Step 0 audit.
2. DB hardening (A2) + run against Supabase.
3. Outbox + email providers (A3): console, Brevo, SMTP, then Mailgun.
4. Accounts, sessions, Google (A4).
5. `/checkout` route and sign-in UX (A1, A4).
6. My Orders with the account path.
7. Docs: RUNBOOK, DECISIONS, `.env.example`.
Then continue with the SPEC's admin and hardening milestones.

---

## B. Business-driven additions (OPTIONAL — start only after A is complete and green)

Why: the farm stocks for ~6 months and only sells in a short harvest window, so for most of the year there is nothing to order. Without this, the site sits idle exactly when the farm needs to find customers.

- **B1. Reservation mode.** When there is no published harvest window with `ends_on >= today`, the same order flow is titled **"Reserve for next harvest"**. Same fields; preferred date becomes optional ("Any date in the next harvest"). New columns (expand-only): `orders.kind` (`order|reservation`, default `order`); `preferred_date` becomes nullable when `kind='reservation'`. Admin gets a `kind` filter and a dashboard panel: **reserved demand by size in kg**, so the family can see demand before and during harvest.
- **B2. Share and referral.** A "Share on WhatsApp" button on the availability card (`wa.me` link with a short message and the site URL), a good Open Graph preview image, and support for `?ref=<code>` stored in `orders.source_ref` and shown in admin order detail.
- **B3. Order again.** A button on completed orders in My Orders that opens `/order` prefilled with the same fish type, size and quantity.