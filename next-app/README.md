# Safi TMS — Next.js app

The application (Next.js App Router, TypeScript). All database/storage access goes through server-side API routes using a Supabase `service_role` key — the browser never talks to Supabase directly. This replaced an earlier `index.html` app that did talk to Supabase directly from the browser with the anon key; see the repo root's `README.md` for the overall project, environments, and security notes.

## Local development

```bash
npm install
npm run dev
```

Needs `.env.local` (gitignored — copy `.env.example` and fill in real values):

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — safe to be public, used for auth only.
- `SUPABASE_SERVICE_ROLE_KEY` — **not** safe to be public. Bypasses RLS on every table. Only ever obtained through `lib/auth/getAuthedOrgContext.ts`, `lib/auth/getAuthedPlatformAdmin.ts`, or `lib/auth/getAuthedApiKey.ts` — never import `lib/supabase/admin.ts` directly from a route handler.

Points at the **staging** Supabase project during development, not production — see `supabase/seed.sql` for the reference data it's seeded with, and the repo root README's security notes before touching RLS or views.

## Structure

- `app/login/`, `app/accept-invite/`, `app/forgot-password/`, `app/reset-password/` — public auth pages (client components, anon key).
- `app/(app)/` — everything behind the auth gate: `layout.tsx` resolves the caller's org (or platform-admin status) server-side via `getAuthedOrgContext()` and either renders the app shell, an organization picker (platform admin with no org selected), or redirects to `/login`. Pages: `board`, `docket`, `billing`, `reports`, `admin`, `organizations` (platform-admin only).
- `app/api/` — REST route handlers. Every one starts with `getAuthedOrgContext()` (org-scoped, session cookie), `getAuthedPlatformAdmin()` (cross-org: `api/platform/organizations`), or `getAuthedApiKey()` (org-scoped, Bearer token: `api/agent/*`), checks a permission set from `lib/auth/permissions.ts` for anything mutating, and filters every query by the resolved `org_id`.
- `lib/supabase/` — `client.ts` (browser, anon key), `server.ts` (SSR, anon key, request-bound cookies), `admin.ts` (service-role factory — internal only, see above).
- `lib/auth/` — `getAuthedOrgContext.ts` (the per-request security choke point every org-scoped route starts with), `getAuthedPlatformAdmin.ts` (the equivalent for cross-org actions), `getAuthedApiKey.ts` (the equivalent for API-key-authenticated agent routes — see [Agent API](#agent-api) below), `platformAdmin.ts` (shared platform-admin check), `permissions.ts` (the role permission matrix).
- `lib/components/` — shared client components: `Nav.tsx` (masthead, nav, mobile hamburger menu, platform-admin org switcher), `ThemeToggle.tsx` (light/dark mode), `OrganizationsPicker.tsx`, `Spinner.tsx`.
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
- `POST /api/agent/estimate` — body `{ routeId, tonnage?, volumeCbm?, customerId? }`. Computes the cost breakdown via the same `lib/estimates/estimateTripCost.ts` function the `/estimates` page itself uses (so the two can never disagree), and — if `customerId` matches a rate card for that route — an estimated revenue and margin. Returns 404 if the route doesn't belong to the caller's org.

Both return `401` for a missing/invalid/revoked key, and never touch `trips`, `trip_costs`, or `invoices`.

## Notes for whoever (or whatever) works on this next

`AGENTS.md` is not boilerplate — Next.js 16 has real breaking changes from older training data (`proxy.ts` replacing `middleware.ts`, fully async `cookies()`/`params`, etc.). Read `node_modules/next/dist/docs/` before assuming an API works the way an earlier Next.js version's did.

Two Postgres pitfalls worth knowing before writing a migration that touches an existing function (see inline comments in `supabase/migrations/` for the incidents that taught these):

- `CREATE OR REPLACE FUNCTION` does not replace a function whose **argument count** changes — it creates a second overload instead, which surfaces as a `PGRST203` ambiguous-function error at the API layer. `DROP FUNCTION IF EXISTS <old signature>` first whenever a parameter is added or removed.
- A PL/pgSQL function declared `RETURNS TABLE (id uuid, ...)` puts `id` in scope as a variable for the whole function body — any bare `id` (or other shared column name) in that function's own SQL collides with it. Qualify every such reference with a table alias.
