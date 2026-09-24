-- One-off data correction, not a schema change -- continuation of
-- 20260915115305_override_amt_congo_old_invoice.sql.
--
-- Now that the old-scheme invoice on trip SAFI-2026-0006 (id
-- e6951ee2-29fb-4600-a187-23803a58fbc6, org
-- 721b0134-bfd0-4381-84d7-d0177a843dd6, revenue $10,600) is cancelled,
-- raises the customer's new 3-milestone schedule fresh against the full
-- $10,600 (On loading 30% = $3,180 / At Nakonde Border 20% = $2,120 / On
-- Container Offload 50% = $5,300), then re-points the customer's
-- original $7,600 payment -- previously recorded against the now-
-- cancelled old invoice, left untouched there rather than reversed --
-- onto the first of these new invoices, per explicit instruction.
--
-- That payment exceeds the first invoice's $3,180 by $4,420, but this
-- app's invoice status is a simple paid-in-full threshold (see
-- sync_invoice_status()), not a running ledger split across invoices: a
-- single payment row can only mark one invoice paid. The other two new
-- invoices remain outstanding (status 'issued') until their own payments
-- come in.
--
-- Guarded to do nothing if this trip already has any non-cancelled
-- invoice (so it's a no-op on re-run, and a no-op on any database that
-- doesn't have this trip at all, e.g. staging).
do $$
declare
  v_trip uuid := 'e6951ee2-29fb-4600-a187-23803a58fbc6';
  v_org  uuid := '721b0134-bfd0-4381-84d7-d0177a843dd6';
  v_payment uuid := '36d56d19-48f2-432c-b1a4-91391673bcdb';
  v_inv1 uuid;
  v_inv2 uuid;
  v_inv3 uuid;
begin
  if not exists (select 1 from trips where id = v_trip and org_id = v_org) then
    return;
  end if;

  if exists (
    select 1 from invoices i
    join invoice_lines il on il.invoice_id = i.id
    where il.trip_id = v_trip and i.status <> 'cancelled'
  ) then
    raise notice 'Trip % already has a non-cancelled invoice -- skipping.', v_trip;
    return;
  end if;

  v_inv1 := public.raise_invoice(v_trip, 1, v_org, null);
  v_inv2 := public.raise_invoice(v_trip, 2, v_org, null);
  v_inv3 := public.raise_invoice(v_trip, 3, v_org, null);

  update public.payments
     set invoice_id = v_inv1
   where id = v_payment;
end $$;
