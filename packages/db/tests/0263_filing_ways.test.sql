begin;
create extension if not exists pgtap;
select plan(12);

-- ============================================================
-- How a firm and its lawyers file on a court's screen (0263). Firm A's
-- partner Ana lets ONE file with the lawyers' logins; its lawyer Bia hands
-- ONE her login at the eproc of TJSP, which the vault's general read never
-- opens. The firm then keeps the filing to the extension: Bia goes down to
-- it and her login is gone; she links her extension with a code. Bia leaves
-- the firm: her link ends. Firm B sees nothing of firm A.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2630000-0000-4000-8000-000000000001', 'ana@lima-formas.invalid', 'Ana Lima'),
  ('a2630000-0000-4000-8000-000000000002', 'bia@lima-formas.invalid', 'Bia Souza'),
  ('a2630000-0000-4000-8000-000000000003', 'caio@prado-formas.invalid', 'Caio Prado')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2630000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-formas', 'a2630000-0000-4000-8000-000000000001'),
  ('b2630000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-formas', 'a2630000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2630000-0000-4000-8000-00000000000a', 'a2630000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2630000-0000-4000-8000-00000000000a', 'a2630000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b2630000-0000-4000-8000-00000000000b', 'a2630000-0000-4000-8000-000000000003', 'owner', 'socio');

create temporary table res (key text primary key, value jsonb);
grant all on res to authenticated, service_role, anon;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(key text, field text) returns text language sql as
$$ select value ->> got.field from res where res.key = got.key; $$;

-- ---------- The systems and the texts ----------

select ok(
  (select ways = array['browser', 'extension'] and login_kind = 'password_app' and host = 'eproc1g.tjsp.jus.br'
   from public.court_screen_systems where key = 'eproc-tjsp')
  and (select ways = '{}' from public.court_screen_systems where key = 'eproc-tjrj')
  and public.filing_term_in_force('protocolo-escritorio') is not null
  and public.filing_term_in_force('protocolo-advogado') is not null
  and not has_function_privilege('authenticated', 'public.claim_extension_link(text, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.court_login_checked(uuid, uuid, text)', 'EXECUTE')
  and not has_column_privilege('authenticated', 'public.extension_links', 'token_hash', 'SELECT'),
  'the systems and the texts are data: the eproc of TJSP is on, the eproc of TJRJ waits for its act; tokens are the backend''s'
);

-- ---------- The firm's way ----------

select pg_temp.sign_in('a2630000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('no_term', public.set_firm_filing_way('b2630000-0000-4000-8000-00000000000a', 'browser', null));
insert into res values ('firm_browser', public.set_firm_filing_way('b2630000-0000-4000-8000-00000000000a', 'browser',
  public.filing_term_in_force('protocolo-escritorio')));
reset role;
select ok(
  pg_temp.got('no_term', 'code') = 'term_not_accepted'
  and pg_temp.got('firm_browser', 'code') = 'saved'
  and (select way = 'browser' and decided_by = 'a2630000-0000-4000-8000-000000000001'
       from public.firm_filing_ways where org_id = 'b2630000-0000-4000-8000-00000000000a'),
  'the partner sets the firm''s way only with the firm''s acknowledgment in force'
);

select pg_temp.sign_in('a2630000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$ select public.set_firm_filing_way('b2630000-0000-4000-8000-00000000000a', 'hand') $$,
  '42501', 'not_authorized',
  'a lawyer who does not decide for the firm cannot set its way'
);
reset role;

-- ---------- Bia's way and her login ----------

select pg_temp.sign_in('a2630000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('rj', public.set_lawyer_filing_way('b2630000-0000-4000-8000-00000000000a', 'eproc-tjrj', 'browser',
  public.filing_term_in_force('protocolo-advogado')));
insert into res values ('bia_way', public.set_lawyer_filing_way('b2630000-0000-4000-8000-00000000000a', 'eproc-tjsp', 'browser',
  public.filing_term_in_force('protocolo-advogado')));
insert into res values ('bad_hint', public.begin_court_login('b2630000-0000-4000-8000-00000000000a', 'eproc-tjsp', '11144477735'));
insert into res values ('bia_login', public.begin_court_login('b2630000-0000-4000-8000-00000000000a', 'eproc-tjsp', '111.***.***-35'));
reset role;
select ok(
  pg_temp.got('rj', 'code') = 'way_not_offered'
  and pg_temp.got('bia_way', 'code') = 'saved'
  and pg_temp.got('bad_hint', 'code') = 'invalid_hint'
  and pg_temp.got('bia_login', 'code') = 'begun'
  and (select provider = 'court.eproc-tjsp' and person_id = 'a2630000-0000-4000-8000-000000000002' and status = 'pending'
              and metadata ->> 'login_hint' = '111.***.***-35'
       from public.connections where id = pg_temp.got('bia_login', 'connection_id')::uuid),
  'the lawyer chooses ONE''s browser at a system the platform turned on, and starts handing over her login, shown only by its hint'
);

-- The backend seals it at once: the general read of the vault never hands it out.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('sealed', public.vault_store_secret('b2630000-0000-4000-8000-00000000000a',
  pg_temp.got('bia_login', 'connection_id')::uuid, 1, 'AAAAAAAAAAAAAAAA', 'c2VsYWRv', 'AAAAAAAAAAAAAAAAAAAAAA=='));
insert into res values ('general_read', public.vault_read_secret('b2630000-0000-4000-8000-00000000000a',
  pg_temp.got('bia_login', 'connection_id')::uuid, 'filing.batch'));
insert into res values ('verified', public.court_login_checked('b2630000-0000-4000-8000-00000000000a',
  pg_temp.got('bia_login', 'connection_id')::uuid, 'verified'));
reset role;
select ok(
  pg_temp.got('sealed', 'code') = 'stored'
  and pg_temp.got('general_read', 'code') = 'personal'
  and pg_temp.got('verified', 'code') = 'verified'
  and (select status = 'connected' and metadata ? 'verified_at'
       from public.connections where id = pg_temp.got('bia_login', 'connection_id')::uuid),
  'her login is sealed and checked with the court, and the vault''s general read refuses it'
);

-- Firm B's partner sees none of it, and cannot begin a login in firm A.
select pg_temp.sign_in('a2630000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('b_sees', jsonb_build_object(
  'connections', (select count(*) from public.connections where org_id = 'b2630000-0000-4000-8000-00000000000a'),
  'ways', (select count(*) from public.lawyer_filing_ways where org_id = 'b2630000-0000-4000-8000-00000000000a')));
select throws_ok(
  $$ select public.begin_court_login('b2630000-0000-4000-8000-00000000000a', 'eproc-tjsp', '529.***.***-25') $$,
  '42501', 'not_a_lawyer',
  'a lawyer of another firm cannot hand a login in this one'
);
reset role;
select ok(
  pg_temp.got('b_sees', 'connections') = '0' and pg_temp.got('b_sees', 'ways') = '0',
  'firm B reads nothing of firm A''s ways and logins'
);

-- ---------- The firm keeps it to the extension ----------

select pg_temp.sign_in('a2630000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('firm_ext', public.set_firm_filing_way('b2630000-0000-4000-8000-00000000000a', 'extension',
  public.filing_term_in_force('protocolo-escritorio')));
reset role;
select ok(
  pg_temp.got('firm_ext', 'code') = 'saved'
  and (select way = 'extension' from public.lawyer_filing_ways
       where org_id = 'b2630000-0000-4000-8000-00000000000a' and user_id = 'a2630000-0000-4000-8000-000000000002')
  and (select status = 'disconnected' from public.connections where id = pg_temp.got('bia_login', 'connection_id')::uuid)
  and not exists (select 1 from public.connection_secrets where connection_id = pg_temp.got('bia_login', 'connection_id')::uuid)
  and exists (select 1 from public.audit_events where action = 'court_login.ended'
              and entity_id = pg_temp.got('bia_login', 'connection_id') and metadata ->> 'reason' = 'firm_way'),
  'the firm keeping it to the extension takes Bia down to it, and her login is discarded at once'
);

select pg_temp.sign_in('a2630000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('beyond', public.set_lawyer_filing_way('b2630000-0000-4000-8000-00000000000a', 'eproc-tjsp', 'browser',
  public.filing_term_in_force('protocolo-advogado')));
reset role;
select ok(
  pg_temp.got('beyond', 'code') = 'beyond_firm_way',
  'a lawyer cannot choose a way more automated than the firm''s'
);

-- ---------- Bia links her extension ----------

select pg_temp.sign_in('a2630000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('link', public.begin_extension_link('b2630000-0000-4000-8000-00000000000a',
  encode(sha256(convert_to('7K4Q9PX', 'UTF8')), 'hex')));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('wrong', public.claim_extension_link(encode(sha256(convert_to('XXXXXXX', 'UTF8')), 'hex'),
  encode(sha256(convert_to('token-a', 'UTF8')), 'hex')));
insert into res values ('claimed', public.claim_extension_link(encode(sha256(convert_to('7K4Q9PX', 'UTF8')), 'hex'),
  encode(sha256(convert_to('token-da-bia', 'UTF8')), 'hex'), 'Chrome no Windows'));
insert into res values ('again', public.claim_extension_link(encode(sha256(convert_to('7K4Q9PX', 'UTF8')), 'hex'),
  encode(sha256(convert_to('token-b', 'UTF8')), 'hex')));
insert into res values ('who', public.extension_link_of(encode(sha256(convert_to('token-da-bia', 'UTF8')), 'hex')));
reset role;
select ok(
  pg_temp.got('link', 'code') = 'begun'
  and pg_temp.got('wrong', 'code') = 'invalid'
  and pg_temp.got('claimed', 'code') = 'linked'
  and pg_temp.got('again', 'code') = 'invalid'
  and pg_temp.got('who', 'user_id') = 'a2630000-0000-4000-8000-000000000002'
  and pg_temp.got('who', 'org_id') = 'b2630000-0000-4000-8000-00000000000a',
  'a code links her extension once, and its token says who she is'
);

-- ---------- Bia leaves ----------

delete from public.memberships
where org_id = 'b2630000-0000-4000-8000-00000000000a' and user_id = 'a2630000-0000-4000-8000-000000000002';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('gone', public.extension_link_of(encode(sha256(convert_to('token-da-bia', 'UTF8')), 'hex')));
reset role;
select ok(
  pg_temp.got('gone', 'code') = 'invalid'
  and (select ended_at is not null and end_reason = 'left_firm' from public.extension_links
       where id = pg_temp.got('claimed', 'link_id')::uuid),
  'a lawyer leaving the firm ends her extension''s link'
);

-- ---------- A partner ends a login ----------

insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2630000-0000-4000-8000-00000000000a', 'a2630000-0000-4000-8000-000000000002', 'member', 'advogado');
select pg_temp.sign_in('a2630000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_firm_filing_way('b2630000-0000-4000-8000-00000000000a', 'browser',
  public.filing_term_in_force('protocolo-escritorio'));
reset role;
select pg_temp.sign_in('a2630000-0000-4000-8000-000000000002');
set local role authenticated;
select public.set_lawyer_filing_way('b2630000-0000-4000-8000-00000000000a', 'eproc-tjsp', 'browser',
  public.filing_term_in_force('protocolo-advogado'));
insert into res values ('again_login', public.begin_court_login('b2630000-0000-4000-8000-00000000000a', 'eproc-tjsp', '111.***.***-35'));
reset role;
select pg_temp.sign_in('a2630000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ended', public.end_court_login(pg_temp.got('again_login', 'connection_id')::uuid));
reset role;
select ok(
  pg_temp.got('ended', 'code') = 'ended'
  and (select status = 'disconnected' from public.connections where id = pg_temp.got('again_login', 'connection_id')::uuid)
  and exists (select 1 from public.audit_events where action = 'court_login.ended'
              and entity_id = pg_temp.got('again_login', 'connection_id') and metadata ->> 'reason' = 'by_firm'),
  'a partner takes a lawyer''s login out of ONE, with no second factor'
);

select * from finish();
rollback;
