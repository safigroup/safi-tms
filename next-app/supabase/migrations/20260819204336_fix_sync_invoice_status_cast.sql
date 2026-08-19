-- Fixes a pre-existing bug in sync_invoice_status() (trg_payment_sync,
-- fires on insert/update/delete of payments) caught by testing the
-- Billing UI: recording the first-ever real payment against an invoice
-- failed with "column status is of type invoice_status but expression is
-- of type text". The bare CASE returning untyped string literals doesn't
-- reliably get inferred as invoice_status in this context. This function
-- predates every migration in this set -- it was never actually exercised
-- until now, not something introduced by the migration to Next.js.

create or replace function public.sync_invoice_status()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
  AS $function$
declare v_inv uuid; v_due numeric; v_paid numeric;
begin
  v_inv := coalesce(new.invoice_id, old.invoice_id);
  select total_due into v_due from invoices where id = v_inv;
  select coalesce(sum(amount),0) into v_paid from payments where invoice_id = v_inv;

  update invoices
     set status = (case
       when status = 'cancelled' then 'cancelled'
       when v_paid >= v_due and v_due > 0 then 'paid'
       when v_paid > 0 then 'part_paid'
       else 'issued' end)::invoice_status
   where id = v_inv;

  return null;
end $function$;
