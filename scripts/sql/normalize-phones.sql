-- One-time cleanup: normalize existing crew phone numbers to (XXX) XXX-XXXX.
-- Only rewrites numbers that reduce to a US 10-digit (or 11-digit leading 1)
-- number; short codes / international / partial numbers are left untouched.
with norm as (
  select id,
    case
      when length(regexp_replace(phone, '\D', '', 'g')) = 10
        then regexp_replace(phone, '\D', '', 'g')
      when length(regexp_replace(phone, '\D', '', 'g')) = 11
           and left(regexp_replace(phone, '\D', '', 'g'), 1) = '1'
        then substring(regexp_replace(phone, '\D', '', 'g') from 2)
      else null
    end as d
  from crew_members
  where phone is not null and phone <> ''
)
update crew_members c
set phone = '(' || substring(norm.d from 1 for 3) || ') '
          || substring(norm.d from 4 for 3) || '-'
          || substring(norm.d from 7 for 4)
from norm
where c.id = norm.id and norm.d is not null;
