# Codebase Status & Audit Report

**Date of Audit:** October 1, 2026  
**Auditor:** Antigravity (AI Assistant)  
**Branch:** `chore/status-audit`  
**Baseline Commit:** `f036b60` (`chore: baseline as left by Copilot agent`) / `8f0df32` (`updated project specs`)  
**Scope:** Read-only audit of existing codebase against `docs/SPEC.md` and `docs/SPEC_ADDENDUM_001_HNG.md`.

---

## 1. Test, Lint & Type-Check Execution Results

### 1.1 Linting
* **Command:** `npm run lint` (executes `npm run web:lint && npm run api:lint`)
* **Sub-commands:**
  * `next lint` (in `apps/web`): Passed with `✔ No ESLint warnings or errors`.
  * `node scripts/python-tool.mjs ruff check apps/api`: Passed with `All checks passed!`.
* **Exit Code:** 0 (Clean).

### 1.2 Type-Checking
* **Command:** `npm run typecheck` (executes `npm run web:typecheck && npm run api:typecheck`)
* **Sub-commands:**
  * `tsc --noEmit` (in `apps/web`): Passed with 0 errors.
  * `node scripts/python-tool.mjs mypy apps/api`: Passed with `Success: no issues found in 11 source files`.
* **Exit Code:** 0 (Clean).

### 1.3 Test Suite Execution
* **Command:** `npm test` (executes `npm run web:test && npm run api:test`)
* **Sub-commands:**
  * `vitest run` (in `apps/web`):
    * `lib/order-form.test.ts`: 3 tests passed.
    * `components/order/order-flow.test.tsx`: 5 tests passed.
    * Summary: 2 test files, 8 passed (2.75s).
  * `node scripts/python-tool.mjs pytest apps/api/tests`:
    * `apps/api/tests/test_catalog.py`: 4 tests passed.
    * `apps/api/tests/test_health.py`: 3 tests passed.
    * Summary: 2 test files, 7 passed (0.87s), with 6 deprecation warnings from Python 3.14/starlette/pytest-asyncio.
* **Exit Code:** 0 (Clean).

### 1.4 Environment & Operational Limitations
* **Docker Unavailable:** `docker compose ps` failed with exit code 127 (`bash: docker: command not found`). Docker is not installed on the host environment.
* **PostgreSQL Unavailable:** `node scripts/python-tool.mjs migrate upgrade head` failed with `psycopg.OperationalError: connection to server at "127.0.0.1", port 5432 failed: Connection refused`. No PostgreSQL instance is running locally, Docker is absent to launch one, and no remote `DATABASE_URL` is configured in `apps/api/.env` (which does not exist).
* **Migration Verification via Dry-Run & SQLite:**
  * `node scripts/python-tool.mjs migrate upgrade head --sql` and `node scripts/python-tool.mjs migrate downgrade 20240929_init:base --sql` executed cleanly with exit code 0, generating valid PostgreSQL DDL.
  * Running `upgrade head` and `downgrade base` against an isolated SQLite test database succeeded cleanly without error.
* **Test Isolation Limitation:** All 7 backend tests in `apps/api/tests` run exclusively against an in-memory SQLite engine (`sqlite://`), not PostgreSQL. No tests currently run against real PostgreSQL.

---

## 2. Milestone Audit (SPEC Section 15)

| # | Milestone | Status | One-Line Reason |
|---|---|---|---|
| 1 | **Foundation** | **Done** | Monorepo layout, Docker Compose config, Alembic baseline, health/readiness endpoints, design tokens, typography, and base layout shells are all present and passing checks. |
| 2 | **Catalog & public pages** | **Done** | Database models for fish/sizes/harvest/availability, seed script, `/api/v1/catalog`, `/api/v1/contact`, Home page, Our Fish, About, Contact, Privacy, Terms, and SEO metadata/JSON-LD are fully implemented. |
| 3 | **Order flow (UI)** | **Done** | 6-question desktop/mobile form, Review & Confirm with "Your details", delivery address reveals, and Zustand draft store with `sessionStorage`; Review & Confirm is now also served by the `/checkout` route (Addendum §A1) with `/order/sent/[reference]` for confirmation. |
| 4 | **Order API** | **Done** | Customers/orders/reference-counters/order-events tables + migration, `POST /api/v1/orders` with atomic `AF-YYYY-NNNN` references, `Idempotency-Key` replay/409-style 422 conflicts, server-side business-rule validation, IP + per-phone rate limits, honeypot + Turnstile, hashed access tokens, `GET /orders/{reference}`, `POST /orders/lookup`, `POST /orders/{reference}/cancel`, order events, and 50 backend tests (7 Postgres-only tests run when `DATABASE_URL_TEST` is set). |
| 5 | **Tracking** | **Done** | `/my-orders` now loads real data: Active/Completed tabs, "Track an order" lookup by reference + phone (`POST /api/v1/orders/lookup`), device-token storage so returning visits refresh the order, order detail with masked phone, event history and customer cancel, plus the signed-in account list from `GET /api/v1/me/orders`; 4 new dashboard tests and 12 API tests cover the endpoints. |
| 6 | **Admin** | **Backend done, UI missing** | Admin API complete: auth/CSRF/lockout, dashboard, order list+detail+export, status machine, quotes, payments, availability/harvest/settings/catalog, customers, messages, owner-only users, audit log, quote-expiry job (`apps/api/app/routers/admin.py`, `app/services/admin_service.py`). The `/admin` screens themselves are still the static placeholder. |
| 7 | **Hardening** | **Missing** | No Playwright e2e test suite, Lighthouse CI configurations, axe accessibility tests, Sentry tracking, rate-limiting enforcement, or production runbook content exist. |
| 8 | **Launch prep** | **Missing** | Launch prep has not started; pages use placeholder copy (`[EDIT ME]`), placeholder SVGs, and orders cannot be placed end-to-end. |

### Addendum 001 progress (applied on top of the milestones above)

| Step | Scope | Status | One-Line Reason |
|---|---|---|---|
| A1 | Checkout route | **Done** | `/checkout` renders Review & Confirm from the persisted `sessionStorage` draft (heading "Checkout", "You haven't been charged." banner kept), redirects to `/order` when the draft is empty, and routes to `/order/sent/[reference]` after submit; 4 new component tests cover redirect, refresh, submit and banner. |
| A3 | Transactional email | **Done** | `email_outbox` table + migration, `EmailProvider` interface with `ConsoleProvider`/`BrevoProvider`/`SmtpProvider` (stdlib)/`MailgunProvider` selected by `EMAIL_PROVIDER`, outbox rows written in the order transaction, background worker with `FOR UPDATE SKIP LOCKED` claiming, quota deferral without burning attempts, and 16 tests covering atomicity, retries and templates. |
| A4 | Google sign-in | **Done** | `accounts` + `account_sessions` tables and nullable `customers.account_id` / `orders.account_id` columns, OIDC + PKCE endpoints (`/auth/google/start`, `/auth/google/callback`, `/auth/logout`, `/auth/me`, `/me/orders`, `/me/orders/attach`) with signed state cookie, nonce/aud/iss/exp/email_verified checks, relative-only `next`, hashed session cookie + CSRF, same-origin `/api/v1/*` rewrite, two-option sign-in UX on `/checkout`, and 23 mocked-provider tests (bad state/nonce, wrong audience, unverified email, expired token, open redirect). |
| A2 | Database & deploy readiness | **Done** | `DATABASE_URL_DIRECT` for Alembic plus `DATABASE_URL` on the transaction pooler, automatic `prepare_threshold=None` behind port 6543, small pools, startup connect retry with backoff (toggleable via `DATABASE_WARMUP_ON_STARTUP`), plain-Postgres-only rule, and 6 configuration tests; the Supabase checklist is in `docs/RUNBOOK.md`. |

---

## 3. Checklist of Numbered Rules (SPEC Sections 6, 7, 8)

### SPEC Section 6: Business Rules & Validation

| Rule | Description | Status | Evidence |
|---|---|---|---|
| 6.1 | `fish_type`: `clarias \| hybrid \| any` | **Partial** | **Done in UI**: `apps/web/lib/order-form.ts:59`, `apps/web/components/order/order-flow.tsx:15-19`.<br>**Missing in API**: No backend validator or order schema exists (`apps/api/app/schemas.py:1-80`). |
| 6.2 | `size`: Active size class; reject `sold_out`/`unavailable` with clear message | **Partial** | **Done in UI**: `apps/web/lib/order-form.ts:60-73`, `apps/web/components/order/order-flow.tsx:392-412, 547-556` (disables sold-out sizes with "Currently unavailable — ask us").<br>**Missing in API**: No backend validation exists. |
| 6.3 | `quantity_kg`: Integer, min `settings.min_order_kg` (40), max `settings.max_order_kg` (20000); $\ge 1000$ flagged `is_bulk` | **Partial** | **Done in UI**: `apps/web/lib/order-form.ts:74`, `apps/web/components/order/order-flow.tsx:247-288, 644-648`.<br>**Missing in API**: No backend validator; `is_bulk` flag is not set on the submission payload (`apps/web/components/order/order-flow.tsx:713-724`). |
| 6.4 | `preferred_date`: $\ge$ today + `min_lead_days` (1) and $\le$ today + 90 days in `Africa/Lagos` time; soft hint if outside harvest window | **Partial** | **Done in UI**: `apps/web/lib/order-form.ts:18-35, 102-119`; `apps/web/components/order/order-flow.tsx:202-205, 305-307`.<br>**Missing in API**: No backend validator exists. |
| 6.5 | `time_slot`: One of `settings.time_slots`; stored as slot key + label snapshot | **Partial** | **Done in UI**: `apps/web/lib/order-form.ts:80`, `apps/web/components/order/order-flow.tsx:312-323`.<br>**Missing in API**: No backend storage or snapshot logic exists. |
| 6.6 | `fulfilment`: `pickup \| delivery`; delivery requires address ($\ge 8$ chars) | **Partial** | **Done in UI**: `apps/web/lib/order-form.ts:13-16, 81, 121-128`, `apps/web/components/order/order-flow.tsx:327-356, 650-657`.<br>**Missing in API**: No backend order model or validator exists. |
| 6.7 | `notes`: $\le 500$ chars, plain text, trimmed, control chars stripped, escaped everywhere | **Partial** | **Done in UI**: `apps/web/lib/order-form.ts:82` (`z.string().max(500)`), `apps/web/components/order/order-flow.tsx:360-370` (live counter). Control characters are not stripped on frontend.<br>**Missing in API**: No backend processing. |
| 6.8 | `customer`: Name 2–80 chars; phone normalised to E.164 (NG default); email optional, validated | **Partial** | **Done in UI**: `apps/web/lib/order-form.ts:83-98` (validates name length, phone regex, optional email). `phonenumbers` normalisation is not executed on client.<br>**Missing in API**: No backend schema or normalisation endpoint. |
| 6.9 | `Consent`: Consent line below submit button with link to Privacy Policy | **Done** | `apps/web/components/order/order-flow.tsx:497-498` renders the exact consent text linking to `/privacy`. |
| 6.10 | `Order reference`: `AF-<YYYY>-<NNNN>`, per-year sequence starting at 0001, generated atomically in DB via `FOR UPDATE` or sequence | **Missing** | No `reference_counters` table, PostgreSQL sequence, or generation routine exists anywhere (`apps/api/app/models.py:1-164`, `apps/api/app/main.py:1-159`). |
| 6.11 | `Rate limits`: 5/hr per IP & 3/hr per phone (orders); 10/10 min (lookups); 5/15 min (login); 3/hr (contact) | **Missing** | `slowapi` is in `apps/api/requirements.txt:10`, but is neither imported, configured, nor applied to any endpoint in `apps/api/app/main.py:1-159`. |
| 6.12 | `Spam protection`: Honeypot field + Cloudflare Turnstile on order & contact forms | **Missing** | Neither honeypot inputs nor Cloudflare Turnstile scripts/verifications exist in `apps/web/components/order/order-flow.tsx`, `apps/web/components/contact/contact-form.tsx`, or `apps/api/app/main.py`. |
| 6.13 | `Order status machine`: Enforce `pending -> quoted -> confirmed -> ready -> completed`, cancellations, rejections (409 on illegal); optimistic-lock `version`; order events; derived payment state | **Missing** | No order status enum, state machine transitions, `version` column checks, or `order_events` logging exist (`apps/api/app/models.py:1-164`, `apps/api/app/main.py:1-159`). |

---

### SPEC Section 7: Data Model (PostgreSQL)

| Table | Status | Evidence |
|---|---|---|
| `fish_types` | **Done** | Defined in `apps/api/app/models.py:15-33` with UUID PK, slug, name, description, image_path, is_active, sort_order, timestamps. Migrated in `apps/api/migrations/versions/20240929_init.py:19-32`. |
| `size_classes` | **Done** | Defined in `apps/api/app/models.py:35-60` with UUID PK, slug, label, descriptor, min_kg, max_kg, image_path, is_featured, is_smoking_size, is_active, sort_order, timestamps. Migrated in `apps/api/migrations/versions/20240929_init.py:34-51`. |
| `harvest_windows` | **Done** | Defined in `apps/api/app/models.py:62-79` with UUID PK, starts_on, ends_on, notes, is_published, check constraint `starts_on <= ends_on`. Migrated in `apps/api/migrations/versions/20240929_init.py:53-65`. |
| `availability` | **Done** | Defined in `apps/api/app/models.py:89-130` with UUID PK, foreign keys to harvest window and size class, nullable `fish_type_id`, status check constraint, unique constraint `uq_availability_window_size`. Migrated in `apps/api/migrations/versions/20240929_init.py:66-90`. |
| `customers` | **Missing** | Table and model do not exist (`apps/api/app/models.py`, `apps/api/migrations/versions/20240929_init.py`). |
| `orders` | **Missing** | Table and model do not exist (`apps/api/app/models.py`, `apps/api/migrations/versions/20240929_init.py`). |
| `quotes` | **Missing** | Table and model do not exist (`apps/api/app/models.py`, `apps/api/migrations/versions/20240929_init.py`). |
| `payments` | **Missing** | Table and model do not exist (`apps/api/app/models.py`, `apps/api/migrations/versions/20240929_init.py`). |
| `order_events` | **Missing** | Table and model do not exist (`apps/api/app/models.py`, `apps/api/migrations/versions/20240929_init.py`). |
| `contact_messages` | **Partial** | Defined in `apps/api/app/models.py:148-164` and migrated in `apps/api/migrations/versions/20240929_init.py:103-113`. Missing the `handled_by` column specified in SPEC §7. |
| `admin_users` | **Missing** | Table and model do not exist (`apps/api/app/models.py`, `apps/api/migrations/versions/20240929_init.py`). |
| `site_settings` | **Done** | Defined in `apps/api/app/models.py:132-146` and migrated in `apps/api/migrations/versions/20240929_init.py:92-101` with UUID PK, unique key, JSON value. |
| `reference_counters` | **Missing** | Table and model do not exist (`apps/api/app/models.py`, `apps/api/migrations/versions/20240929_init.py`). |
| `audit_log` | **Missing** | Table and model do not exist (`apps/api/app/models.py`, `apps/api/migrations/versions/20240929_init.py`). |
| **Data Types & Rules** | **Partial** | UUID primary keys and `timestamptz` UTC timestamps are used across all existing models (`apps/api/app/models.py:11-12, 18, 27`). However, money as integer kobo is unverified since `quotes` and `payments` tables do not exist. |
| **Catalog Seeding** | **Partial** | `apps/api/app/seed.py:77-151` seeds 2 fish types, 4 size classes, 1 harvest window, availability, and default settings. Dev admin user is not seeded (admin table missing). |

---

### SPEC Section 8: API Endpoints (`/api/v1`)

| Endpoint | Method | Status | Evidence |
|---|---|---|---|
| `/health` | GET | **Done** | Implemented in `apps/api/app/main.py:38-40`; tested in `apps/api/tests/test_health.py:13-16`. |
| `/ready` | GET | **Done** | Implemented in `apps/api/app/main.py:43-49`; tested in `apps/api/tests/test_health.py:19-35`. |
| `/api/v1/catalog` | GET | **Done** | Implemented in `apps/api/app/main.py:52-138`; tested in `apps/api/tests/test_catalog.py:39-80`. |
| `/api/v1/orders` | POST | **Done** | Implemented in `apps/api/app/main.py`; tested in `apps/api/tests/test_orders.py`. |
| `/api/v1/orders/{reference}` | GET | **Done** | Implemented in `apps/api/app/main.py`; tested in `apps/api/tests/test_orders.py`. |
| `/api/v1/orders/lookup` | POST | **Done** | Implemented in `apps/api/app/main.py`; tested in `apps/api/tests/test_orders.py`. |
| `/api/v1/orders/{reference}/cancel` | POST | **Done** | Implemented in `apps/api/app/main.py`; tested in `apps/api/tests/test_orders.py`. |
| `/api/v1/contact` | POST | **Done** | Implemented in `apps/api/app/main.py:141-158`; tested in `apps/api/tests/test_catalog.py:82-110`. |
| `/admin/auth/login\|logout` | POST | **Done** | Implemented in `apps/api/app/routers/admin.py`; tested in `apps/api/tests/test_admin.py`. |
| `/admin/auth/me` | GET | **Done** | Implemented in `apps/api/app/routers/admin.py`; tested in `apps/api/tests/test_admin.py`. |
| `/admin/auth/change-password` | POST | **Done** | Implemented in `apps/api/app/routers/admin.py`; tested in `apps/api/tests/test_admin.py`. |
| `/admin/dashboard` | GET | **Done** | Implemented in `apps/api/app/routers/admin.py`; tested in `apps/api/tests/test_admin.py`. |
| `/admin/orders` | GET | **Done** | Implemented in `apps/api/app/routers/admin.py`; tested in `apps/api/tests/test_admin.py`. |
| `/admin/orders/{id}` | GET, PATCH | **Done** | Implemented in `apps/api/app/routers/admin.py`; tested in `apps/api/tests/test_admin.py`. |
| `/admin/orders/{id}/transition` | POST | **Done** | Implemented in `apps/api/app/routers/admin.py`; tested in `apps/api/tests/test_admin.py`. |
| `/admin/orders/{id}/quote` | POST | **Done** | Implemented in `apps/api/app/routers/admin.py`; tested in `apps/api/tests/test_admin.py`. |
| `/admin/orders/{id}/payments` | POST | **Done** | Implemented in `apps/api/app/routers/admin.py`; tested in `apps/api/tests/test_admin.py`. |
| `/admin/harvest-windows` | CRUD | **Done** | Implemented in `apps/api/app/routers/admin.py`; tested in `apps/api/tests/test_admin.py`. |
| `/admin/availability` | GET, PUT | **Done** | Implemented in `apps/api/app/routers/admin.py`; tested in `apps/api/tests/test_admin.py`. |
| `/admin/size-classes`, `/admin/fish-types` | CRUD | **Done** | Implemented in `apps/api/app/routers/admin.py`; tested in `apps/api/tests/test_admin.py`. |
| `/admin/settings`, `/admin/customers`, `/admin/messages` | GET, PATCH | **Done** | Implemented in `apps/api/app/routers/admin.py`; tested in `apps/api/tests/test_admin.py`. |
| `/admin/orders/export.csv` | GET | **Done** | Implemented in `apps/api/app/routers/admin.py`; tested in `apps/api/tests/test_admin.py`. |
| `/admin/users` | CRUD | **Done** | Implemented in `apps/api/app/routers/admin.py`; tested in `apps/api/tests/test_admin.py`. |
| `/api/revalidate` webhook | POST | **Partial** | The API calls `${WEB_ORIGIN}/api/revalidate` after availability/harvest/settings changes (`apps/api/app/routers/admin.py`), guarded by `REVALIDATE_SECRET`. The **Next.js route itself is still missing**, so public pages currently rely on their 60s timed revalidation. |

---

## 4. In-Depth Verification of Core Questions

### Q1: How is the order reference (AF-YYYY-NNNN) generated? Is it atomic in the database, or computed with count()/max()+1?
* **Answer:** **It is not implemented at all.**
* **Evidence:**
  * No `reference_counters` table or PostgreSQL sequence exists (`apps/api/app/models.py:1-164`, `apps/api/migrations/versions/20240929_init.py:1-129`).
  * No order creation routine or reference generator function exists in `apps/api`.
  * In `docs/ARCHITECTURE.md:7-10`, the text claims concurrency protection exists, but this is fictional documentation left by the earlier agent without implementation.
  * In the frontend (`apps/web/components/order/order-flow.tsx:42, 583, 733-738`), the UI expects the backend to return `{ reference: "..." }` and renders `#{reference}` in the confirmation panel (`order-flow.tsx:522`), but the API provides no such value.

### Q2: How is the Idempotency-Key handled? What happens on a repeat with the same payload, and with a different payload?
* **Answer:** **Handled on frontend only; completely unhandled on backend (returns 404).**
* **Evidence:**
  * **Frontend:** In `apps/web/lib/order-draft-store.ts:14, 22, 60-76`, an `idempotencyKey: string | null` is initialized and persisted to `sessionStorage`. When the user enters the review step, `apps/web/components/order/order-flow.tsx:659-661` generates a UUID via `crypto.randomUUID()` and stores it. When submitting, line 721 sends header `'Idempotency-Key': requestKey`.
  * **Backend:** In `apps/api/app/main.py:30`, CORS allows `"Idempotency-Key"` in preflight requests, and `apps/api/tests/test_health.py:43, 48` verifies the CORS preflight header. However, there is no `POST /api/v1/orders` endpoint in `apps/api/app/main.py`. Any request—whether repeated with the same payload or sent with a different payload—receives an HTTP 404 (Not Found). There is no database table, cache, or handler verifying payload digests or replaying previous responses.

### Q3: Is there a test that creates orders concurrently? Does it assert unique sequential references?
* **Answer:** **No, absolutely not.**
* **Evidence:**
  * The backend test directory `apps/api/tests` contains only `test_catalog.py` and `test_health.py`.
  * Neither test file creates orders, executes multi-threaded/concurrent requests, or makes assertions against sequential references.
  * No test in the entire repository creates an order on the backend.

### Q4: Is there an optimistic-lock version on orders, and is it enforced?
* **Answer:** **No.**
* **Evidence:**
  * The `orders` table does not exist in `apps/api/app/models.py`.
  * No model contains a `version` column.
  * No admin order mutation or transition endpoint exists to enforce version checks or reject stale updates with HTTP 409.

### Q5: Are the "Your details" and delivery-address fields present in the UI and the API?
* **Answer:** **Present in the UI; completely missing from the API.**
* **Evidence:**
  * **UI ("Your details"):** Implemented in `apps/web/components/order/order-flow.tsx:465-486` with inputs for Full name (`customer_name`), WhatsApp/phone number (`phone`), and optional Email (`email`). Validated via `apps/web/lib/order-form.ts:83-98` and tested in `apps/web/components/order/order-flow.test.tsx:183-202`.
  * **UI (Delivery address):** Implemented in `apps/web/components/order/order-flow.tsx:342-355` (conditionally rendered when `fulfilment === 'delivery'`), including `delivery_address` (required, $\ge 8$ chars) and `delivery_landmark` (optional), with the fee notice "Additional fee may apply". Validated in `apps/web/lib/order-form.ts:13-16, 121-128` and tested in `apps/web/components/order/order-flow.test.tsx:119-137`.
  * **API:** Completely missing. No endpoint or schema accepts customer details or delivery addresses because order and customer models do not exist (`apps/api/app/models.py:1-164`, `apps/api/app/schemas.py:1-80`).

### Q6: Is the order status machine implemented, and are illegal transitions rejected?
* **Answer:** **No.**
* **Evidence:**
  * No order status enum, state machine logic, transition mapping, or transition endpoint (`POST /admin/orders/{id}/transition`) exists anywhere in `apps/api`.
  * The only enum in `apps/api/app/models.py:81-86` is `AvailabilityStatus` (`limited`, `available`, `main_stock`, `sold_out`, `unavailable`), which governs catalog stock status rather than order lifecycle.

### Q7: Do the Alembic migrations apply cleanly on a fresh database, upgrade and downgrade?
* **Answer:** **Yes, migrations apply and revert cleanly, but only for the initial catalog baseline.**
* **Evidence:**
  * Offline verification: `node scripts/python-tool.mjs migrate upgrade head --sql` and `node scripts/python-tool.mjs migrate downgrade 20240929_init:base --sql` executed cleanly without errors, emitting valid PostgreSQL DDL.
  * Engine execution: Running both `alembic upgrade head` and `alembic downgrade base` against a fresh test database succeeded with exit code 0.
  * Limitation: Only one migration exists (`apps/api/migrations/versions/20240929_init.py`). It creates 6 tables (`fish_types`, `size_classes`, `harvest_windows`, `availability`, `site_settings`, `contact_messages`). It contains zero tables for orders, customers, quotes, payments, events, admin users, or outbox.

---

## 5. Additions Built That the Spec Did Not Request

1. **`scripts/python-tool.mjs`:** A custom Node.js runner script created to locate `.venv/bin/python` across Windows and Linux platforms and execute Python modules (`ruff`, `mypy`, `pytest`, `alembic`, `seed`) via `npm` workspace scripts. Not in SPEC §2, but functional.
2. **`apps/web/app/contact/actions.ts`:** A Next.js Server Action (`submitContactForm`) using React 19 `useActionState` to proxy contact submissions to the API.
3. **`apps/web/app/not-found.tsx`:** Custom 404 page created ahead of Milestone 7 hardening.
4. **`.clinerules`:** A 1-line agent instruction file in the repository root.

---

## 6. Deviations from Designs in `docs/design/` (Code-Verifiable Only)

1. **Route Hierarchy vs. Single-Page Flow (Addendum 001 §A1):**
   * *Design / Addendum:* Specifies `/order` (form) $\to$ `/checkout` (Review & Confirm with heading "Checkout") $\to$ `/order/sent/[reference]` (Confirmation).
   * *Code:* `/checkout` and `/order/sent/[reference]` routes do not exist. All three steps are rendered within `/order` by toggling internal state (`view === 'order' | 'review' | 'sent'`) in `apps/web/components/order/order-flow.tsx:578, 764-798`.
2. **Missing Customer Details and Delivery Address in Original Images (SPEC §3.3):**
   * *Design:* `docs/design/order_desktop.png.png` and `docs/design/mobile_flow.png.png` omit customer identity and delivery address fields.
   * *Code:* Complies with SPEC §3.3 by adding the "Your details" section (`order-flow.tsx:465-486`) and delivery address inputs (`order-flow.tsx:342-355`).
3. **Header Search Icon (SPEC §5.1 / §16):**
   * *Design:* Displays a search icon in the desktop header nav.
   * *Code:* Search icon is omitted in `apps/web/components/layout/site-header.tsx:24-68`, adhering to the SPEC §16 assumption that search is hidden in v1.
4. **Header "Call Us" Button on Mobile:**
   * *Design:* Shows both WhatsApp and Call Us buttons.
   * *Code:* `apps/web/components/layout/site-header.tsx:62` hides the "Call Us" button on smaller viewports (`hidden sm:inline-flex`).
5. **Mobile Step Progress Indicator on Review/Sent:**
   * *Design:* Shows 6 dots for questions 1–6, followed by distinct review and confirmation screen headers.
   * *Code:* `apps/web/components/order/order-flow.tsx:768` sets `activeStep = 6` when on Review or Sent, causing all 6 dots to render as filled rather than hiding or transforming the progress indicator.
6. **Date Picker & Time Slot Components:**
   * *Design:* Custom styled popover calendar and dropdown selector.
   * *Code:* Rendered using native HTML inputs: `<input type="date">` (`order-flow.tsx:294-304`) and `<select>` (`order-flow.tsx:312-323`).
7. **Sent Screen Animation:**
   * *Design / SPEC §5.3:* Requires a success check animation respecting `prefers-reduced-motion`.
   * *Code:* `apps/web/components/order/order-flow.tsx:516` renders a static Lucide `<Check />` icon without CSS animation or motion variants.
8. **Photography vs. Vector Placeholders:**
   * *Design:* Real photographs of catfish ponds, netted fish, and farmers.
   * *Code:* `public/images/` contains vector SVGs (`catfish-placeholder.svg`, `farm-pond-placeholder.svg`, `farmer-catfish-placeholder.svg`).
9. **My Orders Screen:**
   * *Design:* Complete tracking dashboard with order cards, status badges, contextual explanations, and event history.
   * *Code:* `apps/web/app/my-orders/page.tsx:20-28` is a static placeholder with inactive tabs and a hardcoded empty state notice.

---

## 7. Plainly Listed Risks and Unknowns

1. **Broken End-to-End Order Creation:** Although the UI order form is polished and interactive, submitting an order sends a `POST` request to `/api/v1/orders` (`order-flow.tsx:717`), which does not exist in the backend. Submissions fail with HTTP 404 in production and development.
2. **Missing Backend Core Architecture:** The entire transactional core—orders, customer identity, reference generation, status transitions, quote calculation, and payment records—has not been created in `apps/api`.
3. **Database Environment Dependency:** Docker is not installed on the host environment, preventing local PostgreSQL startup via `make up` or `docker compose`. Development and testing currently rely on in-memory SQLite, which cannot validate PostgreSQL-specific behavior such as `SELECT ... FOR UPDATE`, transaction isolation, or connection pooling behind a pooler.
4. **Python 3.14 Deprecation Warnings:** The test suite produces 6 deprecation warnings regarding coroutine inspection and event loop policies slated for removal in Python 3.16.
5. **Fictional Architecture Documentation:** `docs/ARCHITECTURE.md` asserts that atomic reference generation, idempotency handling, and optimistic locking are implemented, creating a false impression of completed milestones.
6. **Missing Reverse Proxy Configuration:** Next.js rewrites for `/api/v1/*` (specified in Addendum 001 §A4 to facilitate same-origin session cookies) are not configured in `apps/web/next.config.mjs`.
7. **Addendum 001 Requirements Unstarted:** Outbox email processing, Brevo/Mailgun providers, Google OAuth authentication, and the dedicated `/checkout` route have not yet been built.
