-- Truck type classification (flatbed/tanker/tipper/other) for reporting,
-- and a cargo volume field on trips mirroring the existing tonnage column
-- -- together these let a rate card price by cubic metre (tankers/tippers)
-- as well as by tonne. A plain constrained text column, not a Postgres
-- enum, so adding a type later never risks the enum-value-in-a-transaction
-- pitfall this codebase has hit before with real enums.
alter table public.trucks add column truck_type text not null default 'flatbed';
alter table public.trucks add constraint trucks_truck_type_check
  check (truck_type in ('flatbed', 'tanker', 'tipper', 'other'));

alter table public.trips add column volume_cbm numeric(10,3);

-- create_trip() gains a 16th param (p_volume_cbm). Its arg count is
-- changing, so CREATE OR REPLACE alone would create a second overload
-- instead of replacing it -- drop the old 15-arg signature first, same
-- pitfall as every prior parameter addition here (p_borders, p_agent_name).
drop function if exists public.create_trip(
  uuid, uuid, uuid, numeric, uuid, uuid, text, numeric, text, text, date, date, uuid, text[], text
);

create or replace function public.create_trip(
  p_org uuid,
  p_customer uuid,
  p_route uuid,
  p_revenue numeric,
  p_truck uuid default null,
  p_driver uuid default null,
  p_commodity text default null,
  p_tonnage numeric default null,
  p_container_no text default null,
  p_seal_no text default null,
  p_load_date date default null,
  p_eta date default null,
  p_user uuid default null,
  p_borders text[] default null,
  p_agent_name text default null,
  p_volume_cbm numeric default null
)
returns table (id uuid, trip_no text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_trip_no text;
  v_status trip_status;
  v_id uuid;
  y int := extract(year from current_date);
  n int;
  prefix text;
begin
  if not exists (select 1 from organizations o where o.id = p_org) then
    raise exception 'organisation not found';
  end if;

  if not exists (select 1 from customers c where c.id = p_customer and c.org_id = p_org) then
    raise exception 'customer does not belong to this organisation';
  end if;

  if not exists (select 1 from routes r where r.id = p_route and r.org_id = p_org) then
    raise exception 'route does not belong to this organisation';
  end if;

  if p_truck is not null and not exists (select 1 from trucks tk where tk.id = p_truck and tk.org_id = p_org) then
    raise exception 'truck does not belong to this organisation';
  end if;

  if p_driver is not null and not exists (select 1 from drivers d where d.id = p_driver and d.org_id = p_org) then
    raise exception 'driver does not belong to this organisation';
  end if;

  if p_revenue is null or p_revenue <= 0 then
    raise exception 'revenue must be a positive amount';
  end if;

  select o.trip_prefix into prefix from organizations o where o.id = p_org;
  insert into trip_counters (org_id, year, last_no)
  values (p_org, y, 1)
  on conflict (org_id, year) do update set last_no = trip_counters.last_no + 1
  returning last_no into n;
  v_trip_no := format('%s-%s-%s', prefix, y, lpad(n::text, 4, '0'));

  v_status := case when p_truck is not null and p_driver is not null then 'allocated' else 'draft' end;

  insert into trips (
    org_id, trip_no, status, customer_id, route_id, truck_id, driver_id,
    commodity, tonnage, container_no, seal_no,
    revenue_amount, revenue_currency,
    planned_load_date, actual_load_date, planned_eta, created_by, borders, agent_name, volume_cbm
  ) values (
    p_org, v_trip_no, v_status, p_customer, p_route, p_truck, p_driver,
    p_commodity, p_tonnage, p_container_no, p_seal_no,
    p_revenue, 'USD',
    p_load_date, p_load_date, p_eta, p_user, p_borders, p_agent_name, p_volume_cbm
  ) returning trips.id into v_id;

  insert into trip_documents (org_id, trip_id, doc_type, status)
  select p_org, v_id, d, 'pending'
  from unnest(array['consignment_note','packing_list','t1_transit','pod']::doc_type[]) as d;

  return query select v_id, v_trip_no;
end;
$function$;

-- Expose volume_cbm on trip_board too, same append-only pattern as every
-- prior column addition (seal_no, agent_name, etc.) -- everything else
-- identical to the view as it stood in 20260903030644_trip_agent_name.sql.
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
        CASE
            WHEN (t.actual_load_date IS NOT NULL) THEN (COALESCE((t.actual_delivery_at)::date, CURRENT_DATE) - t.actual_load_date)
            ELSE NULL::integer
        END AS days_running,
        CASE
            WHEN ((t.actual_load_date IS NOT NULL) AND (r.target_days IS NOT NULL)) THEN ((COALESCE((t.actual_delivery_at)::date, CURRENT_DATE) - t.actual_load_date) > r.target_days)
            ELSE NULL::boolean
        END AS over_target,
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
   FROM ((((((public.trips t
     JOIN public.customers c ON ((c.id = t.customer_id)))
     JOIN public.routes r ON ((r.id = t.route_id)))
     LEFT JOIN public.trucks tk ON ((tk.id = t.truck_id)))
     LEFT JOIN public.drivers d ON ((d.id = t.driver_id)))
     LEFT JOIN LATERAL ( SELECT sum(tc.amount_usd) AS total,
            count(*) AS entries
           FROM public.trip_costs tc
          WHERE (tc.trip_id = t.id)) cost ON (true))
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE (td.status = 'pending'::public.doc_status)) AS pending,
            bool_or(((td.doc_type = 'pod'::public.doc_type) AND (td.status = 'received'::public.doc_status))) AS pod_in
           FROM public.trip_documents td
          WHERE (td.trip_id = t.id)) doc ON (true))
  WHERE (t.status <> 'cancelled'::public.trip_status);
