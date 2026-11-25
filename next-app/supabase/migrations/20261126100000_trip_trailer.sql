-- A trip's trailer. Trailers move between trucks, so the plate on the
-- truck (trucks.trailer_reg, Admin -> Fleet) only says which trailer the
-- truck has now, not which one went on a past trip. Each trip now records
-- its own.
--
--   - "Start loading" on the Board asks for the trailer, filled in with the
--     truck's current one (/api/trips/[id]/advance). If a different trailer
--     goes, it's saved on the trip and becomes the truck's current trailer.
--   - The trigger below is the backstop: a trip that starts loading by any
--     other path, or is inserted already loaded (the demo company's
--     rebuild), takes its truck's current trailer when none is given.
--   - Edit trip (owners, admins) can correct it; changing the truck on a
--     loaded trip moves the trailer to the new truck's (/api/trips/[id]).
--
-- Trips that loaded before this have no trailer recorded and keep none:
-- with trailers moving between trucks, the truck's trailer today would be
-- a guess. Only the demo company's trips are filled in.
--
-- trip_board gains trailer_reg, and the route's origin and destination for
-- the printed reports' "From -> To", as its last columns.

alter table public.trips
  add column trailer_reg text;

comment on column public.trips.trailer_reg is
  'Trailer plate on this trip, recorded when it starts loading (the truck''s current trailer unless changed). Null for trips loaded before 2026-11-26.';

create or replace function public.trips_capture_trailer()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.trailer_reg is null and new.truck_id is not null and (
       (tg_op = 'INSERT' and new.actual_load_date is not null)
    or (tg_op = 'UPDATE' and new.status = 'loading' and old.status is distinct from 'loading')
  ) then
    select tk.trailer_reg into new.trailer_reg
      from trucks tk
     where tk.id = new.truck_id and tk.org_id = new.org_id;
  end if;
  return new;
end;
$function$;

revoke execute on function public.trips_capture_trailer() from public, anon, authenticated;
grant execute on function public.trips_capture_trailer() to service_role;

create trigger trips_capture_trailer
  before insert or update of status on public.trips
  for each row execute function public.trips_capture_trailer();

-- The demo company's trips are fictional; give them their trucks' trailers.
update public.trips t
   set trailer_reg = tk.trailer_reg
  from public.trucks tk, public.organizations o
 where tk.id = t.truck_id
   and o.id = t.org_id
   and o.trip_prefix = 'DEMO'
   and t.org_id = 'd3e00000-0000-4000-a000-000000000001'
   and t.actual_load_date is not null
   and t.trailer_reg is null;

-- trip_board as in 20261114140000_load_date_on_loading.sql, with
-- trailer_reg, origin and destination added as the last columns (CREATE
-- OR REPLACE VIEW can only add at the end). security_invoker restated:
-- CREATE OR REPLACE VIEW replaces the view's options with whatever it's
-- given; its grants (no anon select) carry over.
create or replace view "public"."trip_board" with (security_invoker=on) AS  SELECT t.id AS trip_id,
    t.org_id,
    t.trip_no,
    t.status,
    c.name AS customer,
    r.name AS route,
    COALESCE(t.borders, r.borders) AS borders,
    r.target_days,
    tk.fleet_no,
    tk.horse_reg,
    d.full_name AS driver,
    t.commodity,
    t.tonnage,
    t.container_no,
    t.actual_load_date,
    t.planned_eta,
    t.actual_delivery_at,
    t.pod_received_at,
    span.days AS days_running,
    (span.days > r.target_days) AS over_target,
    t.revenue_amount AS revenue_usd,
    COALESCE(cost.total, (0)::numeric) AS cost_usd,
    (t.revenue_amount - COALESCE(cost.total, (0)::numeric)) AS margin_usd,
        CASE
            WHEN (t.revenue_amount > (0)::numeric) THEN round((((t.revenue_amount - COALESCE(cost.total, (0)::numeric)) / t.revenue_amount) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS margin_pct,
    COALESCE(cost.entries, (0)::bigint) AS cost_entries,
    COALESCE(doc.pending, (0)::bigint) AS docs_pending,
    COALESCE(doc.pod_in, false) AS pod_in_hand,
    ( SELECT te.location
           FROM public.trip_events te
          WHERE ((te.trip_id = t.id) AND (te.event_type ~~ 'border%'::text))
          ORDER BY te.occurred_at DESC
         LIMIT 1) AS last_border,
    ( SELECT te.occurred_at
           FROM public.trip_events te
          WHERE ((te.trip_id = t.id) AND (te.event_type ~~ 'border%'::text))
          ORDER BY te.occurred_at DESC
         LIMIT 1) AS last_border_at,
    tk.id AS truck_id,
    t.customer_id,
    t.route_id,
    t.driver_id,
    t.seal_no,
    t.agent_name,
    t.volume_cbm,
    t.planned_load_date,
    t.trailer_reg,
    r.origin,
    r.destination
   FROM ((((((((public.trips t
     JOIN public.customers c ON ((c.id = t.customer_id)))
     JOIN public.routes r ON ((r.id = t.route_id)))
     LEFT JOIN public.organizations o ON ((o.id = t.org_id)))
     LEFT JOIN public.trucks tk ON ((tk.id = t.truck_id)))
     LEFT JOIN public.drivers d ON ((d.id = t.driver_id)))
     -- NULL until the trip starts loading; NULL > target_days is NULL too.
     LEFT JOIN LATERAL ( SELECT (((COALESCE(t.actual_delivery_at, now()) AT TIME ZONE COALESCE(o.time_zone, 'UTC'::text)))::date - t.actual_load_date) AS days) span ON (true))
     LEFT JOIN LATERAL ( SELECT sum(tc.amount_usd) AS total,
            count(*) AS entries
           FROM public.trip_costs tc
          WHERE (tc.trip_id = t.id)) cost ON (true))
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE (td.status = 'pending'::public.doc_status)) AS pending,
            bool_or(((td.doc_type = 'pod'::public.doc_type) AND (td.status = 'received'::public.doc_status))) AS pod_in
           FROM public.trip_documents td
          WHERE (td.trip_id = t.id)) doc ON (true))
  WHERE (t.status <> 'cancelled'::public.trip_status);
