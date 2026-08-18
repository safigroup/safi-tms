# Safi TMS

A single-page transport management system for **Safi Transport and Logistics Limited** — trip tracking, cost capture, document management, and invoicing for cross-border freight (Zambia / Tanzania / DRC corridor).

Live at: https://safigroup.github.io/safi-tms/

## What this is

One HTML file (`index.html`, ~2,300 lines) — no build step, no framework, no bundler. Plain JS renders everything client-side against a [Supabase](https://supabase.com) backend (Postgres + Auth + Storage). Deployed as-is to GitHub Pages: edit `index.html`, commit, push to `main`, and the live site updates within a minute or two.

Four views, driven by trip status:

- **Board** — trip lifecycle: draft → allocated → loading → in transit → at border → delivered → POD received → invoiced → closed
- **Cost docket** — record trip costs (fuel, border fees, tolls, etc.) with receipt photos; manage trip documents (POD, consignment note, T1 transit, etc.)
- **Billing** — raise invoices (50% on loading / 50% on delivery, gated on POD being in hand), record payments, track receivables ageing
- **Admin** — master data: customers, trucks, drivers, routes, rate cards, FX rates

## Structure

```
index.html                          the app
vendor/
  supabase-js.min.js                vendored @supabase/supabase-js UMD bundle
  migration-cancel-invoice.sql      DB migration for invoice cancellation (see Database below)
archives/                           earlier split-view drafts, kept for reference — not part of the live app
.nojekyll                           tells GitHub Pages not to run this through Jekyll
```

## Configuration

Near the top of `index.html`'s `<script>` block:

```js
const SUPABASE_URL = "https://shvvpcmcezkfzdvelhpl.supabase.co/";
const SUPABASE_KEY = "sb_publishable_...";   // the PUBLISHABLE/anon key — safe to be public, see Security notes below
const COMPANY = { name, reg, address, phone, email, bank };  // printed on every invoice
```

There's currently only one Supabase project (production) — no separate dev/staging environment exists yet (see Known gaps).

## Why `vendor/supabase-js.min.js` exists

`@supabase/supabase-js` used to load from `cdn.jsdelivr.net`. It's now vendored locally so the app still boots on networks that block third-party CDNs — border-post and corporate wifi being the two that actually matter for this app's users. Currently pinned to **v2.112.3**.

To update it: re-download from `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2` and replace `vendor/supabase-js.min.js`. If it ever fails to load (missing file, wrong deploy path), the app shows a clear error on the sign-in screen instead of hanging blank.

## Database

Supabase project ref: `shvvpcmcezkfzdvelhpl`. Schema, RLS policies, and functions live in Supabase itself, not in this repo — there's no Supabase CLI link or migration history set up yet (see Known gaps).

**`vendor/migration-cancel-invoice.sql`** adds invoice cancellation: audit columns (`cancelled_at`, `cancel_reason`) on `invoices`, a `cancel_invoice(p_invoice, p_reason)` RPC, and an `invoice_ar` view update so cancelled invoices stay visible instead of disappearing. **Not yet confirmed applied** — run it once via the Supabase SQL editor before relying on the "Cancel invoice" button in Billing.

### Security notes worth knowing before touching views or RLS

- `SUPABASE_KEY` is the **publishable/anon key** — it's meant to be public and ships in the page source by design. Anonymous access is controlled entirely by RLS policies and grants on the Supabase side, not by keeping the key secret.
- **Postgres views bypass RLS by default** unless created with `security_invoker = on`. This bit us once already: `trip_board`, `billable`, and `invoice_ar` were leaking full customer and financial data to unauthenticated requests until that was fixed (Aug 2026). Any new view built on top of RLS-protected tables needs `security_invoker = on` explicitly, plus `revoke select ... from anon` as defense in depth.
- Fastest way to check for an RLS gap: hit the table/view with `curl`, just the anon key, no session —
  ```
  curl "$SUPABASE_URL/rest/v1/<table_or_view>?select=*&limit=3" -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY"
  ```
  Should come back `[]` or `401` for anything not meant to be public.

## Deployment

GitHub Pages, deploying from the `main` branch root. Push to `main` → live in about a minute. No CI, no build step, no preview environment — what's on `main` is what's live.

## Known gaps / roadmap

- **No staging environment** — every change, including database migrations, goes straight against production. A second free-tier Supabase project plus a second Pages deployment (or a branch) would let changes get tried safely first.
- **No automated tests** — the FX conversion, invoice-splitting, and margin-calculation logic has zero test coverage. Worth extracting into testable functions.
- **No Supabase CLI / migration history** — schema changes currently happen by hand in the SQL editor, with the SQL saved ad hoc under `vendor/`. Linking the Supabase CLI would give proper migration tracking instead.
- **Role-based permissions** — `memberships.role` is fetched and shown in the header but not enforced anywhere in the UI; every signed-in user can currently do everything (raise invoices, edit master data, etc.).
