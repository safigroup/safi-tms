-- Removing a payment recorded by mistake (wrong amount, wrong date, wrong
-- invoice). Until now a payment could only be added, and an invoice with any
-- payment on it can't be cancelled, so a mistyped payment locked its invoice
-- for good.
--
-- The payment row is deleted (nothing references it by key: the cashbook
-- and the reports read payments live), trg_payment_sync puts the invoice's
-- status back (issued / part_paid), and one audit_log row against the
-- invoice keeps what was removed, by whom and why -- the invoice panel
-- shows it. A payment already reconciled in the Cashbook is refused.
--
-- Takes p_org/p_user like cancel_invoice: called by the API route with the
-- service role after its own role check, never by a signed-in client.

create or replace function public.remove_payment(
  p_invoice uuid,
  p_payment uuid,
  p_reason  text,
  p_org     uuid,
  p_user    uuid
) returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_pay  payments%rowtype;
  v_inv  invoices%rowtype;
  v_what text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;

  -- Invoice first, then the payment, so two removals on one invoice queue
  -- up rather than both reading the same payment.
  select * into v_inv from invoices where id = p_invoice and org_id = p_org for update;
  if not found then
    raise exception 'invoice not found';
  end if;

  select * into v_pay from payments
   where id = p_payment and invoice_id = p_invoice and org_id = p_org
     for update;
  if not found then
    raise exception 'payment not found on this invoice';
  end if;

  -- A payment ticked off against its account's statement is money the bank
  -- (or the cash count) confirms; removing it would leave the reconciled
  -- balance wrong. Same match cash_entries uses: the tick counts only while
  -- its account and amount still agree with the payment.
  if exists (select 1 from cash_reconciliations r
              where r.source = 'payment' and r.record_id = v_pay.id
                and r.account_id = v_pay.cash_account_id
                and r.amount = coalesce(v_pay.cash_amount, v_pay.amount)) then
    raise exception 'this payment is ticked off against its cashbook account''s statement — untick it in the Cashbook first';
  end if;

  v_what := format('%s %s received %s', to_char(v_pay.amount, 'FM999,999,999,990.00'), v_pay.currency, v_pay.received_on)
         || coalesce(' · ' || nullif(btrim(v_pay.method), ''), '')
         || coalesce(' · ref ' || nullif(btrim(v_pay.reference), ''), '')
         || coalesce(' · into ' || (select a.name from cash_accounts a where a.id = v_pay.cash_account_id), '');

  delete from payments where id = p_payment;
  -- Ticks that no longer count (the payment's account or amount changed
  -- after ticking) would otherwise outlive it.
  delete from cash_reconciliations where source = 'payment' and record_id = p_payment;

  insert into audit_log (org_id, table_name, record_id, field, old_value, new_value, edited_by)
  values (p_org, 'invoices', p_invoice, 'payment removed', v_what, btrim(p_reason), p_user);
end;
$function$;

revoke execute on function public.remove_payment(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_payment(uuid, uuid, text, uuid, uuid) to service_role;
