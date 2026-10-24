-- Lets a cost be tagged as incurred on a trip's empty return leg (no
-- cargo, no revenue for that leg) -- staff were already marking this by
-- hand with a "(Return)" suffix in the free-text description. Any
-- category can apply to either leg (fuel, tolls, driver allowance are
-- all incurred both ways), so this is its own flag, not a category.
alter table "public"."trip_costs"
  add column "is_empty_return" boolean not null default false;
