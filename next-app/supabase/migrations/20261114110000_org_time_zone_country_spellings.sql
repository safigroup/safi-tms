-- 20261114100000_org_time_zone.sql matched countries written as a code or a
-- plain name ("CD", "DR Congo") but not with punctuation: production has an
-- organization whose country is "D.R.Congo", which was left on UTC. Match
-- again ignoring everything but letters, for organizations still on UTC
-- (anything a platform admin has set since is left alone).

update public.organizations o
   set time_zone = z.tz
  from (values
    ('Africa/Lusaka',        array['ZM', 'ZAMBIA']),
    ('Africa/Lubumbashi',    array['CD', 'DRC', 'DRCONGO', 'CONGODRC', 'CONGOKINSHASA', 'DEMOCRATICREPUBLICOFTHECONGO', 'DEMOCRATICREPUBLICOFCONGO']),
    ('Africa/Dar_es_Salaam', array['TZ', 'TANZANIA', 'UNITEDREPUBLICOFTANZANIA']),
    ('Africa/Nairobi',       array['KE', 'KENYA']),
    ('Africa/Kampala',       array['UG', 'UGANDA']),
    ('Africa/Kigali',        array['RW', 'RWANDA']),
    ('Africa/Bujumbura',     array['BI', 'BURUNDI']),
    ('Africa/Blantyre',      array['MW', 'MALAWI']),
    ('Africa/Maputo',        array['MZ', 'MOZAMBIQUE']),
    ('Africa/Harare',        array['ZW', 'ZIMBABWE']),
    ('Africa/Gaborone',      array['BW', 'BOTSWANA']),
    ('Africa/Johannesburg',  array['ZA', 'SOUTHAFRICA', 'RSA']),
    ('Africa/Windhoek',      array['NA', 'NAMIBIA']),
    ('Africa/Luanda',        array['AO', 'ANGOLA']),
    ('Africa/Juba',          array['SS', 'SOUTHSUDAN']),
    ('Africa/Addis_Ababa',   array['ET', 'ETHIOPIA'])
  ) as z(tz, countries)
 where o.time_zone = 'UTC'
   and regexp_replace(upper(o.country), '[^A-Z]', '', 'g') = any (z.countries);
