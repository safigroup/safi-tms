# Safi TMS

A transport management system for **Safi Transport and Logistics Limited** — trip tracking, cost capture, document management, billing, and per-truck financial reporting for cross-border freight (Zambia / Tanzania / DRC corridor).

Production: https://next-app-mocha-psi.vercel.app (no custom domain configured yet) — the app lives in `next-app/`.

## What this is

A Next.js 16 (App Router, TypeScript) application, deployed on Vercel. All database and storage access goes through server-side API routes using a Supabase `service_role` key — the browser never talks to Supabase directly, and every route resolves the caller's organization and role first (`lib/auth/getAuthedOrgContext.ts`) before touching any data. This replaced an earlier single-file `index.html` app that talked to Supabase directly from the browser with the anon key; that file, `vendor/`, and `archives/` at the repo root are leftover from that architecture and are no longer where active development happens (see **Legacy `index.html` app** below — it is, as of this writing, still technically live).

### Views

- **Board** — trip lifecycle: draft → allocated → loading → in transit → at border → delivered → POD received → invoiced → closed. Routes can have multiple alternate border-crossing paths (e.g. via Kasumbalesa or via Mokambo); owner/admin can retroactively edit trip details with a field-level audit trail.
- **Cost docket** — record trip costs (fuel with liters/price-per-liter auto-costing, border fees, tolls, etc.) with receipt photos; bulk-import costs from CSV/Excel; bulk-select and delete ledger entries; print a trip's full cost ledger; manage trip documents (POD, consignment note, T1 transit, etc.).
- **Billing** — raise invoices (50% on loading / 50% on delivery, delivery half gated on POD being in hand), record payments, track receivables ageing, cancel invoices.
- **Reports** — per-truck revenue/expense P&L with a category breakdown, a standing-cost ledger (maintenance, insurance, tyres, licensing, etc.), and asset breakeven tracking: purchase/clearing/registration costs are kept separate from running costs so the app can show cumulative net cashflow since a truck's purchase date and either when it broke even or a projected date at its recent pace.
- **Admin** — master data (customers, trucks, drivers, routes with border paths, rate cards, FX rates), team management via email invites, and the same audit-trailed record-override capability as Board.
- **Organizations** (platform-admin only) — create new, fully isolated organizations and invite their first owner in one step; switch which organization you're currently viewing/editing via a header dropdown. See **Platform admins** below.

Roles are per-organization — owner, admin, ops, finance, viewer — and enforced server-side (`lib/auth/permissions.ts`), not just hidden in the UI.

## Structure

```
next-app/                     the application — see next-app/README.md for local dev setup
  app/(app)/                  authenticated pages: board, docket, billing, reports, admin, organizations
  app/api/                    server route handlers — the only code allowed to hold a service-role client
  app/login/, accept-invite/, forgot-password/, reset-password/   public auth pages
  lib/auth/                   getAuthedOrgContext (per-org), getAuthedPlatformAdmin (cross-org), permissions.ts
  lib/components/             shared client components (Nav, ThemeToggle, OrganizationsPicker, Spinner)
  supabase/migrations/        tracked schema history — applied to staging, then production, explicitly
  supabase/seed.sql           staging-only reference data, deliberately not in migrations/
index.html, vendor/, archives/   the pre-Next.js single-file app — legacy, see below
```

## Environments

Two separate Supabase projects — **staging** and **production** — that never share data. A schema change is written once as a migration and applied to both explicitly, one at a time (`supabase link --project-ref <ref>` then `supabase db push --linked`); nothing auto-syncs between them.

Vercel deploys a Preview on every push. `safi-tms-staging.vercel.app` is a stable alias kept pointed at whichever preview is current, so there's always one URL to test against while iterating. Production is whatever's on `main`.

## Roles & permissions

| Capability | Roles |
|---|---|
| Manage trips (create/advance/log border events/costs) | owner, admin, ops |
| Manage billing (raise invoices, record payments) | owner, admin, finance |
| Edit fleet data (trucks, drivers, routes) | owner, admin, ops |
| Edit commercial data (customers, rate cards, FX rates) | owner, admin, finance |
| Manage team (invite/remove members) | owner, admin |
| Override an already-recorded trip/ledger entry | owner, admin |
| Cross-organization access (create orgs, switch active org) | platform admins only — separate from the table above |

### Platform admins

A tier above the per-org role model, for the handful of people who need to see across every organization rather than just their own. Backed by a `platform_admins` table with exactly one RLS policy (`select using (user_id = auth.uid())`) and **no insert/update/delete policy at all** — nothing in the app can grant this access. It is only ever granted by running SQL directly against a project:

```sql
insert into platform_admins (user_id) select id from auth.users where email = '...';
```

A platform admin with an organization selected (via the header dropdown) is resolved with a synthetic `owner` role for that org, reusing every existing permission check as-is — every page works against whichever org is currently selected, completely unmodified.

## Database

Schema, RLS policies, and Postgres functions are tracked as migrations in `next-app/supabase/migrations/` and applied via the Supabase CLI — there is no schema drift between what's in the repo and what's live. Notable pitfalls documented inline in the migrations themselves:

- `CREATE OR REPLACE FUNCTION` does not replace a function whose **argument count** changes — Postgres creates a second overload instead, which shows up as a `PGRST203` ambiguous-function error. `DROP FUNCTION IF EXISTS <old signature>` first whenever a function gains or loses a parameter.
- A PL/pgSQL function declared `RETURNS TABLE (id uuid, ...)` puts `id` in scope as a variable for the whole function body — any *unqualified* `id` (or other shared column name) in the function's own SQL collides with it and raises "column reference is ambiguous". Every such reference needs a table alias.

### Security notes

- RLS is enabled on every table, but the real security boundary in the Next.js app is server-side: `getAuthedOrgContext()` resolves the caller's `org_id` and role, and every route filters by it explicitly — RLS is defense-in-depth, not the primary gate. (This is the opposite of the old `index.html` app, where the anon key + RLS *was* the only gate — see below.)
- The service-role client is only ever obtained through `getAuthedOrgContext()` or `getAuthedPlatformAdmin()` (`lib/auth/`). Nothing else should import `lib/supabase/admin.ts` directly — a route handler that did would have no guarantee an org or platform-admin check ever ran.
- Platform-admin access has no in-app grant path at all, by design (see above).

## Legacy `index.html` app

The repo root still contains the original single-file, client-side app (`index.html`, `vendor/supabase-js.min.js`, `archives/`) that this Next.js app replaced. **As of this writing, GitHub Pages is still building and serving it from `main` at https://safigroup.github.io/safi-tms/**, pointed directly at the *production* Supabase project via its publishable/anon key, with no role-based permission enforcement — anyone who finds that URL can still use the old app against real production data. It is not part of active development; decommissioning the GitHub Pages deployment (repo Settings → Pages) is worth doing deliberately rather than by accident.

## Known gaps / roadmap

- **No automated tests** — FX conversion, invoice-splitting, margin, and breakeven-projection logic have zero test coverage.
- **Company letterhead is still placeholder data** (`next-app/lib/company.ts`) — address, phone, email, and bank details printed on every invoice/report need replacing with real ones before those documents go out to customers.
- **No cross-org audit trail** — creating an organization or switching a platform admin's active org isn't logged anywhere beyond Supabase's own request logs, unlike the field-level audit log that already covers trip/ledger overrides.
- **Legacy GitHub Pages deployment** — see above.
