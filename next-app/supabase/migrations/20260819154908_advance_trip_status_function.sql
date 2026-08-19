-- Ports advance() (index.html) -- a plain `.from("trips").update({status})`
-- there, which never validated the transition server-side (the NEXT map
-- was purely client-side, controlling which buttons rendered).
--
-- This has to be a function, not a plain table update from the route
-- handler, for the same reason log_border_event/raise_invoice/
-- cancel_invoice already are: trg_trip_status (BEFORE UPDATE on trips)
-- reads app.acting_user_id via set_config to attribute the change in
-- trip_events, and set_config(..., true) is transaction-local -- it can't
-- be set by one PostgREST call and read by a separate one.

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
    else false
  end;

  if not v_allowed then
    raise exception 'cannot move a trip from % to %', v_current, p_status;
  end if;

  perform set_config('app.acting_user_id', coalesce(p_user::text, ''), true);

  update trips
     set status = p_status,
         actual_delivery_at = case when p_status = 'delivered' then now() else actual_delivery_at end,
         closed_at = case when p_status = 'closed' then now() else closed_at end
   where id = p_trip and org_id = p_org;
end;
$function$;

grant execute on function public.advance_trip_status(uuid, uuid, trip_status, uuid) to service_role;
