-- Calendar dates in the organization's own time zone, not UTC.
--
-- CURRENT_DATE is the database's date, which is UTC, so for a company two
-- or three hours ahead of UTC it was still "yesterday" for the first hours
-- of each local day. That decided:
--   - the date on a POD document when "POD received" is clicked
--     (mark_pod_received),
--   - an invoice's issue and due dates (raise_invoice),
--   - how overdue an invoice is and its aging bucket (invoice_ar),
--   - days since delivery on pod_outstanding.
-- All of them now use today's date where the organization is
-- (organizations.time_zone, 20261114100000_org_time_zone.sql).
--
-- Only the dates change: both functions are otherwise exactly as they
-- stood (20260819192652_mark_pod_received_function.sql and
-- 20260915094622_fix_raise_invoice_duplicate_check.sql), and both views
-- keep their columns, types and order.

-- Today's date for an organization. Falls back to the UTC date for an
-- unknown id, as before, rather than a null that would fail an insert.
create or replace function public.org_today(p_org uuid)
returns date
language sql
stable
set search_path to ''
as $function$
  select coalesce(
    (select (now() at time zone o.time_zone)::date from public.organizations o where o.id = p_org),
    current_date
  );
$function$;

revoke execute on function public.org_today(uuid) from public, anon, authenticated;
grant execute on function public.org_today(uuid) to service_role;

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
     set status = 'received', received_on = org_today(p_org)
   where id = p_doc;

  update trips
     set status = 'pod_received', pod_received_at = now()
   where id = p_trip;
end;
$function$;

revoke execute on function public.mark_pod_received(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_pod_received(uuid, uuid, uuid, uuid) to service_role;

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
  v_today        date;
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
  v_today := org_today(t.org_id);
  v_no := next_invoice_no(t.org_id);

  insert into invoices (org_id, invoice_no, customer_id, status, invoice_type,
                        currency, subtotal, downpayment, total_due, issued_on, due_on,
                        milestone_seq)
  values (t.org_id, v_no, t.customer_id, 'issued', v_label,
          t.revenue_currency, v_amount, 0, v_amount,
          v_today, v_today + v_days, p_seq)
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

revoke execute on function public.raise_invoice(uuid, int, uuid, uuid) from public, anon, authenticated;
grant execute on function public.raise_invoice(uuid, int, uuid, uuid) to service_role;

-- Views: today's date where the invoice's / trip's organization is. The
-- views run as the caller (security_invoker), so the date is worked out
-- inline from organizations rather than through org_today(), which callers
-- other than the server can't run. security_invoker is restated because
-- CREATE OR REPLACE VIEW replaces the view's options.
create or replace view "public"."invoice_ar" with (security_invoker=on) AS  SELECT i.id,
    i.org_id,
    i.invoice_no,
    i.invoice_type,
    i.status,
    c.name AS customer,
    i.currency,
    i.total_due,
    COALESCE(p.paid, (0)::numeric) AS paid,
        CASE
            WHEN (i.status = 'cancelled'::public.invoice_status) THEN (0)::numeric
            ELSE (i.total_due - COALESCE(p.paid, (0)::numeric))
        END AS outstanding,
    i.issued_on,
    i.due_on,
        CASE
            WHEN (i.status = 'cancelled'::public.invoice_status) THEN 0
            WHEN ((i.due_on < cal.today) AND (i.total_due > COALESCE(p.paid, (0)::numeric))) THEN (cal.today - i.due_on)
            ELSE 0
        END AS days_overdue,
        CASE
            WHEN (i.status = 'cancelled'::public.invoice_status) THEN 'cancelled'::text
            WHEN (i.total_due <= COALESCE(p.paid, (0)::numeric)) THEN 'settled'::text
            WHEN (i.due_on >= cal.today) THEN 'current'::text
            WHEN ((cal.today - i.due_on) <= 30) THEN '1-30'::text
            WHEN ((cal.today - i.due_on) <= 60) THEN '31-60'::text
            ELSE '60+'::text
        END AS bucket,
    ( SELECT string_agg(t.trip_no, ', '::text) AS string_agg
           FROM (public.invoice_lines il
             JOIN public.trips t ON ((t.id = il.trip_id)))
          WHERE (il.invoice_id = i.id)) AS trips,
    i.cancelled_at,
    i.cancel_reason
   FROM ((((public.invoices i
     JOIN public.customers c ON ((c.id = i.customer_id)))
     LEFT JOIN public.organizations o ON ((o.id = i.org_id)))
     CROSS JOIN LATERAL ( SELECT ((now() AT TIME ZONE COALESCE(o.time_zone, 'UTC'::text)))::date AS today) cal)
     LEFT JOIN LATERAL ( SELECT sum(pm.amount) AS paid
           FROM public.payments pm
          WHERE (pm.invoice_id = i.id)) p ON (true));

create or replace view "public"."pod_outstanding" with (security_invoker=on) AS  SELECT t.id AS trip_id,
    t.org_id,
    t.trip_no,
    c.name AS customer,
    r.name AS route,
    d.full_name AS driver,
    tk.fleet_no,
    t.actual_delivery_at,
    (((now() AT TIME ZONE COALESCE(o.time_zone, 'UTC'::text)))::date - ((t.actual_delivery_at AT TIME ZONE COALESCE(o.time_zone, 'UTC'::text)))::date) AS days_since_delivery,
    t.revenue_amount AS revenue_usd,
    round((t.revenue_amount * 0.5), 2) AS unbillable_usd
   FROM (((((public.trips t
     JOIN public.customers c ON ((c.id = t.customer_id)))
     JOIN public.routes r ON ((r.id = t.route_id)))
     LEFT JOIN public.organizations o ON ((o.id = t.org_id)))
     LEFT JOIN public.drivers d ON ((d.id = t.driver_id)))
     LEFT JOIN public.trucks tk ON ((tk.id = t.truck_id)))
  WHERE ((t.status = 'delivered'::public.trip_status) AND (t.pod_received_at IS NULL) AND (t.actual_delivery_at IS NOT NULL))
  ORDER BY t.actual_delivery_at;
