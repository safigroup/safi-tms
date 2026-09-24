-- One-off data correction, not a schema change.
--
-- Customer AMT CONGO SARL - K SQUARE COMPANY LTD (id
-- 4d8276b3-51ff-4995-9b9c-ed18c9d0eac2) was moved onto a custom
-- 3-milestone schedule (On loading 30% / At Nakonde Border 20% / On
-- Container Offload 50%) partway through trip SAFI-2026-0006 (revenue
-- $10,600), which already had a single "loading" invoice
-- (SAFI-INV-2026-0006, 50% = $5,300) raised and paid under the org's old
-- default schedule before the custom one existed.
--
-- raise_invoice()'s amount check only nets off non-cancelled invoices, so
-- as long as this one stays 'paid' the new schedule's milestones compute
-- against $10,600 minus the $5,300 already on the books -- see this
-- session's billing review for the full breakdown. Per explicit
-- instruction, that old invoice is being marked cancelled instead, so the
-- new schedule's three milestones can be raised fresh against the full
-- $10,600. This intentionally bypasses cancel_invoice()'s normal guard
-- against cancelling an invoice with a recorded payment: the $5,300
-- payment row itself is deliberately left untouched (not reversed or
-- deleted) and remains on the books as real cash received -- only this
-- invoice's status is being overridden. Scoped to this exact invoice id,
-- org, and current status so it can't match anything else if ever
-- re-run, and a no-op on any database that doesn't have this row (e.g.
-- staging).
update public.invoices
   set status = 'cancelled',
       cancelled_at = now(),
       cancel_reason = 'Overridden: customer moved to a custom milestone schedule mid-trip; rebilling the full trip amount under the new schedule. The $5,300 payment already recorded against this invoice was left in place, not reversed.'
 where id = 'f5ffab23-4449-4a49-b52d-464330695188'
   and org_id = '721b0134-bfd0-4381-84d7-d0177a843dd6'
   and status = 'paid';
