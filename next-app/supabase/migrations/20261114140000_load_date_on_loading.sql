-- A trip's actual load date is set when it starts loading, not when it's
-- created. create_trip used to copy the New trip form's date into both
-- planned_load_date and actual_load_date, and "Start loading" never
-- touched it, so a trip booked ahead either carried the day it was keyed
-- in (days running and Late counted from before it loaded) or a future
-- date (the Board showed "day -5"). Days running, Late, the revenue month
-- and the truck reports all count from actual_load_date.
--
-- Now:
--   - create_trip stores the form's date as planned_load_date only;
--   - advance_trip_status sets actual_load_date to the company's today
--     (org_today) when the trip moves to loading;
--   - correct_trip_times can also correct planned_load_date (Edit times
--     shows the planned date until the trip starts loading);
--   - trip_board gains planned_load_date, as its last column.
--
-- Trips not yet loading (draft, allocated) had only ever used
-- actual_load_date as their planned date -- Edit times labelled it
-- "Planned" before loading. That date moves to planned_load_date and
-- actual_load_date is cleared, so nothing is lost and those trips count
-- from the day they actually start loading, like new ones.

do $$
declare n int;
begin
  update public.trips
     set planned_load_date = coalesce(actual_load_date, planned_load_date),
         actual_load_date = null
   where status in ('draft', 'allocated')
     and actual_load_date is not null;
  get diagnostics n = row_count;
  raise notice 'trips not yet loading: % moved their load date to the planned date', n;
end $$;

-- As in 20260907171045_truck_type_and_volume.sql, except actual_load_date
-- is left empty. Same signature, so its grants (service_role only, see
-- 20261113130000) carry over. The year in the trip number is still the
-- UTC year, as before.
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
    planned_load_date, planned_eta, created_by, borders, agent_name, volume_cbm
  ) values (
    p_org, v_trip_no, v_status, p_customer, p_route, p_truck, p_driver,
    p_commodity, p_tonnage, p_container_no, p_seal_no,
    p_revenue, 'USD',
    p_load_date, p_eta, p_user, p_borders, p_agent_name, p_volume_cbm
  ) returning trips.id into v_id;

  insert into trip_documents (org_id, trip_id, doc_type, status)
  select p_org, v_id, d, 'pending'
  from unnest(array['consignment_note','packing_list','t1_transit','pod']::doc_type[]) as d;

  return query select v_id, v_trip_no;
end;
$function$;

-- As in 20261114130000_allocate_trip.sql, plus: moving to loading sets
-- the actual load date to the company's today.
create or replace function public.advance_trip_status(
  p_trip uuid,
  p_org uuid,
  p_status trip_status,
  p_user uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current trip_status;
  v_allowed boolean;
begin
  select t.status into v_current from trips t where t.id = p_trip and t.org_id = p_org;
  if v_current is null then
    raise exception 'trip not found';
  end if;

  v_allowed := case v_current
    when 'draft' then p_status = 'allocated'
    when 'allocated' then p_status = 'loading'
    when 'loading' then p_status = 'in_transit'
    when 'in_transit' then p_status = 'delivered'
    when 'pod_received' then p_status = 'invoiced'
    when 'invoiced' then p_status = 'closed'
    when 'closed' then p_status = 'invoiced'
    else false
  end;

  if not v_allowed then
    raise exception 'cannot move a trip from % to %', v_current, p_status;
  end if;

  if p_status = 'allocated' and exists (
    select 1 from trips t where t.id = p_trip and (t.truck_id is null or t.driver_id is null)
  ) then
    raise exception 'choose a truck and driver to allocate the trip';
  end if;

  perform set_config('app.acting_user_id', coalesce(p_user::text, ''), true);

  update trips
     set status = p_status,
         actual_load_date = case when p_status = 'loading' then public.org_today(p_org) else actual_load_date end,
         actual_delivery_at = case when p_status = 'delivered' then now() else actual_delivery_at end,
         closed_at = case
           when p_status = 'closed' then now()
           when v_current = 'closed' then null
           else closed_at
         end
   where id = p_trip and org_id = p_org;
end;
$function$;

-- As in 20261113100000_correct_trip_times.sql, plus planned_load_date.
-- p_changes.trip: { planned_load_date?, actual_load_date?, actual_delivery_at?,
--                   pod_received_at?, pod_received_on? }
create or replace function public.correct_trip_times(
  p_trip uuid,
  p_org uuid,
  p_user uuid,
  p_changes jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_trip_changes jsonb := coalesce(p_changes->'trip', '{}'::jsonb);
  v_item jsonb;
  v_event trip_events%rowtype;
  v_at timestamptz;
begin
  perform 1 from trips t where t.id = p_trip and t.org_id = p_org for update;
  if not found then
    raise exception 'trip not found';
  end if;

  perform set_config('app.acting_user_id', coalesce(p_user::text, ''), true);

  if v_trip_changes ? 'planned_load_date' then
    update trips set planned_load_date = (v_trip_changes->>'planned_load_date')::date
     where id = p_trip;
  end if;

  if v_trip_changes ? 'actual_load_date' then
    update trips set actual_load_date = (v_trip_changes->>'actual_load_date')::date
     where id = p_trip;
  end if;

  if v_trip_changes ? 'actual_delivery_at' then
    update trips set actual_delivery_at = (v_trip_changes->>'actual_delivery_at')::timestamptz
     where id = p_trip;
  end if;

  if v_trip_changes ? 'pod_received_at' then
    update trips set pod_received_at = (v_trip_changes->>'pod_received_at')::timestamptz
     where id = p_trip;
    -- The docket shows the date the POD came in on the document itself.
    if v_trip_changes ? 'pod_received_on' then
      update trip_documents
         set received_on = (v_trip_changes->>'pod_received_on')::date
       where trip_id = p_trip and org_id = p_org and doc_type = 'pod' and status = 'received';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_changes->'events', '[]'::jsonb)) loop
    select * into v_event from trip_events e
     where e.id = (v_item->>'id')::uuid and e.trip_id = p_trip and e.org_id = p_org
       for update;
    if not found then
      raise exception 'history entry not found on this trip';
    end if;
    v_at := (v_item->>'at')::timestamptz;

    update trip_events
       set occurred_at = v_at,
           -- Keep the very first recorded time, however many corrections follow.
           detail = coalesce(detail, '{}'::jsonb)
                    || jsonb_build_object('corrected_by', p_user, 'corrected_at', now())
                    || case when coalesce(detail, '{}'::jsonb) ? 'original_at' then '{}'::jsonb
                            else jsonb_build_object('original_at', v_event.occurred_at) end
     where id = v_event.id;

    if v_event.event_type in ('border_arrival', 'border_cleared') then
      update trip_events s
         set occurred_at = v_at
       where s.trip_id = p_trip
         and s.event_type = 'status_change'
         and s.created_at = v_event.created_at
         and ((v_event.event_type = 'border_arrival' and s.to_status = 'at_border')
           or (v_event.event_type = 'border_cleared' and s.from_status = 'at_border' and s.to_status = 'in_transit'));
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_changes->'add', '[]'::jsonb)) loop
    if v_item->>'kind' not in ('arrival', 'cleared') or coalesce(v_item->>'location', '') = '' then
      raise exception 'a border crossing needs a kind (arrival or cleared) and a location';
    end if;
    insert into trip_events (org_id, trip_id, event_type, location, occurred_at, detail, recorded_by)
    values (p_org, p_trip, 'border_' || (v_item->>'kind'), v_item->>'location', (v_item->>'at')::timestamptz,
            jsonb_build_object('added_later', true), p_user);
  end loop;

  insert into audit_log (org_id, table_name, record_id, field, old_value, new_value, edited_by)
  select p_org, 'trips', p_trip, a->>'field', a->>'old', a->>'new', p_user
    from jsonb_array_elements(coalesce(p_changes->'audit', '[]'::jsonb)) a;
end;
$function$;

-- trip_board as in 20261114100000_org_time_zone.sql, with planned_load_date
-- added as the last column (CREATE OR REPLACE VIEW can only add at the
-- end). security_invoker restated: CREATE OR REPLACE VIEW replaces the
-- view's options with whatever it's given.
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
    t.planned_load_date
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
