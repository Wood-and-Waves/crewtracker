-- TEST A: a NON-admin cannot escalate their own permissions.
begin;
do $$
declare
  v_nonadmin uuid;
  v_escalated boolean := false;
begin
  select id into v_nonadmin from profiles where coalesce(can_manage_users, false) = false limit 1;
  if v_nonadmin is null then
    raise notice 'TEST A SKIP: no non-admin profile exists to test with';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_nonadmin::text)::text, true);
  begin
    update profiles set can_manage_users = true where id = v_nonadmin;
    v_escalated := true;
  exception when others then
    raise notice 'TEST A PASS: blocked with "%"', sqlerrm;
  end;
  if v_escalated then
    raise exception 'TEST A FAILED: non-admin self-escalation was not blocked';
  end if;
end $$;
rollback;

-- TEST B: an admin cannot remove their OWN can_manage_users.
begin;
do $$
declare
  v_admin uuid;
  v_demoted boolean := false;
begin
  select id into v_admin from profiles where can_manage_users = true limit 1;
  if v_admin is null then
    raise notice 'TEST B SKIP: no admin profile exists to test with';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  begin
    update profiles set can_manage_users = false where id = v_admin;
    v_demoted := true;
  exception when others then
    raise notice 'TEST B PASS: blocked with "%"', sqlerrm;
  end;
  if v_demoted then
    raise exception 'TEST B FAILED: admin self-demotion was not blocked';
  end if;
end $$;
rollback;

-- TEST C: a non-admin CAN still change a personal-preference column on self.
begin;
do $$
declare
  v_nonadmin uuid;
begin
  select id into v_nonadmin from profiles where coalesce(can_manage_users, false) = false limit 1;
  if v_nonadmin is null then
    raise notice 'TEST C SKIP: no non-admin profile exists to test with';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_nonadmin::text)::text, true);
  begin
    update profiles set use_24_hour_time = not use_24_hour_time where id = v_nonadmin;
    raise notice 'TEST C PASS: personal-preference self-edit allowed';
  exception when others then
    raise exception 'TEST C FAILED: personal-preference self-edit was wrongly blocked: %', sqlerrm;
  end;
end $$;
rollback;
