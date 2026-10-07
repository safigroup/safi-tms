-- Lets an external agent call the read-only /api/agent/* endpoints without
-- participating in the normal session-cookie login flow. Only a hash of
-- the key is stored -- the raw key is shown once at creation (same
-- reveal-once pattern already used for invite links in
-- app/(app)/admin/page.tsx's InviteForm) -- plus a short plaintext prefix
-- so the admin list can show something recognizable without ever
-- re-displaying the full key.
create table "public"."api_keys" (
  "id"            uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"        uuid                     not null,
  "name"          text                     not null,
  "key_hash"      text                     not null,
  "key_prefix"    text                     not null,
  "created_by"    uuid,
  "created_at"    timestamp with time zone not null default now(),
  "last_used_at"  timestamp with time zone,
  "revoked_at"    timestamp with time zone,
  constraint "api_keys_pkey" primary key (id)
);

alter table "public"."api_keys"
  enable row level security;

alter table "public"."api_keys"
  add constraint "api_keys_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."api_keys"
  add constraint "api_keys_created_by_fkey" foreign key (created_by) references auth.users(id);

-- Looked up by hash from lib/auth/getAuthedApiKey.ts (a bearer key, not a
-- login session, so there's no auth.uid() for an org_isolation-style
-- policy to key off) -- unique so that lookup is a direct index hit.
create unique index api_keys_key_hash_idx on public.api_keys using btree (key_hash);
create index api_keys_org_id_idx on public.api_keys using btree (org_id);

create policy "org_isolation" on "public"."api_keys"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."api_keys" to "anon", "authenticated", "postgres", "service_role";
