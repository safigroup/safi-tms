-- Lets an invoice be raised with an issue date other than today, and
-- fixes cancelling the last milestone's invoice leaving its trip stuck at
-- "invoiced".
--
-- 1. raise_invoice() takes an optional p_issued_on. Invoices raised late
--    (the work was done, the paperwork caught up days later) were stamped
--    with the day someone clicked Raise, and nothing could change it. The
--    due date follows the issue date (issued_on + the customer's payment
--    days), as before. Null still means the company's today.
--    The date may not be:
--      - later than the company's today;
--      - before the stage it bills: a milestone that requires POD can't be
--        dated before the POD was received (in the company's time zone),
--        and any other milestone can't be dated before loading started
--        (actual_load_date, when the trip has one). raise_invoice already
--        refuses to raise those milestones before then, so an invoice
--        dated earlier would claim something the system itself wouldn't
--        have allowed on that day. If the trip's own dates are wrong,
--        correct them first (Edit times on the trip).
--    Everything else is exactly as in 20261114120000_company_local_dates.sql.
--    Adding a parameter changes the argument count, so the old signature
--    is dropped first (CREATE OR REPLACE would leave a second overload and
--    a PGRST203 ambiguity at the API).
--
-- 2. cancel_invoice() put the trip back from "invoiced" to "pod_received"
--    only when invoice_type was 'delivery' or 'full'. Since
--    20260906140302_payment_milestones.sql, invoice_type holds the
--    milestone's label ("On delivery", ...), so that never matched and a
--    cancelled final invoice left its trip showing "invoiced" with nothing
--    behind it. It now reverts the trip whenever no live invoice for the
--    schedule's last milestone remains on the trip -- the same thing
--    raise_invoice() checks when it moves the trip to "invoiced" -- and
--    still honours the old 'delivery'/'full' types for invoices raised
--    before milestones existed. Everything else is exactly as in
--    20260819093255_service_role_auth_model.sql.

drop function if exists public.raise_invoice(uuid, int, uuid, uuid);

create or replace function public.raise_invoice (
  p_trip      uuid,
  p_seq       int,
  p_org       uuid default null,
  p_user      uuid default null,
  p_issued_on date default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
  AS $function$
declare
  t              trips%rowtype;
  v_no           text;
  v_id           uuid;
  v_desc         text;
  v_schedule_cid uuid;
  v_label        text;
  v_pct          numeric;
  v_requires_pod boolean;
  v_cum_pct      numeric;
  v_already      numeric;
  v_amount       numeric(14,2);
  v_max_seq      int;
  v_days         int;
  v_today        date;
  v_issued       date;
  v_pod_day      date;
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

  if t.revenue_amount is null or t.revenue_amount <= 0 then
    raise exception 'trip has no revenue figure to invoice';
  end if;

  -- Resolve once whether this customer has their own schedule (fully
  -- overrides the default) or falls back to it, and use this same resolved
  -- owner for every query below -- never per-row -- so a customer can't
  -- end up with fields mixed from both schedules.
  if exists (select 1 from payment_milestones where org_id = t.org_id and customer_id = t.customer_id) then
    v_schedule_cid := t.customer_id;
  else
    v_schedule_cid := null;
  end if;

  select label, pct, requires_pod
    into v_label, v_pct, v_requires_pod
    from payment_milestones
   where org_id = t.org_id
     and customer_id is not distinct from v_schedule_cid
     and seq = p_seq;

  if not found then
    raise exception 'no such payment milestone';
  end if;

  -- The only two gates that exist today, now applied per-milestone instead
  -- of hardcoded to the specific names "delivery"/"loading": a milestone
  -- flagged requires_pod stays locked until POD is in hand; every other
  -- milestone just needs the trip to have started.
  if v_requires_pod then
    if t.pod_received_at is null then
      raise exception 'POD not received — this milestone cannot be invoiced yet';
    end if;
  else
    if t.status in ('draft','allocated') then
      raise exception 'trip has not started loading yet';
    end if;
  end if;

  -- The issue date: today unless one was given, never in the future, and
  -- never before the stage this milestone bills (the gates just above,
  -- applied to the date instead of to today).
  v_today := org_today(t.org_id);
  v_issued := coalesce(p_issued_on, v_today);

  if v_issued > v_today then
    raise exception 'the issue date can''t be later than today (%)', v_today;
  end if;

  if v_requires_pod then
    select (t.pod_received_at at time zone o.time_zone)::date into v_pod_day
      from organizations o where o.id = t.org_id;
    if v_pod_day is not null and v_issued < v_pod_day then
      raise exception 'the POD was received on % — this invoice can''t be dated before that', v_pod_day;
    end if;
  elsif t.actual_load_date is not null and v_issued < t.actual_load_date then
    raise exception 'loading started on % — this invoice can''t be dated before that', t.actual_load_date;
  end if;

  -- Amount is the cumulative percent through this milestone minus whatever
  -- has already been invoiced for the trip -- the same rounding-drift-guard
  -- trick the old "delivery = whatever's left" logic used, generalized so
  -- the schedule's last milestone always absorbs any remainder. This is
  -- also what catches a duplicate/already-invoiced milestone (v_amount
  -- comes out <= 0), correctly, even across a schedule that was edited
  -- after some of the trip's milestones were already invoiced.
  select coalesce(sum(pct), 0) into v_cum_pct
    from payment_milestones
   where org_id = t.org_id
     and customer_id is not distinct from v_schedule_cid
     and seq <= p_seq;

  select coalesce(sum(il.line_total), 0) into v_already
    from invoices i
    join invoice_lines il on il.invoice_id = i.id
   where il.trip_id = p_trip
     and i.status <> 'cancelled';

  v_amount := round(t.revenue_amount * v_cum_pct / 100, 2) - v_already;
  if v_amount <= 0 then
    raise exception 'nothing left to invoice for this milestone';
  end if;

  select coalesce(payment_days, 0) into v_days from customers where id = t.customer_id;
  v_no := next_invoice_no(t.org_id);

  insert into invoices (org_id, invoice_no, customer_id, status, invoice_type,
                        currency, subtotal, downpayment, total_due, issued_on, due_on,
                        milestone_seq)
  values (t.org_id, v_no, t.customer_id, 'issued', v_label,
          t.revenue_currency, v_amount, 0, v_amount,
          v_issued, v_issued + v_days, p_seq)
  returning id into v_id;

  v_desc := format('%s — %s (%s)',
    t.trip_no,
    (select name from routes where id = t.route_id),
    v_label);

  insert into invoice_lines (org_id, invoice_id, trip_id, description, quantity, unit_price)
  values (t.org_id, v_id, p_trip, v_desc, 1, v_amount);

  -- Flips to invoiced once the milestone just raised is the schedule's
  -- last (highest seq) -- generalizes the old p_type in ('delivery','full')
  -- check, which was really just "this was the final invoice for the trip".
  select max(seq) into v_max_seq
    from payment_milestones
   where org_id = t.org_id
     and customer_id is not distinct from v_schedule_cid;

  if p_seq = v_max_seq then
    perform set_config('app.acting_user_id', coalesce(p_user::text, ''), true);
    update trips set status = 'invoiced' where id = p_trip and status = 'pod_received';
  end if;

  return v_id;
end $function$;

revoke execute on function public.raise_invoice(uuid, int, uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.raise_invoice(uuid, int, uuid, uuid, date) to service_role;

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
  inv            invoices%rowtype;
  v_paid         numeric;
  v_trip_id      uuid;
  t              trips%rowtype;
  v_schedule_cid uuid;
  v_max_seq      int;
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

  -- Undo the one side-effect raise_invoice had: raising the schedule's
  -- last milestone moved the trip to 'invoiced'. Once no live invoice for
  -- that last milestone is left on the trip (this one is cancelled now),
  -- put it back so it isn't stuck showing a status nothing backs. The
  -- schedule is resolved the same way raise_invoice does it; invoices
  -- from before milestones have no milestone_seq and are recognised by
  -- their old 'delivery'/'full' type instead.
  select il.trip_id into v_trip_id from invoice_lines il where il.invoice_id = p_invoice limit 1;
  if v_trip_id is not null then
    select * into t from trips where id = v_trip_id;

    if exists (select 1 from payment_milestones where org_id = t.org_id and customer_id = t.customer_id) then
      v_schedule_cid := t.customer_id;
    else
      v_schedule_cid := null;
    end if;

    select max(seq) into v_max_seq
      from payment_milestones
     where org_id = t.org_id
       and customer_id is not distinct from v_schedule_cid;

    if not exists (
      select 1
        from invoices i
        join invoice_lines il on il.invoice_id = i.id
       where il.trip_id = v_trip_id
         and i.status <> 'cancelled'
         and (i.milestone_seq >= v_max_seq
              or (i.milestone_seq is null and i.invoice_type in ('delivery', 'full')))
    ) then
      update trips set status = 'pod_received'
       where id = v_trip_id and status = 'invoiced';
    end if;
  end if;
end;
$function$;

revoke execute on function public.cancel_invoice(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_invoice(uuid, text, uuid, uuid) to service_role;
