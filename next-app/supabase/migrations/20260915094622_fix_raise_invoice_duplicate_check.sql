-- Fixes two bugs in raise_invoice() introduced by
-- 20260906140302_payment_milestones.sql, both in the same "already
-- invoiced this milestone" duplicate-check block:
--
-- 1. It queried invoices.trip_id, which has never existed -- the trip
--    link lives on invoice_lines.trip_id (an invoice can have several
--    lines; the trip is attached to the line, not the invoice header --
--    see the correct join two blocks below, and bootstrap/route.ts's own
--    comment on the same pitfall). This made every raise_invoice() call
--    fail outright with "column i.trip_id does not exist".
--
-- 2. Even fixed to join through invoice_lines, checking milestone_seq for
--    an exact match assumes a trip's milestone numbering is stable over
--    time. It isn't: payment_milestones can be edited (or a customer
--    switched onto/off a custom schedule) after some of a trip's
--    milestones were already invoiced under the old numbering, which
--    could either false-positive-block a legitimate new milestone that
--    happens to reuse an old seq, or fail to catch a real duplicate under
--    renumbering. The amount-based check just below it (v_amount <= 0)
--    already covers "nothing left to invoice" correctly regardless of any
--    of that -- it's the same amount-based approach
--    lib/billing/paymentSchedule.ts's resolveMilestonesDue() already uses
--    for exactly this reason (see its own comment). So rather than fix the
--    join and keep a redundant, schedule-instability-prone guard, this
--    drops the block entirely and relies solely on the amount check.
create or replace function public.raise_invoice (
  p_trip uuid,
  p_seq  int,
  p_org  uuid default null,
  p_user uuid default null
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
          current_date, current_date + v_days, p_seq)
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
