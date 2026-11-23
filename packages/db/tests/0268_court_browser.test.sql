begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- ONE's browser on ONE's server (0268). Ana, partner of firm A, gives ONE her
-- login at the eproc of TJSP for ONE's browser: ONE takes it to check with
-- the court at once (kept on record), not again within the hour, and never
-- again once the court took it; given again, it is checked again. Caio, of
-- firm B, gives his login at the Projudi of TJGO, whose code comes by e-mail:
-- ONE leaves it to his first batch. Neither firm reads the other's openings,
-- and nobody but the backend takes a login to check.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2680000-0000-4000-8000-000000000001', 'ana@lima-navegador.invalid', 'Ana Lima'),
  ('a2680000-0000-4000-8000-000000000002', 'caio@prado-navegador.invalid', 'Caio Prado')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2680000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-navegador', 'a2680000-0000-4000-8000-000000000001'),
  ('b2680000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-navegador', 'a2680000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2680000-0000-4000-8000-00000000000a', 'a2680000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2680000-0000-4000-8000-00000000000b', 'a2680000-0000-4000-8000-000000000002', 'owner', 'socio');

create temporary table res (key text primary key, value jsonb);
grant all on res to authenticated, service_role, anon;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(key text, field text) returns text language sql as
$$ select value ->> got.field from res where res.key = got.key; $$;

-- A lawyer chooses ONE's browser at a system and gives a login there, sealed by the backend.
create function pg_temp.give(name text, who uuid, org uuid, sys text, hint text) returns void language plpgsql as $$
declare
  begun jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  perform public.set_firm_filing_way(org, 'browser', public.filing_term_in_force('protocolo-escritorio'));
  perform public.set_lawyer_filing_way(org, sys, 'browser', public.filing_term_in_force('protocolo-advogado'));
  begun := public.begin_court_login(org, sys, hint);
  reset role;
  perform pg_temp.as_backend();
  set local role service_role;
  perform public.vault_store_secret(org, (begun ->> 'connection_id')::uuid, 1, 'AAAAAAAAAAAAAAAA', 'c2VsYWRv',
    'AAAAAAAAAAAAAAAAAAAAAA==');
  reset role;
  insert into res values (name, begun) on conflict (key) do update set value = excluded.value;
end;
$$;

create function pg_temp.claim() returns jsonb language plpgsql as $$
declare
  taken jsonb;
begin
  perform pg_temp.as_backend();
  set local role service_role;
  taken := public.claim_court_login_check();
  reset role;
  return taken;
end;
$$;

select ok(
  (select start_path = '/eproc/' from public.court_screen_systems where key = 'eproc-tjsp')
  and (select start_path = '/' from public.court_screen_systems where key = 'projudi-tjgo')
  and (select value #> '{purposes,filing_screen,mimes}' = '["image/png", "image/jpeg"]'::jsonb
              and (value #>> '{purposes,filing_screen,people}')::boolean = false
       from public.platform_settings where key = 'files'),
  'ONE''s browser opens each system where the court sends it to sign in, and keeps the court''s screen as an image'
);

select pg_temp.give('ana', 'a2680000-0000-4000-8000-000000000001', 'b2680000-0000-4000-8000-00000000000a',
  'eproc-tjsp', '529.***.***-25');
select pg_temp.give('caio', 'a2680000-0000-4000-8000-000000000002', 'b2680000-0000-4000-8000-00000000000b',
  'projudi-tjgo', '111.***.***-35');

-- ---------- Nobody but the backend ----------

select pg_temp.sign_in('a2680000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.claim_court_login_check() $$,
  '42501', null,
  'a lawyer takes no login to check, not even their own'
);
reset role;

-- ---------- Ana's login is checked at once ----------

insert into res values ('first', pg_temp.claim());
select ok(
  pg_temp.got('first', 'connection_id') = pg_temp.got('ana', 'connection_id')
  and pg_temp.got('first', 'system') = 'eproc-tjsp'
  and pg_temp.got('first', 'host') = 'eproc1g.tjsp.jus.br'
  and pg_temp.got('first', 'start_path') = '/eproc/'
  and (select value #>> '{envelope,ciphertext}' = 'c2VsYWRv' from res where key = 'first')
  and (select count(*) = 1 from public.court_login_uses
       where connection_id = pg_temp.got('ana', 'connection_id')::uuid and purpose = 'check' and batch_id is null)
  and (select count(*) = 1 from public.audit_events
       where action = 'court_login.opened' and entity_id = pg_temp.got('ana', 'connection_id')
         and metadata ->> 'purpose' = 'check'),
  'Ana''s login at the eproc of TJSP is taken to check with the court, the opening kept and audited'
);

select is(pg_temp.claim(), null::jsonb,
  'within the hour it is not taken again, and Caio''s, whose code comes by e-mail, is left to his first batch');

-- Tried an hour ago, it is due again.
update public.connections set metadata = metadata || jsonb_build_object('check_tried_at', now() - interval '61 minutes')
where id = pg_temp.got('ana', 'connection_id')::uuid;
insert into res values ('second', pg_temp.claim());
select ok(
  pg_temp.got('second', 'connection_id') = pg_temp.got('ana', 'connection_id')
  and (select (metadata ->> 'check_tries')::integer = 2 from public.connections
       where id = pg_temp.got('ana', 'connection_id')::uuid),
  'an hour later it is tried again, counted'
);

-- The court took it.
update public.connections set metadata = metadata || jsonb_build_object('check_tried_at', now() - interval '61 minutes')
where id = pg_temp.got('ana', 'connection_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
select public.court_login_checked('b2680000-0000-4000-8000-00000000000a', pg_temp.got('ana', 'connection_id')::uuid,
  'verified');
reset role;
select is(pg_temp.claim(), null::jsonb, 'once the court took it, it is never taken to check again');

-- Given again, it is checked again.
select pg_temp.give('ana', 'a2680000-0000-4000-8000-000000000001', 'b2680000-0000-4000-8000-00000000000a',
  'eproc-tjsp', '529.***.***-25');
select ok(
  (select not (metadata ? 'verified_at') and not (metadata ? 'check_tries') and status = 'connected'
   from public.connections where id = pg_temp.got('ana', 'connection_id')::uuid)
  and (pg_temp.claim() ->> 'connection_id') = pg_temp.got('ana', 'connection_id'),
  'a login given again forgets what the court said of the one before, and is checked again'
);

-- Five tries at most.
update public.connections set metadata = metadata || jsonb_build_object(
  'check_tried_at', now() - interval '61 minutes', 'check_tries', 5)
where id = pg_temp.got('ana', 'connection_id')::uuid;
select is(pg_temp.claim(), null::jsonb, 'a login tried five times is left to the first batch');

-- ---------- Each firm reads its own openings ----------

select pg_temp.sign_in('a2680000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::integer from public.court_login_uses where org_id = 'b2680000-0000-4000-8000-00000000000a'),
  0,
  'Caio, of another firm, reads none of the openings of Ana''s login'
);
reset role;

select * from finish();
rollback;
