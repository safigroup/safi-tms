-- "Allocate truck" used to move a draft trip to allocated without asking
-- which truck. The status changed but truck_id stayed empty, so the trip's
-- costs never reached any truck's report, and ops (who can't edit a trip
-- after creating it) had no way to add one.
--
-- Allocation now takes the truck and driver in the same step, and a trip
-- can't become allocated without both -- the rule create_trip already
-- applies when a trip is created with them.

-- Same as 20260930163248_reopen_closed_trips.sql, plus the truck and
-- driver check on draft -> allocated. Same signature, so its grants
-- (service_role only, see 20261113130000) carry over.
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
         actual_delivery_at = case when p_status = 'delivered' then now() else actual_delivery_at end,
         closed_at = case
           when p_status = 'closed' then now()
           when v_current = 'closed' then null
           else closed_at
         end
   where id = p_trip and org_id = p_org;
end;
$function$;

-- Sets a draft trip's truck and driver and moves it to allocated, in one
-- transaction. The status change is logged by the trips trigger like any
-- other step.
create or replace function public.allocate_trip(
  p_trip uuid,
  p_org uuid,
  p_truck uuid,
  p_driver uuid,
  p_user uuid default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_status public.trip_status;
begin
  select t.status into v_status from public.trips t where t.id = p_trip and t.org_id = p_org for update;
  if v_status is null then
    raise exception 'trip not found';
  end if;
  if v_status <> 'draft' then
    raise exception 'only a draft trip can be allocated (this one is %)', v_status;
  end if;
  if p_truck is null or p_driver is null then
    raise exception 'choose a truck and driver to allocate the trip';
  end if;
  if not exists (select 1 from public.trucks tk where tk.id = p_truck and tk.org_id = p_org) then
    raise exception 'truck does not belong to this organisation';
  end if;
  if not exists (select 1 from public.drivers d where d.id = p_driver and d.org_id = p_org) then
    raise exception 'driver does not belong to this organisation';
  end if;

  update public.trips set truck_id = p_truck, driver_id = p_driver where id = p_trip and org_id = p_org;
  perform public.advance_trip_status(p_trip, p_org, 'allocated', p_user);
end;
$function$;

revoke execute on function public.allocate_trip(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.allocate_trip(uuid, uuid, uuid, uuid, uuid) to service_role;
