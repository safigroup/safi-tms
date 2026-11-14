-- Days running (and so the "late" flag) counted calendar days in UTC: a
-- trip's delivered date was actual_delivery_at::date and "today" was
-- CURRENT_DATE, both read on the database's clock. For a company two or
-- three hours ahead of UTC, a delivery between midnight and 02:00/03:00
-- local time counted toward the day before, and a running trip only moved
-- on to its next day two or three hours into the local morning.
--
-- Each organization now has its own time zone, and trip_board counts days
-- in it. Existing organizations get the zone of their country where it's
-- one we know; anything else stays on UTC (exactly as before) until a
-- platform admin sets it on the Organizations page.

alter table public.organizations
  add column time_zone text not null default 'UTC';

comment on column public.organizations.time_zone is
  'IANA time zone (e.g. Africa/Lusaka) the organization''s calendar days are counted in: days running and the late flag on trip_board.';

update public.organizations o
   set time_zone = z.tz
  from (values
    ('Africa/Lusaka',        array['ZM', 'ZAMBIA']),
    -- DR Congo spans two zones; the trucking corridors run through the
    -- east (Lubumbashi, Kolwezi), not Kinshasa.
    ('Africa/Lubumbashi',    array['CD', 'DRC', 'DR CONGO', 'CONGO DRC', 'CONGO (DRC)', 'DEMOCRATIC REPUBLIC OF THE CONGO', 'DEMOCRATIC REPUBLIC OF CONGO']),
    ('Africa/Dar_es_Salaam', array['TZ', 'TANZANIA']),
    ('Africa/Nairobi',       array['KE', 'KENYA']),
    ('Africa/Kampala',       array['UG', 'UGANDA']),
    ('Africa/Kigali',        array['RW', 'RWANDA']),
    ('Africa/Bujumbura',     array['BI', 'BURUNDI']),
    ('Africa/Blantyre',      array['MW', 'MALAWI']),
    ('Africa/Maputo',        array['MZ', 'MOZAMBIQUE']),
    ('Africa/Harare',        array['ZW', 'ZIMBABWE']),
    ('Africa/Gaborone',      array['BW', 'BOTSWANA']),
    ('Africa/Johannesburg',  array['ZA', 'SOUTH AFRICA']),
    ('Africa/Windhoek',      array['NA', 'NAMIBIA']),
    ('Africa/Luanda',        array['AO', 'ANGOLA']),
    ('Africa/Juba',          array['SS', 'SOUTH SUDAN']),
    ('Africa/Addis_Ababa',   array['ET', 'ETHIOPIA'])
  ) as z(tz, countries)
 where upper(trim(o.country)) = any (z.countries);

do $$ declare r record; begin
  for r in select name, country, time_zone from public.organizations order by name loop
    raise notice '% (%): %', r.name, r.country, r.time_zone;
  end loop;
end $$;

-- A name Postgres doesn't know would make trip_board fail for every trip
-- of that organization, so refuse it at the door.
create or replace function public.check_org_time_zone()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    raise exception 'unknown time zone "%"', new.time_zone using errcode = '22023';
  end if;
  return new;
end;
$function$;

revoke execute on function public.check_org_time_zone() from public, anon, authenticated;
grant execute on function public.check_org_time_zone() to service_role;

create trigger organizations_time_zone_check
  before insert or update of time_zone on public.organizations
  for each row execute function public.check_org_time_zone();

-- trip_board as it stood in 20260907171045_truck_type_and_volume.sql, with
-- days counted in the organization's time zone: the local date it was
-- delivered (or today's local date while it's still running) minus the
-- load date, which people already enter as a local date. Same columns,
-- same types, same order. security_invoker has to be restated: CREATE OR
-- REPLACE VIEW replaces the view's options with whatever it's given.
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
    t.volume_cbm
   FROM ((((((((public.trips t
     JOIN public.customers c ON ((c.id = t.customer_id)))
     JOIN public.routes r ON ((r.id = t.route_id)))
     LEFT JOIN public.organizations o ON ((o.id = t.org_id)))
     LEFT JOIN public.trucks tk ON ((tk.id = t.truck_id)))
     LEFT JOIN public.drivers d ON ((d.id = t.driver_id)))
     -- NULL until the trip has a load date; NULL > target_days is NULL too,
     -- which is what over_target has always been without a load date or a
     -- target.
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
