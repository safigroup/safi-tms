-- Company cashbook, phase 3: ticking statement lines off against the
-- bank's (or wallet's, or cash count's) own statement.
--
-- One row per reconciled line, whichever kind it is: a manual entry or
-- transfer leg, or a TMS record placed in the account. It keeps the
-- account and the amount the line had when it was ticked; a line only
-- counts as reconciled while both still match, so moving a record to
-- another account or correcting its amount quietly un-ticks it rather
-- than leaving a tick that no longer agrees with the bank.
create table public.cash_reconciliations (
  id            uuid                     not null default extensions.uuid_generate_v4(),
  org_id        uuid                     not null references public.organizations(id) on delete cascade,
  account_id    uuid                     not null references public.cash_accounts(id) on delete cascade,
  source        text                     not null,
  record_id     uuid                     not null,
  amount        numeric(14,2)            not null,
  reconciled_by uuid                     references auth.users(id),
  reconciled_at timestamp with time zone not null default now(),
  constraint cash_reconciliations_pkey primary key (id),
  constraint cash_reconciliations_record_key unique (source, record_id),
  constraint cash_reconciliations_source_check
    check (source in ('manual', 'payment', 'trip_cost', 'allocation', 'truck_cost'))
);

create index cash_reconciliations_account_id_idx on public.cash_reconciliations (account_id);

alter table public.cash_reconciliations enable row level security;

create policy "org_isolation" on public.cash_reconciliations
  for all
  to public
  using ((org_id in (select public.current_org_ids() as current_org_ids)))
  with check ((org_id in (select public.current_org_ids() as current_org_ids)));

-- Owner/admin/finance only, through the app's server -- same as the rest
-- of the cashbook.
revoke all on table public.cash_reconciliations from public, anon, authenticated;
grant select, insert, update, delete on table public.cash_reconciliations to service_role;

-- The statement lines, now saying whether (and when, by whom) each was
-- reconciled. The two new columns go last, so every existing column keeps
-- its place.
create or replace view public.cash_entries with (security_invoker = on) as
  select u.*,
         r.reconciled_at,
         r.reconciled_by
    from (
      select t.id,
             t.org_id,
             t.account_id,
             t.occurred_on,
             t.direction,
             t.amount,
             t.category,
             t.counterparty,
             t.description,
             t.reference,
             t.transfer_id,
             'manual'::text      as source,
             null::text          as detail,
             null::text          as paid_by,
             null::uuid          as trip_id,
             null::text          as trip_no,
             null::numeric       as record_amount,
             null::character(3)  as record_currency,
             t.amount_usd,
             t.created_at
        from public.cash_transactions t
      union all
      select s.id, s.org_id, s.cash_account_id, s.occurred_on, s.direction,
             coalesce(s.cash_amount, s.record_amount), s.category, s.counterparty, s.description, s.reference,
             null, s.source, s.detail, s.paid_by, s.trip_id, s.trip_no,
             s.record_amount, s.record_currency, s.amount_usd, s.created_at
        from public.cash_link_sources s
       where s.cash_account_id is not null
    ) u
    left join public.cash_reconciliations r
           on r.source = u.source
          and r.record_id = u.id
          and r.account_id = u.account_id
          and r.amount = u.amount;
