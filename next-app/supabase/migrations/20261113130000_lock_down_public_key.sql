-- Closes the ways the public (anon) key -- which every visitor's browser
-- has -- and a signed-in user's own session could reach data or actions
-- meant only for the app's server.
--
-- The Next.js app does all of its reads and writes server-side with the
-- service role, after getAuthedOrgContext() has checked who is asking and
-- for which organisation. The only thing it does with a user's own session
-- is read that user's membership while signing them in.
--
-- 1. Functions. Postgres lets PUBLIC execute every new function, and
--    Supabase's default privileges add anon and authenticated, so the
--    server-only functions -- which trust the p_org they're given -- could
--    be called straight through the Data API: advance_trip_status,
--    mark_pod_received, create_trip, raise_invoice, cancel_invoice ... on
--    any trip or invoice whose ids the caller knew. Now only the service
--    role may run them. current_org_ids() stays open to signed-in users:
--    row-level security calls it on every read they make.
--
-- 2. Views that skipped row-level security. trip_margin, pod_outstanding
--    and trip_doc_status were created without security_invoker, so they
--    ran as their owner, and anon could select from them: every
--    organisation's trips, customers, routes, trucks, drivers, money and
--    document status. invoice_ar did the same for any signed-in user, of
--    any organisation. They now run as the caller (like trip_board and
--    billable), and anon can no longer read them at all.
--
-- A function added from now on needs its own
--   revoke execute on function ... from public, anon, authenticated;
--   grant execute on function ... to service_role;
-- (see 20261113100000_correct_trip_times.sql). The default-privileges
-- change below stops Supabase's automatic anon/authenticated grant, but
-- Postgres' own grant to PUBLIC can't be turned off for one schema alone.

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       and p.proowner = (select oid from pg_roles where rolname = current_user)
       -- Leave anything an extension installed in public to the extension.
       and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on routine %s from public, anon, authenticated', f);
    execute format('grant execute on routine %s to service_role', f);
    raise notice 'service role only: %', f;
  end loop;
end $$;

grant execute on function public.current_org_ids() to authenticated;

alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

alter view public.trip_margin set (security_invoker = on);
alter view public.pod_outstanding set (security_invoker = on);
alter view public.trip_doc_status set (security_invoker = on);
alter view public.invoice_ar set (security_invoker = on);

revoke all on table public.trip_margin, public.pod_outstanding, public.trip_doc_status, public.invoice_ar from anon;
