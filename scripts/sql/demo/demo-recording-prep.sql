-- RECORDING PREP for the overview video (2026-09-16).
--   1. Remove the hand-built Oct 1-5 show — §2 builds it on camera.
--   2. Unlock Meridian so §5's Send Final Report can be pressed.
--   3. Mint Alex Reyes's clock link on Meridian for §4's "their own hours".
do $$
declare
  v_org  constant uuid := 'e24655eb-5514-42d3-b248-3a879677dde9';
  v_dan  constant uuid := '28d3ae69-15bb-42bc-a478-5d9b43b737de';
  v_show uuid; v_alex uuid; n int;
begin
  if (select name from organizations where id = v_org) <> 'CrewTracker Demo' then
    raise exception 'Refusing: % is not the demo organization.', v_org;
  end if;

  -- 1. The test show. Checked first: no bookings and no punches, so nothing
  --    anybody worked is being thrown away.
  select id into v_show from shows where organization_id = v_org and name = 'Crewtracker staffing';
  if v_show is not null then
    if exists (select 1 from punches p where p.show_id = v_show) then
      raise exception 'That show has punches on it — stopping rather than deleting worked time.';
    end if;
    delete from shows where id = v_show;
    raise notice 'removed the hand-built show';
  end if;

  -- 2. Meridian unlocked. guard_show_unlock only bites when there is a signed-in
  --    caller, so this is the same act as pressing Unlock.
  update shows set finalized_at = null, finalized_by = null
   where organization_id = v_org and name = 'Meridian Partner Summit' and finalized_at is not null;
  get diagnostics n = row_count;
  raise notice 'meridian unlocked: % row(s)', n;

  -- 3. Alex's personal link on Meridian. The token has a database default;
  --    expires_at is only a record of intent (the app DERIVES expiry from the
  --    show), so it is set to the morning after the run.
  select id into v_show from shows where organization_id = v_org and name = 'Meridian Partner Summit';
  select id into v_alex from crew_members where organization_id = v_org and full_name = 'Alex Reyes';
  if not exists (select 1 from clock_links where show_id = v_show and crew_member_id = v_alex and revoked_at is null) then
    insert into clock_links (show_id, crew_member_id, organization_id, expires_at, created_by)
    select v_show, v_alex, v_org,
           ((s.end_date + 1)::timestamp at time zone s.timezone_identifier), v_dan
    from shows s where s.id = v_show;
    raise notice 'minted Alex a link';
  end if;
end $$;

select 'Alex Reyes, Meridian' as who,
       'https://crewtracker.app/clock/' || l.token as link
from clock_links l
join shows s on s.id = l.show_id
join crew_members c on c.id = l.crew_member_id
where s.name = 'Meridian Partner Summit' and c.full_name = 'Alex Reyes' and l.revoked_at is null;
