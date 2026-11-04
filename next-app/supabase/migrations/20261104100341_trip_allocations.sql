-- Money allocated to a trip (a trip budget, cash or mobile money sent to
-- the driver, ...). The debit side of the trip's balance statement; every
-- trip_costs row is a credit against it, whoever paid it. Same shape as
-- trip_costs for the money itself -- the rate on file is frozen onto the
-- row at entry, and amount_usd is derived from it -- so allocations and
-- costs net off in the same dollars.
create table "public"."trip_allocations" (
  "id"             uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"         uuid                     not null,
  "trip_id"        uuid                     not null,
  "allocated_on"   date                     not null default CURRENT_DATE,
  "amount"         numeric(14,2)            not null,
  "currency"       character(3)             not null,
  "fx_rate_to_usd" numeric(18,8)            not null,
  "description"    text,
  "reference"      text,
  "recorded_by"    uuid,
  "created_at"     timestamp with time zone not null default now(),
  constraint "trip_allocations_pkey" primary key (id),
  constraint "trip_allocations_amount_check" check (amount > 0)
);

alter table "public"."trip_allocations"
  add column "amount_usd" numeric(14,2) generated always as ((amount * fx_rate_to_usd)) stored;

alter table "public"."trip_allocations"
  enable row level security;

alter table "public"."trip_allocations"
  add constraint "trip_allocations_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."trip_allocations"
  add constraint "trip_allocations_trip_id_fkey" foreign key (trip_id) references public.trips(id) on delete cascade;

alter table "public"."trip_allocations"
  add constraint "trip_allocations_recorded_by_fkey" foreign key (recorded_by) references auth.users(id);

create index trip_allocations_trip_id_idx on public.trip_allocations using btree (trip_id);

create policy "org_isolation" on "public"."trip_allocations"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."trip_allocations" to "anon", "authenticated", "postgres", "service_role";
