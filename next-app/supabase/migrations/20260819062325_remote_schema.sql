set local check_function_bodies = off;

alter default privileges for role "postgres" in schema "public" revoke all on sequences from "anon";

alter default privileges for role "postgres" in schema "public" revoke all on sequences from "authenticated";

alter default privileges for role "postgres" in schema "public" revoke all on sequences from "service_role";

alter default privileges for role "postgres" in schema "public" revoke all on tables from "anon";

alter default privileges for role "postgres" in schema "public" revoke all on tables from "authenticated";

alter default privileges for role "postgres" in schema "public" revoke all on tables from "service_role";

create table "public"."customers" (
  "id"            uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"        uuid                     not null,
  "name"          text                     not null,
  "country"       text,
  "tpin"          text,
  "contact_name"  text,
  "contact_phone" text,
  "contact_email" text,
  "payment_terms" text                     default '50/50 loading/delivery, USD'::text,
  "is_active"     boolean                  not null default true,
  "created_at"    timestamp with time zone not null default now(),
  "payment_days"  integer                  not null default 0,
  constraint "customers_pkey" primary key (id)
);

alter table "public"."customers"
  enable row level security;

create table "public"."driver_floats" (
  "id"               uuid          not null default extensions.uuid_generate_v4(),
  "org_id"           uuid          not null,
  "trip_id"          uuid,
  "driver_id"        uuid          not null,
  "amount"           numeric(14,2) not null,
  "currency"         character(3)  not null,
  "issued_on"        date          not null default CURRENT_DATE,
  "reconciled_on"    date,
  "balance_returned" numeric(14,2),
  "notes"            text,
  constraint "driver_floats_pkey" primary key (id)
);

alter table "public"."driver_floats"
  enable row level security;

create table "public"."drivers" (
  "id"          uuid    not null default extensions.uuid_generate_v4(),
  "org_id"      uuid    not null,
  "full_name"   text    not null,
  "phone"       text,
  "licence_no"  text,
  "passport_no" text,
  "nationality" text,
  "is_active"   boolean not null default true,
  constraint "drivers_pkey" primary key (id)
);

alter table "public"."drivers"
  enable row level security;

create table "public"."fx_rates" (
  "id"           uuid          not null default extensions.uuid_generate_v4(),
  "org_id"       uuid          not null,
  "currency"     character(3)  not null,
  "rate_to_usd"  numeric(18,8) not null,
  "effective_on" date          not null,
  "source"       text,
  constraint "fx_rates_org_id_currency_effective_on_key" unique (org_id, currency, effective_on),
  constraint "fx_rates_pkey" primary key (id)
);

alter table "public"."fx_rates"
  enable row level security;

create table "public"."invoice_counters" (
  "org_id"  uuid    not null,
  "year"    integer not null,
  "last_no" integer not null default 0,
  constraint "invoice_counters_pkey" primary key (org_id, year)
);

alter table "public"."invoice_counters"
  enable row level security;

create table "public"."invoice_lines" (
  "id"          uuid          not null default extensions.uuid_generate_v4(),
  "org_id"      uuid          not null,
  "invoice_id"  uuid          not null,
  "trip_id"     uuid,
  "description" text          not null,
  "quantity"    numeric(12,3) not null default 1,
  "unit_price"  numeric(14,2) not null,
  constraint "invoice_lines_pkey" primary key (id)
);

alter table "public"."invoice_lines"
  enable row level security;

create table "public"."invoices" (
  "id"            uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"        uuid                     not null,
  "invoice_no"    text                     not null,
  "customer_id"   uuid                     not null,
  "invoice_type"  text                     not null default 'delivery'::text,
  "currency"      character(3)             not null default 'USD'::bpchar,
  "subtotal"      numeric(14,2)            not null default 0,
  "downpayment"   numeric(14,2)            not null default 0,
  "total_due"     numeric(14,2)            not null default 0,
  "issued_on"     date,
  "due_on"        date,
  "created_at"    timestamp with time zone not null default now(),
  "cancelled_at"  timestamp with time zone,
  "cancel_reason" text,
  constraint "invoices_org_id_invoice_no_key" unique (org_id, invoice_no),
  constraint "invoices_pkey" primary key (id)
);

alter table "public"."invoices"
  enable row level security;

create table "public"."memberships" (
  "id"         uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"     uuid                     not null,
  "user_id"    uuid                     not null,
  "created_at" timestamp with time zone not null default now(),
  constraint "memberships_org_id_user_id_key" unique (org_id, user_id),
  constraint "memberships_pkey" primary key (id)
);

alter table "public"."memberships"
  enable row level security;

create table "public"."organizations" (
  "id"             uuid                     not null default extensions.uuid_generate_v4(),
  "name"           text                     not null,
  "country"        text                     not null,
  "base_currency"  character(3)             not null default 'USD'::bpchar,
  "created_at"     timestamp with time zone not null default now(),
  "trip_prefix"    text                     not null default 'TRIP'::text,
  "invoice_prefix" text                     not null default 'INV'::text,
  constraint "organizations_pkey" primary key (id)
);

alter table "public"."organizations"
  enable row level security;

create table "public"."payments" (
  "id"          uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"      uuid                     not null,
  "invoice_id"  uuid                     not null,
  "amount"      numeric(14,2)            not null,
  "currency"    character(3)             not null default 'USD'::bpchar,
  "received_on" date                     not null default CURRENT_DATE,
  "method"      text,
  "reference"   text,
  "created_at"  timestamp with time zone not null default now(),
  constraint "payments_pkey" primary key (id)
);

alter table "public"."payments"
  enable row level security;

create table "public"."rate_cards" (
  "id"            uuid          not null default extensions.uuid_generate_v4(),
  "org_id"        uuid          not null,
  "customer_id"   uuid,
  "route_id"      uuid          not null,
  "commodity"     text,
  "rate_amount"   numeric(14,2) not null,
  "rate_currency" character(3)  not null default 'USD'::bpchar,
  "rate_basis"    text          not null default 'per_trip'::text,
  "valid_from"    date          not null default CURRENT_DATE,
  "valid_to"      date,
  constraint "rate_cards_pkey" primary key (id)
);

alter table "public"."rate_cards"
  enable row level security;

create table "public"."routes" (
  "id"          uuid    not null default extensions.uuid_generate_v4(),
  "org_id"      uuid    not null,
  "name"        text    not null,
  "origin"      text    not null,
  "destination" text    not null,
  "distance_km" integer,
  "borders"     text[],
  "target_days" integer,
  constraint "routes_org_id_name_key" unique (org_id, name),
  constraint "routes_pkey" primary key (id)
);

alter table "public"."routes"
  enable row level security;

create table "public"."trip_costs" (
  "id"             uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"         uuid                     not null,
  "trip_id"        uuid                     not null,
  "description"    text,
  "amount"         numeric(14,2)            not null,
  "currency"       character(3)             not null,
  "fx_rate_to_usd" numeric(18,8)            not null,
  "incurred_on"    date                     not null default CURRENT_DATE,
  "location"       text,
  "paid_by"        text,
  "receipt_ref"    text,
  "is_reconciled"  boolean                  not null default false,
  "recorded_by"    uuid,
  "created_at"     timestamp with time zone not null default now(),
  "receipt_path"   text,
  constraint "trip_costs_pkey" primary key (id)
);

alter table "public"."trip_costs"
  enable row level security;

create table "public"."trip_counters" (
  "org_id"  uuid    not null,
  "year"    integer not null,
  "last_no" integer not null default 0,
  constraint "trip_counters_pkey" primary key (org_id, year)
);

alter table "public"."trip_counters"
  enable row level security;

create table "public"."trip_documents" (
  "id"           uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"       uuid                     not null,
  "trip_id"      uuid                     not null,
  "doc_number"   text,
  "storage_path" text,
  "issued_on"    date,
  "received_on"  date,
  "notes"        text,
  "uploaded_by"  uuid,
  "created_at"   timestamp with time zone not null default now(),
  constraint "trip_documents_pkey" primary key (id)
);

alter table "public"."trip_documents"
  enable row level security;

create table "public"."trip_events" (
  "id"          uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"      uuid                     not null,
  "trip_id"     uuid                     not null,
  "event_type"  text                     not null,
  "location"    text,
  "occurred_at" timestamp with time zone not null default now(),
  "detail"      jsonb,
  "recorded_by" uuid,
  "created_at"  timestamp with time zone not null default now(),
  constraint "trip_events_pkey" primary key (id)
);

alter table "public"."trip_events"
  enable row level security;

create table "public"."trips" (
  "id"                 uuid                     not null default extensions.uuid_generate_v4(),
  "org_id"             uuid                     not null,
  "trip_no"            text                     not null,
  "customer_id"        uuid                     not null,
  "route_id"           uuid                     not null,
  "truck_id"           uuid,
  "driver_id"          uuid,
  "commodity"          text,
  "tonnage"            numeric(10,3),
  "container_no"       text,
  "seal_no"            text,
  "revenue_amount"     numeric(14,2),
  "revenue_currency"   character(3)             not null default 'USD'::bpchar,
  "planned_load_date"  date,
  "actual_load_date"   date,
  "planned_eta"        date,
  "actual_delivery_at" timestamp with time zone,
  "pod_received_at"    timestamp with time zone,
  "closed_at"          timestamp with time zone,
  "notes"              text,
  "created_by"         uuid,
  "created_at"         timestamp with time zone not null default now(),
  "updated_at"         timestamp with time zone not null default now(),
  constraint "trips_org_id_trip_no_key" unique (org_id, trip_no),
  constraint "trips_pkey" primary key (id)
);

alter table "public"."trips"
  enable row level security;

create table "public"."trucks" (
  "id"              uuid          not null default extensions.uuid_generate_v4(),
  "org_id"          uuid          not null,
  "fleet_no"        text          not null,
  "horse_reg"       text          not null,
  "trailer_reg"     text,
  "make_model"      text,
  "tank_capacity_l" numeric(10,2),
  "is_active"       boolean       not null default true,
  constraint "trucks_org_id_fleet_no_key" unique (org_id, fleet_no),
  constraint "trucks_pkey" primary key (id)
);

alter table "public"."trucks"
  enable row level security;

alter table "public"."invoice_lines"
  add column "line_total" numeric(14,2) generated always as ((quantity * unit_price)) stored;

alter table "public"."trip_costs"
  add column "amount_usd" numeric(14,2) generated always as ((amount * fx_rate_to_usd)) stored;

create type "public"."cost_category" as enum (
  'fuel',
  'driver_advance',
  'driver_allowance',
  'border_fees',
  'customs_duty',
  'clearing_agent',
  'tolls',
  'weighbridge',
  'permits',
  'escort',
  'demurrage',
  'detention',
  'repairs',
  'tyres',
  'police',
  'other'
);

alter table "public"."trip_costs"
  add column "category" public.cost_category not null;

create type "public"."doc_status" as enum (
  'pending',
  'issued',
  'lodged',
  'cleared',
  'received',
  'rejected'
);

alter table "public"."trip_documents"
  add column "status" public.doc_status not null default 'pending'::public.doc_status;

create type "public"."doc_type" as enum (
  'consignment_note',
  'cmr',
  'packing_list',
  't1_transit',
  'customs_entry',
  'delivery_note',
  'pod',
  'weighbridge_ticket',
  'insurance',
  'permit',
  'other'
);

alter table "public"."trip_documents"
  add column "doc_type" public.doc_type not null;

create type "public"."invoice_status" as enum (
  'draft',
  'issued',
  'part_paid',
  'paid',
  'overdue',
  'cancelled'
);

alter table "public"."invoices"
  add column "status" public.invoice_status not null default 'draft'::public.invoice_status;

create type "public"."org_role" as enum (
  'owner',
  'admin',
  'ops',
  'finance',
  'viewer'
);

alter table "public"."memberships"
  add column "role" public.org_role not null default 'viewer'::public.org_role;

create type "public"."trip_status" as enum (
  'draft',
  'allocated',
  'loading',
  'in_transit',
  'at_border',
  'delivered',
  'pod_received',
  'invoiced',
  'closed',
  'cancelled'
);

alter table "public"."trip_events"
  add column "from_status" public.trip_status;

alter table "public"."trip_events"
  add column "to_status" public.trip_status;

alter table "public"."trips"
  add column "status" public.trip_status not null default 'draft'::public.trip_status;

create or replace function public.cancel_invoice (
  p_invoice uuid,
  p_reason  text
)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
  AS $function$
declare
  inv invoices%rowtype;
  v_paid numeric;
  v_trip_id uuid;
begin
  select * into inv from invoices where id = p_invoice;
  if not found then raise exception 'invoice not found'; end if;

  if not exists (select 1 from memberships where org_id = inv.org_id and user_id = auth.uid()) then
    raise exception 'not a member of this organisation';
  end if;

  if inv.status = 'cancelled' then
    raise exception 'invoice is already cancelled';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to cancel an invoice';
  end if;

  select coalesce(sum(amount), 0) into v_paid from payments where invoice_id = p_invoice;
  if v_paid > 0 then
    raise exception 'cannot cancel — % % has already been recorded against this invoice', inv.currency, v_paid;
  end if;

  update invoices
     set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason)
   where id = p_invoice;

  -- Undo the one side-effect raise_invoice had: if this was the
  -- delivery/full leg that moved the trip to 'invoiced', put it back so
  -- it isn't stuck showing a status nothing now backs.
  select il.trip_id into v_trip_id from invoice_lines il where il.invoice_id = p_invoice limit 1;
  if v_trip_id is not null and inv.invoice_type in ('delivery', 'full') then
    update trips set status = 'pod_received'
     where id = v_trip_id and status = 'invoiced';
  end if;
end;
$function$;

create or replace function public.current_org_ids()
  returns SETOF uuid
  language sql
  stable
  security definer
  set search_path to 'public'
  AS $function$
  select org_id from memberships where user_id = auth.uid();
$function$;

create or replace function public.log_border_event (
  p_trip     uuid,
  p_kind     text,
  p_location text,
  p_detail   jsonb default '{}'::jsonb
)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
  AS $function$
declare v_org uuid;
begin
  select org_id into v_org from trips where id = p_trip;

  if not exists (select 1 from memberships
                 where org_id = v_org and user_id = auth.uid()) then
    raise exception 'not a member of this organisation';
  end if;

  if p_kind not in ('arrival','cleared') then
    raise exception 'kind must be arrival or cleared';
  end if;

  insert into trip_events (org_id, trip_id, event_type, location, detail, recorded_by)
  values (v_org, p_trip, 'border_' || p_kind, p_location, p_detail, auth.uid());

  update trips
     set status = case when p_kind = 'arrival' then 'at_border'::trip_status
                       else 'in_transit'::trip_status end
   where id = p_trip
     and status in ('in_transit','at_border');
end $function$;

create or replace function public.log_trip_status_change()
  returns trigger
  language plpgsql
  AS $function$
begin
  if new.status is distinct from old.status then
    insert into trip_events (org_id, trip_id, event_type, from_status, to_status, recorded_by)
    values (new.org_id, new.id, 'status_change', old.status, new.status, auth.uid());
  end if;
  new.updated_at := now();
  return new;
end $function$;

create or replace function public.next_invoice_no (
  p_org uuid
)
  returns text
  language plpgsql
  security definer
  set search_path to 'public'
  AS $function$
declare y int := extract(year from current_date); n int; prefix text;
begin
  if not exists (select 1 from memberships where org_id = p_org and user_id = auth.uid()) then
    raise exception 'not a member of this organisation';
  end if;

  select invoice_prefix into prefix from organizations where id = p_org;

  insert into invoice_counters (org_id, year, last_no)
  values (p_org, y, 1)
  on conflict (org_id, year) do update set last_no = invoice_counters.last_no + 1
  returning last_no into n;

  return format('%s-%s-%s', prefix, y, lpad(n::text, 4, '0'));
end $function$;

create or replace function public.next_trip_no (
  p_org uuid
)
  returns text
  language plpgsql
  security definer
  set search_path to 'public'
  AS $function$
declare
  y      int := extract(year from current_date);
  n      int;
  prefix text;
begin
  -- Caller must belong to the org. security definer would otherwise let
  -- any authenticated user burn numbers on someone else's sequence.
  if not exists (select 1 from memberships
                 where org_id = p_org and user_id = auth.uid()) then
    raise exception 'not a member of this organisation';
  end if;

  select trip_prefix into prefix from organizations where id = p_org;

  insert into trip_counters (org_id, year, last_no)
  values (p_org, y, 1)
  on conflict (org_id, year)
  do update set last_no = trip_counters.last_no + 1
  returning last_no into n;

  return format('%s-%s-%s', prefix, y, lpad(n::text, 4, '0'));
end $function$;

create or replace function public.raise_invoice (
  p_trip uuid,
  p_type text
)
  returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
  AS $function$
declare
  t         trips%rowtype;
  v_no      text;
  v_id      uuid;
  v_amount  numeric(14,2);
  v_days    int;
  v_desc    text;
begin
  select * into t from trips where id = p_trip;
  if not found then raise exception 'trip not found'; end if;

  if not exists (select 1 from memberships where org_id = t.org_id and user_id = auth.uid()) then
    raise exception 'not a member of this organisation';
  end if;

  if p_type not in ('loading','delivery','full') then
    raise exception 'type must be loading, delivery or full';
  end if;

  if t.revenue_amount is null or t.revenue_amount <= 0 then
    raise exception 'trip has no revenue figure to invoice';
  end if;

  -- The gate that matters: no POD, no delivery invoice.
  if p_type = 'delivery' and t.pod_received_at is null then
    raise exception 'POD not received — the delivery invoice cannot be raised yet';
  end if;

  if p_type in ('loading','full')
     and t.status in ('draft','allocated') then
    raise exception 'trip has not started loading yet';
  end if;

  if exists (select 1 from invoices i
             join invoice_lines il on il.invoice_id = i.id
             where il.trip_id = p_trip
               and i.invoice_type = p_type
               and i.status <> 'cancelled') then
    raise exception 'a % invoice already exists for this trip', p_type;
  end if;

  v_amount := case p_type when 'full' then t.revenue_amount
                          else round(t.revenue_amount * 0.5, 2) end;

  -- Guard against rounding drift on odd revenue figures: the delivery
  -- half is whatever is left, not a second independent 50%.
  if p_type = 'delivery' then
    v_amount := t.revenue_amount - coalesce((
      select sum(il.line_total) from invoices i
      join invoice_lines il on il.invoice_id = i.id
      where il.trip_id = p_trip and i.status <> 'cancelled'), 0);
  end if;

  select coalesce(payment_days, 0) into v_days from customers where id = t.customer_id;
  v_no := next_invoice_no(t.org_id);

  insert into invoices (org_id, invoice_no, customer_id, status, invoice_type,
                        currency, subtotal, downpayment, total_due, issued_on, due_on)
  values (t.org_id, v_no, t.customer_id, 'issued', p_type,
          t.revenue_currency, v_amount, 0, v_amount,
          current_date, current_date + v_days)
  returning id into v_id;

  v_desc := format('%s — %s (%s)',
    t.trip_no,
    (select name from routes where id = t.route_id),
    case p_type when 'loading'  then '50% on loading'
                when 'delivery' then '50% on delivery'
                else 'full freight charge' end);

  insert into invoice_lines (org_id, invoice_id, trip_id, description, quantity, unit_price)
  values (t.org_id, v_id, p_trip, v_desc, 1, v_amount);

  if p_type in ('delivery','full') then
    update trips set status = 'invoiced' where id = p_trip and status = 'pod_received';
  end if;

  return v_id;
end $function$;

create or replace function public.sync_invoice_status()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
  AS $function$
declare v_inv uuid; v_due numeric; v_paid numeric;
begin
  v_inv := coalesce(new.invoice_id, old.invoice_id);
  select total_due into v_due from invoices where id = v_inv;
  select coalesce(sum(amount),0) into v_paid from payments where invoice_id = v_inv;

  update invoices
     set status = case
       when status = 'cancelled' then 'cancelled'
       when v_paid >= v_due and v_due > 0 then 'paid'
       when v_paid > 0 then 'part_paid'
       else 'issued' end
   where id = v_inv;

  return null;
end $function$;

alter table "public"."driver_floats"
  add constraint "driver_floats_driver_id_fkey" foreign key (driver_id) references public.drivers(id);

alter table "public"."invoices"
  add constraint "invoices_customer_id_fkey" foreign key (customer_id) references public.customers(id);

alter table "public"."invoice_lines"
  add constraint "invoice_lines_invoice_id_fkey" foreign key (invoice_id) references public.invoices(id) on delete cascade;

alter table "public"."memberships"
  add constraint "memberships_user_id_fkey" foreign key (user_id) references auth.users(id) on delete cascade;

alter table "public"."customers"
  add constraint "customers_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."driver_floats"
  add constraint "driver_floats_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."drivers"
  add constraint "drivers_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."fx_rates"
  add constraint "fx_rates_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."invoice_counters"
  add constraint "invoice_counters_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."invoice_lines"
  add constraint "invoice_lines_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."invoices"
  add constraint "invoices_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."memberships"
  add constraint "memberships_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."payments"
  add constraint "payments_invoice_id_fkey" foreign key (invoice_id) references public.invoices(id) on delete cascade;

alter table "public"."payments"
  add constraint "payments_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."rate_cards"
  add constraint "rate_cards_customer_id_fkey" foreign key (customer_id) references public.customers(id) on delete cascade;

alter table "public"."rate_cards"
  add constraint "rate_cards_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."routes"
  add constraint "routes_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."rate_cards"
  add constraint "rate_cards_route_id_fkey" foreign key (route_id) references public.routes(id) on delete cascade;

alter table "public"."trip_costs"
  add constraint "trip_costs_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."trip_costs"
  add constraint "trip_costs_recorded_by_fkey" foreign key (recorded_by) references auth.users(id);

alter table "public"."trip_counters"
  add constraint "trip_counters_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."trip_documents"
  add constraint "trip_documents_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."trip_documents"
  add constraint "trip_documents_uploaded_by_fkey" foreign key (uploaded_by) references auth.users(id);

alter table "public"."trip_events"
  add constraint "trip_events_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."trip_events"
  add constraint "trip_events_recorded_by_fkey" foreign key (recorded_by) references auth.users(id);

alter table "public"."trips"
  add constraint "trips_created_by_fkey" foreign key (created_by) references auth.users(id);

alter table "public"."trips"
  add constraint "trips_customer_id_fkey" foreign key (customer_id) references public.customers(id);

alter table "public"."trips"
  add constraint "trips_driver_id_fkey" foreign key (driver_id) references public.drivers(id);

alter table "public"."trips"
  add constraint "trips_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."driver_floats"
  add constraint "driver_floats_trip_id_fkey" foreign key (trip_id) references public.trips(id) on delete set null;

alter table "public"."invoice_lines"
  add constraint "invoice_lines_trip_id_fkey" foreign key (trip_id) references public.trips(id);

alter table "public"."trip_costs"
  add constraint "trip_costs_trip_id_fkey" foreign key (trip_id) references public.trips(id) on delete cascade;

alter table "public"."trip_documents"
  add constraint "trip_documents_trip_id_fkey" foreign key (trip_id) references public.trips(id) on delete cascade;

alter table "public"."trip_events"
  add constraint "trip_events_trip_id_fkey" foreign key (trip_id) references public.trips(id) on delete cascade;

alter table "public"."trips"
  add constraint "trips_route_id_fkey" foreign key (route_id) references public.routes(id);

alter table "public"."trucks"
  add constraint "trucks_org_id_fkey" foreign key (org_id) references public.organizations(id) on delete cascade;

alter table "public"."trips"
  add constraint "trips_truck_id_fkey" foreign key (truck_id) references public.trucks(id);

create view "public"."billable" with (security_invoker=on) AS  SELECT t.id AS trip_id,
    t.org_id,
    t.trip_no,
    c.name AS customer,
    r.name AS route,
    t.status,
    t.revenue_amount AS revenue_usd,
    round((t.revenue_amount * 0.5), 2) AS half_usd,
    (t.pod_received_at IS NOT NULL) AS pod_in_hand,
    (EXISTS ( SELECT 1
           FROM (public.invoices i
             JOIN public.invoice_lines il ON ((il.invoice_id = i.id)))
          WHERE ((il.trip_id = t.id) AND (i.invoice_type = 'loading'::text) AND (i.status <> 'cancelled'::public.invoice_status)))) AS loading_invoiced,
    (EXISTS ( SELECT 1
           FROM (public.invoices i
             JOIN public.invoice_lines il ON ((il.invoice_id = i.id)))
          WHERE ((il.trip_id = t.id) AND (i.invoice_type = 'delivery'::text) AND (i.status <> 'cancelled'::public.invoice_status)))) AS delivery_invoiced
   FROM ((public.trips t
     JOIN public.customers c ON ((c.id = t.customer_id)))
     JOIN public.routes r ON ((r.id = t.route_id)))
  WHERE (t.status <> ALL (ARRAY['draft'::public.trip_status, 'allocated'::public.trip_status, 'cancelled'::public.trip_status, 'closed'::public.trip_status]));

create view "public"."invoice_ar" AS  SELECT i.id,
    i.org_id,
    i.invoice_no,
    i.invoice_type,
    i.status,
    c.name AS customer,
    i.currency,
    i.total_due,
    COALESCE(p.paid, (0)::numeric) AS paid,
        CASE
            WHEN (i.status = 'cancelled'::public.invoice_status) THEN (0)::numeric
            ELSE (i.total_due - COALESCE(p.paid, (0)::numeric))
        END AS outstanding,
    i.issued_on,
    i.due_on,
        CASE
            WHEN (i.status = 'cancelled'::public.invoice_status) THEN 0
            WHEN ((i.due_on < CURRENT_DATE) AND (i.total_due > COALESCE(p.paid, (0)::numeric))) THEN (CURRENT_DATE - i.due_on)
            ELSE 0
        END AS days_overdue,
        CASE
            WHEN (i.status = 'cancelled'::public.invoice_status) THEN 'cancelled'::text
            WHEN (i.total_due <= COALESCE(p.paid, (0)::numeric)) THEN 'settled'::text
            WHEN (i.due_on >= CURRENT_DATE) THEN 'current'::text
            WHEN ((CURRENT_DATE - i.due_on) <= 30) THEN '1-30'::text
            WHEN ((CURRENT_DATE - i.due_on) <= 60) THEN '31-60'::text
            ELSE '60+'::text
        END AS bucket,
    ( SELECT string_agg(t.trip_no, ', '::text) AS string_agg
           FROM (public.invoice_lines il
             JOIN public.trips t ON ((t.id = il.trip_id)))
          WHERE (il.invoice_id = i.id)) AS trips,
    i.cancelled_at,
    i.cancel_reason
   FROM ((public.invoices i
     JOIN public.customers c ON ((c.id = i.customer_id)))
     LEFT JOIN LATERAL ( SELECT sum(pm.amount) AS paid
           FROM public.payments pm
          WHERE (pm.invoice_id = i.id)) p ON (true));

create view "public"."pod_outstanding" AS  SELECT t.id AS trip_id,
    t.org_id,
    t.trip_no,
    c.name AS customer,
    r.name AS route,
    d.full_name AS driver,
    tk.fleet_no,
    t.actual_delivery_at,
    (CURRENT_DATE - (t.actual_delivery_at)::date) AS days_since_delivery,
    t.revenue_amount AS revenue_usd,
    round((t.revenue_amount * 0.5), 2) AS unbillable_usd
   FROM ((((public.trips t
     JOIN public.customers c ON ((c.id = t.customer_id)))
     JOIN public.routes r ON ((r.id = t.route_id)))
     LEFT JOIN public.drivers d ON ((d.id = t.driver_id)))
     LEFT JOIN public.trucks tk ON ((tk.id = t.truck_id)))
  WHERE ((t.status = 'delivered'::public.trip_status) AND (t.pod_received_at IS NULL) AND (t.actual_delivery_at IS NOT NULL))
  ORDER BY t.actual_delivery_at;

create view "public"."trip_board" with (security_invoker=on) AS  SELECT t.id AS trip_id,
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
         LIMIT 1) AS last_border_at
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

create view "public"."trip_doc_status" AS  SELECT t.id AS trip_id,
    t.org_id,
    t.trip_no,
    t.status,
    count(td.id) FILTER (WHERE (td.status = ANY (ARRAY['issued'::public.doc_status, 'lodged'::public.doc_status, 'cleared'::public.doc_status, 'received'::public.doc_status]))) AS docs_complete,
    count(td.id) FILTER (WHERE (td.status = 'pending'::public.doc_status)) AS docs_pending,
    count(td.id) FILTER (WHERE (td.status = 'rejected'::public.doc_status)) AS docs_rejected,
    bool_or(((td.doc_type = 'pod'::public.doc_type) AND (td.status = 'received'::public.doc_status))) AS pod_in_hand
   FROM (public.trips t
     LEFT JOIN public.trip_documents td ON ((td.trip_id = t.id)))
  WHERE (t.status <> ALL (ARRAY['closed'::public.trip_status, 'cancelled'::public.trip_status]))
  GROUP BY t.id;

create view "public"."trip_margin" AS  SELECT t.id AS trip_id,
    t.org_id,
    t.trip_no,
    t.status,
    c.name AS customer,
    r.name AS route,
    tk.fleet_no,
    t.actual_load_date,
    t.actual_delivery_at,
    t.revenue_amount AS revenue_usd,
    COALESCE(sum(tc.amount_usd), (0)::numeric) AS cost_usd,
    (t.revenue_amount - COALESCE(sum(tc.amount_usd), (0)::numeric)) AS margin_usd,
        CASE
            WHEN (t.revenue_amount > (0)::numeric) THEN round((((t.revenue_amount - COALESCE(sum(tc.amount_usd), (0)::numeric)) / t.revenue_amount) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS margin_pct
   FROM ((((public.trips t
     JOIN public.customers c ON ((c.id = t.customer_id)))
     JOIN public.routes r ON ((r.id = t.route_id)))
     LEFT JOIN public.trucks tk ON ((tk.id = t.truck_id)))
     LEFT JOIN public.trip_costs tc ON ((tc.trip_id = t.id)))
  WHERE (t.status <> 'cancelled'::public.trip_status)
  GROUP BY t.id, c.name, r.name, tk.fleet_no;

create index memberships_user_id_idx on public.memberships using btree (user_id);

create index trip_costs_org_id_category_incurred_on_idx on public.trip_costs using btree (org_id, category, incurred_on);

create index trip_costs_trip_id_idx on public.trip_costs using btree (trip_id);

create index trip_documents_trip_id_doc_type_idx on public.trip_documents using btree (trip_id, doc_type);

create index trip_events_trip_id_occurred_at_idx on public.trip_events using btree (trip_id, occurred_at);

create index trips_customer_id_idx on public.trips using btree (customer_id);

create index trips_org_id_actual_load_date_idx on public.trips using btree (org_id, actual_load_date desc);

create index trips_org_id_status_idx on public.trips using btree (org_id, status);

create trigger trg_payment_sync
  after insert or delete or update on public.payments
  for each row
  execute function public.sync_invoice_status();

create trigger trg_trip_status
  before update on public.trips
  for each row
  execute function public.log_trip_status_change();

create policy "org_isolation" on "public"."customers"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "org_isolation" on "public"."driver_floats"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "org_isolation" on "public"."drivers"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "org_isolation" on "public"."fx_rates"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "inv_counters_org" on "public"."invoice_counters"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "org_isolation" on "public"."invoice_lines"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "org_isolation" on "public"."invoices"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "membership_read" on "public"."memberships"
  for select
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)));

create policy "org_read" on "public"."organizations"
  for select
  to PUBLIC
  using ((id in ( select public.current_org_ids() as current_org_ids)));

create policy "org_isolation" on "public"."payments"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "org_isolation" on "public"."rate_cards"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "org_isolation" on "public"."routes"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "org_isolation" on "public"."trip_costs"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "counters_org" on "public"."trip_counters"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "org_isolation" on "public"."trip_documents"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "org_isolation" on "public"."trip_events"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "org_isolation" on "public"."trips"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

create policy "org_isolation" on "public"."trucks"
  for all
  to PUBLIC
  using ((org_id in ( select public.current_org_ids() as current_org_ids)))
  with check ((org_id IN ( SELECT public.current_org_ids() AS current_org_ids)));

grant execute on function "public"."cancel_invoice"(uuid, text) to public, "anon", "authenticated", "postgres", "service_role";

grant execute on function "public"."current_org_ids"() to public, "anon", "authenticated", "postgres", "service_role";

grant execute on function "public"."log_border_event"(uuid, text, text, jsonb) to public, "anon", "authenticated", "postgres", "service_role";

grant execute on function "public"."log_trip_status_change"() to public, "anon", "authenticated", "postgres", "service_role";

grant execute on function "public"."next_invoice_no"(uuid) to public, "anon", "authenticated", "postgres", "service_role";

grant execute on function "public"."next_trip_no"(uuid) to public, "anon", "authenticated", "postgres", "service_role";

grant execute on function "public"."raise_invoice"(uuid, text) to public, "anon", "authenticated", "postgres", "service_role";

grant execute on function "public"."sync_invoice_status"() to public, "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."customers" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."driver_floats" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."drivers" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."fx_rates" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."invoice_counters" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."invoice_lines" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."invoices" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."memberships" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."organizations" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."payments" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."rate_cards" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."routes" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."trip_costs" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."trip_counters" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."trip_documents" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."trip_events" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."trips" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."trucks" to "anon", "authenticated", "postgres", "service_role";

grant usage on type "public"."cost_category" to "postgres";

grant usage on type "public"."doc_status" to "postgres";

grant usage on type "public"."doc_type" to "postgres";

grant usage on type "public"."invoice_status" to "postgres";

grant usage on type "public"."org_role" to "postgres";

grant usage on type "public"."trip_status" to "postgres";

revoke all on table "public"."billable" from "anon";

grant delete, insert, maintain, references, trigger, truncate, update on table "public"."billable" to "anon";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."billable" to "authenticated", "postgres", "service_role";

revoke all on table "public"."invoice_ar" from "anon";

grant delete, insert, maintain, references, trigger, truncate, update on table "public"."invoice_ar" to "anon";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."invoice_ar" to "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."pod_outstanding" to "anon", "authenticated", "postgres", "service_role";

revoke all on table "public"."trip_board" from "anon";

grant delete, insert, maintain, references, trigger, truncate, update on table "public"."trip_board" to "anon";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."trip_board" to "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."trip_doc_status" to "anon", "authenticated", "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."trip_margin" to "anon", "authenticated", "postgres", "service_role";

alter default privileges for role "postgres" in schema "public" grant select, update, usage on sequences to "anon";

alter default privileges for role "postgres" in schema "public" grant select, update, usage on sequences to "authenticated";

alter default privileges for role "postgres" in schema "public" grant select, update, usage on sequences to "service_role";

alter default privileges for role "postgres" in schema "public" grant execute on FUNCTIONS to "anon";

alter default privileges for role "postgres" in schema "public" grant execute on FUNCTIONS to "authenticated";

alter default privileges for role "postgres" in schema "public" grant execute on FUNCTIONS to "service_role";

alter default privileges for role "postgres" in schema "public" grant delete, insert, maintain, references, select, trigger, truncate, update on tables to "anon";

alter default privileges for role "postgres" in schema "public" grant delete, insert, maintain, references, select, trigger, truncate, update on tables to "authenticated";

alter default privileges for role "postgres" in schema "public" grant delete, insert, maintain, references, select, trigger, truncate, update on tables to "service_role";

