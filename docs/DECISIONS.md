# Decisions

## ADR 1: Typography choice

- Chosen: `Plus Jakarta Sans` for headings and `Inter` for body.
- Reason: close to the supplied design language and widely available via `next/font`.

## ADR 2: Default assumptions

- Minimum order: 40kg.
- Default lead time: 1 day.
- Delivery is manually quoted rather than automatically priced.
- Search icon remains hidden in v1 to match the design and scope.

## ADR 3: SQLModel compatibility

- Chosen: SQLModel `>=0.0.47,<0.1` instead of `0.0.24`.
- Reason: `0.0.24` fails runtime model construction with the current Pydantic 2.13 release; the current SQLModel release is compatible and passes schema creation checks.

## ADR 4: Outline icon library

- Chosen: `lucide-react` for site navigation, trust marks and action icons.
- Reason: it is the icon library specified for the outline style in the product design.

## ADR 5: Farm map link

- Chosen: leave `farm_maps_url` unset until the farm provides a verified pin.
- Reason: a generic region search could direct customers to the wrong pickup location.

## ADR 6: Transactional email provider**

- Chosen: `Brevo` for transactional email.

- Reason: it provides a free transactional email tier with up to 300 emails per day and no credit card required, making it suitable for development and early-stage use without requiring payment details upfront.

- Alternative considered: `Mailgun`. Its current Free plan also does not require a credit card and provides 100 emails per day, so the decision is based on the available free-tier capacity and project requirements rather than a card requirement.

## ADR 7: Deterministic access token re-derivation on idempotent replays

- Chosen: Derive initial `access_token` via HMAC-SHA256 from application `SECRET_KEY`, `order_reference`, and `idempotency_key`, storing only its SHA-256 hash in `orders.access_token_hash`.
- Reason: Satisfies both the security requirement that plaintext access tokens are never stored in the database, and the idempotency requirement that identical retries with the same `Idempotency-Key` return the identical 201 response payload including the customer's access token.

## ADR 8: Turnstile enforcement is opt-in and fails closed

- Chosen: Turnstile is verified only when `TURNSTILE_SECRET_KEY` is set (off in dev/tests); an unreachable siteverify endpoint returns `503` and token replays within five minutes are rejected.
- Reason: SPEC §6.12 requires server-side verification but also says the feature is flagged off in dev; failing closed stops a broken verifier from becoming a spam bypass, and the replay guard keeps one single-use token from creating several orders.

## ADR 11: Email provider and outbox policy

- Chosen: `EMAIL_PROVIDER` selects `console` (default), `brevo`, `mailgun` or `smtp`; SMTP uses the standard library (no extra dependency); order emails are written to `email_outbox` in the order transaction and sent by a background worker that claims rows with `FOR UPDATE SKIP LOCKED`, defers quota/5xx responses by an hour without burning an attempt, and marks a row `failed` only after five real attempts.
- Reason: Addendum §A3 requires switching provider by env only and never failing an order on an email error; the outbox gives atomic enqueue plus retry, and Brevo stays the default because its free tier needs no card (ADR 6).

## ADR 9: Customer phone rate limit is counted in the database, not in memory

- Chosen: The per-phone limit (3 orders/hour) counts `orders` rows submitted in the last hour; the per-IP limits stay in the in-process limiter.
- Reason: With more than one API worker the in-memory bucket would count per process and let a spammer multiply the limit; counting persisted rows is consistent across workers and restarts. A shared Redis limiter is a later upgrade if the API is scaled horizontally.

## ADR 10: `/checkout` is the canonical review route while `/order` keeps its inline review

- Chosen: `/checkout` renders Review & Confirm from the persisted `sessionStorage` draft and redirects to `/order` when the draft is empty; `/order` still contains the full form and its inline review, and now links to `/checkout`.
- Reason: Addendum §A1 requires the `/checkout` route without removing the already-shipped and tested single-page order flow; keeping both is additive and the persisted draft makes either entry point work after a refresh.

## ADR 12: Google sign-in without a crypto SDK

- Chosen: OIDC authorization code + PKCE (S256) implemented with the standard library and `httpx`; the ID token is validated by Google's `tokeninfo` endpoint server-to-server and then re-checked locally for `aud`, `iss`, `exp`, `nonce` and `email_verified`; state, PKCE verifier and nonce live in an HMAC-signed, 10-minute HttpOnly cookie and the session is a random id whose SHA-256 hash is stored.
- Reason: the target environment has no `authlib`/`google-auth`/`PyJWT` and no package index access, while verification must stay server-side. Google's tokeninfo check validates the signature for us and the local checks keep every rule the Addendum lists; adding `authlib` later only changes `auth_service.verify_id_token`, not the endpoints.

## ADR 13: Pooled runtime URL, direct migration URL

- Chosen: `DATABASE_URL` points at the transaction pooler (port 6543) for the API and the email worker, `DATABASE_URL_DIRECT` at the session/direct endpoint for Alembic; prepared statements are disabled automatically when the runtime URL is a pooler URL, pools are small (5 + 5), and the first connect retries with backoff.
- Reason: Addendum §A2 forbids Supabase/Neon SDKs and warns that PgBouncer's transaction mode breaks prepared statements and that free projects pause; the transaction-scoped `SELECT ... FOR UPDATE` reference counter is unaffected, and migrations must not run through the pooler.

## ADR 14: Admin money is integer kobo and payment state is derived

- Chosen: quotes and payments store integer kobo; `total_kobo` is stored on the quote rather than recomputed, and the paid/balance figures are the sum of the append-only `payments` ledger against the accepted quote. There is no `payment_status` column and no running total on the order.
- Reason: SPEC §9 asks for a live total and a paid/balance pair. Floats drift by a few kobo on bulk orders, which would make the customer's accepted quote disagree with the balance. Deriving the totals from immutable rows also removes a lost-update race when two cash payments are recorded at once (ADR 9 covers the same reasoning for rate-limit counters). Storing `total_kobo` on each quote version keeps a historical quote showing the terms the customer actually saw, even after prices change.
- Alternative considered: a `payment_status` enum on `orders`, updated on each payment. Rejected because two concurrent payments could leave it disagreeing with the ledger.

## ADR 15: Admin sessions are separate from customer sessions, with their own CSRF

- Chosen: `/admin` uses an `adesoba_admin_session` cookie scoped to `Path=/admin`, its own `admin_sessions` table and its own CSRF token namespace (`admin-csrf:<session>`), with a 30-minute idle timeout and 12-hour absolute lifetime (SPEC §9).
- Reason: SPEC §9 requires a separate admin security model, and sharing the customer cookie would let a customer session reach admin routes or vice versa. Scoping the cookie to `/admin` also means signing into the dashboard never disturbs a customer's `/my-orders` session in the same browser. Passwords use argon2id via `argon2-cffi` (already a dependency) rather than a bare SHA-256, because a fast hash is the wrong choice for a low-entropy secret even though it is fine for random session tokens.

## ADR 16: Revalidation webhook is best-effort and never fails an admin edit

- Chosen: after an availability, harvest-window or settings change the API POSTs to `${WEB_ORIGIN}/api/revalidate` with `REVALIDATE_SECRET`; a missing secret or a failed call is logged and swallowed, and the public pages keep their ≤60s timed revalidation as a backstop.
- Reason: SPEC §8 requires on-demand revalidation, but the admin edit is already committed by the time the webhook fires. Letting a webhook failure propagate would report a failed write for a write that succeeded. The timed revalidate window bounds how stale the public catalog can be.
