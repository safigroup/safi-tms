-- 1. Audit trail for cancellation (currently missing entirely)
alter table invoices
  add column cancelled_at timestamptz,
  add column cancel_reason text;

-- 2. The RPC. Mirrors raise_invoice's shape: membership check, then the
--    one guard that actually matters here — no payments recorded yet.
create or replace function public.cancel_invoice(p_invoice uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inv invoices%rowtype;
  v_paid numeric;
  v_trip_id uuid;
begin
  select * into inv from invoices where id = p_invoice;
  if not found then raise exception 'invoice not found'; end if;

  if not exists (select 1 from memberships where org_id = inv.org_id and user_id = auth.uid()) then
    raise exception 'not a member of this organisation';
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

-- 3. invoice_ar currently has `where i.status <> 'cancelled'`, so a
--    cancelled invoice would vanish from the app entirely even though the
--    row/reason/timestamp still exist in `invoices`. This keeps it visible
--    (outstanding forced to 0 so it never counts toward AR totals) instead
--    of just disappearing. Uses CREATE OR REPLACE (not drop+create) so the
--    existing grants are preserved — importantly, the `revoke select ...
--    from anon` applied earlier stays intact.
create or replace view public.invoice_ar as
 select i.id,
    i.org_id,
    i.invoice_no,
    i.invoice_type,
    i.status,
    c.name as customer,
    i.currency,
    i.total_due,
    coalesce(p.paid, 0::numeric) as paid,
    case when i.status = 'cancelled' then 0
         else i.total_due - coalesce(p.paid, 0::numeric) end as outstanding,
    i.issued_on,
    i.due_on,
    case when i.status = 'cancelled' then 0
         when i.due_on < current_date and i.total_due > coalesce(p.paid, 0::numeric) then current_date - i.due_on
         else 0 end as days_overdue,
    case when i.status = 'cancelled' then 'cancelled'
         when i.total_due <= coalesce(p.paid, 0::numeric) then 'settled'
         when i.due_on >= current_date then 'current'
         when (current_date - i.due_on) <= 30 then '1-30'
         when (current_date - i.due_on) <= 60 then '31-60'
         else '60+' end as bucket,
    (select string_agg(t.trip_no, ', ') from invoice_lines il join trips t on t.id = il.trip_id where il.invoice_id = i.id) as trips,
    i.cancelled_at,
    i.cancel_reason
   from invoices i
     join customers c on c.id = i.customer_id
     left join lateral (select sum(pm.amount) as paid from payments pm where pm.invoice_id = i.id) p on true;
