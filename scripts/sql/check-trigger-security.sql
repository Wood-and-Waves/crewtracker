-- Diagnosis: writes to timecards started failing with "permission denied for
-- table timecards" right after day_rate was revoked from `authenticated`.

-- Do the show-wide day-rate triggers run as the invoker (and therefore need
-- SELECT on day_rate, which authenticated no longer has)?
select p.proname,
       case when p.prosecdef then 'SECURITY DEFINER' else 'security invoker' end as security,
       p.provolatile
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('inherit_show_day_rate', 'propagate_show_day_rate',
                    'show_id_for_room', 'block_writes_when_finalized',
                    'set_show_assignment_organization_id')
order by p.proname;

-- Did the failed "Add Day & Copy Crew" leave an orphaned work_day behind?
select s.name, w.day_number, to_char(w.date,'YYYY-MM-DD') as date,
       (select count(*) from rooms r where r.work_day_id = w.id) as rooms,
       (select count(*) from timecards t
          join rooms r2 on r2.id = t.room_id where r2.work_day_id = w.id) as timecards
from work_days w
join shows s on s.id = w.show_id
where s.name in ('Test 1','Test 2')
order by s.name, w.day_number;

-- And does shows.end_date still agree with the last work_day?
select s.name, to_char(s.end_date,'YYYY-MM-DD') as show_end_date,
       to_char(max(w.date),'YYYY-MM-DD') as last_work_day
from shows s join work_days w on w.show_id = s.id
where s.name in ('Test 1','Test 2')
group by s.name, s.end_date;
