# Safi TMS — Next.js app

The application (Next.js App Router, TypeScript). All database/storage access goes through server-side API routes using a Supabase `service_role` key — the browser never talks to Supabase directly. This replaced an earlier `index.html` app that did talk to Supabase directly from the browser with the anon key; see the repo root's `README.md` for the overall project, environments, and security notes.

## Local development

```bash
npm install
npm run dev
```

Needs `.env.local` (gitignored — copy `.env.example` and fill in real values):

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — safe to be public, used for auth only.
- `SUPABASE_SERVICE_ROLE_KEY` — **not** safe to be public. Bypasses RLS on every table. Only ever obtained through `lib/auth/getAuthedOrgContext.ts`, `lib/auth/getAuthedPlatformAdmin.ts`, `lib/auth/getAuthedApiKey.ts`, or `lib/auth/getAuthedCron.ts` — never import `lib/supabase/admin.ts` directly from a route handler. The one exception is `lib/demoRequests/createDemoRequest.ts`, which uses it internally to record a landing-page demo request and never hands the client back (see [Landing page](#landing-page)).
- `RESEND_API_KEY` / `DEMO_REQUEST_FROM` — demo-request notification emails (see [Landing page](#landing-page)); optional, nothing breaks without them.
- `CRON_SECRET` — **not** safe to be public. Gates `/api/cron/fx-rates` (see [Automated FX rates](#automated-fx-rates) below). Only needed locally if you want to call that route yourself.
- `ANTHROPIC_API_KEY` — **not** safe to be public. Powers the Estimator page's AI cost insights (see below). A real, ongoing per-call cost, not a one-time setup. Leave unset in any environment where that's not wanted yet — the feature just reports itself as unconfigured rather than failing the page.

Points at the **staging** Supabase project during development, not production — see `supabase/seed.sql` for the reference data it's seeded with, and the repo root README's security notes before touching RLS or views.

## Structure

- `app/page.tsx` + `app/_landing/` — the public landing page at `/` (see [Landing page](#landing-page)); signed-in users are redirected straight to `/overview`.
- `app/login/`, `app/accept-invite/`, `app/forgot-password/`, `app/reset-password/` — public auth pages (client components, anon key), all framed by `lib/components/AuthShell.tsx` so each links back to the landing page.
- `app/(app)/` — everything behind the auth gate: `layout.tsx` resolves the caller's org (or platform-admin status) server-side via `getAuthedOrgContext()` and either renders the app shell, an organization picker (platform admin with no org selected), or redirects to `/login`. Pages: `overview` (the home page after sign-in), `board`, `docket`, `billing`, `cashbook`, `reports`, `estimates`, `admin`, `organizations` and `demo-requests` (both platform-admin only).
- `app/api/` — REST route handlers. Every one starts with `getAuthedOrgContext()` (org-scoped, session cookie), `getAuthedPlatformAdmin()` (cross-org: `api/platform/organizations`), `getAuthedApiKey()` (org-scoped, Bearer token: `api/agent/*`), or `getAuthedCron()` (shared-secret, Vercel Cron: `api/cron/*`) — the only exception is the public `api/demo-requests` (see [Landing page](#landing-page)) — checks a permission set from `lib/auth/permissions.ts` for anything mutating, and filters every query by the resolved `org_id`.
- `lib/supabase/` — `client.ts` (browser, anon key), `server.ts` (SSR, anon key, request-bound cookies), `admin.ts` (service-role factory — internal only, see above).
- `lib/auth/` — `getAuthedOrgContext.ts` (the per-request security choke point every org-scoped route starts with), `getAuthedPlatformAdmin.ts` (the equivalent for cross-org actions), `getAuthedApiKey.ts` (the equivalent for API-key-authenticated agent routes — see [Agent API](#agent-api) below), `getAuthedCron.ts` (the equivalent for Vercel Cron routes — see [Automated FX rates](#automated-fx-rates) below), `platformAdmin.ts` (shared platform-admin check), `permissions.ts` (the role permission matrix).
- `lib/components/` — shared client components: `Nav.tsx` (the left sidebar: company and platform-admin org switcher at the top, pages in groups with live counts, account, dark mode, sign out and collapse at the bottom; full width from 1280px, an icon strip from 900 to 1279px or when collapsed (remembered in `localStorage` as `safi:nav` and applied before paint by the root layout's inline script), and a slide-in menu from a top bar on phones), `NavIcons.tsx` (its line icons), `bandFigs.tsx` (band figures that carry a change against another period, shared by the Overview and the truck report), `MonthlyChart.tsx` (revenue beside costs month by month, as bars or a table), `PageBand.tsx` (the navy header every page opens with, after the landing page: a kicker naming the page, a headline, a line of context, the page's main action on the right, then its key figures in a row — plain read-outs, or filters/shortcuts with `onClick` — and optional tabs along the bottom edge; the figures fit the band's width, not the window's, through a CSS container query), `ThemeToggle.tsx` (light/dark mode), `OrganizationsPicker.tsx`, `Spinner.tsx`.
- `proxy.ts` — refreshes the Supabase session cookie on every request (this is `middleware.ts` under Next.js 16's new naming — see `AGENTS.md`).
- `supabase/` — CLI-linked project: `migrations/` (applied to both staging and production, in order, explicitly — never auto-synced), `seed.sql` (staging-only reference data, deliberately **not** in `migrations/`).

## Agent API

`app/api/agent/*` lets an external agent (or script) query the Trip Cost Estimator programmatically instead of a human clicking through `/estimates`. It is deliberately **read-only** — nothing under `/api/agent/` can create or modify a trip, cost, or invoice, so a leaked key can't do anything destructive.

**Auth**: `Authorization: Bearer <key>` header, where `<key>` is issued from Admin → API keys (`CAN_MANAGE_TEAM` only). The raw key is shown exactly once at creation — only its hash is stored — and can be revoked at any time from the same screen. Keys are scoped to the organization that issued them; there is no cross-org access.

```bash
curl -H "Authorization: Bearer sk_..." https://<host>/api/agent/routes
curl -X POST -H "Authorization: Bearer sk_..." -H "Content-Type: application/json" \
  -d '{"routeId": "...", "tonnage": 28, "customerId": "..."}' \
  https://<host>/api/agent/estimate
```

- `GET /api/agent/routes` — lists the org's routes (`origin`, `destination`, `distanceKm`, `targetDays`, `defaultBorders`, `alternateBorderPaths`, and a `costTemplate` summary), so an agent can browse options before estimating.
- `POST /api/agent/estimate` — body `{ routeId, tonnage?, volumeCbm?, customerId?, commodity? }`. Computes the cost breakdown via the same `lib/estimates/estimateTripCost.ts` function the `/estimates` page itself uses (so the two can never disagree), and — if `customerId` has a rate card for that route valid today — an estimated revenue and margin. The card is chosen by `lib/rates/pickRateCard.ts`, the same rule the New trip form uses; pass `commodity` when the customer has a different rate per commodity. Returns 404 if the route doesn't belong to the caller's org.

Both return `401` for a missing/invalid/revoked key, and never touch `trips`, `trip_costs`, or `invoices`.

## AI cost insights

`GET /api/insights/routes/[id]` (session-authenticated, not the Agent API) powers an "Insights" panel on the Estimator page. For the selected route, it compares each cost-template line against what trips that actually ran on that route have averaged per category — the same `estimateTripCost()` math the page itself uses, reused rather than re-implemented — and surfaces categories with no template line at all. Claude (`claude-opus-5-5`, low effort) is given only those precomputed numbers and asked to write 1–4 short, concrete findings grounded in them; it's explicitly told never to invent a figure. The reply comes back as structured output validated against a Zod schema (`client.beta.messages.parse`), so there's no free text to parse, and `fallbacks: "default"` re-runs a request a safety classifier declines on Anthropic's recommended fallback model.

Degrades deliberately rather than erroring: fewer than 2 qualifying trips returns `insufficientData`, and a route with a template but no recorded costs at all (or vice versa) skips the Claude call entirely rather than spending one on an empty brief. Requires `ANTHROPIC_API_KEY`; without it — or if the call fails or is declined — the endpoint returns an error and the panel simply doesn't show, rather than claiming nothing stands out. It never blocks or delays the manual cost breakdown above it on the page.

## Automated FX rates

`GET /api/cron/fx-rates`, triggered by Vercel Cron every morning (`vercel.json`), keeps every org's `fx_rates` current without anyone having to remember the Admin → "Exchange rates" form. It refreshes **only** currencies an org already has at least one `fx_rates` row for — it never introduces a currency no one asked for — using the free, keyless [open.er-api.com](https://open.er-api.com) feed. Each run refreshes only currencies whose newest rate (automatic or manual) is 14+ days old, so rates still change roughly every two weeks — but a run Vercel fails to deliver (cron delivery is best-effort; the 2026-11-01 run never arrived) is made up the next day instead of leaving rates stale for another fortnight. Vercel's dashboard (or `vercel crons run /api/cron/fx-rates`) can trigger it by hand.

It always **inserts** a new row dated today (upserted only against today's own `(org_id, currency, effective_on)` key, same as the manual admin form) and never touches a past row — `trip_costs.fx_rate_to_usd` freezes whatever rate was on file at entry time, so history must never be rewritten.

These are official/interbank rates, which can diverge from real border-town cash rates (ZMW and CDF especially) — the manual admin form still works and always wins if someone enters a same-day rate after the cron ran. `Nav.tsx`'s 14-day staleness warning (a note at the top of every page and an amber count on Admin in the sidebar) is the safety net if a run is ever missed.

**Auth**: `CRON_SECRET` env var — Vercel sends it automatically as `Authorization: Bearer <value>` on every cron invocation once it's set in the project's environment variables.

## Landing page

`/` is a public, bilingual (EN/FR) landing page for signed-out visitors, styled entirely with the app's own tokens and component classes so it follows the same light/dark toggle. Copy lives in `app/_landing/copy.ts` — both languages share one typed shape, so a key missing from either fails the build. The language comes from the `safi_lang` cookie (set by the EN/FR toggle), else the browser's `Accept-Language`, else English.

The product previews (`app/_landing/previews.tsx`) are pictures of the real screens built from the app's own component classes, with illustrative data. They stay in English in both languages, because the signed-in screens are English-only; keep their wording in step with the screens they show when those change. The hero's trip plays forward once when it scrolls into view, sections fade in as they're reached, and a "Request a demo" bar follows phone visitors until the form is on screen; with reduced motion the trip shows its last step and nothing is hidden.

**Share card**: `app/opengraph-image.tsx` renders the image shown when a safitms.com link is shared (WhatsApp, LinkedIn, email), once at build time, from the static Manrope files in `assets/fonts` (the generator can't read the woff2 files `next/font` serves). `metadataBase` in `app/layout.tsx` points share links at `https://safitms.com`.

**Demo requests**: the page's form posts to the public `POST /api/demo-requests`, which validates input, drops honeypot submissions silently, and allows at most 5 requests per IP per hour (IPs are stored only as a SHA-256 hash). Rows land in `demo_requests` — the platform operator's own sales leads, not tenant data, so there is no `org_id`; RLS is on with no policies and anon/authenticated grants are revoked, so the public anon key can't touch the table directly. Platform admins see them at `/demo-requests` (`GET /api/platform/demo-requests`).

**Notification email**: after each saved request, `lib/demoRequests/notifyDemoRequest.ts` emails every platform admin through [Resend](https://resend.com), with Reply-To set to the requester. It runs in `after()`, so the visitor never waits on it, and a failure is only logged. It's off until `RESEND_API_KEY` is set. Without `DEMO_REQUEST_FROM` it sends from Resend's test sender, which only delivers to the Resend account's own address — verify a domain in Resend and set `DEMO_REQUEST_FROM` to reach every admin.

## Overview

`/overview` is the home page after sign-in. Its figures come from `lib/dashboard/summary.ts` (pure functions over `/api/bootstrap`'s data): this month so far against the same days of last month, trips by stage (each linking to the matching Board filter via `/board?filter=`), trips needing attention (late, waiting at a border 24h+, delivered 3+ days without POD, on the road with no costs, documents still pending after delivery — each linking to `/board?trip=`), what Billing can invoice now, and receivables by age with the customers who owe most. Revenue and costs land in the month a trip loaded, the same rule as truck reports. Owner/admin/finance (`CAN_SEE_FINANCE_OVERVIEW`) see the money sections; cash collected comes from `GET /api/dashboard/collections`, which converts each payment at the rate on file the day it arrived. Operations and viewers see the operational figures only.

## Truck report

`/reports` is one truck's report for a period, written so it can be read without an accounting background. `GET /api/reports/trucks/[id]` returns the period's figures plus what they're compared with; the page and its printout only arrange them.

- **Period**: quick ranges on the company's calendar (`lib/reports/periods.ts`), each with a like-for-like comparison period (this month's first 17 days against last month's first 17). A link with `?from=&to=` opens as a custom range.
- **Profit** is revenue less trip costs less **owning costs** (truck costs other than buying the truck). Purchase, clearing and registration (`CAPITAL_CATEGORIES`, `lib/trucks/costs.ts`) are the investment, not a cost of the period, so they're left out here exactly as the Overview's profit per truck leaves them out; the two pages agree for the same truck and dates.
- **In short** (`lib/reports/summary.ts`): the headline and sentences are worked out by fixed rules from the report's own figures (nothing generated), beside one bar splitting each dollar of revenue into trip costs, owning costs and what was kept.
- **Comparisons**: the same truck over the comparison period, and the fleet's average for the same dates (trucks that are active or had trips or costs in them) with this truck's rank by profit.
- **Month by month**: the last 12 months, sharing `lib/components/MonthlyChart.tsx` with the Overview.
- **Payback** ("Has this truck paid for itself?"): money actually earned back since purchase against what the truck cost to buy. Depreciation (`NON_CASH_CATEGORIES`) is left out of it, since it restates the purchase price on paper; the projected date is a straight line from the last six full months, never the month in progress; and with no purchase cost logged it asks for one rather than guessing.

## Company cashbook

`/cashbook` records the company's own money: bank accounts, mobile money wallets and cash boxes (`cash_accounts`, any currency the app has a rate for), each opening with its balance on a chosen date (1 Nov 2026 by default), plus every movement in or out (`cash_transactions`). Transfers between two of the company's accounts are written as a pair sharing a `transfer_id`, so they're only ever created or deleted whole; across currencies both the amount sent and the amount received are entered as they actually happened. Each entry freezes the rate on file at entry, like trip costs, for later USD reporting.

Statements (`lib/cashbook/statement.ts`, shared by the page and its English/French printout) show money in as the debit side and money out as the credit side, with the balance brought forward to the period's first day. Account balances come from the `cash_account_balances` view, so they stay correct past the API's 1,000-row read limit.

Unlike the rest of the app, **viewing** is restricted too: only owner, admin and finance (`CAN_USE_CASHBOOK`), on every `/api/cashbook` route. The cash tables and views are revoked from `anon` and `authenticated` as well, so organization isolation alone can't expose them through the public API.

**TMS records in the cashbook** (phase 2). Money that already passes through the app lands in the cashbook without being typed twice:

| Record | Cashbook | Field on the form |
|---|---|---|
| Invoice payment (Billing) | money in | Received into |
| Trip cost paid by Office, Agent or Card (Docket) | money out | Paid from |
| Trip allocation (Docket → Balance) | money out | Paid from |
| Truck cost other than depreciation (Reports) | money out | Paid from |

A driver-float cost never goes in an account (that money left when it was allocated), and depreciation isn't money leaving anywhere. Each of the four tables has `cash_account_id` and, only when the account is in another currency, `cash_amount` (what actually went through the account). The records stay where they are; the `cash_entries` view unions them with manual entries, and `cash_account_balances` and every statement read it, so correcting a cost in the Docket also corrects the cashbook.

The `cash_link_guard` trigger keeps links valid whichever route writes them: same company, open account, dated on or after the account's opening date, an account-currency amount when currencies differ. Setting a link that doesn't fit is refused with a message the user sees; an edit elsewhere that stops a link fitting (paid by changed to the driver float, currency changed, the amount changed on a cross-currency link) sends the record back to **To place** instead of failing.

The account field (`lib/components/CashAccountField.tsx`) only shows for cashbook roles and remembers each person's last account per currency; records from anyone else, "decide later", the bulk cost import, and everything dated since the first account opened but entered before these links existed wait in the Cashbook's **To place** list (`/api/cashbook/links`), where finance ticks them and picks the account (several at once in the account's currency, or one at a time with the amount when it's in another). A placed record can be taken back out of a statement onto To place; it's only deleted where it was entered. Statement lines and their English/French printout are described by `lib/cashbook/describe.ts`.

**Monthly summary and Excel export** (phase 3). The Cashbook's *Monthly summary* view shows money in against money out by category, month by month, across every account in USD (`lib/cashbook/summary.ts`, `GET /api/cashbook/summary?from=YYYY-MM&to=YYYY-MM`). Each line counts at the rate locked onto it when it was entered; a customer payment in another currency has no locked rate, so it converts at the rate on file the day it arrived (the Overview's rule). Transfers between the company's own accounts are left out, and trip and truck costs are split by cost category. `GET /api/cashbook/export?from=&to=&lang=en|fr` returns the same months as an .xlsx workbook (`lib/cashbook/workbook.ts`, written with `write-excel-file`): *Summary*, *Entries* (every line of every account, with USD and whether it's reconciled) and *Accounts* (balances at the start and end of the period, and the reconciled balance).

**Reconciliation** (phase 3). Each statement line has a tick for "agrees with the account's own statement" (bank, wallet, cash count), stored in `cash_reconciliations` with the line's account and amount at that moment. `cash_entries.reconciled_at` is only set while both still match, so moving a record to another account or correcting its amount un-ticks it rather than leaving a tick that no longer agrees with the bank. The statement shows the reconciled balance as of the period end (opening balance plus ticked lines) and the difference from a balance typed in from the bank's statement; "Not reconciled only" narrows the list to what's left. `POST /api/cashbook/reconcile` takes `{ items: [{ source, id }], reconciled }`; deleting a manual entry removes its tick.

## Notes for whoever (or whatever) works on this next

`AGENTS.md` is not boilerplate — Next.js 16 has real breaking changes from older training data (`proxy.ts` replacing `middleware.ts`, fully async `cookies()`/`params`, etc.). Read `node_modules/next/dist/docs/` before assuming an API works the way an earlier Next.js version's did.

Two Postgres pitfalls worth knowing before writing a migration that touches an existing function (see inline comments in `supabase/migrations/` for the incidents that taught these):

- `CREATE OR REPLACE FUNCTION` does not replace a function whose **argument count** changes — it creates a second overload instead, which surfaces as a `PGRST203` ambiguous-function error at the API layer. `DROP FUNCTION IF EXISTS <old signature>` first whenever a parameter is added or removed.
- A PL/pgSQL function declared `RETURNS TABLE (id uuid, ...)` puts `id` in scope as a variable for the whole function body — any bare `id` (or other shared column name) in that function's own SQL collides with it. Qualify every such reference with a table alias.
