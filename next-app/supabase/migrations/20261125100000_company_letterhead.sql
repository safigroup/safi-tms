-- Every printed document -- invoices, truck reports, trip ledgers, cashbook
-- statements, estimates -- carried one fixed letterhead: Safi's, from
-- next-app/lib/company.ts, whichever company printed it. With other
-- companies on the platform, their invoices went out under Safi's name,
-- registration and tax number, with placeholder bank details.
--
-- Each organization now keeps its own letterhead, edited by its owners and
-- admins in Admin -> Company (PATCH /api/admin/company). Every field is
-- optional: an empty one is simply left off the page, and the name falls
-- back to the organization's name. Registration and tax lines are stored
-- the way they should print, label included ("PACRA Reg. No. ...",
-- "TPIN ...", "RCCM ...", "NIF ..."), since the label differs by country.
--
-- Read like the rest of the row (members see their own organization);
-- written only through the service role, as before.

alter table public.organizations
  add column legal_name      text,
  add column registration_no text,
  add column tax_id          text,
  add column address         text,
  add column contact_phone   text,
  add column contact_email   text,
  add column bank_details    text;

comment on column public.organizations.legal_name is
  'Name printed at the top of documents; the organization''s name when empty.';
comment on column public.organizations.registration_no is
  'Company registration line as printed, label included (e.g. PACRA Reg. No. 120261044060).';
comment on column public.organizations.tax_id is
  'Tax number line as printed, label included (e.g. TPIN 2004440854).';
comment on column public.organizations.address is
  'Postal/physical address as printed; may run over several lines.';
comment on column public.organizations.contact_phone is
  'Phone number printed on documents.';
comment on column public.organizations.contact_email is
  'Email address printed on documents.';
comment on column public.organizations.bank_details is
  'Printed under "Remit to" on invoices, one line per line; left off the invoice when empty.';

-- Safi's letterhead exactly as it printed until now. Its bank lines were
-- placeholders ("<<< REPLACE >>>"), so they aren't carried over: Safi's
-- invoices print without them until real ones are entered.
update public.organizations
   set legal_name      = 'Safi Transport and Logistics Limited',
       registration_no = 'PACRA Reg. No. 120261044060',
       tax_id          = 'TPIN 2004440854',
       address         = 'Lus/12446, Industrial Area, Chinika, Lusaka, Zambia',
       contact_phone   = '+260 978 731 593',
       contact_email   = 'claude@safigroup.org'
 where trip_prefix = 'SAFI'
   and name ilike 'safi transport%'
   and legal_name is null;

-- The demo company (see 20261120100000_demo_company.sql): plainly fictional
-- details, so a demo printout looks like a real one without pretending to
-- be anybody. reset_demo_company() doesn't touch these columns.
update public.organizations
   set legal_name      = 'Demo Haulage Ltd',
       registration_no = 'BRELA Reg. No. 000000000 (demo)',
       tax_id          = 'TIN 000-000-000 (demo)',
       address         = 'Plot 1, Demo Road, Dar es Salaam, Tanzania',
       contact_phone   = '+255 700 000 000',
       contact_email   = 'accounts@demo-haulage.example',
       bank_details    = E'Demo Bank Tanzania (fictional)\nAccount name: Demo Haulage Ltd\nUSD account: 0000 0000 0000\nSWIFT: DEMOTZTZ'
 where id = 'd3e00000-0000-4000-a000-000000000001'
   and trip_prefix = 'DEMO'
   and legal_name is null;
