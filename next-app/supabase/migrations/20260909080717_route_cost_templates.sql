-- The cost-side counterpart to rate_cards (which already prices revenue
-- per route): an admin-configured set of expected cost lines per route,
-- used by the trip cost estimator. category reuses the exact trip_costs
-- vocabulary from the Cost Docket (driver_advance/driver_allowance
-- excluded -- those are per-driver-float reimbursements, not something a
-- route-level estimate predicts). basis is per_trip/per_tonne/per_cbm/
-- per_km, a plain text column with app-level validation, matching
-- rate_cards.rate_basis's existing pattern rather than a Postgres enum.
create table "public"."route_cost_templates" (
  "id"         uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"     uuid                     not null,
  "route_id"   uuid                     not null,
  "category"   text                     not null,
  "amount"     numeric(14,2)            not null,
  "currency"   text                     not null default 'USD',
  "basis"      text                     not null,
  "created_at" timestamp with time zone not null default now(),
  constraint "route_cost_templates_pkey" primary key (id)
);

alter table "public"."route_cost_templates"
  enable row level security;

alter table "public"."route_cost_templates"
  add constraint "route_cost_templates_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."route_cost_templates"
  add constraint "route_cost_templates_route_id_fkey" foreign key (route_id) references public.routes(id) on delete cascade;

create index route_cost_templates_org_id_route_id_idx on public.route_cost_templates using btree (org_id, route_id);

create policy "org_isolation" on "public"."route_cost_templates"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."route_cost_templates" to "anon", "authenticated", "postgres", "service_role";
