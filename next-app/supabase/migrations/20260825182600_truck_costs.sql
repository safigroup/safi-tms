-- Standing (non-trip) truck costs -- maintenance, insurance, licensing, etc.
-- Mirrors trip_costs' exact shape (including the amount_usd generated
-- column) so the FX-freeze-at-entry-time behavior is identical.
create type "public"."truck_cost_category" as enum (
  'maintenance',
  'insurance',
  'licensing',
  'depreciation',
  'tyres',
  'repairs',
  'other'
);

create table "public"."truck_costs" (
  "id"             uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"         uuid                     not null,
  "truck_id"       uuid                     not null,
  "category"       public.truck_cost_category not null,
  "description"    text,
  "amount"         numeric(14,2)            not null,
  "currency"       character(3)             not null,
  "fx_rate_to_usd" numeric(18,8)            not null,
  "incurred_on"    date                     not null default CURRENT_DATE,
  "recorded_by"    uuid,
  "created_at"     timestamp with time zone not null default now(),
  constraint "truck_costs_pkey" primary key (id)
);

alter table "public"."truck_costs"
  add column "amount_usd" numeric(14,2) generated always as ((amount * fx_rate_to_usd)) stored;

alter table "public"."truck_costs"
  enable row level security;

alter table "public"."truck_costs"
  add constraint "truck_costs_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."truck_costs"
  add constraint "truck_costs_truck_id_fkey" foreign key (truck_id) references public.trucks(id) on delete cascade;

alter table "public"."truck_costs"
  add constraint "truck_costs_recorded_by_fkey" foreign key (recorded_by) references auth.users(id);

create index truck_costs_org_id_truck_id_incurred_on_idx on public.truck_costs using btree (org_id, truck_id, incurred_on);

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."truck_costs" to "anon", "authenticated", "postgres", "service_role";
grant usage on type "public"."truck_cost_category" to "postgres";

-- Expose truck_id on trip_board so per-truck reports can filter trips
-- without re-deriving the view's own cost-aggregation logic. Appended as
-- the last column, everything else identical to the view as created in
-- 20260819062325_remote_schema.sql, so create-or-replace doesn't disturb
-- existing consumers or accidentally change any other behavior (notably
-- the WHERE clause excluding cancelled trips).
create or replace view "public"."trip_board" with (security_invoker=on) AS  SELECT t.id AS trip_id,
    t.org_id,
    t.trip_no,
    t.status,
    c.name AS customer,
    r.name AS route,
    r.borders,
    r.target_days,
    tk.fleet_no,
    tk.horse_reg,
    d.full_name AS driver,
    t.commodity,
    t.tonnage,
    t.container_no,
    t.actual_load_date,
    t.planned_eta,
    t.actual_delivery_at,
    t.pod_received_at,
        CASE
            WHEN (t.actual_load_date IS NOT NULL) THEN (COALESCE((t.actual_delivery_at)::date, CURRENT_DATE) - t.actual_load_date)
            ELSE NULL::integer
        END AS days_running,
        CASE
            WHEN ((t.actual_load_date IS NOT NULL) AND (r.target_days IS NOT NULL)) THEN ((COALESCE((t.actual_delivery_at)::date, CURRENT_DATE) - t.actual_load_date) > r.target_days)
            ELSE NULL::boolean
        END AS over_target,
    t.revenue_amount AS revenue_usd,
    COALESCE(cost.total, (0)::numeric) AS cost_usd,
    (t.revenue_amount - COALESCE(cost.total, (0)::numeric)) AS margin_usd,
        CASE
            WHEN (t.revenue_amount > (0)::numeric) THEN round((((t.revenue_amount - COALESCE(cost.total, (0)::numeric)) / t.revenue_amount) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS margin_pct,
    COALESCE(cost.entries, (0)::bigint) AS cost_entries,
    COALESCE(doc.pending, (0)::bigint) AS docs_pending,
    COALESCE(doc.pod_in, false) AS pod_in_hand,
    ( SELECT te.location
           FROM public.trip_events te
          WHERE ((te.trip_id = t.id) AND (te.event_type ~~ 'border%'::text))
          ORDER BY te.occurred_at DESC
         LIMIT 1) AS last_border,
    ( SELECT te.occurred_at
           FROM public.trip_events te
          WHERE ((te.trip_id = t.id) AND (te.event_type ~~ 'border%'::text))
          ORDER BY te.occurred_at DESC
         LIMIT 1) AS last_border_at,
    tk.id AS truck_id
   FROM ((((((public.trips t
     JOIN public.customers c ON ((c.id = t.customer_id)))
     JOIN public.routes r ON ((r.id = t.route_id)))
     LEFT JOIN public.trucks tk ON ((tk.id = t.truck_id)))
     LEFT JOIN public.drivers d ON ((d.id = t.driver_id)))
     LEFT JOIN LATERAL ( SELECT sum(tc.amount_usd) AS total,
            count(*) AS entries
           FROM public.trip_costs tc
          WHERE (tc.trip_id = t.id)) cost ON (true))
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE (td.status = 'pending'::public.doc_status)) AS pending,
            bool_or(((td.doc_type = 'pod'::public.doc_type) AND (td.status = 'received'::public.doc_status))) AS pod_in
           FROM public.trip_documents td
          WHERE (td.trip_id = t.id)) doc ON (true))
  WHERE (t.status <> 'cancelled'::public.trip_status);
