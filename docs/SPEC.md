# Adesoba Catfish Farm — Order Site: Build Specification



## 0. How you (Copilot) must work

1. **Read the whole spec before writing code.** Then work milestone by milestone (Section 15). Finish and verify one milestone before starting the next. After each milestone: run lint, type-check and tests, and summarise what changed in 5 lines or fewer.
2. **Follow the designs to the letter.** Layout, copy, spacing rhythm, component shapes, badge colours and iconography must match the images. Where this spec explicitly lists a deviation (Section 3), follow the spec. Never invent visual changes.
3. **Don't guess silently.** If something is ambiguous, pick the default stated in Section 16 ("Assumptions"), record it in `docs/DECISIONS.md` as a short ADR, and continue.
4. **Production standards, not demo standards.** Typed, validated, tested, migrated, logged, accessible, secure. No `any`, no untyped dicts crossing boundaries, no hard-coded secrets, no TODO-driven stubs presented as finished.
5. **Explain the tricky parts.** For concurrency-sensitive code (order reference generation, idempotent order creation, status transitions, availability checks) add a short comment block explaining the race that could occur and how the code prevents it. Put a summary in `docs/ARCHITECTURE.md`. The owner must be able to explain every line of this code.
6. **Small, reviewable commits.** Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
7. **Do not add dependencies casually.** Prefer the stack in Section 2. Every extra dependency needs a one-line justification in `docs/DECISIONS.md`.

---

## 1. Product summary

**Business:** Adesoba Catfish Farm ("Healthy Fish. Better Business.") — a family catfish farm in Nigeria selling live/fresh catfish (Clarias and Hybrid) to households, resellers, businesses and smoking/BBQ buyers. Harvests happen in windows (roughly every 6 months; current example window: 3–12 October).

**What the site is:** a *request-a-quote ordering site*, not a cart-and-pay shop. Customers describe what they need (fish type, size, quantity, date/time, pickup or delivery, notes). The farm checks stock, confirms the price and details over WhatsApp/phone, and the customer pays as agreed (deposit or full) and collects or receives delivery. **No online price display and no online payment in v1**, prices depend on size, quantity and market conditions.

**Goals:**
- Customer can submit a complete order request in under 90 seconds on a phone.
- The family can run the whole operation from a simple admin dashboard: set harvest window, set availability per size, receive and process requests, send quotes, record payments.
- Reliable, fast on mid-range Android phones over slow 4G, discoverable on Google.
- Extendable later (online payments, WhatsApp automation, more products such as fingerlings/feed, multiple farms/staff) without rewrites.

**Non-goals for v1:** online card/transfer payments, customer accounts with passwords, multi-language, inventory accounting, courier integrations.

---

## 2. Tech stack and repo layout

Monorepo:

```
adesoba/
├─ apps/
│  ├─ web/            # Next.js (App Router) + TypeScript — public site + /admin
│  └─ api/            # FastAPI + SQLModel + Alembic
├─ docs/              # SPEC.md, ARCHITECTURE.md, DECISIONS.md, RUNBOOK.md, design/
├─ .github/           # workflows, copilot-instructions.md, PR template
├─ docker-compose.yml # postgres + api + web for local dev
├─ Makefile           # make dev | test | lint | migrate | seed
└─ README.md
```

**Frontend (`apps/web`)**
- Next.js (latest stable, App Router), React, TypeScript strict.
- Tailwind CSS with design tokens defined once (Section 4). `shadcn/ui` primitives (Radix) allowed for accessible dialogs, selects, popovers, calendar; restyle to match the designs.
- Forms: `react-hook-form` + `zod` (schemas mirror API validation). Server state: TanStack Query. Multi-step order state: a small store (Zustand) persisted to `sessionStorage` so refresh doesn't lose progress.
- Public pages use server rendering/ISR for SEO and speed. Admin is client-heavy behind auth.
- Icons: `lucide-react` (match the outline style in the designs). Fonts: `next/font` (see Section 4).

**Backend (`apps/api`)**
- Python 3.12, FastAPI, SQLModel/SQLAlchemy 2.x, Alembic migrations, Pydantic v2, `pydantic-settings`.
- PostgreSQL 16 (plain Postgres, no vendor-specific features; Supabase-hosted Postgres is fine in production; do NOT use Supabase Auth/SDK).
- Password hashing: `argon2-cffi`. Phone parsing: `phonenumbers`. Rate limiting: `slowapi` (or equivalent) backed by memory in dev / Redis-compatible later. Email: SMTP or Resend behind an interface (`Notifier`).
- Tooling: `ruff`, `mypy --strict`, `pytest`, `pytest-asyncio`, `httpx`, `factory-boy` or fixtures, `testcontainers` or a dedicated test DB.

**Cross-cutting**
- Docker for api and local Postgres. `.env.example` for every app. All config via env.
- GitHub Actions CI: lint, type-check, unit + integration tests, Playwright e2e on the critical order flow, build. Required to pass before merge.
- Sentry (free tier) for error tracking on both apps. Structured JSON logs with request IDs.
- Playwright for e2e; Vitest + Testing Library for components.

**Deployment target (documented in RUNBOOK.md):** web on Vercel (or any Node host), API as a Docker container on any container host (Render/Fly/Railway/VPS), Postgres managed with automated daily backups + a weekly `pg_dump` to object storage. Nothing may depend on one vendor's proprietary API.

---

## 3. Designs: inventory, and required deviations

### 3.1 Screens supplied
1. **Home (desktop)** — sticky header (logo, nav: Home, Order Fish, Our Fish, About Us, Contact, search icon, green WhatsApp button, outlined Call Us button); hero with dark green overlay on catfish-in-net photo, eyebrow "FRESH • QUALITY • RELIABLE", H1 "Fresh Catfish Directly From Our Farm", supporting paragraph, three trust icons (Healthy & well-raised fish / Clarias & Hybrid varieties / Pickup or delivery available); floating white card "Tell us what you need" with three option rows (I know what I want; I want to buy in bulk; I'm looking for smoking/BBQ size) each with icon + chevron; **Current Availability** section (harvest cadence text, "Next harvest window" box with dates, four size cards with status pills and Request buttons, "Most Popular" ribbon on 2–3kg); **How It Works** 5 steps; **Why Choose Us** dark green panel + photo + "Prefer to talk?" WhatsApp strip; footer.
2. **Order page (desktop)** — page hero "Order Your Catfish"; 3-step stepper (Your Order / Review & Confirm / Get Quote); the six numbered questions in one long form; right sidebar with Current Availability, Why Order With Us, and "Quality Catfish. Real Business." WhatsApp card; "Back to Home" and "Check Availability →" actions.
3. **Mobile flow (10 screens)** — mobile home; steps 1–6 as one question per screen with a 6-dot progress indicator; Review & Confirm; Order Request Sent; My Orders tracking.

### 3.2 Pages with NO design (build using the same components/tokens; keep them simple)
- **Our Fish** — fish types (Clarias, Hybrid) and size classes as cards, with short descriptions, live availability pills, and a Request button per size that deep-links into the order flow with the size preselected.
- **About Us** — farm story, how fish are raised, harvest cadence, location/pickup info. Content lives in code/MDX so the family can edit copy easily. Use placeholder copy clearly marked `[EDIT ME]`.
- **Contact** — phone, WhatsApp, address, map link (no embedded third-party map script; use a link or static image), opening hours, and a simple contact form (name, phone, message) → `contact_messages`.
- **Privacy Policy** and **Terms** (basic, editable), **404**, **500**, **Order not found**, **Site maintenance** page.
- **Admin** (Section 9) — functional, clean, mobile-usable. Reuse tokens; no special design needed.

### 3.3 Deviations required to make the designs work (only these; keep styling identical to existing form components)
1. **Missing customer contact details.** The designs never ask who the customer is. Add a **"Your details"** block to the Review & Confirm step (desktop step 2, mobile screen 8): *Full name* (required), *WhatsApp / phone number* (required, Nigerian default `+234`), *Email* (optional). Style with the existing input components.
2. **Missing delivery address.** If Delivery is selected in step 5, reveal on the same step: *Delivery address / area* (required), *Landmark or extra directions* (optional). Show the note "Additional fee may apply" (already in design).
3. **Copy typos in the design must not be copied.** Mobile screen 9 caption reads "Oorfirmckion" → use **"Confirmation"**. Footer shows "© 2025" → render the current year dynamically. Example dates ("Sat, 4 Oct 2025", "Oct 3 – Oct 12") are placeholder data → always driven by API data.
4. **Desktop vs mobile step model.** Desktop is one long form with a 3-step stepper (Your Order → Review & Confirm → Get Quote). Mobile is a 6-question wizard, then Review, then Sent. Implement **one shared form state and validation schema** with two presentations. "Get Quote" (desktop step 3) is the confirmation/"Order Request Sent" state.
5. **Default selections in the designs** (Hybrid, 2–3kg, 200kg, pickup, date pre-filled) are illustrative. In production, nothing is preselected except: pickup selected by default, and the preferred date defaults to the earliest valid date. If the user arrived via a size card's Request button, preselect that size only.
6. **Delivery-specific optional fee note** and **min-order** validations are described in Section 6.

---

## 4. Design system (extract from the images, verify by sampling pixels)

Approximate tokens, **verify against the images and adjust**, then define once in Tailwind config / CSS variables. Never hard-code hex values in components.

| Token | Approx. value | Used for |
|---|---|---|
| `--brand-900` | ~#0B3D2A | Footer, "Why Choose Us" panel, dark pills ("Main stock") |
| `--brand-700` | ~#0F5F3E | Primary buttons, headings accent, step active circle, selected radio |
| `--brand-100` | ~#E8F3EC | Section backgrounds (How It Works, sidebar), selected-card tint |
| `--accent-400` | ~#F6B93B | Amber CTA ("About Our Farm"), "Limited" pills |
| `--status-available` | ~#8CC63F | "Available" pill |
| `--whatsapp` | ~#1E8E4E | WhatsApp header button; lime variant (~#C5F03A) on the dark "Talk to Us on WhatsApp" card |
| `--surface` / `--border` / `--text` | white / light grey / near-black green-grey | Cards, dividers, body text |

- **Typography:** the designs use a bold geometric/humanist sans for headings and a clean sans for body. Pick the closest free Google font (e.g. *Plus Jakarta Sans* or *Poppins* for headings, *Inter* for body), load via `next/font`, and record the choice in DECISIONS.md.
- **Shape:** cards radius ~12–16px, buttons/pills fully rounded, soft low-elevation shadows, 1px light borders. Selected cards get a 2px `--brand-700` border + `--brand-100` tint + filled radio.
- **Status pills** (reusable `<StatusPill status>`): `limited` amber, `available` light green, `main_stock` dark green with white text, `sold_out` grey, `unavailable` grey outline.
- **Images:** the designs use photography (fish in net, farmer holding catfish, ponds) and per-size fish cut-outs. Use placeholders at the exact aspect ratios in `public/images/` with clear filenames; the family will drop in real photos. Use `next/image`, WebP/AVIF, `sizes`, lazy loading, and explicit dimensions (no layout shift).
- **Breakpoints:** mobile-first. Mobile layout matches the mobile screens; ≥1024px matches desktop designs. Tablet (768–1023) = mobile layout with wider containers, 2-column size grids.
- **Components to build once and reuse:** `Button` (primary/secondary/whatsapp/amber), `StatusPill`, `SelectableCard` (radio card with image), `ChipGroup` (quantity chips), `Stepper` (3-step desktop), `DotProgress` (6-step mobile), `SizeCard`, `AvailabilityPanel`, `HowItWorks`, `WhyChooseUs`, `WhatsAppCard`, `SiteHeader`, `MobileBottomNav` (Home / Order Fish / [My Orders or Our Fish] / Contact), `SiteFooter`, `FormField`, `EmptyState`, `ErrorState`, `Skeleton`.
- **Mobile bottom nav** in the designs shows Home, Order Fish, Our Fish, Contact on the home screen and Home, Order Fish, My Orders, Contact on the tracking screen. Implement: Home, Order Fish, **My Orders**, Contact; "Our Fish" remains reachable from the hamburger menu and home page.

---

## 5. Public site: behaviour

### 5.1 Home
- "Tell us what you need" card rows set an **intent** and go to the order flow:
  - *I know what I want* → `/order` (no preset)
  - *I want to buy in bulk* → `/order?intent=bulk` (preselect quantity chip `500kg`, and show a small hint "For 1 tonne+ choose 1 tonne+")
  - *I'm looking for smoking/BBQ size* → `/order?intent=smoking` (preselect the size class flagged as smoking/BBQ, i.e. 1–1.5kg)
- Store `intent` on the order (`source_intent`) for analytics.
- **Current Availability** and the harvest window box render from API data (ISR revalidate ≤ 60s + on-demand revalidation when admin changes availability). If no harvest window is set, show "Next harvest date to be announced. Send us a request and we'll notify you." and keep ordering enabled.
- Size card **Request** button → `/order?size=<slug>`.
- "Most Popular" ribbon driven by a `is_featured` flag on the size class.
- Header WhatsApp button → `https://wa.me/<number>?text=<prefilled>`; Call Us → `tel:`. Both numbers come from `site_settings`.
- Search icon in the header: **v1 = hide it**, or make it open a simple client-side jump to Order Fish / Our Fish / Contact. Do not build a search engine.

### 5.2 Order flow (desktop: single page; mobile: wizard)
Questions, in order (copy exactly as in designs):
1. **What kind of fish do you want?** — Clarias / Hybrid / Either–No preference. (Helper copy: "Common and widely available." / "Fast growing, good for bulk orders." / "We'll give you what's available.")
2. **What size do you need?** — four size classes with descriptor, image, live status pill. Sold-out sizes are shown disabled with "Currently unavailable — ask us".
3. **How much do you need?** — chips `40kg 100kg 200kg 500kg 1 tonne+` plus custom amount (kg). Selecting a chip clears the custom field and vice versa. `1 tonne+` sets the custom field to 1000 (editable, min 1000).
4. **When do you need it?** — preferred date (calendar popover) and preferred time slot (select).
5. **Pickup or delivery?** — radio cards. Delivery reveals address fields (Section 3.3).
6. **Any special instructions?** — textarea, 500 char max with live counter "0/500".

Then **Review & Confirm**: read-only summary table (Fish type, Size range, Quantity, Preferred date, Time, Pickup or delivery, Notes), the new "Your details" block, an explanatory banner ("We'll check the farm, confirm the available size/quantity and give you the current price. **You haven't been charged.**"), and **Submit Order Request**.

Behaviour rules:
- Desktop "Check Availability →" validates the form and moves to Review & Confirm. Mobile "Next →" validates the current step only. Back is always available and preserves state.
- Progress persists in `sessionStorage`; cleared after successful submit.
- Inline, human error messages; focus moves to the first invalid field; errors announced to screen readers.
- Submit button disables while pending, shows a spinner, and the request carries an **Idempotency-Key** (UUID generated when the review step opens) so double-taps/retries never create duplicate orders.
- On network failure show a retry state that preserves everything and offers the WhatsApp fallback link with a prefilled message summarising the order.

### 5.3 Confirmation ("Order Request Sent!")
Success check animation (respect `prefers-reduced-motion`), message ("Your request has been sent to the farm. We'll check availability and get back to you with the current price and final details."), **Order Reference** card (e.g. `#AF-2025-0473`, "Keep this number for reference."), buttons: **Back to Home**, **Chat on WhatsApp** (prefilled: "Hi, I just sent order request #AF-2025-0473 …"), and **Need urgent help? Call the farm** row with tap-to-call.

### 5.4 My Orders (tracking)
- Two tabs: **Active** and **Completed**. Order card: reference, status badge (Pending, Quoted, Confirmed, Ready, Completed…), fish type • size • quantity, date/time, pickup/delivery, a contextual info banner per status (e.g. Pending: "We're checking availability and will get back to you shortly with the price and final details."), **View Details** (full summary, quote breakdown when available, payment status, event timeline).
- **No customer passwords in v1.** Access model:
  - When an order is created the API returns a random `access_token` (returned once; only its hash is stored). The browser stores `{reference, access_token}` pairs in `localStorage`; My Orders lists those and fetches each with the token.
  - Anyone can also look an order up via **Track an order** (reference + phone number that matches the order). Generic error on mismatch; rate limited.
  - Design the endpoint layer so phone-OTP login can replace this later (v2) without changing the order model.

---

## 6. Business rules and validation (enforce server-side; mirror in zod)

- **fish_type:** `clarias | hybrid | any`.
- **size:** must reference an *active* size class. If its availability status is `sold_out`/`unavailable` reject with a clear message (a request is still allowed via "ask us" WhatsApp, not via the form).
- **quantity_kg:** integer, min `settings.min_order_kg` (default **40**), max `settings.max_order_kg` (default 20000). Anything ≥ 1000 flagged `is_bulk` (drives a highlight in admin).
- **preferred_date:** must be ≥ today + `settings.min_lead_days` (default 1) and ≤ today + 90 days, in `Africa/Lagos` time. Show a soft hint (not an error) when the date is outside the current harvest window: "Our next harvest is {start}–{end}. We'll confirm the best date with you."
- **time slot:** one of `settings.time_slots` (default: 8–10 AM, 10 AM–12 PM, 12–2 PM, 2–4 PM, 4–6 PM). Stored as slot key + label snapshot.
- **fulfilment:** `pickup | delivery`. Delivery ⇒ address required (min 8 chars).
- **notes:** ≤ 500 chars, plain text, trimmed, control characters stripped, rendered escaped everywhere.
- **customer:** name 2–80 chars; phone normalised to E.164 (default region NG; accept `0801…`, `+234…`, `234…`); email optional, validated.
- **Consent:** below submit button: "By submitting you agree we may contact you about this request via WhatsApp, phone or email." Link to Privacy Policy.
- **Order reference:** `AF-<YYYY>-<NNNN>`, per-year sequence starting at 0001, unique, human-friendly, generated **atomically in the database** (a `reference_counters` row locked `FOR UPDATE`, or a Postgres sequence per year) — never by `count()+1` or `max()+1`.
- **Rate limits:** order creation 5/hour per IP and 3/hour per phone; lookups 10/10 min per IP; login 5/15 min per IP+email; contact form 3/hour per IP.
- **Spam protection:** honeypot field + Cloudflare Turnstile (invisible) on order creation and contact form; server verifies the token; feature-flagged off in dev.

### Order status machine (server-enforced; illegal transitions return 409)
```
pending ──► quoted ──► confirmed ──► ready ──► completed
   │           │           │           │
   ├──► declined (farm can't fulfil)   └──► cancelled
   ├──► cancelled (customer/farm) — from pending, quoted, confirmed, ready
   └──► expired (quote valid_until passed without confirmation; automatic job)
```
- Customer-facing labels: Pending, Quoted, Confirmed, Ready for pickup/delivery, Completed, Cancelled, Declined, Expired.
- Every transition writes an `order_events` row (actor, from, to, note, timestamp).
- Use an optimistic-lock `version` column on `orders`; `PATCH`/transition requests carry the expected version; mismatch ⇒ 409 so two admins can't overwrite each other.
- Payment state is **derived** (`unpaid | partial | paid`) from `payments` vs the accepted quote total, not a stored status.

---

## 7. Data model (PostgreSQL; all tables have `id` (UUID or bigserial, pick one and be consistent), `created_at`, `updated_at`)

- **fish_types**: slug (`clarias`,`hybrid`), name, description, image_path, is_active, sort_order.
- **size_classes**: slug (`1-1-5kg`…), label ("1 – 1.5kg"), descriptor ("Smoking / BBQ size"), min_kg, max_kg (null for 3kg+), image_path, is_featured ("Most Popular"), is_smoking_size, is_active, sort_order.
- **harvest_windows**: starts_on, ends_on, notes, is_published. "Current/next window" = earliest published window whose `ends_on >= today`.
- **availability**: harvest_window_id, size_class_id, `status` enum (`limited | available | main_stock | sold_out | unavailable`), internal_estimate_kg (admin-only, never exposed publicly), unique(harvest_window_id, size_class_id). *(Add nullable `fish_type_id` for future per-type availability; not used in v1.)*
- **customers**: name, phone_e164 (unique), email, notes (admin-only), first_order_at. Upsert by phone on order creation.
- **orders**: reference (unique), customer_id, status, version, fish_type, size_class_id, size_label_snapshot, quantity_kg, is_bulk, preferred_date, time_slot_key, time_slot_label, fulfilment, delivery_address, delivery_landmark, notes, source_intent, idempotency_key (unique), access_token_hash, harvest_window_id (nullable), internal_notes, assigned_to (admin_user_id nullable), submitted_at, closed_at.
- **quotes**: order_id, version_no, unit_price_kobo (per kg), quantity_kg, delivery_fee_kobo, discount_kobo, total_kobo, deposit_kobo, valid_until, message_to_customer, created_by, is_accepted, accepted_at. Only one active quote per order; new quote supersedes old (keep history).
- **payments**: order_id, amount_kobo, method (`cash|transfer|pos|other`), reference, received_at, recorded_by, note. Immutable; corrections are new negative/reversal entries with a note.
- **order_events**: order_id, type, from_status, to_status, actor_type (`customer|admin|system`), actor_id, note, created_at.
- **contact_messages**: name, phone, message, status (`new|handled`), handled_by.
- **admin_users**: email (unique), name, password_hash (argon2id), role (`owner|staff`), is_active, last_login_at, failed_attempts, locked_until.
- **site_settings**: key (unique) / value (JSON). Keys: `whatsapp_number`, `phone_number`, `farm_address`, `farm_maps_url`, `business_hours`, `min_order_kg`, `max_order_kg`, `min_lead_days`, `time_slots`, `delivery_notice`, `announcement_banner`.
- **reference_counters**: year, last_value.
- **audit_log**: actor, action, entity, entity_id, before/after JSON, ip, created_at (admin mutations).

Rules: **money is integer kobo**, quantities integer kg, timestamps `timestamptz` in UTC (display in `Africa/Lagos`). Foreign keys with explicit `ON DELETE` behaviour; soft-delete via `is_active` rather than deleting anything referenced by orders. Indexes on `orders(status, submitted_at)`, `orders(customer_id)`, `orders(reference)`, `customers(phone_e164)`. Every schema change ships as an Alembic migration; migrations must be reversible and run in CI against a fresh DB.

Seed script (`make seed`): two fish types, four size classes exactly as in designs (1–1.5kg Smoking/BBQ, 1.5–2kg Medium, 2–3kg Table/wholesale [featured, main_stock], 3kg+ Large), one published harvest window, default settings, one dev admin (dev only).

---

## 8. API (REST, `/api/v1`, JSON, OpenAPI auto-docs enabled in non-prod)

Conventions: Pydantic request/response models for everything; consistent error envelope `{ "error": { "code", "message", "fields"?: {..}, "request_id" } }`; pagination `?page&page_size` with `total`; ISO-8601 dates; no leaking internal IDs or admin-only fields.

**Public**
- `GET /health` (liveness), `GET /ready` (DB reachable).
- `GET /catalog` → fish types, active size classes with current availability status, current/next harvest window, public settings (contact numbers, min order, time slots, lead days).
- `POST /orders` (header `Idempotency-Key` required) → `201 { reference, access_token, status, submitted_at }`. Same key + same payload ⇒ same response; same key + different payload ⇒ 422.
- `GET /orders/{reference}` with header `X-Order-Token` → public order view (no internal notes).
- `POST /orders/lookup` `{ reference, phone }` → order view + a fresh access token.
- `POST /orders/{reference}/cancel` (token) — allowed only from `pending`/`quoted`.
- `POST /contact` → creates a `contact_messages` row.

**Admin** (cookie session, CSRF-protected, role-checked)
- `POST /admin/auth/login|logout`, `GET /admin/auth/me`, `POST /admin/auth/change-password`.
- `GET /admin/dashboard` → counts by status, today's pickups/deliveries, upcoming bulk orders, unhandled messages.
- `GET /admin/orders` (filter: status, date range, fulfilment, size, bulk, search by reference/name/phone; sort), `GET /admin/orders/{id}`, `PATCH /admin/orders/{id}` (internal notes, assignment; version required), `POST /admin/orders/{id}/transition`, `POST /admin/orders/{id}/quote`, `POST /admin/orders/{id}/payments`.
- `GET|POST|PATCH /admin/harvest-windows`, `GET|PUT /admin/availability` (bulk update all sizes for a window in one call), `GET|POST|PATCH /admin/size-classes`, `/admin/fish-types`.
- `GET|PATCH /admin/settings`, `GET /admin/customers`, `GET /admin/customers/{id}` (with order history), `GET|PATCH /admin/messages`.
- `GET /admin/orders/export.csv` (filtered).
- Owner-only: `GET|POST|PATCH /admin/users`.

Any admin change to availability/harvest window/settings must trigger on-demand revalidation of the public pages (secured webhook from API to Next.js `/api/revalidate` with a shared secret).

---

## 9. Admin dashboard (`/admin`)

Simple, fast, mobile-usable. Screens:
1. **Login** (email + password, generic errors, lockout after repeated failures).
2. **Dashboard** — cards: New requests (pending), Awaiting customer (quoted), Today's pickups/deliveries, This week's confirmed volume (kg), Unhandled messages.
3. **Orders list** — table on desktop, cards on mobile; filters and search; bulk badge; quick actions.
4. **Order detail** — customer info with one-tap WhatsApp/call buttons (prefilled message templates per status), order summary, quote builder (price per kg, delivery fee, discount, deposit, validity → live total, all in ₦ with kobo storage), status transition buttons (only valid ones shown), payments ledger (record payment; shows paid/balance), internal notes, event timeline.
5. **Availability & harvest** — set the harvest window dates; a grid of the four sizes with status dropdowns; "Publish" toggle; preview of how the public site will look.
6. **Fish & sizes** — edit descriptions, images, order, featured flag, active flag.
7. **Customers** — list + history, repeat-customer indicator.
8. **Messages** — contact form inbox.
9. **Settings** — contact numbers, address, min/max order, lead days, time slots, banner.
10. **Users** (owner only).

Admin security: session cookie `HttpOnly; Secure; SameSite=Lax`, CSRF token on mutations, idle timeout 30 min / absolute 12 h, argon2id, password rules (min 12 chars), forced password change for seeded admin, all mutations written to `audit_log`.

---

## 10. Notifications

Behind a `Notifier` interface with pluggable channels so WhatsApp can be added later without touching business logic.
- **v1:** email to the farm on every new order (subject `New order request AF-…`, includes summary and a link to the admin page); email to customer if an email was provided (request received). Sending must be **async/background** and must never block or fail order creation (log and retry with backoff; failures visible in admin).
- **v1 WhatsApp:** deep links only (`wa.me` with prefilled text). Templates for admin quick-replies: request received, quote ready, ready for pickup, payment reminder.
- **v2 (design for it, don't build):** WhatsApp Business Cloud API, Paystack payments, SMS OTP for My Orders.
- Scheduled job (cron/APScheduler): mark `quoted` orders as `expired` when `valid_until` passes; daily digest email of tomorrow's pickups/deliveries.

---

## 11. Non-functional requirements

**Performance (budgets, verified with Lighthouse CI on mobile emulation, throttled 4G):** LCP < 2.5s, CLS < 0.1, INP < 200ms, initial JS on home < 150KB gzipped, hero image ≤ 150KB. API p95 < 300ms for catalog and order creation. Cache the catalog endpoint (short TTL) and ISR public pages.

**Accessibility (WCAG 2.1 AA):** semantic landmarks, visible focus rings, keyboard-operable radio cards/chips/calendar, labels + `aria-describedby` for errors, colour contrast ≥ 4.5:1 (check the amber/white and lime/dark combinations), status never conveyed by colour alone (pills carry text), respects reduced motion, touch targets ≥ 44px, correct `inputmode`/`autocomplete` (`tel`, `name`, `street-address`).

**SEO:** per-page titles/meta, Open Graph, `sitemap.xml`, `robots.txt`, canonical URLs, JSON-LD `LocalBusiness` (name, phone, address, hours) on home/contact, semantic headings (one H1 per page), descriptive alt text. Admin and tracking pages `noindex`.

**Security:** OWASP ASVS L1 as the baseline. Strict input validation, parameterised queries only, output escaping, security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors none), CORS restricted to the web origin, secrets only in env, dependency audit in CI (`pip-audit`, `npm audit`), no PII in logs (mask phone numbers), HTTPS only. Access tokens and admin passwords never logged.

**Privacy (Nigeria Data Protection Act 2023):** collect only name, phone, optional email, address when delivering; privacy policy page; consent line at submit; admin ability to export/delete a customer's data on request; retention policy documented in RUNBOOK.

**Reliability:** health/readiness probes, graceful shutdown, DB connection pooling, timeouts on all outbound calls, idempotent order creation, Sentry alerts, uptime monitor (free) on `/health`, daily DB backups with a tested restore procedure documented in RUNBOOK.md.

**Analytics (privacy-friendly, no cookies, e.g. Plausible/Umami, optional):** events `order_started`, `order_step_completed{step}`, `order_submitted`, `whatsapp_click{location}`, `call_click{location}`, `intent_selected{intent}`.

**Browser/device support:** last 2 versions of Chrome, Safari, Firefox, Edge; Android 8+ Chrome; iOS 15+ Safari.

---

## 12. Testing requirements

- **Backend:** unit tests for validators, status machine (every legal and illegal transition), quote maths (integer kobo, rounding rules), phone normalisation; integration tests against a real Postgres for order creation, idempotency replay, **concurrent order creation producing unique sequential references** (run N parallel requests), optimistic-lock conflict, rate limits, auth/lockout, CSRF, permission checks (staff vs owner). Target ≥ 85% coverage on `services/` and `domain/`.
- **Frontend:** component tests for `SelectableCard`, `ChipGroup`, step validation, quantity chip/custom interplay; schema tests.
- **E2E (Playwright, mobile + desktop viewports):** (1) home → intent card → full order → confirmation with reference; (2) validation errors and recovery; (3) double-click submit creates one order; (4) admin login → open order → send quote → confirm → record payment → complete; (5) change availability in admin → public page updates.
- **Visual check:** Playwright screenshots of home, order page, and each mobile step compared against a saved baseline (`docs/design/` images are the reference for manual comparison).
- CI must fail on lint, type, test, or Lighthouse-budget regressions.

---

## 13. Documentation deliverables

`README.md` (setup in ≤ 5 commands on Windows + WSL/Ubuntu), `docs/ARCHITECTURE.md` (diagram in Mermaid, data flow, concurrency notes), `docs/DECISIONS.md` (ADRs), `docs/RUNBOOK.md` (deploy, rollback, backup/restore, rotate secrets, add an admin, common incidents), `docs/API.md` or OpenAPI export, `.github/copilot-instructions.md` (short rules distilled from Section 0), `.env.example` files, `CONTRIBUTING.md`.

---

## 14. Definition of done (per feature)

Implements the spec and matches the design; server + client validation; tests written and passing; accessible via keyboard; no console errors; lint/type-check clean; migration included (if schema changed); docs updated; no secrets committed; works at 360px width and at 1440px.

---

## 15. Milestones (execute in order; stop and report after each)

1. **Foundation** — monorepo, tooling, Docker Compose, CI, env config, Postgres + Alembic baseline, health endpoints, design tokens, base components, layout (header, footer, mobile bottom nav).
2. **Catalog & public pages** — data model for fish/sizes/harvest/availability, seed, `GET /catalog`, Home page matching the design pixel-for-pixel, Our Fish, About, Contact (form), Privacy/Terms, SEO basics.
3. **Order flow (UI)** — shared form state/schemas, desktop order page, mobile wizard, Review & Confirm with the added details block, error/empty/loading states.
4. **Order API** — customers, orders, reference generation, idempotency, validation, rate limits, Turnstile, order events, access tokens; wire UI; confirmation screen; email notifications.
5. **Tracking** — My Orders (Active/Completed), Track an order, order detail view.
6. **Admin** — auth, dashboard, orders list/detail, status machine, quote builder, payments ledger, availability & harvest editor, settings, customers, messages, audit log, CSV export, revalidation webhook.
7. **Hardening** — full e2e suite, Lighthouse budgets, accessibility audit (axe), security headers, load test of `POST /orders`, Sentry, backups, RUNBOOK, production deploy config.
8. **Launch prep** — real content and photos, domain + HTTPS, uptime monitor, seed production admin, dry run with a real order end-to-end.

---

## 16. Assumptions (defaults to use unless the owner overrides; record in DECISIONS.md)

- Minimum order 40kg (chip row starts at 40kg). Maximum 20,000kg.
- Time slots: 8–10, 10–12, 12–2, 2–4, 4–6.
- Minimum lead time 1 day; farm operates Mon–Sat (Sunday selectable but flagged "subject to confirmation").
- Delivery area and fee are quoted per order by the farm; no automated delivery pricing.
- No online payments; payments recorded manually by staff.
- Currency ₦ (NGN), formatted `₦1,250,000`; kobo internally.
- Timezone `Africa/Lagos`; language `en-NG`.
- Phone/WhatsApp/address in the designs (`+234 801 234 5678`) are placeholders; real values are set in `site_settings` at launch.
- The header search icon is hidden in v1.
- The "harvest roughly every 6 months" line on the home page is content, editable in settings/CMS constants, not hard-coded logic.

---

## 17. Out of scope for now (but don't paint yourself into a corner)

Online payments (Paystack/Flutterwave), WhatsApp Business API automation, customer login/OTP, multiple farms or warehouses, other products (fingerlings, feed, smoked fish), reviews, loyalty/discounts, PWA/offline mode, multi-language. Keep the schema and service boundaries ready for them: `payments` and `quotes` are already separate tables, `Notifier` is an interface, `availability` has a nullable `fish_type_id`, and `site_settings` is key/value.