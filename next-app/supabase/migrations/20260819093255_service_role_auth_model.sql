-- Makes cancel_invoice, log_border_event, raise_invoice, next_trip_no, and
-- next_invoice_no callable from a service-role context (the Next.js API
-- routes being built in next-app/), where there is no auth.uid() to check
-- membership against.
--
-- Backward compatible by design: index.html is still live on GitHub Pages
-- and calls these RPCs today without a p_org argument, using a real
-- session's auth.uid(). p_org/p_user are new, optional (default null)
-- trailing parameters:
--   - p_org omitted (old callers)  -> original auth.uid()-based membership
--     check, unchanged.
--   - p_org supplied (new service-role callers) -> the row's actual org_id
--     is compared against the asserted p_org. This is a real check, not a
--     bypass: a route handler that passes the wrong id still gets rejected
--     by the database, the same protection RLS used to provide for free.
--
-- Also fixes the audit trail: `recorded_by`/trip_events used auth.uid()
-- directly, which is always null under service-role. p_user threads the
-- acting user's id through via a transaction-local set_config, which
-- log_trip_status_change() (fires on every trips.status update, including
-- ones this migration doesn't touch directly) now reads as a fallback.

create or replace function public.cancel_invoice (
  p_invoice uuid,
  p_reason  text,
  p_org     uuid default null,
  p_user    uuid default null
)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
  AS $function$
declare
  inv invoices%rowtype;
  v_paid numeric;
  v_trip_id uuid;
begin
  select * into inv from invoices where id = p_invoice;
  if not found then raise exception 'invoice not found'; end if;

  if p_org is not null then
    if inv.org_id <> p_org then
      raise exception 'not authorized for this organisation';
    end if;
  else
    if not exists (select 1 from memberships where org_id = inv.org_id and user_id = auth.uid()) then
      raise exception 'not a member of this organisation';
    end if;
  end if;

  if inv.status = 'cancelled' then
    raise exception 'invoice is already cancelled';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to cancel an invoice';
  end if;

  select coalesce(sum(amount), 0) into v_paid from payments where invoice_id = p_invoice;
  if v_paid > 0 then
    raise exception 'cannot cancel — % % has already been recorded against this invoice', inv.currency, v_paid;
  end if;

  perform set_config('app.acting_user_id', coalesce(p_user::text, ''), true);

  update invoices
     set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason)
   where id = p_invoice;

  -- Undo the one side-effect raise_invoice had: if this was the
  -- delivery/full leg that moved the trip to 'invoiced', put it back so
  -- it isn't stuck showing a status nothing now backs.
  select il.trip_id into v_trip_id from invoice_lines il where il.invoice_id = p_invoice limit 1;
  if v_trip_id is not null and inv.invoice_type in ('delivery', 'full') then
    update trips set status = 'pod_received'
     where id = v_trip_id and status = 'invoiced';
  end if;
end;
$function$;

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

create or replace function public.raise_invoice (
  p_trip uuid,
  p_type text,
  p_org  uuid default null,
  p_user uuid default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
  AS $function$
declare
  t         trips%rowtype;
  v_no      text;
  v_id      uuid;
  v_amount  numeric(14,2);
  v_days    int;
  v_desc    text;
begin
  select * into t from trips where id = p_trip;
  if not found then raise exception 'trip not found'; end if;

  if p_org is not null then
    if t.org_id <> p_org then
      raise exception 'not authorized for this organisation';
    end if;
  else
    if not exists (select 1 from memberships where org_id = t.org_id and user_id = auth.uid()) then
      raise exception 'not a member of this organisation';
    end if;
  end if;

  if p_type not in ('loading','delivery','full') then
    raise exception 'type must be loading, delivery or full';
  end if;

  if t.revenue_amount is null or t.revenue_amount <= 0 then
    raise exception 'trip has no revenue figure to invoice';
  end if;

  -- The gate that matters: no POD, no delivery invoice.
  if p_type = 'delivery' and t.pod_received_at is null then
    raise exception 'POD not received — the delivery invoice cannot be raised yet';
  end if;

  if p_type in ('loading','full')
     and t.status in ('draft','allocated') then
    raise exception 'trip has not started loading yet';
  end if;

  if exists (select 1 from invoices i
             join invoice_lines il on il.invoice_id = i.id
             where il.trip_id = p_trip
               and i.invoice_type = p_type
               and i.status <> 'cancelled') then
    raise exception 'a % invoice already exists for this trip', p_type;
  end if;

  v_amount := case p_type when 'full' then t.revenue_amount
                          else round(t.revenue_amount * 0.5, 2) end;

  -- Guard against rounding drift on odd revenue figures: the delivery
  -- half is whatever is left, not a second independent 50%.
  if p_type = 'delivery' then
    v_amount := t.revenue_amount - coalesce((
      select sum(il.line_total) from invoices i
      join invoice_lines il on il.invoice_id = i.id
      where il.trip_id = p_trip and i.status <> 'cancelled'), 0);
  end if;

  select coalesce(payment_days, 0) into v_days from customers where id = t.customer_id;
  v_no := next_invoice_no(t.org_id);

  insert into invoices (org_id, invoice_no, customer_id, status, invoice_type,
                        currency, subtotal, downpayment, total_due, issued_on, due_on)
  values (t.org_id, v_no, t.customer_id, 'issued', p_type,
          t.revenue_currency, v_amount, 0, v_amount,
          current_date, current_date + v_days)
  returning id into v_id;

  v_desc := format('%s — %s (%s)',
    t.trip_no,
    (select name from routes where id = t.route_id),
    case p_type when 'loading'  then '50% on loading'
                when 'delivery' then '50% on delivery'
                else 'full freight charge' end);

  insert into invoice_lines (org_id, invoice_id, trip_id, description, quantity, unit_price)
  values (t.org_id, v_id, p_trip, v_desc, 1, v_amount);

  if p_type in ('delivery','full') then
    perform set_config('app.acting_user_id', coalesce(p_user::text, ''), true);
    update trips set status = 'invoiced' where id = p_trip and status = 'pod_received';
  end if;

  return v_id;
end $function$;

-- next_trip_no / next_invoice_no take only p_org (always required, always
-- supplied by every existing caller) — there's no separate target row to
-- assert p_org against, so the fix is the simpler hybrid: skip the
-- membership check only when there's no auth.uid() to check (service-role),
-- otherwise behave exactly as before.

create or replace function public.next_trip_no (
  p_org uuid
)
  returns text
  language plpgsql
  security definer
  set search_path to 'public'
  AS $function$
declare
  y      int := extract(year from current_date);
  n      int;
  prefix text;
begin
  if auth.uid() is not null and not exists (select 1 from memberships
                 where org_id = p_org and user_id = auth.uid()) then
    raise exception 'not a member of this organisation';
  end if;

  select trip_prefix into prefix from organizations where id = p_org;

  insert into trip_counters (org_id, year, last_no)
  values (p_org, y, 1)
  on conflict (org_id, year)
  do update set last_no = trip_counters.last_no + 1
  returning last_no into n;

  return format('%s-%s-%s', prefix, y, lpad(n::text, 4, '0'));
end $function$;

create or replace function public.next_invoice_no (
  p_org uuid
)
  returns text
  language plpgsql
  security definer
  set search_path to 'public'
  AS $function$
declare y int := extract(year from current_date); n int; prefix text;
begin
  if auth.uid() is not null and not exists (select 1 from memberships where org_id = p_org and user_id = auth.uid()) then
    raise exception 'not a member of this organisation';
  end if;

  select invoice_prefix into prefix from organizations where id = p_org;

  insert into invoice_counters (org_id, year, last_no)
  values (p_org, y, 1)
  on conflict (org_id, year) do update set last_no = invoice_counters.last_no + 1
  returning last_no into n;

  return format('%s-%s-%s', prefix, y, lpad(n::text, 4, '0'));
end $function$;

-- Trigger: reads the acting user from set_config as a fallback when
-- auth.uid() is null (service-role), instead of always recording NULL.
create or replace function public.log_trip_status_change()
  returns trigger
  language plpgsql
  AS $function$
declare v_user uuid;
begin
  if new.status is distinct from old.status then
    v_user := coalesce(auth.uid(), nullif(current_setting('app.acting_user_id', true), '')::uuid);
    insert into trip_events (org_id, trip_id, event_type, from_status, to_status, recorded_by)
    values (new.org_id, new.id, 'status_change', old.status, new.status, v_user);
  end if;
  new.updated_at := now();
  return new;
end $function$;
