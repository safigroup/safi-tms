# Safi TMS — Next.js app

The in-progress replacement for the top-level `index.html` app, migrating to Next.js (App Router, TypeScript) with all database/storage access moved behind server-side API routes using a Supabase `service_role` key, instead of the browser talking to Supabase directly. See the repo root's `README.md` for the overall project, and this session's migration plan for the full rationale and phase breakdown.

## Local development

```bash
npm install
npm run dev
```

Needs `.env.local` (gitignored — copy `.env.example` and fill in real values):

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — safe to be public, used for auth only.
- `SUPABASE_SERVICE_ROLE_KEY` — **not** safe to be public. Bypasses RLS on every table. Only ever obtained through `lib/auth/getAuthedOrgContext.ts` — never import `lib/supabase/admin.ts` directly from a route handler.

Points at the **staging** Supabase project during development, not production — see `supabase/seed.sql` for the reference data it's seeded with, and the repo root README's security notes before touching RLS or views.

## Structure

- `app/login/` — public sign-in page (client component, anon key).
- `app/(app)/` — everything behind the auth gate. `layout.tsx` resolves the session server-side and redirects to `/login` if there isn't one.
- `app/api/` — REST route handlers (added phase by phase; empty until Phase 1).
- `lib/supabase/` — `client.ts` (browser, anon key), `server.ts` (SSR, anon key, request-bound cookies), `admin.ts` (service-role factory — internal only).
- `lib/auth/getAuthedOrgContext.ts` — the security choke point every route handler starts with.
- `proxy.ts` — refreshes the Supabase session cookie on every request (this is `middleware.ts` under Next.js 16's new naming — see `AGENTS.md`).
- `supabase/` — CLI-linked project: `migrations/` (applied to both staging and production), `seed.sql` (staging-only reference data, deliberately **not** in `migrations/`).

## Notes for whoever (or whatever) works on this next

`AGENTS.md` is not boilerplate — Next.js 16 has real breaking changes from older training data (`proxy.ts` replacing `middleware.ts`, fully async `cookies()`/`params`, etc.). Read `node_modules/next/dist/docs/` before assuming an API works the way an earlier Next.js version's did.
