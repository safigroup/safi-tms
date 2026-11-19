-- Demo company: a fictional haulier for showing prospects the real app.
--
-- reset_demo_company() deletes everything the demo company holds and builds
-- it again, in one transaction. Its users (memberships) are kept, so demo
-- logins survive a reset. It builds:
--   8 trucks, 9 drivers, 6 customers, 5 routes on the Dar es Salaam corridors,
--   about five months of trips at every stage, with border crossings, costs,
--   driver floats, documents, invoices, payments, truck costs and a cashbook.
-- The story is the same every run (fixed random seed); only the dates move
-- with today. So the Board always shows a truck loading, trucks on the road,
-- one held at Kasumbalesa past its target, a delivery waiting for its POD,
-- trips ready to bill and trucks booked for the coming days.
--
-- /api/cron/demo-reset runs it nightly, which keeps the dates current and
-- wipes whatever was clicked during a demo.
--
-- It only ever touches the one organization id below, and refuses to run if
-- that id belongs to a company whose trip prefix isn't DEMO. Fictional
-- throughout: names are invented, customer emails use the reserved .example
-- domain and phone numbers are 000 numbers, so nothing can reach a real
-- person. Documents carry numbers and dates but no files.

create or replace function public.reset_demo_company()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c_org    constant uuid := 'd3e00000-0000-4000-a000-000000000001';
  c_tz     constant text := 'Africa/Dar_es_Salaam';
  v_now    timestamptz := now();
  v_today  date;
  v_start  date;
  v_open   date;

  cu_mw uuid; cu_kol uuid; cu_kivu uuid; cu_lwiza uuid; cu_tembo uuid; cu_bahari uuid;
  r_lub uuid; r_kol uuid; r_goma uuid; r_chi uuid; r_ndo uuid;
  a_usd uuid; a_tzs uuid; a_mpesa uuid; a_cash uuid;
  v_trucks  uuid[] := '{}';
  v_drivers uuid[] := '{}';
  v_id uuid;

  -- truck history generation
  v_pat   text[] := array['LUB,CHI,LUB,GOMA', 'LUB,CHI,KOL,GOMA', 'CHI,LUB,GOMA,LUB', 'CHI,LUB,KOL,LUB',
                          'CHI,GOMA,LUB,KOL', 'LUB,KOL,GOMA,CHI', 'LUB,GOMA,KOL,CHI', 'KOL,CHI,LUB'];
  v_until date[];
  v_next date; v_l1 date; v_l2 date;
  v_route text; v_cust text;
  v_borders text[]; v_fracs numeric[]; v_dwell numeric[];
  v_drive numeric; v_days int; v_ret int;
  b_drive numeric; b_dwell numeric[]; b_days int;
  i int; k int; n int;

  -- per trip
  r record;
  v_trip uuid; v_no int; v_year int; v_trip_no text;
  v_created timestamptz; t_alloc timestamptz; t_load timestamptz; t_dep timestamptz;
  t_del timestamptz; t_pod timestamptz;
  v_arr timestamptz[]; v_clr timestamptz[]; v_acc numeric;
  v_status trip_status;
  v_target int; v_dist int;
  v_d date; v_mid date;
  v_l numeric; v_p numeric;
  v_place text;

  -- billing
  inv record;
  v_pay date; v_pay2 date; v_amt numeric; v_ref int := 0; v_disputed boolean := false;
  v_count jsonb;
begin
  -- Refuse if the id ever belongs to someone else's company.
  if exists (select 1 from organizations where id = c_org and coalesce(trip_prefix, '') <> 'DEMO') then
    raise exception 'organization % is not the demo company', c_org;
  end if;

  insert into organizations (id, name, country, base_currency, trip_prefix, invoice_prefix, time_zone)
  values (c_org, 'Demo Haulage Ltd', 'Tanzania', 'USD', 'DEMO', 'DEMO-INV', c_tz)
  on conflict (id) do update
     set base_currency = 'USD', trip_prefix = 'DEMO', invoice_prefix = 'DEMO-INV', time_zone = c_tz;

  v_today := org_today(c_org);
  v_start := v_today - 150;
  v_open  := v_today - 160;
  perform setseed(0.2026);

  -- ── wipe ──────────────────────────────────────────────────────────────
  delete from cash_reconciliations where org_id = c_org;
  delete from payments            where org_id = c_org;
  delete from invoice_lines       where org_id = c_org;
  delete from invoices            where org_id = c_org;
  delete from invoice_counters    where org_id = c_org;
  delete from audit_log           where org_id = c_org;
  delete from trip_events         where org_id = c_org;
  delete from trip_documents      where org_id = c_org;
  delete from trip_costs          where org_id = c_org;
  delete from trip_allocations    where org_id = c_org;
  delete from driver_floats       where org_id = c_org;
  delete from trips               where org_id = c_org;
  delete from trip_counters       where org_id = c_org;
  delete from truck_costs         where org_id = c_org;
  delete from rate_cards          where org_id = c_org;
  delete from route_cost_templates where org_id = c_org;
  delete from route_border_paths  where org_id = c_org;
  delete from routes              where org_id = c_org;
  delete from payment_milestones  where org_id = c_org;
  delete from customers           where org_id = c_org;
  delete from trucks              where org_id = c_org;
  delete from drivers             where org_id = c_org;
  delete from cash_transactions   where org_id = c_org;
  delete from cash_accounts       where org_id = c_org;
  delete from fx_rates            where org_id = c_org;

  -- ── exchange rates: weekly, drifting gently, up to today ──────────────
  insert into fx_rates (org_id, currency, rate_to_usd, effective_on, source)
  select c_org, cur, round((1 / (base + slope * w + (random() - 0.5) * noise))::numeric, 8), v_today - 161 + w * 7, 'demo'
    from generate_series(0, 23) w
   cross join (values ('TZS', 2585::numeric, 2.6::numeric, 14::numeric),
                      ('ZMW', 26.6, -0.07, 0.3),
                      ('CDF', 2860, -3.1, 18),
                      ('RWF', 1438, 1.1, 6)) as c(cur, base, slope, noise);

  -- ── customers and payment schedules ───────────────────────────────────
  insert into customers (org_id, name, country, tpin, contact_name, contact_phone, contact_email, payment_terms, payment_days)
  values (c_org, 'Mwangaza Mining Supplies SARL', 'CD', null, 'Patrick Ilunga', '+243 970 000 101', 'logistics@mwangaza-mining.example', '30 days', 30)
  returning id into cu_mw;
  insert into customers (org_id, name, country, tpin, contact_name, contact_phone, contact_email, payment_terms, payment_days)
  values (c_org, 'Kolwe Mineral Logistics SARL', 'CD', null, 'Sandrine Mbuyi', '+243 970 000 102', 'transport@kolwe-minerals.example', '30 days', 30)
  returning id into cu_kol;
  insert into customers (org_id, name, country, tpin, contact_name, contact_phone, contact_email, payment_terms, payment_days)
  values (c_org, 'Kivu Lake Traders SARL', 'CD', null, 'Eric Habimana', '+243 970 000 103', 'imports@kivulake.example', '15 days', 15)
  returning id into cu_kivu;
  insert into customers (org_id, name, country, tpin, contact_name, contact_phone, contact_email, payment_terms, payment_days)
  values (c_org, 'Lwiza Grain Millers Ltd', 'ZM', '2000000104', 'Grace Phiri', '+260 970 000 104', 'supply@lwizagrain.example', '14 days', 14)
  returning id into cu_lwiza;
  insert into customers (org_id, name, country, tpin, contact_name, contact_phone, contact_email, payment_terms, payment_days)
  values (c_org, 'Tembo Building Materials Ltd', 'ZM', '2000000105', 'Moses Tembo', '+260 970 000 105', 'accounts@tembobuild.example', '30 days', 30)
  returning id into cu_tembo;
  insert into customers (org_id, name, country, tpin, contact_name, contact_phone, contact_email, payment_terms, payment_days)
  values (c_org, 'Bahari Export Partners Ltd', 'TZ', null, 'Amina Salim', '+255 700 000 106', 'shipping@bahariexport.example', '7 days', 7)
  returning id into cu_bahari;

  insert into payment_milestones (org_id, customer_id, seq, label, pct, requires_pod) values
    (c_org, null,      1, 'On loading',             50,  false),
    (c_org, null,      2, 'On delivery',            50,  true),
    (c_org, cu_kol,    1, 'On loading',             70,  false),
    (c_org, cu_kol,    2, 'On delivery',            30,  true),
    (c_org, cu_kivu,   1, 'At loading',             40,  false),
    (c_org, cu_kivu,   2, 'At offloading',          20,  false),
    (c_org, cu_kivu,   3, 'At container drop-off',  40,  true),
    (c_org, cu_bahari, 1, 'On delivery',            100, true);

  -- ── routes ────────────────────────────────────────────────────────────
  insert into routes (org_id, name, origin, destination, distance_km, borders, target_days)
  values (c_org, 'Dar es Salaam - Lubumbashi', 'Dar es Salaam, TZ', 'Lubumbashi, CD', 2100, array['Tunduma / Nakonde', 'Kasumbalesa'], 14)
  returning id into r_lub;
  insert into routes (org_id, name, origin, destination, distance_km, borders, target_days)
  values (c_org, 'Dar es Salaam - Kolwezi', 'Dar es Salaam, TZ', 'Kolwezi, CD', 2400, array['Tunduma / Nakonde', 'Kasumbalesa'], 16)
  returning id into r_kol;
  insert into routes (org_id, name, origin, destination, distance_km, borders, target_days)
  values (c_org, 'Dar es Salaam - Goma', 'Dar es Salaam, TZ', 'Goma, CD', 1650, array['Rusumo', 'Rubavu / Goma'], 10)
  returning id into r_goma;
  insert into routes (org_id, name, origin, destination, distance_km, borders, target_days)
  values (c_org, 'Dar es Salaam - Chingola', 'Dar es Salaam, TZ', 'Chingola, ZM', 1900, array['Tunduma / Nakonde'], 12)
  returning id into r_chi;
  insert into routes (org_id, name, origin, destination, distance_km, borders, target_days)
  values (c_org, 'Ndola - Dar es Salaam', 'Ndola, ZM', 'Dar es Salaam, TZ', 1860, array['Nakonde / Tunduma'], 10)
  returning id into r_ndo;

  insert into route_border_paths (org_id, route_id, label, borders)
  values (c_org, r_lub, 'Via Mokambo', array['Tunduma / Nakonde', 'Mokambo']);

  insert into route_cost_templates (org_id, route_id, category, amount, currency, basis)
  select c_org, rid, cat, amt, 'USD', basis
    from (values
      (r_lub,  'fuel', 0.56, 'per_km'), (r_lub,  'driver_allowance', 350, 'per_trip'), (r_lub,  'border_fees', 620, 'per_trip'),
      (r_lub,  'clearing_agent', 440, 'per_trip'), (r_lub,  'tolls', 60, 'per_trip'), (r_lub,  'permits', 40, 'per_trip'),
      (r_kol,  'fuel', 0.56, 'per_km'), (r_kol,  'driver_allowance', 400, 'per_trip'), (r_kol,  'border_fees', 640, 'per_trip'),
      (r_kol,  'clearing_agent', 460, 'per_trip'), (r_kol,  'tolls', 60, 'per_trip'), (r_kol,  'permits', 40, 'per_trip'),
      (r_goma, 'fuel', 0.58, 'per_km'), (r_goma, 'driver_allowance', 250, 'per_trip'), (r_goma, 'border_fees', 360, 'per_trip'),
      (r_goma, 'clearing_agent', 330, 'per_trip'), (r_goma, 'tolls', 25, 'per_trip'), (r_goma, 'permits', 50, 'per_trip'),
      (r_chi,  'fuel', 0.55, 'per_km'), (r_chi,  'driver_allowance', 300, 'per_trip'), (r_chi,  'border_fees', 160, 'per_trip'),
      (r_chi,  'clearing_agent', 170, 'per_trip'), (r_chi,  'tolls', 55, 'per_trip'), (r_chi,  'permits', 40, 'per_trip'),
      (r_ndo,  'fuel', 0.52, 'per_km'), (r_ndo,  'driver_allowance', 250, 'per_trip'), (r_ndo,  'border_fees', 140, 'per_trip'),
      (r_ndo,  'clearing_agent', 160, 'per_trip'), (r_ndo,  'tolls', 55, 'per_trip')
    ) as t(rid, cat, amt, basis);

  insert into rate_cards (org_id, customer_id, route_id, commodity, rate_amount, rate_currency, rate_basis, valid_from)
  values (c_org, cu_mw,     r_lub,  null, 6800, 'USD', 'per_trip', v_today - 365),
         (c_org, cu_kol,    r_kol,  null, 7900, 'USD', 'per_trip', v_today - 365),
         (c_org, cu_kivu,   r_goma, null, 5600, 'USD', 'per_trip', v_today - 365),
         (c_org, cu_lwiza,  r_chi,  null, 4600, 'USD', 'per_trip', v_today - 365),
         (c_org, cu_tembo,  r_chi,  null, 4750, 'USD', 'per_trip', v_today - 365),
         (c_org, cu_bahari, r_ndo,  null, 2900, 'USD', 'per_trip', v_today - 365);

  -- ── fleet ─────────────────────────────────────────────────────────────
  for k in 1..8 loop
    insert into trucks (org_id, fleet_no, horse_reg, trailer_reg, make_model, tank_capacity_l, is_active, purchase_date, truck_type)
    values (c_org, 'DH-0' || k, 'T ' || (100 + k * 7) || ' DM' || chr(64 + k), 'T ' || (300 + k * 11) || ' DT' || chr(64 + k),
            (array['Howo A7 6x4', 'Scania R460', 'Mercedes-Benz Actros 3340', 'MAN TGS 26.440',
                   'Volvo FH 440', 'Howo A7 6x4', 'Shacman X3000', 'Scania G410'])[k],
            (array[600, 700, 750, 700, 800, 600, 650, 700])[k], true, v_today - (420 + k * 190), 'flatbed')
    returning id into v_id;
    v_trucks := v_trucks || v_id;
  end loop;

  for k in 1..9 loop
    insert into drivers (org_id, full_name, phone, licence_no, passport_no, nationality, is_active)
    values (c_org,
            (array['Juma Mwakalinga', 'Hassan Mfinanga', 'Bakari Said', 'Emmanuel Banda', 'Joseph Mulenga',
                   'Jean-Pierre Kabongo', 'Daniel Nshimiyimana', 'Peter Ochieng', 'Rashidi Kombo'])[k],
            '+255 700 000 2' || lpad(k::text, 2, '0'), 'DL-40000' || lpad(k::text, 2, '0'), 'PX00000' || lpad(k::text, 2, '0'),
            (array['TZ', 'TZ', 'TZ', 'ZM', 'ZM', 'CD', 'RW', 'KE', 'TZ'])[k], true)
    returning id into v_id;
    v_drivers := v_drivers || v_id;
  end loop;

  -- ── cashbook accounts ─────────────────────────────────────────────────
  insert into cash_accounts (org_id, name, kind, currency, opening_balance, opening_date)
  values (c_org, 'Bank — USD account', 'bank', 'USD', 60000, v_open) returning id into a_usd;
  insert into cash_accounts (org_id, name, kind, currency, opening_balance, opening_date)
  values (c_org, 'Bank — TZS account', 'bank', 'TZS', 45000000, v_open) returning id into a_tzs;
  insert into cash_accounts (org_id, name, kind, currency, opening_balance, opening_date)
  values (c_org, 'M-Pesa till', 'mobile_money', 'TZS', 1500000, v_open) returning id into a_mpesa;
  insert into cash_accounts (org_id, name, kind, currency, opening_balance, opening_date)
  values (c_org, 'Office cash — USD', 'cash', 'USD', 2000, v_open) returning id into a_cash;

  -- ── trips: the present first, then each truck's history backwards ─────
  drop table if exists _dt;
  create temp table _dt (
    truck int, route text, cust text, load_date date,
    drive numeric, dwell numeric[], borders text[], fracs numeric[],
    pod_lag int, kind text default 'hist', load_h numeric default 8, depart_h numeric default 30,
    mokambo boolean default false, notes text, extra_cost text
  ) on commit drop;

  -- One truck per story on today's Board.
  insert into _dt (truck, route, cust, load_date, drive, dwell, borders, fracs, pod_lag, kind, load_h, depart_h, notes, extra_cost) values
    (1, 'LUB',  'mw',     v_today + 2,  200, array[26, 55],  array['Tunduma / Nakonde', 'Kasumbalesa'], array[0.30, 0.78], 5,  'now', 8, 30, null, null),
    (2, 'GOMA', 'kivu',   v_today - 1,  150, array[10, 20],  array['Rusumo', 'Rubavu / Goma'],          array[0.55, 0.92], 4,  'now', 14, 54, 'Loading at the port — container released late, departs tomorrow morning.', null),
    (3, 'LUB',  'mw',     v_today - 5,  200, array[24, 60],  array['Tunduma / Nakonde', 'Kasumbalesa'], array[0.30, 0.78], 5,  'now', 8, 30, null, null),
    (4, 'KOL',  'kol',    v_today - 17, 309, array[30, 150], array['Tunduma / Nakonde', 'Kasumbalesa'], array[0.22, 0.92], 7,  'now', 8, 30,
       'Gearbox repaired at Mpika (2 days lost). Long queue at Kasumbalesa on the DRC side.', 'gearbox'),
    (5, 'GOMA', 'kivu',   v_today - 12, 150, array[10, 20],  array['Rusumo', 'Rubavu / Goma'],          array[0.55, 0.92], 99, 'now', 8, 30, 'Offloaded at the customer''s Goma warehouse; empty container still to be returned for the POD.', null),
    (5, 'LUB',  'mw',     v_today + 6,  200, array[28, 50],  array['Tunduma / Nakonde', 'Kasumbalesa'], array[0.30, 0.78], 5,  'now', 8, 30, null, null),
    (6, 'CHI',  'tembo',  v_today - 15, 176, array[26],      array['Tunduma / Nakonde'],                array[0.42],       4,  'now', 8, 30, null, null),
    (6, 'NDO',  'bahari', v_today - 4,  168, array[14],      array['Nakonde / Tunduma'],                array[0.30],       4,  'now', 8, 30, 'Backload from Ndola after the Chingola delivery.', null),
    (7, 'CHI',  'lwiza',  v_today - 13, 176, array[28],      array['Tunduma / Nakonde'],                array[0.42],       3,  'now', 8, 30, null, null);
  -- An order waiting for a truck, and one the customer called off.
  insert into _dt (truck, route, cust, load_date, drive, dwell, borders, fracs, pod_lag, kind, notes) values
    (null, 'CHI',  'tembo', v_today + 6,  176, array[26],     array['Tunduma / Nakonde'],      array[0.42],       4, 'draft', 'Customer confirmed the order; truck to be assigned.'),
    (null, 'GOMA', 'kivu',  v_today - 61, 150, array[10, 20], array['Rusumo', 'Rubavu / Goma'], array[0.55, 0.92], 4, 'cancelled', 'Customer postponed the shipment.');

  -- Each truck's history ends before its first trip above (truck 8 has been in the workshop).
  v_until := array[v_today + 2, v_today - 1, v_today - 5, v_today - 17, v_today - 12, v_today - 15, v_today - 13, v_today - 16];
  for k in 1..8 loop
    v_next := v_until[k];
    n := array_length(string_to_array(v_pat[k], ','), 1);
    i := 0;
    loop
      v_route := split_part(v_pat[k], ',', 1 + i % n);
      v_borders := case v_route
        when 'LUB'  then case when random() < 0.25 then array['Tunduma / Nakonde', 'Mokambo'] else array['Tunduma / Nakonde', 'Kasumbalesa'] end
        when 'KOL'  then array['Tunduma / Nakonde', 'Kasumbalesa']
        when 'GOMA' then array['Rusumo', 'Rubavu / Goma']
        else array['Tunduma / Nakonde'] end;
      v_fracs := case v_route when 'LUB' then array[0.30, 0.78] when 'KOL' then array[0.27, 0.68]
                              when 'GOMA' then array[0.55, 0.92] else array[0.42] end;
      v_drive := (case v_route when 'LUB' then 200 when 'KOL' then 236 when 'GOMA' then 150 else 176 end) * (0.95 + random() * 0.15);
      v_dwell := array(select round((case b when 'Tunduma / Nakonde' then 18 + random() * 22
                                            when 'Kasumbalesa' then 36 + random() * 64
                                            when 'Mokambo' then 20 + random() * 16
                                            when 'Rusumo' then 6 + random() * 10
                                            else 10 + random() * 18 end)::numeric, 1)
                         from unnest(v_borders) b);
      v_days := floor((30 + v_drive + (select sum(x) from unnest(v_dwell) x)) / 24);
      v_cust := case v_route when 'LUB' then 'mw' when 'KOL' then 'kol' when 'GOMA' then 'kivu'
                             else case when i % 2 = 0 then 'lwiza' else 'tembo' end end;
      if v_route = 'CHI' then
        b_drive := 168 * (0.95 + random() * 0.12);
        b_dwell := array[round((14 + random() * 16)::numeric, 1)];
        b_days := floor((30 + b_drive + b_dwell[1]) / 24);
        v_l2 := v_next - (2 + floor(random() * 3))::int - b_days;
        v_l1 := v_l2 - 2 - v_days;
      else
        v_ret := ceil(v_drive / 24 * 0.8)::int + 1;
        v_l1 := v_next - (2 + floor(random() * 3))::int - v_ret - v_days;
      end if;
      exit when v_l1 < v_start;

      insert into _dt (truck, route, cust, load_date, drive, dwell, borders, fracs, pod_lag, mokambo)
      values (k, v_route, v_cust, v_l1, v_drive, v_dwell, v_borders, v_fracs,
              case when v_cust = 'kol' then 5 + floor(random() * 6) else 3 + floor(random() * 6) end,
              'Mokambo' = any(v_borders));
      if v_route = 'CHI' then
        insert into _dt (truck, route, cust, load_date, drive, dwell, borders, fracs, pod_lag)
        values (k, 'NDO', 'bahari', v_l2, b_drive, b_dwell, array['Nakonde / Tunduma'], array[0.50], 3 + floor(random() * 4));
      end if;
      v_next := v_l1;
      i := i + 1;
    end loop;
  end loop;

  drop table if exists _dc;
  create temp table _dc (trip_id uuid, category text, description text, amount numeric, currency text, incurred_on date,
                         location text, paid_by text, liters numeric, ppl numeric, empty_return boolean default false,
                         account uuid, receipt_ref text) on commit drop;
  drop table if exists _da;
  create temp table _da (trip_id uuid, allocated_on date, amount numeric, currency text, description text, reference text, account uuid) on commit drop;
  drop table if exists _di;
  create temp table _di (trip_id uuid, cust text, seq int, issued_on date) on commit drop;

  -- ── each trip, oldest first ───────────────────────────────────────────
  for r in select * from _dt order by load_date, truck nulls last loop
    v_trip := extensions.uuid_generate_v4();
    v_target := case r.route when 'LUB' then 14 when 'KOL' then 16 when 'GOMA' then 10 when 'CHI' then 12 else 10 end;
    v_dist   := case r.route when 'LUB' then 2100 when 'KOL' then 2400 when 'GOMA' then 1650 when 'CHI' then 1900 else 1860 end;

    -- When things happened (company-local times).
    v_created := least((r.load_date - 3)::timestamp + interval '9 hours', (v_today - 1)::timestamp + interval '10 hours') at time zone c_tz;
    t_alloc   := least((r.load_date - 2)::timestamp + interval '15 hours', (v_today - 1)::timestamp + interval '16 hours') at time zone c_tz;
    t_load    := (r.load_date::timestamp + interval '1 hour' * r.load_h) at time zone c_tz;
    t_dep     := (r.load_date::timestamp + interval '1 hour' * r.depart_h) at time zone c_tz;
    v_arr := '{}'; v_clr := '{}'; v_acc := 0;
    for i in 1..coalesce(array_length(r.borders, 1), 0) loop
      v_arr := v_arr || (t_dep + interval '1 hour' * (r.fracs[i] * r.drive + v_acc));
      v_clr := v_clr || (v_arr[i] + interval '1 hour' * r.dwell[i]);
      v_acc := v_acc + r.dwell[i];
    end loop;
    t_del := t_dep + interval '1 hour' * (r.drive + v_acc);
    t_pod := (((t_del at time zone c_tz)::date + r.pod_lag)::timestamp + interval '10 hours') at time zone c_tz;

    v_status := case
      when r.kind = 'cancelled' then 'cancelled'
      when r.truck is null then 'draft'
      when t_load > v_now then 'allocated'
      when t_dep > v_now then 'loading'
      when t_del > v_now then
        case when exists (select 1 from generate_series(1, coalesce(array_length(v_arr, 1), 0)) j
                           where v_arr[j] <= v_now and v_clr[j] > v_now)
             then 'at_border' else 'in_transit' end
      when t_pod > v_now then 'delivered'
      else 'pod_received' end;

    v_year := extract(year from (v_created at time zone c_tz));
    insert into trip_counters (org_id, year, last_no) values (c_org, v_year, 1)
    on conflict (org_id, year) do update set last_no = trip_counters.last_no + 1
    returning last_no into v_no;
    v_trip_no := 'DEMO-' || v_year || '-' || lpad(v_no::text, 4, '0');

    insert into trips (id, org_id, trip_no, customer_id, route_id, truck_id, driver_id, commodity, tonnage, container_no, seal_no,
                       revenue_amount, revenue_currency, planned_load_date, actual_load_date, planned_eta,
                       actual_delivery_at, pod_received_at, notes, created_at, updated_at, status, borders, agent_name)
    values (v_trip, c_org, v_trip_no,
            case r.cust when 'mw' then cu_mw when 'kol' then cu_kol when 'kivu' then cu_kivu
                        when 'lwiza' then cu_lwiza when 'tembo' then cu_tembo else cu_bahari end,
            case r.route when 'LUB' then r_lub when 'KOL' then r_kol when 'GOMA' then r_goma when 'CHI' then r_chi else r_ndo end,
            v_trucks[r.truck], v_drivers[r.truck],
            case r.route
              when 'LUB'  then (array['Mining spares (40ft container)', 'Grinding media (steel balls)', 'Hydrated lime (bagged)'])[1 + v_no % 3]
              when 'KOL'  then (array['Mill liners', 'Flotation reagents (bagged)'])[1 + v_no % 2]
              when 'GOMA' then (array['Rice (bagged, 40ft container)', 'Cooking oil (40ft container)', 'Sugar (bagged, 40ft container)'])[1 + v_no % 3]
              when 'NDO'  then 'Copper cathodes'
              else case r.cust when 'lwiza' then 'Wheat (bulk bags)' else (array['Steel rebar', 'Cement (bagged)'])[1 + v_no % 2] end end,
            round((28 + random() * 6)::numeric, 1),
            case when r.route = 'GOMA' or (r.route = 'LUB' and v_no % 3 = 1) then 'DEMU' || lpad((1000000 + (v_no * 7919) % 8999999)::text, 7, '0') end,
            case when r.route in ('GOMA', 'LUB', 'KOL') then 'SL' || lpad((v_no * 4813 % 999999)::text, 6, '0') end,
            (select case when random() < 0.3 then round(rc * (0.93 + random() * 0.14)::numeric / 50) * 50 else rc end
               from (select case r.cust when 'mw' then 6800 when 'kol' then 7900 when 'kivu' then 5600
                                        when 'lwiza' then 4600 when 'tembo' then 4750 else 2900 end::numeric rc) x), 'USD',
            r.load_date, case when t_load <= v_now and r.kind not in ('draft', 'cancelled') then r.load_date end, r.load_date + v_target,
            case when t_del <= v_now and v_status not in ('draft', 'cancelled') then t_del end,
            case when t_pod <= v_now and v_status not in ('draft', 'cancelled') then t_pod end,
            r.notes, v_created, v_created, v_status,
            case when r.mokambo then r.borders end,
            case when r.route = 'GOMA' then 'Kivu Transit Services' when r.kind in ('draft', 'cancelled') then null
                 else 'Mpakani Clearing & Forwarding' end);

    -- History, as the app would have logged it.
    if r.kind = 'cancelled' then
      insert into trip_events (org_id, trip_id, event_type, occurred_at, from_status, to_status, created_at)
      values (c_org, v_trip, 'status_change', v_created + interval '2 days', 'draft', 'cancelled', v_created + interval '2 days');
    elsif r.truck is not null then
      insert into trip_events (org_id, trip_id, event_type, location, occurred_at, from_status, to_status, created_at)
      select c_org, v_trip, e.typ, e.loc, e.at, e.f, e.t, e.at
        from (
          select 'status_change' typ, null::text loc, t_alloc at, 'draft'::trip_status f, 'allocated'::trip_status t
          union all select 'status_change', null, t_load, 'allocated', 'loading'
          union all select 'status_change', null, t_dep, 'loading', 'in_transit'
          union all select 'border_arrival', r.borders[j], v_arr[j], null, null from generate_series(1, array_length(r.borders, 1)) j
          union all select 'status_change', null, v_arr[j], 'in_transit', 'at_border' from generate_series(1, array_length(r.borders, 1)) j
          union all select 'border_cleared', r.borders[j], v_clr[j], null, null from generate_series(1, array_length(r.borders, 1)) j
          union all select 'status_change', null, v_clr[j], 'at_border', 'in_transit' from generate_series(1, array_length(r.borders, 1)) j
          union all select 'status_change', null, t_del, 'in_transit', 'delivered'
          union all select 'status_change', null, t_pod, 'delivered', 'pod_received'
        ) e
       where e.at <= v_now;
    end if;

    -- The four documents every trip starts with.
    insert into trip_documents (org_id, trip_id, doc_type, status, doc_number, issued_on, received_on, created_at)
    values
      (c_org, v_trip, 'consignment_note', case when t_load <= v_now and r.truck is not null then 'issued' else 'pending' end::doc_status,
       case when t_load <= v_now and r.truck is not null then 'CN-' || v_year || '-' || lpad(v_no::text, 4, '0') end,
       case when t_load <= v_now and r.truck is not null then r.load_date end, null, v_created),
      (c_org, v_trip, 'packing_list', case when t_load <= v_now and r.truck is not null then 'received' else 'pending' end::doc_status,
       null, null, case when t_load <= v_now and r.truck is not null then r.load_date end, v_created),
      (c_org, v_trip, 't1_transit', case when t_dep > v_now or r.truck is null then 'pending'
                                        when v_clr[1] <= v_now then 'cleared' else 'lodged' end::doc_status,
       case when t_dep <= v_now and r.truck is not null then 'T1/' || v_year || '/' || lpad((v_no * 37)::text, 5, '0') end,
       case when t_dep <= v_now and r.truck is not null then (t_dep at time zone c_tz)::date end, null, v_created),
      (c_org, v_trip, 'pod', case when t_pod <= v_now and r.truck is not null then 'received' else 'pending' end::doc_status,
       case when t_pod <= v_now and r.truck is not null then 'POD-' || lpad(v_no::text, 4, '0') end,
       null, case when t_pod <= v_now and r.truck is not null then (t_pod at time zone c_tz)::date end, v_created);

    continue when r.truck is null or t_load > v_now;

    -- ── costs and the driver's float ──
    v_mid := ((t_dep + interval '1 hour' * (r.drive / 2)) at time zone c_tz)::date;
    if r.route = 'NDO' then
      v_l := round((380 + random() * 60)::numeric); v_p := round((27.2 + random() * 1.2)::numeric, 2);
      insert into _dc values (v_trip, 'fuel', 'Diesel — depot fill, Ndola', v_l * v_p, 'ZMW', r.load_date, 'Ndola', 'driver_float', v_l, v_p, false, null, 'R-' || v_no || '01');
      insert into _dc values (v_trip, 'weighbridge', 'Weighbridge — Kapiri Mposhi', 450, 'ZMW', r.load_date + 1, 'Kapiri Mposhi', 'driver_float', null, null, false, null, null);
    else
      v_l := round((560 + random() * 80)::numeric); v_p := round((3050 + random() * 130)::numeric);
      insert into _dc values (v_trip, 'fuel', 'Diesel — depot fill, Dar es Salaam', v_l * v_p, 'TZS', r.load_date, 'Dar es Salaam', 'office', v_l, v_p, false, a_tzs, 'FD-' || v_no);
      insert into _dc values (v_trip, 'weighbridge', 'Weighbridge — Vigwaza', 40000, 'TZS', (t_dep at time zone c_tz)::date, 'Vigwaza', 'driver_float', null, null, false, null, null);
    end if;
    insert into _dc values (v_trip, 'driver_allowance', 'Driver allowance (' || v_target || ' days at $25)', 25 * v_target, 'USD',
                            (t_dep at time zone c_tz)::date, null, 'driver_float', null, null, false, null, null);

    for i in 1..array_length(r.borders, 1) loop
      v_place := split_part(r.borders[i], ' / ', 1);
      insert into _dc values (v_trip, 'border_fees', 'Border fees — ' || v_place,
        round((case r.borders[i] when 'Kasumbalesa' then 380 + random() * 140 when 'Mokambo' then 260 + random() * 80
                    when 'Rusumo' then 80 + random() * 40 when 'Rubavu / Goma' then 220 + random() * 80
                    else 120 + random() * 60 end)::numeric), 'USD',
        (v_arr[i] at time zone c_tz)::date, v_place, 'agent', null, null, false, a_usd, 'AG-' || v_no || i);
      insert into _dc values (v_trip, 'clearing_agent', 'Clearing — ' || v_place,
        round((case r.borders[i] when 'Kasumbalesa' then 250 + random() * 130 when 'Mokambo' then 200 + random() * 80
                    when 'Rusumo' then 100 + random() * 50 when 'Rubavu / Goma' then 180 + random() * 80
                    else 120 + random() * 90 end)::numeric), 'USD',
        (v_clr[i] at time zone c_tz)::date, v_place, 'agent', null, null, false, a_usd, 'AG-' || v_no || i || 'C');
      if r.dwell[i] > 72 then
        insert into _dc values (v_trip, 'other', 'Parking & security — ' || v_place || ' queue', 60, 'USD',
                                (v_clr[i] at time zone c_tz)::date, v_place, 'driver_float', null, null, false, null, null);
        insert into _dc values (v_trip, 'demurrage', 'Demurrage — ' || round(r.dwell[i] / 24) || ' days held at ' || v_place, round(r.dwell[i] / 24 * 85), 'USD',
                                (v_clr[i] at time zone c_tz)::date, v_place, 'agent', null, null, false, a_usd, 'DM-' || v_no);
      end if;
    end loop;

    if r.route in ('LUB', 'KOL', 'CHI', 'NDO') then
      v_l := round((250 + random() * 130)::numeric); v_p := round((27.2 + random() * 1.4)::numeric, 2);
      if r.route <> 'NDO' then
        insert into _dc values (v_trip, 'fuel', 'Diesel — top-up, Mpika', v_l * v_p, 'ZMW', v_mid, 'Mpika', 'driver_float', v_l, v_p, false, null, 'R-' || v_no || '02');
        insert into _dc values (v_trip, 'permits', 'Road permit & carbon tax — Zambia', 950, 'ZMW', (v_clr[1] at time zone c_tz)::date, 'Nakonde', 'driver_float', null, null, false, null, null);
      end if;
      insert into _dc values (v_trip, 'tolls', 'Road tolls — Zambia', round((1100 + random() * 500)::numeric), 'ZMW', v_mid, null, 'driver_float', null, null, false, null, null);
      if r.route = 'NDO' then
        v_l := round((380 + random() * 80)::numeric); v_p := round((3080 + random() * 120)::numeric);
        insert into _dc values (v_trip, 'fuel', 'Diesel — top-up, Mbeya', v_l * v_p, 'TZS', (v_clr[1] at time zone c_tz)::date, 'Mbeya', 'driver_float', v_l, v_p, false, null, 'R-' || v_no || '03');
      end if;
    else
      v_l := round((200 + random() * 60)::numeric); v_p := round((1620 + random() * 80)::numeric);
      insert into _dc values (v_trip, 'fuel', 'Diesel — top-up, Kigali', v_l * v_p, 'RWF', v_mid, 'Kigali', 'driver_float', v_l, v_p, false, null, 'R-' || v_no || '02');
      insert into _dc values (v_trip, 'permits', 'Transit permit — Rwanda', 50, 'USD', (v_clr[1] at time zone c_tz)::date, 'Rusumo', 'agent', null, null, false, a_usd, null);
      insert into _dc values (v_trip, 'tolls', 'Road tolls — Rwanda', 30000, 'RWF', v_mid, null, 'driver_float', null, null, false, null, null);
    end if;
    if random() < 0.35 then
      insert into _dc values (v_trip, 'police', 'Police — speed check fine', 30000, 'TZS', (t_dep at time zone c_tz)::date + 1, 'Morogoro', 'driver_float', null, null, false, null, null);
    end if;
    if random() < 0.18 then
      insert into _dc values (v_trip, 'repairs', 'Puncture repair', round((60000 + random() * 60000)::numeric, -3), 'TZS', v_mid, 'Iringa', 'driver_float', null, null, false, null, null);
    end if;
    if random() < 0.12 then
      insert into _dc values (v_trip, 'repairs', (array['Spring and U-bolt repair', 'Brake chamber and linings', 'Alternator replacement', 'Trailer axle bearing'])[1 + floor(random() * 4)::int],
                              round((450 + random() * 950)::numeric, -1), 'USD', v_mid, (array['Mbeya', 'Mpika', 'Kapiri Mposhi', 'Kigali'])[1 + floor(random() * 4)::int],
                              'office', null, null, false, a_usd, 'WS-' || (2000 + v_no));
    end if;
    if r.extra_cost = 'gearbox' then
      insert into _dc values (v_trip, 'repairs', 'Gearbox repair — roadside, Mpika', 1850, 'USD', v_mid, 'Mpika', 'office', null, null, false, a_usd, 'WS-2291');
    end if;
    -- Coming back empty from the DRC.
    if r.route in ('LUB', 'KOL', 'GOMA') and t_del <= v_now - interval '1 day' then
      v_l := round((v_dist * (0.36 + random() * 0.04))::numeric); v_p := round((1.36 + random() * 0.1)::numeric, 2);
      insert into _dc values (v_trip, 'fuel', 'Diesel — return leg (empty)', v_l * v_p, 'USD', (t_del at time zone c_tz)::date + 1,
                              split_part(case r.route when 'LUB' then 'Lubumbashi' when 'KOL' then 'Kolwezi' else 'Goma' end, ',', 1),
                              'card', v_l, v_p, true, a_usd, 'FC-' || v_no);
    end if;

    if t_dep <= v_now then
      insert into _da values (v_trip, (t_dep at time zone c_tz)::date,
                              case r.route when 'LUB' then 650 when 'KOL' then 750 when 'GOMA' then 500 when 'CHI' then 550 else 450 end,
                              'USD', 'Driver float — road expenses', 'FL-' || v_no, a_cash);
      insert into _da values (v_trip, (t_dep at time zone c_tz)::date, 300000, 'TZS', 'Driver float — Tanzania leg', 'MP' || (700000 + v_no * 13), a_mpesa);
    end if;

    -- ── billing: each stage on its natural day, leaving the most recent ready to bill ──
    if t_dep <= v_now and r.cust <> 'bahari' then
      insert into _di values (v_trip, r.cust, 1, r.load_date + floor(random() * 2)::int);
    end if;
    if r.cust = 'kivu' and t_del <= v_now and (t_del at time zone c_tz)::date <= v_today - 1 then
      insert into _di values (v_trip, r.cust, 2, (t_del at time zone c_tz)::date);
    end if;
    if t_pod <= v_now and (t_pod at time zone c_tz)::date <= v_today - 3 then
      insert into _di values (v_trip, r.cust, case r.cust when 'kivu' then 3 when 'bahari' then 1 else 2 end,
                              least((t_pod at time zone c_tz)::date + floor(random() * 3)::int, v_today));
    end if;
  end loop;

  -- ── costs, floats ────────────────────────────────────────────────────
  insert into trip_costs (org_id, trip_id, description, amount, currency, fx_rate_to_usd, incurred_on, location, paid_by,
                          receipt_ref, is_reconciled, created_at, category, liters, price_per_liter, is_empty_return, cash_account_id)
  select c_org, c.trip_id, c.description, round(c.amount, 2), c.currency, fx.rate, c.incurred_on, c.location, c.paid_by,
         c.receipt_ref, c.incurred_on <= v_today - 20, least((c.incurred_on::timestamp + interval '18 hours') at time zone c_tz, v_now),
         c.category::cost_category, c.liters, c.ppl, c.empty_return,
         case when c.paid_by = 'agent' and c.incurred_on > v_today - 7 then null else c.account end
    from _dc c
   cross join lateral (select case when c.currency = 'USD' then 1 else
            (select f.rate_to_usd from fx_rates f where f.org_id = c_org and f.currency = c.currency and f.effective_on <= c.incurred_on
              order by f.effective_on desc limit 1) end as rate) fx
   where c.incurred_on <= v_today;

  insert into trip_allocations (org_id, trip_id, allocated_on, amount, currency, fx_rate_to_usd, description, reference, created_at, cash_account_id)
  select c_org, a.trip_id, a.allocated_on, a.amount, a.currency, fx.rate, a.description, a.reference,
         least((a.allocated_on::timestamp + interval '7 hours') at time zone c_tz, v_now), a.account
    from _da a
   cross join lateral (select case when a.currency = 'USD' then 1 else
            (select f.rate_to_usd from fx_rates f where f.org_id = c_org and f.currency = a.currency and f.effective_on <= a.allocated_on
              order by f.effective_on desc limit 1) end as rate) fx
   where a.allocated_on <= v_today;

  -- ── invoices, in the order they'd have been raised ───────────────────
  for inv in select * from _di order by issued_on, seq loop
    perform raise_invoice(inv.trip_id, inv.seq, c_org, null, inv.issued_on);
  end loop;
  update invoices set created_at = least((issued_on::timestamp + interval '11 hours') at time zone c_tz, v_now) where org_id = c_org;

  -- ── payments: each customer pays the way it usually does ─────────────
  for inv in
    select i.id, i.total_due, i.issued_on, i.milestone_seq seq, d.cust
      from invoices i join invoice_lines l on l.invoice_id = i.id join _di d on d.trip_id = l.trip_id and d.seq = i.milestone_seq
     where i.org_id = c_org order by i.issued_on, i.invoice_no
  loop
    v_pay := inv.issued_on + (case inv.cust
      when 'mw' then 18 + floor(random() * 15)
      when 'kol' then 40 + floor(random() * 46)
      when 'kivu' then case when inv.seq = 1 then 2 + floor(random() * 4) else 9 + floor(random() * 10) end
      when 'lwiza' then 9 + floor(random() * 8)
      when 'tembo' then 20 + floor(random() * 11)
      else 5 + floor(random() * 5) end)::int;
    if inv.cust = 'kol' and inv.seq = 2 and inv.issued_on between v_today - 120 and v_today - 75 and not v_disputed then
      v_disputed := true;  -- the customer disputes the delivery charge: never paid
      continue;
    end if;
    v_amt := case when inv.cust = 'tembo' then round(inv.total_due * 0.6, 2) else inv.total_due end;
    v_pay2 := v_pay + (22 + floor(random() * 9))::int;
    if v_pay <= v_today then
      v_ref := v_ref + 1;
      insert into payments (org_id, invoice_id, amount, currency, received_on, method, reference, created_at, cash_account_id)
      values (c_org, inv.id, v_amt, 'USD', v_pay, 'Bank transfer', 'TT' || to_char(v_pay, 'YYMMDD') || lpad(v_ref::text, 3, '0'),
              least((v_pay::timestamp + interval '12 hours') at time zone c_tz, v_now),
              case when v_pay <= v_today - 6 then a_usd end);
    end if;
    if inv.cust = 'tembo' and v_pay2 <= v_today then
      v_ref := v_ref + 1;
      insert into payments (org_id, invoice_id, amount, currency, received_on, method, reference, created_at, cash_account_id)
      values (c_org, inv.id, inv.total_due - v_amt, 'USD', v_pay2, 'Bank transfer', 'TT' || to_char(v_pay2, 'YYMMDD') || lpad(v_ref::text, 3, '0'),
              least((v_pay2::timestamp + interval '12 hours') at time zone c_tz, v_now),
              case when v_pay2 <= v_today - 6 then a_usd end);
    end if;
  end loop;

  -- Fully paid trips are closed a couple of days after the last payment.
  update trips t
     set status = 'closed', closed_at = least(((p.last_paid + 2)::timestamp + interval '11 hours') at time zone c_tz, v_now)
    from (select l.trip_id, max(p.received_on) last_paid
            from invoice_lines l join invoices i on i.id = l.invoice_id join payments p on p.invoice_id = i.id
           where i.org_id = c_org
           group by l.trip_id
          having bool_and(i.status = 'paid')) p
   where t.id = p.trip_id and t.org_id = c_org and t.status = 'invoiced' and p.last_paid <= v_today - 3
     and not exists (select 1 from invoice_lines l2 join invoices i2 on i2.id = l2.invoice_id
                      where l2.trip_id = t.id and i2.status not in ('paid', 'cancelled'));

  -- raise_invoice and the close above went through the status trigger, which
  -- stamps the moment of this run: date those entries when they happened.
  update trip_events e
     set occurred_at = x.at, created_at = x.at
    from (select t.id trip_id, 'invoiced'::trip_status st,
                 (select (max(i.issued_on)::timestamp + interval '11 hours') at time zone c_tz
                    from invoice_lines l join invoices i on i.id = l.invoice_id where l.trip_id = t.id) at
            from trips t where t.org_id = c_org
          union all
          select t.id, 'closed', t.closed_at from trips t where t.org_id = c_org and t.closed_at is not null) x
   where e.org_id = c_org and e.trip_id = x.trip_id and e.to_status = x.st and e.created_at = v_now and x.at is not null;

  -- ── truck running costs and ownership ────────────────────────────────
  drop table if exists _dk;
  create temp table _dk (truck uuid, category text, description text, amount numeric, currency text, incurred_on date, account uuid) on commit drop;
  for k in 1..8 loop
    v_d := v_today - (420 + k * 190);
    insert into _dk values (v_trucks[k], 'purchase', 'Truck and trailer purchase', 92000 + k * 3500, 'USD', v_d, null);
    insert into _dk values (v_trucks[k], 'registration', 'Registration & number plates', 4200000, 'TZS', v_d + 21, null);
    insert into _dk select v_trucks[k], 'depreciation', 'Depreciation — ' || to_char(m, 'Mon YYYY'), round((92000 + k * 3500) / 72.0, 2), 'USD', m::date, null
                      from generate_series(date_trunc('month', v_start::timestamp), v_today::timestamp, interval '1 month') m
                     where m::date >= v_start;
    insert into _dk values (v_trucks[k], 'insurance', 'Comprehensive insurance — annual premium', 2400 + k * 90, 'USD', v_start + 4 + k * 9, a_usd);
    insert into _dk values (v_trucks[k], 'licensing', 'Road licence & annual inspection', 1350000, 'TZS', v_start + 30 + k * 7, a_tzs);
    insert into _dk select v_trucks[k], 'maintenance', 'Service — oil, filters and greasing', round((260 + random() * 160)::numeric), 'USD', d::date, a_usd
                      from generate_series((v_start + k * 5)::timestamp, v_today::timestamp, interval '42 days') d;
    if k in (2, 4, 6) then
      insert into _dk values (v_trucks[k], 'tyres', 'Tyres — six drive tyres', 3200, 'USD', v_start + 60 + k * 3, a_usd);
    end if;
  end loop;
  insert into _dk values (v_trucks[8], 'repairs', 'Engine overhaul — injector pump and head gasket', 4850, 'USD', v_today - 12, a_usd);
  insert into _dk values (v_trucks[8], 'repairs', 'Parts — turbocharger', 1350, 'USD', v_today - 5, a_usd);

  insert into truck_costs (org_id, truck_id, category, description, amount, currency, fx_rate_to_usd, incurred_on, created_at, cash_account_id)
  select c_org, d.truck, d.category::truck_cost_category, d.description, d.amount, d.currency, fx.rate, d.incurred_on,
         least((d.incurred_on::timestamp + interval '14 hours') at time zone c_tz, v_now), d.account
    from _dk d
   cross join lateral (select case when d.currency = 'USD' then 1 else
            coalesce((select f.rate_to_usd from fx_rates f where f.org_id = c_org and f.currency = d.currency and f.effective_on <= d.incurred_on
                       order by f.effective_on desc limit 1),
                     (select f.rate_to_usd from fx_rates f where f.org_id = c_org and f.currency = d.currency order by f.effective_on limit 1)) end as rate) fx
   where d.incurred_on <= v_today;

  -- ── office money: rent, salaries, transfers ──────────────────────────
  drop table if exists _dm;
  create temp table _dm (account uuid, currency text, occurred_on date, direction cash_direction, amount numeric, category text,
                         counterparty text, description text, reference text, transfer_id uuid) on commit drop;
  for v_d in select m::date from generate_series(date_trunc('month', v_start::timestamp), v_today::timestamp, interval '1 month') m loop
    insert into _dm values
      (a_usd,   'USD', v_d + 1,  'out', 1200,     'Rent & utilities',          'Harbour View Properties', 'Office and yard rent', 'RENT-' || to_char(v_d, 'YYMM'), null),
      (a_mpesa, 'TZS', v_d + 4,  'out', 420000,   'Communication & internet',  'Demo Telecom',            'Internet and phones',  null, null),
      (a_tzs,   'TZS', v_d + 27, 'out', 16000000, 'Salaries & wages',          'Staff payroll',           'Salaries — ' || to_char(v_d, 'Mon YYYY'), 'PAY-' || to_char(v_d, 'YYMM'), null),
      (a_usd,   'USD', (v_d + interval '1 month - 1 day')::date, 'out', 38, 'Bank charges', null, 'Monthly bank charges', null, null);
    v_id := extensions.uuid_generate_v4();
    v_p := (select f.rate_to_usd from fx_rates f where f.org_id = c_org and f.currency = 'TZS' and f.effective_on <= v_d + 9 order by f.effective_on desc limit 1);
    insert into _dm values
      (a_usd, 'USD', v_d + 9, 'out', 16000, 'Transfer', 'Bank — TZS account', 'USD to TZS for fuel and salaries', 'FX-' || to_char(v_d, 'YYMM'), v_id),
      (a_tzs, 'TZS', v_d + 9, 'in', round(16000 / v_p, -3), 'Transfer', 'Bank — USD account', 'USD to TZS for fuel and salaries', 'FX-' || to_char(v_d, 'YYMM'), v_id);
  end loop;
  for v_d in select d::date from generate_series((v_start + 3)::timestamp, v_today::timestamp, interval '14 days') d loop
    v_id := extensions.uuid_generate_v4();
    insert into _dm values
      (a_usd,  'USD', v_d, 'out', 3500, 'Transfer', 'Office cash — USD', 'Cash for driver floats', null, v_id),
      (a_cash, 'USD', v_d, 'in',  3500, 'Transfer', 'Bank — USD account', 'Cash for driver floats', null, v_id);
    v_id := extensions.uuid_generate_v4();
    insert into _dm values
      (a_tzs,   'TZS', v_d, 'out', 2500000, 'Transfer', 'M-Pesa till', 'Top-up for driver floats', null, v_id),
      (a_mpesa, 'TZS', v_d, 'in',  2500000, 'Transfer', 'Bank — TZS account', 'Top-up for driver floats', null, v_id);
  end loop;

  insert into cash_transactions (org_id, account_id, occurred_on, direction, amount, fx_rate_to_usd, category, counterparty,
                                 description, reference, transfer_id, created_at)
  select c_org, m.account, m.occurred_on, m.direction, m.amount, fx.rate, m.category, m.counterparty, m.description, m.reference,
         m.transfer_id, least((m.occurred_on::timestamp + interval '10 hours') at time zone c_tz, v_now)
    from _dm m
   cross join lateral (select case when m.currency = 'USD' then 1 else
            (select f.rate_to_usd from fx_rates f where f.org_id = c_org and f.currency = m.currency and f.effective_on <= m.occurred_on
              order by f.effective_on desc limit 1) end as rate) fx
   where m.occurred_on between v_open and v_today;

  -- Bank lines older than three weeks are ticked off against the statement.
  insert into cash_reconciliations (org_id, account_id, source, record_id, amount, reconciled_at)
  select c_org, e.account_id, e.source, e.id, e.amount, least((e.occurred_on + 21)::timestamp at time zone c_tz, v_now)
    from cash_entries e
   where e.org_id = c_org and e.account_id in (a_usd, a_tzs) and e.occurred_on <= v_today - 21;

  select jsonb_build_object(
    'organization', c_org,
    'today', v_today,
    'trips', (select count(*) from trips where org_id = c_org),
    'by_status', (select jsonb_object_agg(s.status, s.cnt) from (select t.status, count(*) cnt from trips t where t.org_id = c_org group by t.status) s),
    'invoices', (select count(*) from invoices where org_id = c_org),
    'payments', (select count(*) from payments where org_id = c_org),
    'trip_costs', (select count(*) from trip_costs where org_id = c_org),
    'cash_lines', (select count(*) from cash_transactions where org_id = c_org)
  ) into v_count;
  return v_count;
end;
$function$;

revoke execute on function public.reset_demo_company() from public, anon, authenticated;
grant execute on function public.reset_demo_company() to service_role;
