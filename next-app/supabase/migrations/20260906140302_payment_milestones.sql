-- Replaces the hardcoded 50%-on-loading/50%-on-delivery split with an
-- arbitrary, named, percentage-based schedule per customer. A row with
-- customer_id null is the organization's default schedule; a customer with
-- any rows of their own fully overrides the default (not merged). Every
-- existing organization is seeded with two rows reproducing today's exact
-- behavior, so nothing changes for any customer unless someone deliberately
-- configures a custom schedule for them.
create table "public"."payment_milestones" (
  "id"             uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"         uuid                     not null,
  "customer_id"    uuid,
  "seq"            integer                  not null,
  "label"          text                     not null,
  "pct"            numeric(5,2)             not null,
  "requires_pod"   boolean                  not null default false,
  "created_at"     timestamp with time zone not null default now(),
  constraint "payment_milestones_pkey" primary key (id)
);

alter table "public"."payment_milestones"
  add constraint "payment_milestones_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."payment_milestones"
  add constraint "payment_milestones_customer_id_fkey" foreign key (customer_id) references public.customers(id) on delete cascade;

alter table "public"."payment_milestones"
  add constraint "payment_milestones_org_customer_seq_key" unique nulls not distinct (org_id, customer_id, seq);

alter table "public"."payment_milestones"
  enable row level security;

create policy "org_isolation" on "public"."payment_milestones"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."payment_milestones" to "anon", "authenticated", "postgres", "service_role";

insert into payment_milestones (org_id, customer_id, seq, label, pct, requires_pod)
select id, null::uuid, 1, 'On loading', 50, false from organizations
union all
select id, null::uuid, 2, 'On delivery', 50, true from organizations;

-- Which schedule position an invoice corresponds to. Null for invoices
-- raised before this migration -- invoice_type (already plain text, not an
-- enum) keeps whatever label was in effect when each was raised, so this
-- is purely additional bookkeeping, not a backfill.
alter table "public"."invoices" add column "milestone_seq" integer;

-- raise_invoice()'s 2nd parameter changes type (p_type text -> p_seq int).
-- Same pitfall as an argument-count change (see
-- 20260830111343_route_border_paths.sql): a different signature even
-- though the argument count is unchanged, so CREATE OR REPLACE alone would
-- leave the old 4-arg(uuid,text,uuid,uuid) overload behind. Drop it first.
drop function if exists public.raise_invoice(uuid, text, uuid, uuid);

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

  if exists (select 1 from invoices i
             where i.trip_id = p_trip
               and i.milestone_seq = p_seq
               and i.status <> 'cancelled') then
    raise exception 'this milestone has already been invoiced for this trip';
  end if;

  -- Amount is the cumulative percent through this milestone minus whatever
  -- has already been invoiced for the trip -- the same rounding-drift-guard
  -- trick the old "delivery = whatever's left" logic used, generalized so
  -- the schedule's last milestone always absorbs any remainder.
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

-- Simplified to drop the hardcoded half_usd/loading_invoiced/delivery_invoiced
-- columns -- which milestones are outstanding for a trip is now resolved in
-- application code (lib/billing/paymentSchedule.ts) against
-- payment_milestones + invoices.milestone_seq, the same way the truck
-- breakeven projection resolves its own multi-row business logic in TS
-- rather than a wider SQL view. customer_id is exposed so that resolution
-- can look up the right schedule per trip.
drop view if exists "public"."billable";

create view "public"."billable" with (security_invoker=on) AS
 SELECT t.id AS trip_id,
    t.org_id,
    t.trip_no,
    c.name AS customer,
    t.customer_id,
    r.name AS route,
    t.status,
    t.revenue_amount AS revenue_usd,
    (t.pod_received_at IS NOT NULL) AS pod_in_hand
   FROM ((public.trips t
     JOIN public.customers c ON ((c.id = t.customer_id)))
     JOIN public.routes r ON ((r.id = t.route_id)))
  WHERE (t.status <> ALL (ARRAY['draft'::public.trip_status, 'allocated'::public.trip_status, 'cancelled'::public.trip_status, 'closed'::public.trip_status]));

-- Dropping and recreating the view (required above, since CREATE OR REPLACE
-- VIEW cannot drop columns) resets its grants to the owner only -- restore
-- exactly what was there before, including anon's SELECT specifically
-- staying revoked (this view was one of the ones fixed for leaking data to
-- unauthenticated requests; see the root README's security notes).
grant delete, insert, references, trigger, truncate, update on table "public"."billable" to "anon";
grant delete, insert, references, select, trigger, truncate, update on table "public"."billable" to "authenticated", "postgres", "service_role";
