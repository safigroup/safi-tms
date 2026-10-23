-- Demo requests from the public landing page (app/page.tsx). These are
-- the platform operator's own sales leads, not any tenant org's data, so
-- there is deliberately no org_id and no org_isolation policy: rows are
-- written only by the service-role client behind POST /api/demo-requests
-- (lib/demoRequests/createDemoRequest.ts) and read only by platform admins
-- via GET /api/platform/demo-requests. RLS is on with no policies, and
-- the default anon/authenticated grants are revoked, so the public anon
-- key can't read or write this table directly through PostgREST and skip
-- the route's validation and rate limit.
create table "public"."demo_requests" (
  "id"          uuid                     not null default extensions.uuid_generate_v4(),
  "created_at"  timestamp with time zone not null default now(),
  "name"        text                     not null,
  "company"     text                     not null,
  "email"       text,
  "phone"       text,
  "country"     text,
  "fleet_size"  text,
  "message"     text,
  "lang"        text                     not null default 'en',
  -- sha256 of the submitter's IP, only for the per-IP rate limit.
  "ip_hash"     text,
  constraint "demo_requests_pkey" primary key (id),
  constraint "demo_requests_contact_check" check (email is not null or phone is not null),
  constraint "demo_requests_lang_check" check (lang in ('en', 'fr'))
);

alter table "public"."demo_requests"
  enable row level security;

create index demo_requests_ip_hash_created_at_idx on public.demo_requests using btree (ip_hash, created_at);

revoke all on table "public"."demo_requests" from "anon", "authenticated";
