SET session_replication_role = replica;

--
-- trip-docs storage bucket. Not part of the pg_dump below -- storage.buckets
-- lives outside the `public` schema this file otherwise mirrors from
-- production, and unlike the reference-data rows below, production already
-- has this bucket, so it's only needed here for staging. ON CONFLICT DO
-- NOTHING makes this file safe to re-run.
--

insert into storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types, type)
values ('trip-docs', 'trip-docs', false, false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','application/pdf'], 'STANDARD')
on conflict (id) do nothing;

--
-- PostgreSQL database dump
--

-- \restrict 8xxcj9CHoMeimWUbSkuJ26GYLb8X3IwwMzkYMharE3bsOqfCx7zb3Dsx5n3LYrQ

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: organizations; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."organizations" ("id", "name", "country", "base_currency", "created_at", "trip_prefix", "invoice_prefix") VALUES
	('721b0134-bfd0-4381-84d7-d0177a843dd6', 'Safi Transport and Logistics Limited (STAGING)', 'ZM', 'USD', '2026-08-11 19:53:55.853891+00', 'SAFI', 'SAFI-INV');


--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."customers" ("id", "org_id", "name", "country", "tpin", "contact_name", "contact_phone", "contact_email", "payment_terms", "is_active", "created_at", "payment_days") VALUES
	('6979d2ea-8dbd-4943-b32c-55f1086a19e2', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'AIGLES BUSINESS GROUP LTD', 'CD', 'NONE', NULL, '+243 973 802 522', NULL, '50% on loading, 50% on delivery. USD only.', true, '2026-08-13 07:27:40.083975+00', 30),
	('7eade7d9-b59e-42ad-b26d-a40ee355a206', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'INAFRICA DRILLING & EXPLORATION LTD', 'ZM', 'NONE', NULL, NULL, NULL, '50/50 loading/delivery, USD', true, '2026-08-11 20:11:03.604254+00', 30),
	('eff8c744-2f6e-470d-bca5-f15224225124', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'ETS DING', 'CD', '999999999', NULL, NULL, NULL, '50/50 loading/delivery, USD', true, '2026-08-11 20:11:03.604254+00', 30);


--
-- Data for Name: drivers; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."drivers" ("id", "org_id", "full_name", "phone", "licence_no", "passport_no", "nationality", "is_active") VALUES
	('8db3661e-a4fd-4f95-b590-28b4653a20b3', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'Kambale Sivyolo', '+243 999 139 829', '32959677733DL', 'DGM/520/321965', 'CD', true),
	('261ea57b-442c-4331-9763-a815040dab9d', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'Mumbere Ila', '+243 994337672', '10200921971DL', 'OP1495548', 'CD', true),
	('01da1165-e1fe-4854-a230-cab77d4ed1e9', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'Kasereka Grace', '+243 830 477 109', '0991724343DL', 'DGM/520/45722', 'CD', true);


--
-- Data for Name: fx_rates; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."fx_rates" ("id", "org_id", "currency", "rate_to_usd", "effective_on", "source") VALUES
	('3e9966da-580d-4661-9015-3391e2de9aac', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'USD', 1.00000000, '2026-08-11', 'manual - verify'),
	('3e2c8e09-9ef8-4a10-bf0b-f90a15fe8ddf', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'TZS', 0.00038462, '2026-08-11', 'manual - verify'),
	('4061c605-9b64-48de-82bb-8702a6464b1c', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'ZMW', 0.03846154, '2026-08-11', 'manual - verify'),
	('6d7eb396-b650-4a41-af61-88ae24ba500a', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'CDF', 0.00035714, '2026-08-11', 'manual - verify'),
	('b7c9a540-a49a-4855-9d7a-4b5f6fe7e7ac', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'TZS', 0.00037736, '2026-08-13', 'CONGO Forex Bureau'),
	('5af1db42-ed8a-4e3e-be5c-c3c663640e1c', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'ZMW', 0.05319149, '2026-08-13', 'Hello Logistics Limited'),
	('e97ab4c3-c338-4528-befc-2a735e83fa29', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'RWF', 0.00067568, '2026-08-13', 'Morningstar');


--
-- Data for Name: routes; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."routes" ("id", "org_id", "name", "origin", "destination", "distance_km", "borders", "target_days") VALUES
	('b987ef9a-b4c0-44c5-b618-aa531bebbf0f', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'Dar es Salaam - Kasumbalesa', 'Dar es Salaam, TZ', 'Kasumbalesa, ZM', 1940, '{"Tunduma / Nakonde"}', 14),
	('fa7e66da-2192-45fa-86e7-076f7329cded', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'Dar es Salaam - Chingola', 'Dar es Salaam, TZ', 'Chingola, ZM', 1900, '{"Tunduma / Nakonde"}', 14),
	('a73da67f-1fa1-4e11-b4fa-d71592257fec', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'Dar es Salaam - Goma', 'Dar es Salaam, TZ', 'Goma, CD', 1650, '{Rusumo}', 4);


--
-- Data for Name: rate_cards; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."rate_cards" ("id", "org_id", "customer_id", "route_id", "commodity", "rate_amount", "rate_currency", "rate_basis", "valid_from", "valid_to") VALUES
	('a6260e56-0834-4ee1-92b5-f9b663e07b06', '721b0134-bfd0-4381-84d7-d0177a843dd6', '7eade7d9-b59e-42ad-b26d-a40ee355a206', 'fa7e66da-2192-45fa-86e7-076f7329cded', 'Machine Parts', 6500.00, 'USD', 'per_trip', '2026-07-23', '2026-08-24'),
	('36cc73d9-43e8-45b8-9f8f-e90e8e9ec948', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'eff8c744-2f6e-470d-bca5-f15224225124', 'b987ef9a-b4c0-44c5-b618-aa531bebbf0f', 'Sacs', 7000.00, 'USD', 'per_trip', '2026-06-16', '2026-07-17'),
	('6dfe7f31-709f-4ff5-a66b-77c080a35289', '721b0134-bfd0-4381-84d7-d0177a843dd6', '6979d2ea-8dbd-4943-b32c-55f1086a19e2', 'a73da67f-1fa1-4e11-b4fa-d71592257fec', 'Used Clothes / Used Bags WOSAC', 5000.00, 'USD', 'per_trip', '2026-08-04', '2026-09-04');


--
-- Data for Name: trucks; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."trucks" ("id", "org_id", "fleet_no", "horse_reg", "trailer_reg", "make_model", "tank_capacity_l", "is_active") VALUES
	('0bf2b266-d8e2-46fb-9efc-2191aa522218', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'ST-01', 'AIH1797ZM', 'AIH1770ZM', 'SHACMAN H3000 400HP', 930.00, true),
	('3f65382e-039b-4735-9b8a-8629d3410801', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'ST-02', 'AIH1771ZM', 'AIH1772ZM', 'SHACMAN H3000 400HP', 930.00, true),
	('9484e3c6-61b3-451b-8acb-af4b2647bf25', '721b0134-bfd0-4381-84d7-d0177a843dd6', 'ST-03', '9427AG19', '9620AA19', 'MB ACTROS 3340 V6', 1500.00, true);


--
-- PostgreSQL database dump complete
--

-- \unrestrict 8xxcj9CHoMeimWUbSkuJ26GYLb8X3IwwMzkYMharE3bsOqfCx7zb3Dsx5n3LYrQ

RESET ALL;
