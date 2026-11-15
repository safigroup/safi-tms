-- Company cashbook, phase 2: money that already passes through Safi TMS
-- lands in the cashbook without being typed twice.
--
--   invoice payment                        money in   "Received into" an account
--   trip cost paid by Office, Agent, Card  money out  "Paid from" an account
--   trip allocation                        money out  "Paid from" an account
--   truck cost (not depreciation)          money out  "Paid from" an account
--
-- A trip cost paid from the driver's float never goes in an account: that
-- money already left when it was allocated to the trip. Depreciation isn't
-- money leaving anywhere.
--
-- Each of the four tables gets the account its money went through, and --
-- only when that account is in another currency -- the amount as it
-- actually left or reached the account (a TZS fuel bill paid on a USD
-- card, say). The records stay where they are; the cashbook reads them
-- through the cash_entries view below, so correcting a cost in the Docket
-- also corrects the cashbook.

alter table public.payments
  add column cash_account_id uuid references public.cash_accounts(id) on delete restrict,
  add column cash_amount numeric(14,2) check (cash_amount > 0);
alter table public.trip_costs
  add column cash_account_id uuid references public.cash_accounts(id) on delete restrict,
  add column cash_amount numeric(14,2) check (cash_amount > 0);
alter table public.trip_allocations
  add column cash_account_id uuid references public.cash_accounts(id) on delete restrict,
  add column cash_amount numeric(14,2) check (cash_amount > 0);
alter table public.truck_costs
  add column cash_account_id uuid references public.cash_accounts(id) on delete restrict,
  add column cash_amount numeric(14,2) check (cash_amount > 0);

create index payments_cash_account_id_idx on public.payments (cash_account_id) where cash_account_id is not null;
create index trip_costs_cash_account_id_idx on public.trip_costs (cash_account_id) where cash_account_id is not null;
create index trip_allocations_cash_account_id_idx on public.trip_allocations (cash_account_id) where cash_account_id is not null;
create index truck_costs_cash_account_id_idx on public.truck_costs (cash_account_id) where cash_account_id is not null;

-- Keeps every link valid, whichever route or import writes the row.
--
-- Setting or changing a link is refused when it doesn't fit: an account of
-- another company or a closed one, a record the cashbook doesn't take (a
-- driver-float cost, depreciation), a date before the account opened
-- (that money is already in its opening balance), or another currency
-- without the account-currency amount.
--
-- An edit elsewhere on the record that stops the link fitting -- paid by
-- changed to the driver's float, the date moved before the account opened,
-- the currency changed, or the amount changed on a cross-currency link --
-- doesn't fail the edit: the record just goes back to the cashbook's
-- "To place" list for finance to look at again.
create or replace function public.cash_link_guard() returns trigger
  language plpgsql
  set search_path to ''
as $$
declare
  rec jsonb := to_jsonb(new);
  on_date date := coalesce(rec->>'received_on', rec->>'incurred_on', rec->>'allocated_on')::date;
  acct record;
  link_changed boolean := true;
  figure_changed boolean := false;
  problem text;
begin
  if new.cash_account_id is null then
    new.cash_amount := null;
    return new;
  end if;

  -- OLD only exists on an update
  if tg_op = 'UPDATE' then
    link_changed := new.cash_account_id is distinct from old.cash_account_id
                 or new.cash_amount is distinct from old.cash_amount;
    figure_changed := new.amount is distinct from old.amount
                   or new.currency is distinct from old.currency;
  end if;

  select a.org_id, a.currency, a.opening_date, a.is_active, a.name
    into acct
    from public.cash_accounts a
   where a.id = new.cash_account_id;

  if acct.org_id is null or acct.org_id <> new.org_id then
    raise exception using message = 'Cashbook account not found.', errcode = 'check_violation';
  end if;

  if tg_table_name = 'trip_costs' and coalesce(rec->>'paid_by', '') not in ('office', 'agent', 'card') then
    problem := 'Costs paid from the driver''s float are already counted through the trip''s allocation, so they don''t go in an account.';
  elsif tg_table_name = 'truck_costs' and rec->>'category' = 'depreciation' then
    problem := 'Depreciation isn''t money leaving an account.';
  elsif on_date < acct.opening_date then
    problem := format('%s opens on %s; money before that is already in its opening balance.', acct.name, acct.opening_date);
  elsif acct.currency <> new.currency and new.cash_amount is null then
    problem := format('%s is in %s. Enter the amount in %s as it went through the account.', acct.name, acct.currency, acct.currency);
  elsif link_changed and not acct.is_active then
    problem := format('%s is closed.', acct.name);
  elsif not link_changed and figure_changed and acct.currency <> new.currency then
    -- the account-currency amount was given for the old figure
    problem := 'The amount changed.';
  end if;

  if problem is null then
    -- In the account's own currency the record's amount is the amount.
    if acct.currency = new.currency then
      new.cash_amount := null;
    end if;
    return new;
  end if;

  if link_changed then
    raise exception using message = problem, errcode = 'check_violation';
  end if;
  new.cash_account_id := null;
  new.cash_amount := null;
  return new;
end;
$$;

revoke execute on function public.cash_link_guard() from public, anon, authenticated;

create trigger payments_cash_link before insert or update on public.payments
  for each row execute function public.cash_link_guard();
create trigger trip_costs_cash_link before insert or update on public.trip_costs
  for each row execute function public.cash_link_guard();
create trigger trip_allocations_cash_link before insert or update on public.trip_allocations
  for each row execute function public.cash_link_guard();
create trigger truck_costs_cash_link before insert or update on public.truck_costs
  for each row execute function public.cash_link_guard();

-- Every TMS record the cashbook can take, placed in an account or not yet,
-- with what a statement line needs to describe it. A payment shows the
-- first trip on its invoice.
create view public.cash_link_sources with (security_invoker = on) as
  select 'payment'::text              as source,
         p.id,
         p.org_id,
         p.cash_account_id,
         p.received_on                as occurred_on,
         'in'::public.cash_direction  as direction,
         p.amount                     as record_amount,
         p.currency                   as record_currency,
         p.cash_amount,
         'Customer payment'::text     as category,
         c.name                       as counterparty,
         null::text                   as description,
         p.reference,
         i.invoice_no                 as detail,
         null::text                   as paid_by,
         tr.id                        as trip_id,
         tr.trip_no,
         case when p.currency = 'USD' then p.amount end as amount_usd,
         p.created_at
    from public.payments p
    join public.invoices i on i.id = p.invoice_id
    left join public.customers c on c.id = i.customer_id
    left join lateral (
      select t.id, t.trip_no
        from public.invoice_lines l
        join public.trips t on t.id = l.trip_id
       where l.invoice_id = i.id
       order by t.trip_no
       limit 1
    ) tr on true
  union all
  select 'trip_cost', tc.id, tc.org_id, tc.cash_account_id, tc.incurred_on, 'out'::public.cash_direction,
         tc.amount, tc.currency, tc.cash_amount, 'Trip cost', null, tc.description, tc.receipt_ref,
         tc.category::text, tc.paid_by, t.id, t.trip_no, tc.amount_usd, tc.created_at
    from public.trip_costs tc
    join public.trips t on t.id = tc.trip_id
   where tc.paid_by in ('office', 'agent', 'card')
  union all
  select 'allocation', a.id, a.org_id, a.cash_account_id, a.allocated_on, 'out'::public.cash_direction,
         a.amount, a.currency, a.cash_amount, 'Trip allocation', null, a.description, a.reference,
         null, null, t.id, t.trip_no, a.amount_usd, a.created_at
    from public.trip_allocations a
    join public.trips t on t.id = a.trip_id
  union all
  select 'truck_cost', k.id, k.org_id, k.cash_account_id, k.incurred_on, 'out'::public.cash_direction,
         k.amount, k.currency, k.cash_amount, 'Truck cost', tk.fleet_no, k.description, null,
         k.category::text, null, null, null, k.amount_usd, k.created_at
    from public.truck_costs k
    join public.trucks tk on tk.id = k.truck_id
   where k.category <> 'depreciation';

-- Every line of every account's statement: manual entries and transfers,
-- plus the TMS records placed in an account. amount is always in the
-- account's own currency; record_amount/record_currency keep the original
-- when that differs.
create view public.cash_entries with (security_invoker = on) as
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
   where s.cash_account_id is not null;

-- Balances now include the placed TMS records. Same columns as before.
create or replace view public.cash_account_balances with (security_invoker = on) as
  select a.id as account_id,
         a.org_id,
         a.opening_balance + coalesce(sum(case when e.direction = 'in' then e.amount else -e.amount end), 0) as balance
    from public.cash_accounts a
    left join public.cash_entries e on e.account_id = a.id
   group by a.id;

-- The cashbook is owner/admin/finance only, enforced in the app's
-- /api/cashbook routes, which read with the service role. Organization
-- isolation alone would let any signed-in member of the company read these
-- through the public API, so nothing but the service role gets them.
revoke all on table public.cash_link_sources, public.cash_entries from public, anon, authenticated;
grant select on table public.cash_link_sources, public.cash_entries to service_role;
revoke all on table public.cash_accounts, public.cash_transactions, public.cash_account_balances from anon, authenticated;
