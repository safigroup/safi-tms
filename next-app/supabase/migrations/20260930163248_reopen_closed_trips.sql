-- Lets a closed trip be reopened to fix an expense that was missed or
-- entered wrong -- trip_costs has never had a status gate of its own
-- (only the Docket page's trip picker hides closed/cancelled trips), so
-- moving a trip back to invoiced is all that's needed to get it back
-- into the docket. Doesn't go all the way back to pod_received:
-- invoicing itself isn't affected by a cost correction.
--
-- Same signature as before (no DROP needed -- only the body changes).
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
