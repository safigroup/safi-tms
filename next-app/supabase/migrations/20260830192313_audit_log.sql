-- Field-level audit trail for admin overrides of trips/trip_costs. One row
-- per changed field rather than one row per edit action -- simpler to
-- query "history of this one field" and matches this schema's existing
-- preference for plain relational rows over JSONB blobs (no JSONB used
-- anywhere else in this project).
create table "public"."audit_log" (
  "id"         uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"     uuid                     not null,
  "table_name" text                     not null,
  "record_id"  uuid                     not null,
  "field"      text                     not null,
  "old_value"  text,
  "new_value"  text,
  "edited_by"  uuid,
  "edited_at"  timestamp with time zone not null default now(),
  constraint "audit_log_pkey" primary key (id)
);

alter table "public"."audit_log"
  enable row level security;

alter table "public"."audit_log"
  add constraint "audit_log_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."audit_log"
  add constraint "audit_log_edited_by_fkey" foreign key (edited_by) references auth.users(id);

create index audit_log_org_id_table_name_record_id_idx on public.audit_log using btree (org_id, table_name, record_id);

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."audit_log" to "anon", "authenticated", "postgres", "service_role";
