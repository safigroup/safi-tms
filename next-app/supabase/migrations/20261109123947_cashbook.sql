-- Company cashbook, phase 1: the company's own money accounts (bank,
-- mobile money, cash) and every movement into or out of them, entered by
-- hand. Phase 2 will add invoice payments, office/agent/card-paid trip
-- costs, trip allocations and truck costs to the same statements.
-- Unlike most tenant data this is owner/admin/finance only -- enforced by
-- CAN_USE_CASHBOOK in every /api/cashbook route, for reads as well.
create type "public"."cash_account_kind" as enum ('bank', 'mobile_money', 'cash');
create type "public"."cash_direction" as enum ('in', 'out');

create table "public"."cash_accounts" (
  "id"              uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"          uuid                     not null,
  "name"            text                     not null,
  "kind"            public.cash_account_kind not null,
  "currency"        character(3)             not null,
  "opening_balance" numeric(14,2)            not null default 0,
  "opening_date"    date                     not null,
  "is_active"       boolean                  not null default true,
  "created_at"      timestamp with time zone not null default now(),
  constraint "cash_accounts_pkey" primary key (id)
);

-- amount is in the account's own currency; the rate on file at entry is
-- frozen onto the row, same as trip_costs, so USD totals never shift.
create table "public"."cash_transactions" (
  "id"             uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"         uuid                     not null,
  "account_id"     uuid                     not null,
  "occurred_on"    date                     not null,
  "direction"      public.cash_direction    not null,
  "amount"         numeric(14,2)            not null,
  "fx_rate_to_usd" numeric(18,8)            not null,
  "category"       text                     not null,
  "counterparty"   text,
  "description"    text,
  "reference"      text,
  -- Both legs of a transfer between two of the org's own accounts share
  -- this id, so a transfer is only ever deleted whole.
  "transfer_id"    uuid,
  "recorded_by"    uuid,
  "created_at"     timestamp with time zone not null default now(),
  constraint "cash_transactions_pkey" primary key (id),
  constraint "cash_transactions_amount_check" check (amount > 0)
);

alter table "public"."cash_transactions"
  add column "amount_usd" numeric(14,2) generated always as ((amount * fx_rate_to_usd)) stored;

alter table "public"."cash_accounts" enable row level security;
alter table "public"."cash_transactions" enable row level security;

alter table "public"."cash_accounts"
  add constraint "cash_accounts_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."cash_transactions"
  add constraint "cash_transactions_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

-- restrict: an account with history can be deactivated, never deleted out
-- from under its transactions.
alter table "public"."cash_transactions"
  add constraint "cash_transactions_account_id_fkey" foreign key (account_id) references public.cash_accounts(id) on delete restrict;

alter table "public"."cash_transactions"
  add constraint "cash_transactions_recorded_by_fkey" foreign key (recorded_by) references auth.users(id);

create index cash_accounts_org_id_idx on public.cash_accounts using btree (org_id);
create index cash_transactions_account_id_occurred_on_idx on public.cash_transactions using btree (account_id, occurred_on);
create index cash_transactions_transfer_id_idx on public.cash_transactions using btree (transfer_id);

create policy "org_isolation" on "public"."cash_accounts"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "org_isolation" on "public"."cash_transactions"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."cash_accounts" to "anon", "authenticated", "postgres", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."cash_transactions" to "anon", "authenticated", "postgres", "service_role";
grant usage on type "public"."cash_account_kind" to "postgres";
grant usage on type "public"."cash_direction" to "postgres";

-- Each account's balance today, summed in the database: the API's row
-- limit would otherwise silently truncate a client-side sum once an
-- organization passes 1,000 transactions.
create view "public"."cash_account_balances" with (security_invoker=on) as
  select a.id as account_id,
         a.org_id,
         a.opening_balance + coalesce(sum(case when t.direction = 'in' then t.amount else -t.amount end), 0) as balance
    from public.cash_accounts a
    left join public.cash_transactions t on t.account_id = a.id
   group by a.id;

grant select on table "public"."cash_account_balances" to "anon", "authenticated", "postgres", "service_role";
