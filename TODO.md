# TODO — remaining build (SPEC Milestones 6–8)

Living plan for the work left after Milestone 5. Source of truth stays
[`docs/SPEC.md`](docs/SPEC.md) and [`docs/SPEC_ADDENDUM_001_HNG.md`](docs/SPEC_ADDENDUM_001_HNG.md)
(the addendum wins on conflict); this file only sequences and tracks the remaining work.

**How to work through it** (same rules as `docs/AGENT_RULES.md`): one milestone at a time, additive
changes only (expand-only migrations, nothing removed or renamed), passing tests keep passing, record
each unclear choice in `docs/DECISIONS.md`, put owner-only steps in `docs/RUNBOOK.md` and keep going,
and update the matching row in the milestone table of [`docs/STATUS.md`](docs/STATUS.md) when a
milestone is green.

**Green commands** (must all pass before a milestone row is marked done):

```
npm test        # web: vitest  ·  api: pytest
npm run lint    # next lint  ·  ruff
npm run typecheck
DATABASE_URL_TEST=postgresql+psycopg://… npm test   # adds Postgres-only tests
```

---

## 1. Where the build stands

| # | Milestone | Status | Notes |
|---|---|---|---|
| 1 | Foundation | Done | Monorepo, Alembic baseline, health/readiness, tokens, layout |
| 2 | Catalog & public pages | Done | Catalog API, seed, Home/Our Fish/About/Contact/Privacy/Terms, SEO |
| 3 | Order flow (UI) | Done | 6-question form/wizard, Review & Confirm, `/checkout`, `/order/sent/[reference]` |
| 4 | Order API | Done | Orders/customers/reference counter/events, idempotency, rate limits, Turnstile |
| 5 | Tracking | Done | My Orders (Active/Completed), track by reference + phone, detail view |
| 6 | Admin | **Missing** | Everything below in §2 |
| 7 | Hardening | **Missing** | Everything below in §3 |
| 8 | Launch prep | **Missing** | Everything below in §4 |

Addendum 001 steps A1 (checkout), A2 (database/deploy), A3 (email outbox + providers) and
A4 (Google sign-in) are **done**. Section B of the addendum (optional business additions) is not started.

Current suite: 95 API tests (7 Postgres-only, skipped without `DATABASE_URL_TEST`) + 18 web tests,
lint and typecheck clean.

---

## 2. Milestone 6 — Admin dashboard (`/admin`)

The biggest remaining chunk. Build backend-first so the UI is a thin client over tested endpoints.

### 2.1 Schema (expand-only migration `20241004_admin`)

- `admin_users`: id, email (unique), name, password_hash (argon2id), role (`owner|staff`), is_active,
  last_login_at, failed_attempts, locked_until.
- `quotes`: id, order_id, version_no, unit_price_kobo, quantity_kg, delivery_fee_kobo, discount_kobo,
  total_kobo, deposit_kobo, valid_until, message_to_customer, created_by, is_accepted, accepted_at;
  one active quote per order, new quote supersedes old but keeps history.
- `payments`: id, order_id, amount_kobo, method (`cash|transfer|pos|other`), reference, received_at,
  recorded_by, note; immutable, corrections are new reversal rows.
- `audit_log`: id, actor_type, actor_id, action, entity, entity_id, before JSON, after JSON, ip, created_at.
- Money stays integer kobo; payment state is derived from `payments` vs the accepted quote.

### 2.2 Auth and security (SPEC §8, §11)

- `POST /admin/auth/login`, `POST /admin/auth/logout`, `GET /admin/auth/me`, `POST /admin/auth/change-password`.
- Server-side admin session (hashed id), separate cookie name/path from `adesoba_session`,
  `HttpOnly; Secure; SameSite=Lax`.
- CSRF token on every mutating admin request (`X-CSRF-Token`), role check (`owner` for `/admin/users`),
  login rate limit 5/15 min per IP+email and lockout via `failed_attempts`/`locked_until`.
- Argon2id hashing (already in `requirements.txt`); never log passwords or customer access tokens.

### 2.3 Endpoints

- `GET /admin/dashboard` — counts by status, today's pickups/deliveries, upcoming bulk orders, unhandled
  messages, pending/failed outbox email counts (`outbox_counts` already exists).
- `GET /admin/orders` — filter by status, date range, fulfilment, size, bulk; search reference/name/phone;
  sort; paginate with `total`. `GET /admin/orders/{id}` (full view incl. internal notes, quotes, payments, events).
- `PATCH /admin/orders/{id}` — internal notes + assignment, `version` required, mismatch ⇒ 409.
- `POST /admin/orders/{id}/transition` — the status machine (`pending → quoted → confirmed → ready → completed`,
  plus `declined`, `cancelled`, `expired`); illegal transition ⇒ 409; every transition writes `order_events`.
- `POST /admin/orders/{id}/quote`, `POST /admin/orders/{id}/payments` (immutable ledger, derived state).
- `GET|POST|PATCH /admin/harvest-windows`, `GET|PUT /admin/availability` (bulk update for one window).
- `GET|POST|PATCH /admin/size-classes`, `/admin/fish-types`.
- `GET|PATCH /admin/settings`, `GET /admin/customers`, `GET /admin/customers/{id}` (order history),
  `GET|PATCH /admin/messages`, `GET /admin/orders/export.csv`, owner-only `GET|POST|PATCH /admin/users`.
- Customer privacy: admin export/delete of a customer's data on request (SPEC §11).

### 2.4 Revalidation and scheduled jobs (SPEC §8, §10)

- Next.js `POST /api/revalidate` with a shared-secret header; the API calls it after any availability,
  harvest-window or settings change. Point the public pages at `revalidateTag('catalog')`.
- Cron/CLI job: mark `quoted` orders `expired` when `valid_until` passes; daily digest of tomorrow's
  pickups/deliveries. Reuse the `python-tool.mjs` runner pattern (`app/email_worker.py` is the model).

### 2.5 UI (`apps/web/app/admin`)

- Mobile-usable screens: login, dashboard, orders list (filters/sort), order detail (event timeline,
  status buttons that respect the machine, quote builder, payments ledger), availability/harvest editor,
  settings, customers, messages, users (owner only).
- Show every customer-facing label (Pending, Quoted, Confirmed, Ready for pickup/delivery, Completed,
  Cancelled, Declined, Expired); status never by colour alone; `noindex` on `/admin`.

### 2.6 Tests and done-when

- Unit: status machine for every legal and illegal transition; quote maths (integer kobo, rounding,
  supersede rules); derived payment state; password hashing and lockout.
- Integration: login/CSRF/permissions (staff vs owner), optimistic-lock 409, CSV export contents,
  audit rows written for admin mutations.
- Web: component tests for the quote builder and the status buttons.
- Done when `npm test`, `npm run lint`, `npm run typecheck` are green and `docs/STATUS.md` row 6 is updated.

---

## 3. Milestone 7 — Hardening

### 3.1 Tests

- Playwright e2e (mobile + desktop): home → intent card → full order → confirmation; validation errors
  and recovery; **double-click submit creates exactly one order**; admin login → open order → quote →
  confirm → payment → complete; availability change in admin updates the public page.
- Visual snapshots of home, order page and each mobile step against `docs/design/` baselines.
- Axe accessibility run on every public page and the checkout (WCAG 2.1 AA: landmarks, focus rings,
  labels, `aria-describedby` errors, contrast, reduced motion, 44px targets).
- Load test of `POST /orders` (API p95 < 300ms budget from SPEC §11).
- CI must fail on lint, type, test or budget regressions (`.github/workflows/ci.yml` already runs the
  fast checks; wire the slow ones on schedule or on demand).

### 3.2 Performance budgets

- Lighthouse CI budgets: LCP < 2.5s, CLS < 0.1, INP < 200ms, home initial JS < 150KB gzipped,
  hero image ≤ 150KB. Record the current build output in `docs/STATUS.md` first, then hold the line
  (dependencies are additive only from here).

### 3.3 Security and operations

- Security headers (CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors none`) on the
  Next app and the API; confirm CORS still allows only `WEB_ORIGIN`.
- Dependency audit in CI (`pip-audit`, `npm audit`) with a documented policy for findings.
- Sentry (or equivalent) for API and web errors; uptime monitor on `/health`; daily DB backup **and a
  tested restore** documented in `docs/RUNBOOK.md`; retention policy and customer-data deletion process.
- Analytics events if wanted: `order_started`, `order_step_completed{step}`, `order_submitted`,
  `whatsapp_click`, `call_click`, `intent_selected` (cookie-free provider).
- Confirm no PII leaks into logs (phone masking already applied in `notifier.py`).

### 3.4 Done-when

Budgets and e2e suite run in CI, restore procedure proven once, `docs/STATUS.md` row 7 updated.

---

## 4. Milestone 8 — Launch prep

1. Replace every `[EDIT ME]` placeholder (farm address, WhatsApp/phone numbers, harvest copy) with real
   content in `site_settings` and the page copy.
2. Replace `public/images/*-placeholder.svg` with real photography at the same aspect ratios; re-check
   image budgets after the swap.
3. Domain + HTTPS (DNS, certificate, `SESSION_COOKIE_SECURE=true`, `sslmode=require` on the DB URLs).
4. Seed the production admin (owner) from the RUNBOOK checklist; rotate every secret out of `.env` files.
5. Uptime monitor + error alerting switched on; `EMAIL_PROVIDER` and Google credentials verified live.
6. Dry run: one real order end-to-end (guest checkout → confirmation email → admin quote → confirm →
   payment → complete), then one Google-signed-in order, then check `/my-orders` from both paths.
7. Final pass over privacy policy text, consent line, Terms, and the retention note; update
   `docs/RUNBOOK.md` and `README.md` with the real deploy steps.
8. Done when the dry run passes and `docs/STATUS.md` row 8 is updated.

---

## 5. Cross-cutting gaps (SPEC items outside the three milestones above)

- **Status machine** — transitions and the optimistic-lock `version` check land with §2.3; public
  endpoints already refuse illegal customer actions (`cancel` only from `pending`/`quoted`).
- **Outbox admin visibility** — `outbox_counts` exists; surface it on the dashboard (§2.3).
- **Quote expiry job** — depends on `quotes.valid_until` (§2.4).
- **Optional addendum §B** — only after the SPEC is complete; treat as a new milestone row.
- **API docs** — `docs/API.md` or an exported OpenAPI file is a SPEC §13 deliverable and still missing.

---

## 6. Owner-only actions (do not block the build)

Everything in [`docs/RUNBOOK.md`](docs/RUNBOOK.md): Cloudflare Turnstile keys, transactional email
provider account, Google Cloud Console OAuth client, Supabase project/pooler strings, `DATABASE_URL_TEST`
database, domain/DNS/certificate, production admin seeding. Each list is numbered and can be worked
through in parallel with the milestones above.