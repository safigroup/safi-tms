-- Correcting a trip's milestone times after the fact: the load date,
-- loading started, departed, each border arrival/clearance, delivered and
-- POD received. Buttons on the Board record "now", which is wrong whenever
-- someone logs a step late or forgets it, and those times drive days
-- running, border waits, the POD-overdue warning and the revenue month.
--
-- The API route (app/api/trips/[id]/times) works out what changes and
-- checks the order; this applies it all in one transaction so a trip is
-- never left half-corrected, and writes the audit trail with it.
--
-- p_changes:
--   trip:   { actual_load_date?, actual_delivery_at?, pod_received_at?, pod_received_on? }
--   events: [{ id, at }]                     -- move an existing history entry
--   add:    [{ kind, location, at }]          -- a border crossing never logged
--   audit:  [{ field, old, new }]             -- one audit_log row per milestone
--
-- A border arrival or clearance is logged together with the status change
-- it causes (at_border / back to in_transit), in the same transaction and
-- so with the same created_at. That status change moves with it, or the
-- history would show it as a separate step at the old time.

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

revoke execute on function public.correct_trip_times(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.correct_trip_times(uuid, uuid, uuid, jsonb) to service_role;
