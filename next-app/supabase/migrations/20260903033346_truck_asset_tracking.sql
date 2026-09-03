-- Asset tracking for trucks: new truck_cost_category values for the
-- one-time acquisition costs (purchase/clearing/registration), and an
-- explicit purchase date on the truck to anchor the breakeven projection
-- (application code, not this migration -- see /api/reports/trucks/[id]).
-- Distinguishing these from the existing ongoing categories (maintenance,
-- insurance, licensing, tyres, repairs, other) is what lets the breakeven
-- math separate the initial investment from day-to-day running costs.
alter type "public"."truck_cost_category" add value 'purchase';
alter type "public"."truck_cost_category" add value 'clearing';
alter type "public"."truck_cost_category" add value 'registration';

alter table "public"."trucks" add column "purchase_date" date;
