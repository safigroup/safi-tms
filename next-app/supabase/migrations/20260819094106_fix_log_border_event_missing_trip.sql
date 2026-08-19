-- Fixes a real bug caught by testing the previous migration on staging:
-- log_border_event never checked whether p_trip actually exists. The
-- original auth.uid()-based check got away with this because
-- `not exists (... where org_id = v_org ...)` correctly treats a NULL
-- v_org (trip not found) as "no match, reject". The new `v_org <> p_org`
-- comparison added in 20260819093255 does NOT have that property — SQL's
-- three-valued logic makes `NULL <> anything` evaluate to NULL, which a
-- PL/pgSQL `IF` treats as false, so a nonexistent trip silently passed the
-- check and fell through to a confusing NOT NULL constraint violation on
-- trip_events.org_id instead of a clean rejection.

create or replace function public.log_border_event (
  p_trip     uuid,
  p_kind     text,
  p_location text,
  p_detail   jsonb default '{}'::jsonb,
  p_org      uuid default null,
  p_user     uuid default null
)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
  AS $function$
declare v_org uuid;
begin
  select org_id into v_org from trips where id = p_trip;
  if v_org is null then
    raise exception 'trip not found';
  end if;

  if p_org is not null then
    if v_org <> p_org then
      raise exception 'not authorized for this organisation';
    end if;
  else
    if not exists (select 1 from memberships
                   where org_id = v_org and user_id = auth.uid()) then
      raise exception 'not a member of this organisation';
    end if;
  end if;

  if p_kind not in ('arrival','cleared') then
    raise exception 'kind must be arrival or cleared';
  end if;

  perform set_config('app.acting_user_id', coalesce(p_user::text, ''), true);

  insert into trip_events (org_id, trip_id, event_type, location, detail, recorded_by)
  values (v_org, p_trip, 'border_' || p_kind, p_location, p_detail, coalesce(auth.uid(), p_user));

  update trips
     set status = case when p_kind = 'arrival' then 'at_border'::trip_status
                       else 'in_transit'::trip_status end
   where id = p_trip
     and status in ('in_transit','at_border');
end $function$;
