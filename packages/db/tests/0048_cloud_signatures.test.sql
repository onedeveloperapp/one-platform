begin;
create extension if not exists pgtap with schema extensions;
select plan(84);

-- ============================================================
-- A lawyer's signature in the cloud, kept by ONE under rules of its own
-- (0041).
--
-- A lawyer declares their CPF and authorizes ONE at their PSC, for themself,
-- as a partner or a lawyer of the firm, with the second factor, never from a
-- support visit; the authorization comes into force only for a certificate
-- of that CPF, with its end at most 7 days away, while its holder signs for
-- the firm, and never passes to another person, firm or PSC. It is opened
-- only for a use declared first and bound to what it says (the test of an
-- authorization that just arrived, once; the very files of a package built
-- for a lawsuit the lawyer signs), and the vault's general read and its
-- rotation never reach it. What the PSC says of it follows each use, and
-- only of the seal the use opened; what a use signed while the authorization
-- ended is never handed over. The lawyer, a partner or who manages the firm
-- ends it; it ends by itself when the lawyer leaves or stops being a lawyer
-- of the firm, when its time ends and when the PSC's address moves. Two
-- firms: neither reaches the other's.
--
-- Every person, firm, CPF and token here is invented: the CPFs are the ones
-- every manual uses as examples.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a8100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'paula@souza.invalid', '', now(), '{}', '{"display_name":"Paula Souza"}', now(), now()),
  ('a8100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'lucas@souza.invalid', '', now(), '{}', '{"display_name":"Lucas Lima"}', now(), now()),
  ('a8100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'tania@souza.invalid', '', now(), '{}', '{"display_name":"Tania Reis"}', now(), now()),
  ('a8100000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'gabriel@souza.invalid', '', now(), '{}', '{"display_name":"Gabriel Neves"}', now(), now()),
  ('a8100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'marcos@rocha.invalid', '', now(), '{}', '{"display_name":"Marcos Rocha"}', now(), now()),
  ('a8100000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a8100000-0000-4000-8000-000000000009';

-- Firm A: Paula (owner, partner), Lucas (lawyer), Tania (attendance) and
-- Gabriel (admin, the deadlines). Firm B: Marcos (owner, partner).
insert into public.organizations (id, name, slug, created_by) values
  ('b8100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-psc', 'a8100000-0000-4000-8000-000000000001'),
  ('b8100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-psc', 'a8100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b8100000-0000-4000-8000-00000000000a', 'a8100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b8100000-0000-4000-8000-00000000000a', 'a8100000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b8100000-0000-4000-8000-00000000000a', 'a8100000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b8100000-0000-4000-8000-00000000000a', 'a8100000-0000-4000-8000-000000000005', 'admin', 'controladoria'),
  ('b8100000-0000-4000-8000-00000000000b', 'a8100000-0000-4000-8000-000000000004', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert, update on res to authenticated, service_role, anon;

create function pg_temp.sign_in(who uuid, level text default 'aal2', session text default null)
returns void language sql as
$$
  select set_config(
    'request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level, 'session_id', session))::text,
    true
  );
$$;

create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;

create function pg_temp.got(name text, key text) returns text language sql as
$$ select payload ->> key from res where res.name = got.name; $$;

create function pg_temp.conn(name text) returns uuid language sql as
$$ select (payload ->> 'connection_id')::uuid from res where res.name = conn.name; $$;

create function pg_temp.status(connection uuid) returns text language sql as
$$ select status || coalesce(':' || last_error, '') from public.connections where id = connection; $$;

create function pg_temp.sealed(connection uuid) returns boolean language sql as
$$ select exists (select 1 from public.connection_secrets where connection_id = connection); $$;

-- The backend seals what a PSC answered, with the middle of the certificate's CPF beside it.
create function pg_temp.seal(org uuid, connection uuid, middle text, lasts interval) returns jsonb language sql as
$$ select public.vault_store_secret(org, connection, 1, 'AAAAAAAAAAAAAAAA', 'c2Vzc2Fv', 'AAAAAAAAAAAAAAAAAAAAAA==',
     now() + lasts, jsonb_build_object('holder_cpf_middle', middle, 'serial', '0a0b0c')); $$;

create function pg_temp.stored(org uuid, name text, mark text) returns uuid language plpgsql as $$
declare
  reserved jsonb := public.reserve_file(org, 'upload', name, 'application/pdf', 1000);
begin
  perform public.confirm_file((reserved ->> 'file_id')::uuid, repeat(mark, 64), 1000, 'application/pdf', 1);
  return (reserved ->> 'file_id')::uuid;
end;
$$;

-- ---------- The PSCs ----------

select is(
  (select count(*)::integer from public.psc_providers where active and confirmed_at is null),
  8,
  'eight PSCs of the ITI''s list are offered, none tried by the platform yet'
);

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select count(*)::integer from public.psc_providers), 8, 'anybody of a firm reads the list, to choose their own');
select throws_ok($$update public.psc_providers set active = false where true$$, '42501', null, 'and nobody of a firm writes it');
select throws_ok(
  $$select public.admin_save_psc_provider('serproid', 'SerproID', 'https://serproid.serpro.gov.br/oauth/v0', 'base64', 'form', 5, true, true, 'Teste da plataforma', date '2026-10-15')$$,
  '42501', 'not_authorized',
  'nor through the operator''s function'
);
reset role;

set local role anon;
select throws_ok($$select count(*) from public.psc_providers$$, '42501', null, 'an anonymous visitor does not read it');
reset role;

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000009', 'aal1');
set local role authenticated;
select throws_ok(
  $$select public.admin_save_psc_provider('serproid', 'SerproID', 'https://evil.invalid/v0', 'base64', 'form', 5, true, false, 'Lista de PSCs do ITI', date '2026-10-15')$$,
  '42501', 'second_factor_required',
  'the operator changes where the lawyers'' tokens go only with the second factor, whatever the screen asks'
);
reset role;

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('psc_confirmed', public.admin_save_psc_provider('serproid', 'SerproID (Serpro)',
  'https://serproid.serpro.gov.br/oauth/v0', 'base64', 'form', 5, true, true, 'Homologação do SerproID', date '2026-10-15'));
insert into res values ('psc_bad', public.admin_save_psc_provider('goldid', 'GoldID', 'http://goldid.com.br/psc/v0',
  'base64', 'form', 1, true, false, 'Lista de PSCs do ITI', date '2026-10-15'));
reset role;

select ok(
  pg_temp.got('psc_confirmed', 'code') = 'saved'
  and (select confirmed_at is not null and source = 'Homologação do SerproID' from public.psc_providers where slug = 'serproid')
  and exists (select 1 from public.audit_events where action = 'admin.psc_provider.saved' and entity_id = 'serproid'
              and actor_id = 'a8100000-0000-4000-8000-000000000009'),
  'the operator records that the platform tried a PSC in its test environment, on the record'
);
select is(pg_temp.got('psc_bad', 'code'), 'invalid_value', 'an address that is not https is refused');

-- ---------- The lawyer's CPF ----------

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('cpf_attendance', public.declare_lawyer_cpf('111.444.777-35'));
reset role;
select is(pg_temp.got('cpf_attendance', 'code'), 'not_a_lawyer', 'who does not sign for a firm declares no CPF here');

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002', 'aal1');
set local role authenticated;
select throws_ok($$select public.declare_lawyer_cpf('529.982.247-25')$$, '42501', 'second_factor_required',
  'a lawyer declares it with the second factor');
reset role;

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a8100000-0000-4000-8000-000000000009', 'a8100000-0000-4000-8000-000000000002', 'b8100000-0000-4000-8000-00000000000a',
        'Conferindo a assinatura', 'f8100000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002', 'aal2', 'f8100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.declare_lawyer_cpf('529.982.247-25')$$, '42501', 'not_allowed_in_support_session',
  'never from a support visit');
reset role;

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('cpf_invalid', public.declare_lawyer_cpf('529.982.247-26'));
insert into res values ('cpf_lucas', public.declare_lawyer_cpf('529.982.247-25'));
insert into res values ('cpf_lucas_again', public.declare_lawyer_cpf('52998224725'));
select is((select count(*)::integer from public.lawyer_cpfs), 1, 'the lawyer reads their own CPF');
reset role;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(*)::integer from public.lawyer_cpfs), 0, 'and nobody else reads it, not even a partner who manages the firm');
reset role;
-- A lawyer of another firm declares Lucas's CPF first.
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('cpf_squat', public.declare_lawyer_cpf('52998224725'));
reset role;

select ok(
  pg_temp.got('cpf_invalid', 'code') = 'invalid_cpf' and pg_temp.got('cpf_lucas', 'code') = 'declared'
  and pg_temp.got('cpf_lucas_again', 'code') = 'unchanged'
  and (select cpf = '52998224725' from public.lawyer_cpfs where user_id = 'a8100000-0000-4000-8000-000000000002')
  and exists (select 1 from public.audit_events where action = 'lawyer.cpf_declared'
              and actor_id = 'a8100000-0000-4000-8000-000000000002' and not metadata ? 'cpf'),
  'a CPF that checks is declared once, on the record without its digits'
);
select is(pg_temp.got('cpf_squat', 'code'), 'declared',
  'a CPF nobody proved yet holds against nobody: another account that declares it first blocks nobody');

-- ---------- The lawyer's own act ----------

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('begin_attendance', public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000a', 'serproid'));
reset role;
select is(pg_temp.got('begin_attendance', 'code'), 'not_a_lawyer', 'who is not a partner or a lawyer authorizes no signature');

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('begin_no_cpf', public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000a', 'birdid'));
insert into res values ('cpf_paula', public.declare_lawyer_cpf('111.444.777-35'));
reset role;
select ok(
  pg_temp.got('begin_no_cpf', 'code') = 'cpf_required' and pg_temp.got('cpf_paula', 'code') = 'declared',
  'nor who did not declare their CPF yet'
);

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002', 'aal1');
set local role authenticated;
select throws_ok(
  $$select public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000a', 'serproid')$$,
  '42501', 'second_factor_required',
  'a lawyer authorizes with the second factor'
);
reset role;

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002', 'aal2', 'f8100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000a', 'serproid')$$,
  '42501', 'not_allowed_in_support_session',
  'never from a support visit'
);
reset role;

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000b', 'serproid')$$,
  '42501', 'not_authorized',
  'nor for a firm that is not theirs'
);
insert into res values ('begin_unknown', public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000a', 'nenhum'));
insert into res values ('lucas_serpro', public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000a', 'serproid'));
insert into res values ('lucas_serpro_again', public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000a', 'serproid'));
reset role;

select is(pg_temp.got('begin_unknown', 'code'), 'unknown_psc', 'a PSC the platform does not offer is refused');
select ok(
  pg_temp.got('lucas_serpro', 'code') = 'started'
  and (select person_id = 'a8100000-0000-4000-8000-000000000002' and provider = 'psc.serproid'
          and external_id = 'a8100000-0000-4000-8000-000000000002' and status = 'pending' and label = 'SerproID (Serpro)'
       from public.connections where id = pg_temp.conn('lucas_serpro'))
  and pg_temp.got('lucas_serpro_again', 'code') = 'existing'
  and pg_temp.conn('lucas_serpro_again') = pg_temp.conn('lucas_serpro'),
  'the lawyer starts their own authorization, a connection of theirs at that PSC, and starting again reuses it'
);
select ok(
  exists (select 1 from public.audit_events where action = 'lawyer_signature.started'
          and actor_id = 'a8100000-0000-4000-8000-000000000002' and entity_id = pg_temp.conn('lucas_serpro')::text),
  'the start is on record, as the lawyer''s'
);

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('manager_psc', public.begin_connection('b8100000-0000-4000-8000-00000000000a', 'psc.serproid',
  'a8100000-0000-4000-8000-000000000002', 'Assinatura'));
reset role;
select ok(
  pg_temp.got('manager_psc', 'code') = 'invalid_provider'
  and (select connected_by = 'a8100000-0000-4000-8000-000000000002' and label = 'SerproID (Serpro)'
       from public.connections where id = pg_temp.conn('lucas_serpro')),
  'who manages the firm cannot start or touch a lawyer''s authorization as an account of the firm'
);
select throws_ok(
  $$insert into public.connections (org_id, provider, external_id, label) values ('b8100000-0000-4000-8000-00000000000a', 'psc.birdid', 'qualquer', 'BirdID')$$,
  '23514', null,
  'and the table refuses a PSC''s connection that is nobody''s, whoever writes'
);

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('paula_bird', public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000a', 'birdid'));
reset role;

-- ---------- In force only with its end, its holder and its certificate ----------

select pg_temp.as_backend();
set local role service_role;
select throws_ok(
  format($$select public.vault_store_secret(%L, %L, 1, 'AAAAAAAAAAAAAAAA', 'c2Vzc2Fv', 'AAAAAAAAAAAAAAAAAAAAAA==', null, '{"holder_cpf_middle": "982247"}')$$,
    'b8100000-0000-4000-8000-00000000000a', pg_temp.conn('lucas_serpro')),
  '23514', 'lawyer_signature_without_end',
  'a lawyer''s authorization is never sealed without its end'
);
select throws_ok(
  format($$select pg_temp.seal(%L, %L, '982247', interval '8 days')$$,
    'b8100000-0000-4000-8000-00000000000a', pg_temp.conn('lucas_serpro')),
  '23514', 'lawyer_signature_without_end',
  'nor for longer than the 7 days the norm gives a person'
);
select throws_ok(
  format($$select pg_temp.seal(%L, %L, '444777', interval '3 days')$$,
    'b8100000-0000-4000-8000-00000000000a', pg_temp.conn('lucas_serpro')),
  '23514', 'lawyer_signature_other_holder',
  'nor for a certificate of another CPF than the one the lawyer declared'
);
insert into res values ('lucas_sealed', pg_temp.seal('b8100000-0000-4000-8000-00000000000a', pg_temp.conn('lucas_serpro'),
  '982247', interval '3 days'));
insert into res values ('paula_sealed', pg_temp.seal('b8100000-0000-4000-8000-00000000000a', pg_temp.conn('paula_bird'),
  '444777', interval '7 days'));
reset role;

select ok(
  pg_temp.got('lucas_sealed', 'code') = 'stored' and pg_temp.status(pg_temp.conn('lucas_serpro')) = 'connected'
  and pg_temp.got('paula_sealed', 'code') = 'stored',
  'sealed with its end, for the declared CPF''s certificate, it is in force'
);

select ok(
  (select proven_at is null from public.lawyer_cpfs where user_id = 'a8100000-0000-4000-8000-000000000002')
  and exists (select 1 from public.lawyer_cpfs where user_id = 'a8100000-0000-4000-8000-000000000004'),
  'an authorization kept proves nothing yet: a CPF is proved by a signature the PSC made and ONE checked'
);

-- A row of somebody who does not sign for the firm never comes into force, whatever writes it.
insert into public.connections (org_id, provider, external_id, label, person_id)
values ('b8100000-0000-4000-8000-00000000000a', 'psc.serproid', 'a8100000-0000-4000-8000-000000000003', 'SerproID',
        'a8100000-0000-4000-8000-000000000003');
select throws_ok(
  $$update public.connections set status = 'connected', expires_at = now() + interval '1 day'
    where person_id = 'a8100000-0000-4000-8000-000000000003'$$,
  '23514', 'lawyer_signature_not_a_lawyer',
  'an authorization of somebody who does not sign for the firm never comes into force'
);
delete from public.connections where person_id = 'a8100000-0000-4000-8000-000000000003';
select throws_ok(
  format($$update public.connections set person_id = 'a8100000-0000-4000-8000-000000000001', external_id = 'a8100000-0000-4000-8000-000000000001' where id = %L$$,
    pg_temp.conn('lucas_serpro')),
  '23514', 'lawyer_signature_identity',
  'and one never passes to another person, whatever writes it'
);

-- ---------- Who reads it ----------

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select array_agg(provider order by provider) from public.connections where provider like 'psc.%'),
  array['psc.serproid'],
  'the lawyer reads their own authorization, and not a colleague''s'
);
reset role;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000003');
set local role authenticated;
select is((select count(*)::integer from public.connections where provider like 'psc.%'), 0, 'somebody of the attendance reads none');
reset role;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(*)::integer from public.connections where provider like 'psc.%'), 2, 'a partner reads every lawyer''s');
reset role;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000005');
set local role authenticated;
select is((select count(*)::integer from public.connections where provider like 'psc.%'), 2, 'and so does who manages the firm');
reset role;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000004');
set local role authenticated;
select is((select count(*)::integer from public.connections where provider like 'psc.%'), 0, 'another firm reads none of them');
reset role;

-- ---------- The vault's general read and its rotation never reach it ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('general_read', public.vault_read_secret('b8100000-0000-4000-8000-00000000000a',
  pg_temp.conn('lucas_serpro'), 'whatsapp.send'));
insert into res values ('rotation_read', public.vault_read_secret('b8100000-0000-4000-8000-00000000000a',
  pg_temp.conn('lucas_serpro'), 'vault.rotation'));
insert into res values ('rotation_pending', jsonb_build_object('list', public.vault_rewrap_pending(9999)));
reset role;
select ok(
  pg_temp.got('general_read', 'code') = 'personal' and pg_temp.got('rotation_read', 'code') = 'personal'
  and not exists (
    select 1 from jsonb_array_elements((select payload -> 'list' from res where name = 'rotation_pending')) item
    where (item ->> 'connection_id')::uuid in (pg_temp.conn('lucas_serpro'), pg_temp.conn('paula_bird'))
  ),
  'the vault''s general read never hands out a lawyer''s authorization, not even to the key''s rotation'
);

-- ---------- A package built for a lawsuit Lucas signs ----------

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_a', public.create_case('b8100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02"}'::jsonb));
insert into res values ('proceeding', public.save_proceeding(pg_temp.got('case_a', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "system": "projudi"}'::jsonb,
  array[pg_temp.got('case_a', 'party_id')::uuid]));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('petition_file', jsonb_build_object('file_id',
  pg_temp.stored('b8100000-0000-4000-8000-00000000000a', 'inicial.pdf', 'a')));
reset role;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('petition', public.attach_case_document(pg_temp.got('case_a', 'case_id')::uuid,
  pg_temp.got('petition_file', 'file_id')::uuid, 'petition'));
select public.decide_case_document(pg_temp.got('petition', 'document_id')::uuid, 'accepted');
reset role;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('b8100000-0000-4000-8000-00000000000b', 'cancellation', null, null,
  '{"full_name": "Paulo Teste", "cpf": "52998224725", "birth_date": "1980-01-10"}'::jsonb));
reset role;

insert into public.proceeding_lawyers (proceeding_id, user_id, org_id)
values (pg_temp.got('proceeding', 'proceeding_id')::uuid, 'a8100000-0000-4000-8000-000000000002',
        'b8100000-0000-4000-8000-00000000000a');
-- Built, and claimed for its signature under the number 1 (0042).
insert into public.filing_packages (id, org_id, case_id, proceeding_id, court, system, kind, status, petition_document_id, built_at,
                                    signature_status, signature_claim, signature_claimed_at)
values ('c8100000-0000-4000-8000-0000000000aa', 'b8100000-0000-4000-8000-00000000000a', pg_temp.got('case_a', 'case_id')::uuid,
        pg_temp.got('proceeding', 'proceeding_id')::uuid, 'TJGO', 'projudi', 'juizado', 'ready',
        pg_temp.got('petition', 'document_id')::uuid, now(), 'due', 1, now());
insert into public.filing_package_items (org_id, package_id, position, name, file_id, document_id, bytes)
values ('b8100000-0000-4000-8000-00000000000a', 'c8100000-0000-4000-8000-0000000000aa', 1, '01-peticao-inicial.pdf',
        pg_temp.got('petition_file', 'file_id')::uuid, pg_temp.got('petition', 'document_id')::uuid, 1000);

-- ---------- Opened for a use declared first, bound to what it says ----------

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format($$select public.lawyer_signature_open(%L, %L, 'filing.package', %L, null, array[repeat('a', 64)])$$,
    'b8100000-0000-4000-8000-00000000000a', 'a8100000-0000-4000-8000-000000000002', 'c8100000-0000-4000-8000-0000000000aa'),
  '42501', null,
  'a person never opens a lawyer''s authorization: the backend does'
);
reset role;

select pg_temp.as_backend();
set local role service_role;
select throws_ok(
  format($$select public.lawyer_signature_open(%L, %L, 'filing.package', null, null, array['abc'])$$,
    'b8100000-0000-4000-8000-00000000000a', 'a8100000-0000-4000-8000-000000000002'),
  '22023', 'invalid_hashes',
  'a use names the SHA-256 of every document it signs'
);
select throws_ok(
  format($$select public.lawyer_signature_open(%L, %L, 'qualquer', null, null, array[repeat('a', 64)])$$,
    'b8100000-0000-4000-8000-00000000000a', 'a8100000-0000-4000-8000-000000000002'),
  '22023', 'invalid_purpose',
  'and what it is for'
);
select throws_ok(
  format($$select public.lawyer_signature_open(%L, %L, 'authorization.check', null, null, array[repeat('a', 64)])$$,
    'b8100000-0000-4000-8000-00000000000a', 'a8100000-0000-4000-8000-000000000002'),
  '22023', 'invalid_use',
  'the test of an authorization names the one it tries'
);
insert into res values ('open_attendance', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000003', 'filing.package', 'c8100000-0000-4000-8000-0000000000aa', null, array[repeat('a', 64)], target_claim => 1));
insert into res values ('open_other_firm', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000b',
  'a8100000-0000-4000-8000-000000000002', 'filing.package', 'c8100000-0000-4000-8000-0000000000aa', null, array[repeat('a', 64)], target_claim => 1));
insert into res values ('open_other_case', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000002', 'filing.package', 'c8100000-0000-4000-8000-0000000000aa',
  pg_temp.got('case_b', 'case_id')::uuid, array[repeat('a', 64)], target_claim => 1));
insert into res values ('open_not_package', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000002', 'filing.package', 'c8100000-0000-4000-8000-0000000000ff', null, array[repeat('a', 64)], target_claim => 1));
insert into res values ('open_other_files', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000002', 'filing.package', 'c8100000-0000-4000-8000-0000000000aa', null, array[repeat('b', 64)], target_claim => 1));
insert into res values ('open_not_signer', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000001', 'filing.package', 'c8100000-0000-4000-8000-0000000000aa', null, array[repeat('a', 64)], target_claim => 1));
insert into res values ('use_1', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000002', 'filing.package', 'c8100000-0000-4000-8000-0000000000aa', null, array[repeat('a', 64)], target_claim => 1));
reset role;

select is(
  array[pg_temp.got('open_attendance', 'code'), pg_temp.got('open_other_firm', 'code'), pg_temp.got('open_other_case', 'code')],
  array['not_a_lawyer', 'not_a_lawyer', 'not_found'],
  'nobody''s signature but a partner''s or a lawyer''s of the firm is opened, and for a case of the firm'
);
select is(
  array[pg_temp.got('open_not_package', 'code'), pg_temp.got('open_other_files', 'code'), pg_temp.got('open_not_signer', 'code')],
  array['invalid_subject', 'files_changed', 'not_a_signer'],
  'a package''s files are signed only as they are, and only by a lawyer who signs its lawsuit'
);
select ok(
  pg_temp.got('use_1', 'code') = 'opened'
  and pg_temp.conn('use_1') = pg_temp.conn('lucas_serpro')
  and pg_temp.got('use_1', 'serial') = '0a0b0c' and pg_temp.got('use_1', 'cpf') = '52998224725'
  and (select payload -> 'envelope' ->> 'ciphertext' = 'c2Vzc2Fv' from res where name = 'use_1'),
  'the backend gets the lawyer''s authorization still sealed, with the certificate authorized and the CPF it must carry'
);
select ok(
  (select status = 'opened' and psc = 'serproid' and purpose = 'filing.package' and cardinality(document_hashes) = 1
          and person_id = 'a8100000-0000-4000-8000-000000000002' and finished_at is null
          and case_id = pg_temp.got('case_a', 'case_id')::uuid
          and seal_id = (select s.seal_id from public.connection_secrets s where s.connection_id = pg_temp.conn('lucas_serpro'))
   from public.lawyer_signature_uses where id = pg_temp.got('use_1', 'use_id')::uuid),
  'and the use is on record before anything is signed, with the seal it opened and the package''s case'
);
select ok(
  exists (select 1 from public.audit_events where action = 'vault.secret.read' and actor_type = 'system'
          and entity_id = pg_temp.conn('lucas_serpro')::text and metadata ->> 'purpose' = 'psc.filing.package'
          and metadata ->> 'use' = pg_temp.got('use_1', 'use_id')),
  'the opening is audited with the use it was for'
);

-- ---------- What came of each use ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('finish_1', public.lawyer_signature_finish('b8100000-0000-4000-8000-00000000000a',
  pg_temp.got('use_1', 'use_id')::uuid, true));
insert into res values ('finish_1_again', public.lawyer_signature_finish('b8100000-0000-4000-8000-00000000000a',
  pg_temp.got('use_1', 'use_id')::uuid, true));
insert into res values ('finish_other_firm', public.lawyer_signature_finish('b8100000-0000-4000-8000-00000000000b',
  pg_temp.got('use_1', 'use_id')::uuid, true));
select throws_ok(
  format($$select public.lawyer_signature_finish(%L, %L, false)$$,
    'b8100000-0000-4000-8000-00000000000a', pg_temp.got('use_1', 'use_id')),
  '22023', 'invalid_error_code',
  'a use that failed says why'
);
insert into res values ('use_2', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000002', 'filing.package', 'c8100000-0000-4000-8000-0000000000aa', null, array[repeat('a', 64)], target_claim => 1));
insert into res values ('finish_2', public.lawyer_signature_finish('b8100000-0000-4000-8000-00000000000a',
  pg_temp.got('use_2', 'use_id')::uuid, false, 'psc_unavailable'));
reset role;

select ok(
  pg_temp.got('finish_1', 'code') = 'recorded'
  and (select status = 'signed' and signed_count = 1 and error_code is null and finished_at is not null
       from public.lawyer_signature_uses where id = pg_temp.got('use_1', 'use_id')::uuid),
  'a use whose documents were all signed and checked is recorded as signed'
);
select is(
  array[pg_temp.got('finish_1_again', 'code'), pg_temp.got('finish_other_firm', 'code')],
  array['already_finished', 'not_found'],
  'once, and only by the firm it was for'
);

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('cpf_taken', public.declare_lawyer_cpf('52998224725'));
reset role;
select ok(
  (select proven_at is not null from public.lawyer_cpfs where user_id = 'a8100000-0000-4000-8000-000000000002')
  and not exists (select 1 from public.lawyer_cpfs where user_id = 'a8100000-0000-4000-8000-000000000004')
  and exists (select 1 from public.audit_events where action = 'lawyer.cpf_released'
              and org_id = 'b8100000-0000-4000-8000-00000000000b'
              and entity_id = 'a8100000-0000-4000-8000-000000000004')
  and pg_temp.got('cpf_taken', 'code') = 'cpf_taken'
  and exists (select 1 from public.audit_events where action = 'lawyer.cpf_refused'
              and actor_id = 'a8100000-0000-4000-8000-000000000004'),
  'the first signature that holds proves the CPF: a declaration nothing proved lets it go, on the record, and the CPF is that account''s alone'
);
select ok(
  (select status = 'failed' and error_code = 'psc_unavailable' and signed_count = 0
   from public.lawyer_signature_uses where id = pg_temp.got('use_2', 'use_id')::uuid)
  and pg_temp.status(pg_temp.conn('lucas_serpro')) = 'error:psc_unavailable'
  and pg_temp.sealed(pg_temp.conn('lucas_serpro')),
  'a PSC that did not answer leaves the authorization in force, and says so'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('use_3', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000002', 'filing.package', 'c8100000-0000-4000-8000-0000000000aa', null, array[repeat('a', 64)], target_claim => 1));
insert into res values ('finish_3', public.lawyer_signature_finish('b8100000-0000-4000-8000-00000000000a',
  pg_temp.got('use_3', 'use_id')::uuid, true));
insert into res values ('use_4', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000002', 'filing.package', 'c8100000-0000-4000-8000-0000000000aa', null, array[repeat('a', 64)], target_claim => 1));
insert into res values ('finish_4', public.lawyer_signature_finish('b8100000-0000-4000-8000-00000000000a',
  pg_temp.got('use_4', 'use_id')::uuid, false, 'session_ended'));
insert into res values ('use_after_end', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000002', 'filing.package', 'c8100000-0000-4000-8000-0000000000aa', null, array[repeat('a', 64)], target_claim => 1));
reset role;

select is(pg_temp.got('use_3', 'code'), 'opened', 'an authorization whose last use failed is still tried');
select is(pg_temp.status(pg_temp.conn('lucas_serpro')), 'expired:session_ended',
  'a success brings it back, and a PSC that no longer signs with it ends it');
select ok(
  not pg_temp.sealed(pg_temp.conn('lucas_serpro'))
  and exists (select 1 from public.audit_events where action = 'connection.recovered'
              and entity_id = pg_temp.conn('lucas_serpro')::text)
  and exists (select 1 from public.audit_events where action = 'lawyer_signature.ended'
              and entity_id = pg_temp.conn('lucas_serpro')::text and metadata ->> 'reason' = 'session_ended'),
  'its token discarded at once, each change on record'
);
select is(pg_temp.got('use_after_end', 'code'), 'no_signature', 'and nothing is opened for the lawyer until they authorize again');

-- ---------- The test of an authorization that just arrived ----------

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('lucas_serpro_2', public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000a', 'serproid'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.seal('b8100000-0000-4000-8000-00000000000a', pg_temp.conn('lucas_serpro'), '982247', interval '1 day');
insert into res values ('check_1', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000002', 'authorization.check', null, null, array[repeat('1', 64)],
  pg_temp.conn('lucas_serpro')));
select public.lawyer_signature_finish('b8100000-0000-4000-8000-00000000000a', pg_temp.got('check_1', 'use_id')::uuid, true);
insert into res values ('check_2', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000002', 'authorization.check', null, null, array[repeat('2', 64)],
  pg_temp.conn('lucas_serpro')));
select throws_ok(
  format($$select public.lawyer_signature_open(%L, %L, 'authorization.check', null, null, array[repeat('1', 64), repeat('2', 64)], %L)$$,
    'b8100000-0000-4000-8000-00000000000a', 'a8100000-0000-4000-8000-000000000002', pg_temp.conn('lucas_serpro')),
  '22023', 'invalid_use',
  'the test signs one text'
);
reset role;
select ok(
  pg_temp.got('lucas_serpro_2', 'code') = 'existing' and pg_temp.got('check_1', 'code') = 'opened'
  and pg_temp.got('check_2', 'code') = 'check_spent',
  'authorized again, its test is opened once for its seal'
);

-- ---------- What a use signed while the authorization ended is never handed over ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('use_ending', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000002', 'filing.package', 'c8100000-0000-4000-8000-0000000000aa', null, array[repeat('a', 64)], target_claim => 1));
-- A newer authorization takes the place of the one the use opened.
select pg_temp.seal('b8100000-0000-4000-8000-00000000000a', pg_temp.conn('lucas_serpro'), '982247', interval '2 days');
insert into res values ('finish_ending', public.lawyer_signature_finish('b8100000-0000-4000-8000-00000000000a',
  pg_temp.got('use_ending', 'use_id')::uuid, true));
insert into res values ('use_old_seal', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000002', 'filing.package', 'c8100000-0000-4000-8000-0000000000aa', null, array[repeat('a', 64)], target_claim => 1));
select pg_temp.seal('b8100000-0000-4000-8000-00000000000a', pg_temp.conn('lucas_serpro'), '982247', interval '3 days');
insert into res values ('finish_old_seal', public.lawyer_signature_finish('b8100000-0000-4000-8000-00000000000a',
  pg_temp.got('use_old_seal', 'use_id')::uuid, false, 'session_ended'));
reset role;
select ok(
  pg_temp.got('finish_ending', 'code') = 'ended_meanwhile'
  and (select status = 'failed' and error_code = 'ended_meanwhile' from public.lawyer_signature_uses
       where id = pg_temp.got('use_ending', 'use_id')::uuid),
  'a use whose authorization was replaced while it signed hands over nothing'
);
select ok(
  pg_temp.status(pg_temp.conn('lucas_serpro')) = 'connected' and pg_temp.sealed(pg_temp.conn('lucas_serpro')),
  'and what the PSC said of the seal a use opened never ends a newer one'
);

-- ---------- The authorization that lasts the longest ----------

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('lucas_safe', public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000a', 'safeid'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.seal('b8100000-0000-4000-8000-00000000000a', pg_temp.conn('lucas_safe'), '982247', interval '5 days');
insert into res values ('use_longest', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000002', 'filing.package', 'c8100000-0000-4000-8000-0000000000aa', null, array[repeat('a', 64)], target_claim => 1));
select public.lawyer_signature_finish('b8100000-0000-4000-8000-00000000000a', pg_temp.got('use_longest', 'use_id')::uuid, true);
insert into res values ('use_colleague', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000002', 'filing.package', 'c8100000-0000-4000-8000-0000000000aa', null, array[repeat('a', 64)],
  pg_temp.conn('paula_bird'), 1));
reset role;
select ok(
  pg_temp.conn('use_longest') = pg_temp.conn('lucas_safe') and pg_temp.got('use_colleague', 'code') = 'no_signature',
  'at a second PSC, the authorization that lasts the longest is opened, and never a colleague''s'
);

-- ---------- Who reads the uses ----------

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select count(*)::integer from public.lawyer_signature_uses), 8, 'the lawyer reads every use of their signature');
select throws_ok(
  $$insert into public.lawyer_signature_uses (org_id, psc, purpose, document_hashes, seal_id) values ('b8100000-0000-4000-8000-00000000000a', 'serproid', 'filing.package', array[repeat('a', 64)], gen_random_uuid())$$,
  '42501', null,
  'and writes none: the backend records them'
);
reset role;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000003');
set local role authenticated;
select is((select count(*)::integer from public.lawyer_signature_uses), 0, 'somebody of the attendance reads none');
reset role;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000005');
set local role authenticated;
select is((select count(*)::integer from public.lawyer_signature_uses), 8, 'who manages the firm reads them');
reset role;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000004');
set local role authenticated;
select is((select count(*)::integer from public.lawyer_signature_uses), 0, 'another firm reads none');
reset role;

-- ---------- Ending it ----------

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('end_attendance', public.end_lawyer_signature(pg_temp.conn('lucas_safe')));
reset role;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('end_other_firm', public.end_lawyer_signature(pg_temp.conn('lucas_safe')));
reset role;
select is(
  array[pg_temp.got('end_attendance', 'code'), pg_temp.got('end_other_firm', 'code')],
  array['not_authorized', 'not_found'],
  'somebody of the attendance does not end a lawyer''s authorization, and another firm does not find it'
);

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002', 'aal2', 'f8100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format($$select public.end_lawyer_signature(%L)$$, pg_temp.conn('lucas_safe')),
  '42501', 'not_allowed_in_support_session',
  'nor does a support visit'
);
reset role;

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002', 'aal1');
set local role authenticated;
insert into res values ('end_only_pending', public.end_lawyer_signature(pg_temp.conn('lucas_safe'), true));
reset role;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('cpf_change_in_force', public.declare_lawyer_cpf('123.456.789-09'));
reset role;
select ok(
  pg_temp.got('end_only_pending', 'code') = 'not_pending' and pg_temp.status(pg_temp.conn('lucas_safe')) = 'connected',
  'a start that came to nothing is given up alone, never an authorization in force'
);
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002', 'aal1');
set local role authenticated;
insert into res values ('end_own', public.end_lawyer_signature(pg_temp.conn('lucas_safe')));
insert into res values ('end_own_again', public.end_lawyer_signature(pg_temp.conn('lucas_safe')));
reset role;
select ok(
  pg_temp.got('end_own', 'code') = 'ended' and pg_temp.got('end_own_again', 'code') = 'already_ended'
  and pg_temp.status(pg_temp.conn('lucas_safe')) = 'disconnected' and not pg_temp.sealed(pg_temp.conn('lucas_safe'))
  and exists (select 1 from public.audit_events where action = 'lawyer_signature.ended'
              and entity_id = pg_temp.conn('lucas_safe')::text and metadata ->> 'reason' = 'by_lawyer'),
  'the lawyer ends it, even without the second factor at hand, and its token is discarded'
);

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000005', 'aal1');
set local role authenticated;
insert into res values ('end_by_firm', public.end_lawyer_signature(pg_temp.conn('lucas_serpro')));
reset role;
select ok(
  pg_temp.got('end_by_firm', 'code') = 'ended' and pg_temp.status(pg_temp.conn('lucas_serpro')) = 'disconnected'
  and exists (select 1 from public.audit_events where action = 'lawyer_signature.ended'
              and entity_id = pg_temp.conn('lucas_serpro')::text and metadata ->> 'reason' = 'by_firm'),
  'who manages the firm ends it too'
);

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('firm_account', public.begin_connection('b8100000-0000-4000-8000-00000000000a', 'zapsign', null, 'ZapSign'));
insert into res values ('end_firm_account', public.end_lawyer_signature(pg_temp.conn('firm_account')));
reset role;
select is(pg_temp.got('end_firm_account', 'code'), 'not_found', 'an account of the firm is no lawyer''s authorization to end');

-- ---------- The CPF changes only with nothing in course ----------

-- An authorization whose time ran out before the upkeep saw it, and a start the PSC never answered, are nothing in
-- course (the clock of the upkeep is moved by hand: a transaction has one now()).
alter table public.connections disable trigger connections_updated_at;
update public.connections set status = 'connected', expires_at = now() - interval '1 minute'
where id = pg_temp.conn('lucas_safe');
update public.connections set status = 'pending', updated_at = now() - interval '11 minutes'
where id = pg_temp.conn('lucas_serpro');
alter table public.connections enable trigger connections_updated_at;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('cpf_change_after', public.declare_lawyer_cpf('123.456.789-09'));
reset role;
select ok(
  pg_temp.got('cpf_change_in_force', 'code') = 'end_first' and pg_temp.got('cpf_change_after', 'code') = 'declared'
  and (select proven_at is null from public.lawyer_cpfs where user_id = 'a8100000-0000-4000-8000-000000000002'),
  'a lawyer changes their CPF only once no authorization of theirs is in course, whatever the upkeep has not seen yet, and a new CPF is nobody''s proof'
);
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('safe_again', public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000a', 'safeid'));
reset role;
select ok(
  pg_temp.got('safe_again', 'code') = 'existing'
  and pg_temp.status(pg_temp.conn('lucas_safe')) = 'pending' and not pg_temp.sealed(pg_temp.conn('lucas_safe'))
  and exists (select 1 from public.audit_events where action = 'lawyer_signature.ended'
              and entity_id = pg_temp.conn('lucas_safe')::text and metadata ->> 'reason' = 'expired'),
  'starting again over an authorization whose time ran out ends it, and is a start, whatever CPF it was of'
);
-- That start came to nothing (the PSC never sent the lawyer back): given up, as the PSC's return gives one up.
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
select public.end_lawyer_signature(pg_temp.conn('lucas_safe'), true);
reset role;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
select public.declare_lawyer_cpf('529.982.247-25');
reset role;

-- ---------- Ending by itself ----------

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
select public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000a', 'serproid');
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.seal('b8100000-0000-4000-8000-00000000000a', pg_temp.conn('lucas_serpro'), '982247', interval '2 days');
reset role;
update public.memberships set firm_function = 'atendimento'
where org_id = 'b8100000-0000-4000-8000-00000000000a' and user_id = 'a8100000-0000-4000-8000-000000000002';
select ok(
  pg_temp.status(pg_temp.conn('lucas_serpro')) = 'disconnected' and not pg_temp.sealed(pg_temp.conn('lucas_serpro'))
  and exists (select 1 from public.audit_events where action = 'lawyer_signature.ended'
              and entity_id = pg_temp.conn('lucas_serpro')::text and metadata ->> 'reason' = 'function_changed'),
  'a lawyer who stops being one in the firm stops signing through ONE at once'
);

update public.memberships set firm_function = 'advogado'
where org_id = 'b8100000-0000-4000-8000-00000000000a' and user_id = 'a8100000-0000-4000-8000-000000000002';
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
select public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000a', 'serproid');
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.seal('b8100000-0000-4000-8000-00000000000a', pg_temp.conn('lucas_serpro'), '982247', interval '2 days');
reset role;
select is(pg_temp.status(pg_temp.conn('lucas_serpro')), 'connected', 'a lawyer again, they authorize again');
delete from public.memberships
where org_id = 'b8100000-0000-4000-8000-00000000000a' and user_id = 'a8100000-0000-4000-8000-000000000002';
select ok(
  pg_temp.status(pg_temp.conn('lucas_serpro')) = 'disconnected' and not pg_temp.sealed(pg_temp.conn('lucas_serpro'))
  and exists (select 1 from public.audit_events where action = 'lawyer_signature.ended'
              and entity_id = pg_temp.conn('lucas_serpro')::text and metadata ->> 'reason' = 'left_firm'),
  'and who leaves the firm takes nothing of it with them'
);

-- ---------- A PSC that moves, and a time that ends ----------

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('paula_safe', public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000a', 'safeid'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.seal('b8100000-0000-4000-8000-00000000000a', pg_temp.conn('paula_safe'), '444777', interval '1 day');
reset role;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('psc_moved', public.admin_save_psc_provider('safeid', 'SafeID (Safeweb)',
  'https://pscsafeweb.safewebpss.com.br/Service/Microservice/OAuth/api/v1', 'base64', 'form', 1, true, false,
  'Documentação do SafeID, nova versão', date '2026-10-15'));
reset role;
select ok(
  (pg_temp.got('psc_moved', 'authorizations_ended'))::integer = 1
  and pg_temp.status(pg_temp.conn('paula_safe')) = 'expired:psc_moved' and not pg_temp.sealed(pg_temp.conn('paula_safe'))
  and (select confirmed_at is null and base_url like '%/api/v1' from public.psc_providers where slug = 'safeid')
  and pg_temp.status(pg_temp.conn('paula_bird')) = 'connected',
  'a PSC whose address moved ends every authorization given at it, and nothing of another PSC''s'
);

update public.connections set expires_at = now() - interval '1 minute' where id = pg_temp.conn('paula_bird');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('expired_sweep', public.expire_connections());
reset role;
select ok(
  pg_temp.status(pg_temp.conn('paula_bird')) = 'expired' and not pg_temp.sealed(pg_temp.conn('paula_bird')),
  'an authorization whose time ended is discarded by the upkeep'
);

-- ---------- A CPF is asked a few times a day at most ----------

insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
select 'b8100000-0000-4000-8000-00000000000a', 'a8100000-0000-4000-8000-000000000001', 'lawyer.cpf_refused', 'profile',
       'a8100000-0000-4000-8000-000000000001', '{"reason": "taken"}'::jsonb
from generate_series(1, 10);
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('cpf_throttled', public.declare_lawyer_cpf('123.456.789-09'));
reset role;
select is(pg_temp.got('cpf_throttled', 'code'), 'too_many_attempts',
  'ten declarations or refusals a day are a person''s most: no CPF is tried at length');

-- ---------- A firm that goes ----------

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000004');
set local role authenticated;
select public.declare_lawyer_cpf('123.456.789-09');
insert into res values ('marcos_serpro', public.begin_lawyer_signature('b8100000-0000-4000-8000-00000000000b', 'serproid'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.seal('b8100000-0000-4000-8000-00000000000b', pg_temp.conn('marcos_serpro'), '456789', interval '1 day');
reset role;
select ok(
  pg_temp.status(pg_temp.conn('marcos_serpro')) = 'connected',
  'a lawyer of another firm authorizes their own, the CPF declared there'
);
select pg_temp.as_backend();
set local role service_role;
insert into res values ('marcos_check', public.lawyer_signature_open('b8100000-0000-4000-8000-00000000000b',
  'a8100000-0000-4000-8000-000000000004', 'authorization.check', null, null, array[repeat('3', 64)],
  pg_temp.conn('marcos_serpro')));
select public.lawyer_signature_finish('b8100000-0000-4000-8000-00000000000b', pg_temp.got('marcos_check', 'use_id')::uuid,
  false, 'certificate_changed');
reset role;
select ok(
  pg_temp.status(pg_temp.conn('marcos_serpro')) = 'expired:certificate_changed'
  and not pg_temp.sealed(pg_temp.conn('marcos_serpro')),
  'a PSC that no longer shows the certificate authorized ends the authorization: the lawyer authorizes again'
);
select lives_ok(
  $$delete from public.organizations where id = 'b8100000-0000-4000-8000-00000000000b'$$,
  'a firm that goes takes its lawyers'' authorizations with it'
);
select is(
  (select count(*)::integer from public.connections where org_id = 'b8100000-0000-4000-8000-00000000000b'),
  0,
  'nothing of them stays'
);

select * from finish();
rollback;
