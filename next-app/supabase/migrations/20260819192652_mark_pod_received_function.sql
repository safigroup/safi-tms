-- Ports markPod() (index.html): two separate .update() calls (trip_documents
-- then trips) with independent error handling, not atomic. One transaction
-- here, and -- same reason as advance_trip_status -- has to be a function
-- rather than two plain table updates so set_config()-based audit
-- attribution reaches trg_trip_status on the trips update.
--
-- Deliberately does NOT add a status-transition guard the way
-- advance_trip_status does: the original button is enabled while status is
-- 'delivered', 'in_transit', OR 'at_border' (as long as a POD file is
-- already attached) -- POD can arrive before formal delivery is marked.
-- Matching that permissiveness, not tightening it.

create or replace function public.mark_pod_received(
  p_doc uuid,
  p_trip uuid,
  p_org uuid,
  p_user uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from trips t where t.id = p_trip and t.org_id = p_org) then
    raise exception 'trip not found';
  end if;

  if not exists (select 1 from trip_documents td where td.id = p_doc and td.trip_id = p_trip and td.org_id = p_org) then
    raise exception 'document not found on this trip';
  end if;

  perform set_config('app.acting_user_id', coalesce(p_user::text, ''), true);

  update trip_documents
     set status = 'received', received_on = current_date
   where id = p_doc;

  update trips
     set status = 'pod_received', pod_received_at = now()
   where id = p_trip;
end;
$function$;

grant execute on function public.mark_pod_received(uuid, uuid, uuid, uuid) to service_role;
