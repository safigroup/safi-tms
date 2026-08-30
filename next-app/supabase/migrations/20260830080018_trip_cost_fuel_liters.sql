-- Optional fuel-consumption fields on trip_costs. Only meaningful for
-- category = 'fuel', but left ungated by a check constraint -- the app
-- enforces that, and a DB-level constraint would just make future
-- category additions more fragile for no real safety benefit here.
alter table "public"."trip_costs"
  add column "liters" numeric(10,3),
  add column "price_per_liter" numeric(14,4);
