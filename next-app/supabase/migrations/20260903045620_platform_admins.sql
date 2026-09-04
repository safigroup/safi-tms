-- Platform-level access, sitting above the per-org owner/admin/ops/finance/
-- viewer role model: lets a designated person create and switch between
-- organizations from the app. Deliberately grantable only by direct SQL --
-- no insert/update/delete policy, and nothing in the app ever writes to
-- this table -- so this power can never be self-granted or exposed through
-- a bug in the UI. The lone select policy lets a signed-in user check only
-- their own row (same defense-in-depth posture already used for
-- memberships in getAuthedOrgContext()).
create table "public"."platform_admins" (
  "user_id"    uuid                     not null,
  "created_at" timestamp with time zone not null default now(),
  constraint "platform_admins_pkey" primary key (user_id),
  constraint "platform_admins_user_id_fkey" foreign key (user_id) references auth.users(id) on delete cascade
);

alter table "public"."platform_admins" enable row level security;

create policy "platform_admins_self_read" on "public"."platform_admins"
  for select
  using (user_id = auth.uid());

grant select on table "public"."platform_admins" to "authenticated";
