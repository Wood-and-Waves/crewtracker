-- TEST A: a NON-admin cannot escalate their own permissions.
begin;
do $$
declare
  v_nonadmin uuid;
begin
  select id into v_nonadmin from profiles where coalesce(can_manage_users, false) = false limit 1;
  if v_nonadmin is null then
    raise notice 'TEST A SKIP: no non-admin profile exists to test with';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_nonadmin::text)::text, true);
  begin
    update profiles set can_manage_users = true where id = v_nonadmin;
    raise notice 'TEST A FAIL: self-escalation was NOT blocked';
  exception when others then
    raise notice 'TEST A PASS: blocked with "%"', sqlerrm;
  end;
end $$;
rollback;

-- TEST B: an admin cannot remove their OWN can_manage_users.
begin;
do $$
declare
  v_admin uuid;
begin
  select id into v_admin from profiles where can_manage_users = true limit 1;
  if v_admin is null then
    raise notice 'TEST B SKIP: no admin profile exists to test with';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  begin
    update profiles set can_manage_users = false where id = v_admin;
    raise notice 'TEST B FAIL: self-demotion was NOT blocked';
  exception when others then
    raise notice 'TEST B PASS: blocked with "%"', sqlerrm;
  end;
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
    raise notice 'TEST C FAIL: personal-preference self-edit wrongly blocked: "%"', sqlerrm;
  end;
end $$;
rollback;
