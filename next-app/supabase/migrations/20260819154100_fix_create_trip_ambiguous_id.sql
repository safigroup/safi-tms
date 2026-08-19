-- Fixes a bug caught by testing on staging: `returns table (id uuid, ...)`
-- declares `id` as a PL/pgSQL variable in scope for the whole function
-- body, which collided with every bare `id` column reference in the
-- existence checks below ("column reference id is ambiguous"). Qualifies
-- every one with its table name.

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
  p_user uuid default null
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
    planned_load_date, actual_load_date, planned_eta, created_by
  ) values (
    p_org, v_trip_no, v_status, p_customer, p_route, p_truck, p_driver,
    p_commodity, p_tonnage, p_container_no, p_seal_no,
    p_revenue, 'USD',
    p_load_date, p_load_date, p_eta, p_user
  ) returning trips.id into v_id;

  insert into trip_documents (org_id, trip_id, doc_type, status)
  select p_org, v_id, d, 'pending'
  from unnest(array['consignment_note','packing_list','t1_transit','pod']::doc_type[]) as d;

  return query select v_id, v_trip_no;
end;
$function$;
