-- One-off data correction, not a schema change -- continuation of
-- 20260915115305_override_amt_congo_old_invoice.sql and
-- 20260915125639_rebill_amt_congo_new_schedule.sql.
--
-- Per explicit instruction, restarts billing on trip SAFI-2026-0006 (id
-- e6951ee2-29fb-4600-a187-23803a58fbc6, org
-- 721b0134-bfd0-4381-84d7-d0177a843dd6, customer AMT CONGO SARL - K
-- SQUARE COMPANY LTD) from a completely clean slate: hard-deletes every
-- invoice ever raised against this trip (the original $5,300, the
-- $699.60 draft, the $3,180 "On loading" invoice, and the two cancelled
-- $2,120/$5,300 invoices) so the customer's current schedule can be
-- tried fresh. invoice_lines and payments both cascade-delete with their
-- invoice, so this also removes the real $7,600 payment that was
-- attached to the $3,180 invoice -- deliberately, per instruction, unlike
-- every other invoice action this session which only ever cancelled
-- (kept for audit purposes) rather than deleted.
--
-- Also resets the trip's status back to pod_received (its state before
-- any milestone invoice existed -- POD was already on file) since
-- nothing now backs the "invoiced" status that raising the final
-- milestone had set.
--
-- Guarded to do nothing on any database that doesn't have this exact
-- trip (e.g. staging), and safe to re-run (a second pass finds nothing
-- left to delete or revert).
do $$
declare
  v_trip uuid := 'e6951ee2-29fb-4600-a187-23803a58fbc6';
  v_org  uuid := '721b0134-bfd0-4381-84d7-d0177a843dd6';
begin
  if not exists (select 1 from trips where id = v_trip and org_id = v_org) then
    return;
  end if;

  delete from invoices
   where org_id = v_org
     and id in (select invoice_id from invoice_lines where trip_id = v_trip);

  update trips set status = 'pod_received' where id = v_trip and status = 'invoiced';
end $$;
