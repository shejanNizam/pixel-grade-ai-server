# PixelGrade AI — API Reference

Express 5 + TypeScript. Every route below is mounted under **`/api/v1`** unless
stated otherwise.

Interactive Swagger UI is served at **`/api/docs`** in non-production
environments and is generated from the JSDoc on each route file. This document
is the flat overview; Swagger is the per-field detail.

- No trailing slashes on any path.
- All request and response bodies are camelCase JSON.
- Auth is `Authorization: Bearer <accessToken>`.

---

## Conventions

### Success envelope

Every successful response goes through the same wrapper:

```json
{
  "statusCode": 200,
  "success": true,
  "message": "Collection retrieved successfully!",
  "data": {},
  "meta": { "page": 1, "limit": 10, "total": 42, "totalPage": 5 }
}
```

`meta` is present only on paginated list endpoints.

### Error envelope

```json
{
  "success": false,
  "message": "A scan costs 10 credits and your balance is 4.",
  "errorSources": [{ "path": "email", "message": "Invalid email address format." }],
  "stack": "…"
}
```

`errorSources` is populated for Zod and Mongoose validation failures and is
otherwise an empty array. `stack` appears in non-production only.

### Status codes

| Code | Meaning here |
|---|---|
| 400 | Malformed request, or a business rule rejected the input |
| 401 | Token missing a valid user, or credentials wrong |
| 402 | Credit balance too low to start a scan |
| 403 | No token, unverified email, blocked account, wrong role, or plan not entitled |
| 404 | Not found, or found but not owned by the caller |
| 409 | Duplicate key |
| 422 | The grading model declined the images |
| 429 | Rate limited |
| 502 | Upstream vendor returned something unusable |
| 503 | A required external service is not configured |

Note that **403, not 401, is returned when the `Authorization` header is
absent** — `checkAuth` throws before any token parsing happens.

### Roles

`user` · `admin` · `super_admin`. Where a table says **Admin**, it means
`admin` or `super_admin`.

### Rate limits

| Scope | Window | Limit |
|---|---|---|
| Global | 15 min | 200 requests |
| `/auth/*` (login, password, refresh) | 15 min | 20 requests |
| `/otp/send` | 1 hour | 5 requests |

The Stripe webhook is mounted **before** the global limiter so a burst of
legitimate events is never throttled into retries.

---

## Outside `/api/v1`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | — | DB + Redis probe. Returns **503** when a dependency is down, which is intentional — do not treat non-200 as an outage of this endpoint |
| GET | `/health/live` | — | Liveness only. No DB or Redis dependency |
| GET | `/api/docs` | — | Swagger UI, non-production only |
| POST | `/webhook/stripe` | Stripe signature | Raw body. Verified by HMAC, never by a bearer token |

---

## Auth — `/auth`

| Method | Path | Auth | Body / notes |
|---|---|---|---|
| POST | `/auth/login` | — | `{ email, password }`. Returns `accessToken`, `refreshToken`, user |
| POST | `/auth/refresh-token` | — | Reads `refreshToken` from the **cookie**, not the body. Returns a new `accessToken` |
| POST | `/auth/logout` | — | Clears auth cookies |
| POST | `/auth/change-password` | Any | `{ oldPassword, newPassword }` |
| POST | `/auth/set-password` | Any | `{ password }`. For Google accounts that have no password yet |
| POST | `/auth/forgot-password` | — | `{ email }`. Emails a reset link |
| POST | `/auth/reset-password` | Reset token | Guarded by `checkResetToken`, not `checkAuth` |
| GET | `/auth/google` | — | Starts OAuth. `?redirect=` sets the post-login landing path |
| GET | `/auth/google/callback` | — | OAuth return leg |

Tokens are named `accessToken` and `refreshToken`. There is no `uidb64`, no
`token/refresh/`, and no Django-style path anywhere in this API.

## OTP — `/otp`

| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/otp/send` | — | `{ email }` |
| POST | `/otp/verify` | — | `{ email, otp }` — exactly 6 digits |

Codes live in Redis with a 5–10 minute TTL, never in Mongo.

## Users — `/user`

| Method | Path | Auth | Body / notes |
|---|---|---|---|
| POST | `/user/register` | — | `{ name, email, password, phone? }`. Password needs 8+ chars, an uppercase, a digit, and a special character. Phone is E.164 |
| GET | `/user/me` | Any | The caller's own profile |
| DELETE | `/user/me` | Any | Soft delete. Uploaded images and grading reports are retained as training data |
| GET | `/user/all-users` | Admin | `?searchTerm=&page=&limit=&sort=` over name and email |
| GET | `/user/:id` | Admin | |
| PATCH | `/user/:id` | Any | Self-edit, or admin edit. `{ name?, phone?, role?, status?, blockReason?, isEmailVerified?, isDeleted? }`. Blocking is `status: "blocked"` plus `blockReason` |
| DELETE | `/user/:id` | Admin | Soft delete |

There is no country or state field on a user. The admin tables that show those
columns have no backing data yet.

## Uploads — `/upload`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/upload` | Any | `multipart/form-data`, field name **`files`**, up to 10 per request |

Returns `{ url, publicId }` for a single file, or an array of those for several.
Feed the returned URLs into `POST /analysis`.

---

## The scan flow

Four calls, in this order. Steps 2 and 3 cannot be skipped or reordered.

```
1.  POST /upload            → image URLs
2.  POST /analysis          → debits 10 credits, identifies the card
3.  PATCH /analysis/:id/confirm  → user picks the real card  ← HARD GATE
4.  POST /grading/:analysisId    → grades it
```

**Grading refuses to run until step 3 has set `confirmedCard`.** This is a
server-side gate, not a UI step — there is no flag that bypasses it.

### Analyses — `/analysis`

| Method | Path | Auth | Body / notes |
|---|---|---|---|
| POST | `/analysis` | Any + credits | `{ images: [{ imageUrl, side?, slotIndex? }], source?, game?, language? }`. Standard: max **1 per side** (front + back). PixelScope: up to 10 per side |
| GET | `/analysis` | Any | The caller's analyses, paginated |
| GET | `/analysis/:id` | Any | Includes candidate matches for the confirmation step |
| PATCH | `/analysis/:id/confirm` | Any | `{ cardId }` |

`POST /analysis` passes through two guards before the handler: `requirePixelScope`
(when `source: "pixelscope"`) and `requireCredits`.

- **Credits**: 10 per scan. The balance check and the debit are both server-side.
  A shortfall is a **402 Payment Required** naming the balance. The debit happens
  after the images are persisted but before the vendor call, and a vendor failure
  refunds rather than silently keeping the credits.
- **`source: "pixelscope"`** is accepted in the body but grants nothing on its
  own — the caller's plan is what decides, and a Free plan is rejected.
- Candidate `matchScore` is **Scrydex's raw scale (~0.7–1.3+, unbounded), not a
  percentage.** Rank with it. Never render it as "N% match".
- **Dev mode:** with `MOCK_SCRYDEX=true` (honored only under
  `NODE_ENV=development`), identification returns three fixed `mock-`-prefixed
  candidates and pricing returns fabricated daily-drifting quotes — so the full
  scan flow and price tracker are testable before the real Scrydex credentials
  arrive. Turn the flag off the moment they do.

### Grading — `/grading`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/grading/:analysisId` | Any | Grades a confirmed analysis. **400 if not yet confirmed.** Re-grading an already-graded analysis returns the existing report rather than re-running the model |
| GET | `/grading` | Any | The caller's reports |
| GET | `/grading/report/:id` | Any | One report |
| GET | `/grading/report/:id/pdf` | Any | **Returns `application/pdf` bytes.** Watermarked when the report owner's plan has `watermarkReports` (Free); rendered fresh per download so the watermark tracks the current plan |
| GET | `/grading/all` | Admin | Every report across the platform |

A report carries `grade` (0–10), `gradeLabel`, four sub-scores (`scoreSurface`,
`scoreCorners`, `scoreEdges`, `scoreCentering`), `confidence` (0–100),
`pixelVerified`, and `modelVersion`.

- **Repeatability** comes from a Redis cache keyed by
  `grading:{modelVersion}:{imageSetHash}`, with no TTL. The same image set always
  replays the original grade. The model itself is non-deterministic; the cache is
  the guarantee.
- **`pixelVerified` is never cached and never accepted from a client.** It is
  derived per request from the upload mode of *that* analysis plus a confidence
  floor of 90. Two users scanning identical images can legitimately get the same
  grade and different badges.

### Slab labels — `/slab`

| Method | Path | Auth | Body / notes |
|---|---|---|---|
| GET | `/slab/styles` | Any | Available background styles |
| POST | `/slab` | Any | `{ reportId, styleId? }`. Renders and exports |
| GET | `/slab` | Any | The caller's labels |
| GET | `/slab/:id` | Any | One label, with `exportPngUrl` and `exportPdfUrl` |
| POST | `/slab/:id/regenerate` | Any | `{ styleId? }`. New background, bumps `version` |
| GET | `/slab/:id/preview` | Any | **Returns `image/png` bytes, not JSON.** `Cache-Control: no-store` |

Geometry is deliberately absent from the request body — dimensions are
server-owned, so a client cannot resize the card window. Each label stores its
own copy of the numbers so already-exported labels keep rendering at the
dimensions they were sold at.

Only the **background** is AI-generated. The card image and label text are
composited server-side.

> Backgrounds are generated by **OpenAI gpt-image-1** (client-approved,
> 2026-07-19) on the same API key as grading. Until that key is configured,
> slab creation returns **503 "not configured"** — expected, not a bug.

---

## Collection — `/collection`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/collection` | Any | Filters: `searchTerm`, `set`, `rarity`, `minGrade`, `maxGrade`, `minPrice`, `maxPrice`, `favorite`, `sortBy` (`addedAt`\|`price`\|`grade`\|`name`), `sortOrder`, `page`, `limit` |
| POST | `/collection` | Any | Either `{ report }` (scanned) or `{ card }` (manual), plus `quantity?`, `favorite?`, `externalGrade?`, `manualImageUrl?`. `currentPrice` is not accepted — price is system-owned |
| GET | `/collection/summary` | Any | `totalValue`, `totalCards`, `entryCount`, `averageGrade` |
| GET | `/collection/value-over-time` | Any | `?months=` (1–36, default 12). One point per calendar month, oldest-first, as `{ month: "2026-07", value }` |
| GET | `/collection/by-set` | Any | Count and value per set |
| GET | `/collection/:id` | Any | |
| PATCH | `/collection/:id` | Any | `{ quantity?, favorite?, externalGrade?, manualImageUrl? }` |
| DELETE | `/collection/:id` | Any | Removes the entry only. The report and its images are retained permanently |

`averageGrade` covers graded entries only — manual entries are excluded rather
than counted as zero — and is `null` when nothing is graded.

**`value-over-time` makes two documented approximations**, because the exact
answer is not recoverable from the data:

1. Today's quantity is applied to every past month. Entries keep no quantity
   history.
2. For months before a card's price history begins, its earliest known price is
   carried backwards. The platform is younger than the collections in it, so the
   alternative — zero — would draw a value cliff that never happened.

Collection routes are **not** plan-gated yet. Whether Free gets access, and any
size cap, is unresolved (`docs/OPEN-QUESTIONS.md` #5).

## Prices — `/price`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/price/portfolio` | Any + price tracking | Total value and value-weighted 24h/7d/30d change |
| GET | `/price/history` | Any + price tracking | `?cardIds=a,b,c&window=30d`. **Capped at 50 ids** |
| GET | `/price/:cardId` | Any + price tracking | `?window=24h\|7d\|30d\|1y`. Points oldest-first plus the change over the window |
| POST | `/price/refresh` | Admin | `?limit=` (default 200). Same sweep the hourly cron runs |

Price tracking is Collector and above. A Free caller gets **403** from
`requirePriceTracking`.

`/price/history` exists so a table of sparklines is one request instead of one
per row. Points are bucketed — daily for `7d` and `30d`, monthly for `1y`, raw
for `24h` — and each bucket carries its **closing** price. The response is a map
keyed by card id; a card with no history yet comes back as `[]` rather than
being omitted.

Portfolio change percentages are **value-weighted, not a plain mean**: a large
move on a high-value card outweighs the same move on a common.

---

## Dashboards — `/dashboard`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/dashboard/me` | Any | Five stat cards for the user landing page |
| GET | `/dashboard/admin` | Admin | Four stat cards plus MRR |

Every stat card is `{ value, delta }`.

**`delta` is `null` when the previous month was zero.** Growth from nothing has
no meaningful percentage, so the API returns null rather than inventing
`+100%` — render no delta chip in that case.

`/dashboard/me` returns `collectionValue`, `cardsInCollection`, `slabsOrdered`,
`totalScans`, and `averageGrade`. **`averageGrade` is `null` outright** for a
collection with nothing graded in it — that is not the same as an average of
zero. Cancelled slab orders are excluded from `slabsOrdered`.

`/dashboard/admin` returns `totalUsers`, `subscribedUsers`, `newSubscribers`,
`totalEarnings`, and `mrr`. `totalEarnings.value` is lifetime revenue while its
delta compares this month against last.

> **`subscribedUsers.delta` is approximate.** Subscriptions record current
> status, not status history, so "how many were active a month ago" cannot be
> answered exactly. Today's active count minus this month's signups is used,
> which undercounts churn — someone who subscribed in March and cancelled last
> week appears in neither number. An exact figure needs a status audit trail.

## Credits — `/credit`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/credit/me` | Any | Balance, `creditsPerScan`, and scans remaining |
| GET | `/credit/me/ledger` | Any | The caller's credit movements |
| GET | `/credit/:userId/ledger` | Admin | Any user's ledger |
| POST | `/credit/:userId/adjust` | Admin | `{ amount, note? }`. Non-zero integer, may be negative |

There is deliberately **no user-facing route that grants credits**. Credits enter
a wallet only via a scheduled grant, a refund, or the admin adjustment above.

Grants are re-granted, not accrued — there is no rollover. Free tops up daily;
paid plans monthly, **including yearly subscribers**, who receive one month's
allowance twelve times rather than the whole year at once.

## Plans — `/plan`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/plan` | — | Public catalogue |
| GET | `/plan/:id` | — | |
| GET | `/plan/admin` | Admin | Includes Stripe price ids |
| PATCH | `/plan/:id` | Admin | Edit only |

The four tiers — Free, Collector, Pro, Enterprise — are fixed. **There is no
create route and no delete route, and `name` cannot be changed.** `creditAmount`
accepts `null`, meaning unlimited; that nullability is load-bearing, since
without it Enterprise would be un-editable.

Keep this catalogue in sync with `pixel-grade-ai/src/config/plans.ts`.

## Subscriptions — `/subscription`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/subscription/me` | Any | Plan, renewal date, and credit position in one call |
| POST | `/subscription/checkout` | Any | `{ planId, interval: "monthly" \| "yearly" }`. Returns `{ checkoutUrl, sessionId }` |
| POST | `/subscription/cancel` | Any | Cancels at period end, not immediately |
| GET | `/subscription/subscribers` | Admin | `?searchTerm=&status=&plan=&page=&limit=`. Defaults to active plus past-due |
| GET | `/subscription/stats` | Admin | `activeSubscriptions`, `mrr`, `newThisMonth`, `newLastMonth` |

Checkout rejects the **Free** plan with 400 — Free is the implicit default for
any account without an active paid subscription.

A subscription is only ever activated by a **verified Stripe webhook event**.
Nothing about price or status is accepted from a client.

**Yearly billing charges the effective monthly rate × 12 up front**, but credits
still refresh monthly. `mrr` therefore takes `priceYearly` verbatim for yearly
subscribers, because that field is already the effective monthly rate — dividing
an annual charge by twelve would double-discount every yearly customer.
Past-due subscriptions count toward neither `mrr` nor `activeSubscriptions`.

`/subscription/subscribers` is driven from subscriptions rather than accounts,
since "subscribed" is not a field on a user.

## Transactions — `/transaction`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/transaction/me` | Any | The caller's payment history |
| GET | `/transaction` | Admin | All transactions, paginated |
| GET | `/transaction/earnings` | Admin | `grossRevenue`, `subscriptionRevenue`, `slabOrderRevenue`, counts, `refundedAmount` |
| GET | `/transaction/revenue-by-month` | Admin | Bucketed for the earnings chart |

---

## Support — `/support`

| Method | Path | Auth | Body / notes |
|---|---|---|---|
| POST | `/support` | Any | `{ subject, message }` — 3–150 and 1–5000 chars |
| GET | `/support` | Any | The caller's tickets |
| GET | `/support/:id` | Any | |
| POST | `/support/:id/message` | Any | `{ message }`. A user reply reopens an answered ticket |
| GET | `/support/all` | Admin | Every ticket |
| PATCH | `/support/:id/status` | Admin | `{ status }` |

## Notifications — `/notification`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/notification` | Any | The caller's notifications |
| GET | `/notification/unread-count` | Any | |
| PATCH | `/notification/:id/read` | Any | |
| PATCH | `/notification/read-all` | Any | |
| DELETE | `/notification/:id` | Any | |
| GET | `/notification/settings` | Any | |
| PATCH | `/notification/settings` | Any | `{ inappEnabled?, emailGradeReady?, emailPriceAlert?, emailSubscription?, emailSupport? }` |

There is **no create route** — notifications are minted server-side only. Types
are `grade_ready`, `price_alert`, `subscription`, `support`, `system`.

## Cards — `/card`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/card` | Any | Catalogue search, paginated |
| GET | `/card/sets` | Any | Distinct sets/expansions |
| GET | `/card/:id` | Any | |

## CMS — `/cms`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/cms/:slug` | — | **Public.** Backs the about / terms / privacy pages |
| GET | `/cms` | Admin | All pages |
| PATCH | `/cms/:slug` | Admin | `{ htmlContent }`, max 200,000 chars |

## Activity log — `/activity-log`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/activity-log` | Admin | Audit trail, paginated |

---

## Not implemented

These have frontend screens but no API, deliberately. Both need a client
decision before anything is built — see `docs/OPEN-QUESTIONS.md`.

| Screen | Missing |
|---|---|
| Creator profile | Followers, showcase, community rating, badges. No module and nothing in DB design v3.0 |
| Admin platform settings | Site name, support email, signup toggle, maintenance mode. The page labels itself as demo fields |
| Slab ordering (Module 8b) | Blocked on whether a custom slab is a physical product or a paid digital export |

Country and state columns in the admin user tables also have no backing field on
the user model.

## Things that will bite during frontend integration

The RTK Query slices in `pixel-grade-ai/src/redux/features/` are still the
template's Django-style artifacts and do not match this API:

- `baseApi` refreshes against `/api/auth/token/refresh/` and reads `data.access`.
  The real route is `POST /api/v1/auth/refresh-token` returning `accessToken`.
- Endpoint paths carry trailing slashes and `uidb64`-style reset params. Neither
  exists here.
- The notification settings page is from a different product entirely — its
  toggles are "Rule Triggered" and "Session Locked", not the five preferences
  above.
- There is no card-confirmation screen, but step 3 of the scan flow is a hard
  server gate. One has to be designed before scanning can work end to end.
