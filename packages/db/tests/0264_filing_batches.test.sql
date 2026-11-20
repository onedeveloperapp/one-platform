begin;
create extension if not exists pgtap;
select plan(11);

-- ============================================================
-- A batch a lawyer approves to be filed on the court's screen (0264). Ana,
-- partner of firm A, lets ONE's browser file with her login at the eproc of
-- TJSP and approves a batch of one lawsuit. ONE's browser takes the batch,
-- opens her login for it (kept on record), asks her the court's code and
-- takes it once. ONE does not know the eproc of TJSP yet, so the filing stops
-- at the court's summary until Ana confirms it; then it goes, the court gives
-- its number, the path ONE learned is kept and becomes trusted. A second
-- batch is stopped and its package is free again. Firm B approves nothing of
-- firm A and reads none of its batches.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2640000-0000-4000-8000-000000000001', 'ana@lima-lotes.invalid', 'Ana Lima'),
  ('a2640000-0000-4000-8000-000000000002', 'caio@prado-lotes.invalid', 'Caio Prado')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2640000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-lotes', 'a2640000-0000-4000-8000-000000000001'),
  ('b2640000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-lotes', 'a2640000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2640000-0000-4000-8000-00000000000a', 'a2640000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2640000-0000-4000-8000-00000000000b', 'a2640000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.oab_registrations (user_id, uf, number) values
  ('a2640000-0000-4000-8000-000000000001', 'SP', '123456'),
  ('a2640000-0000-4000-8000-000000000002', 'SP', '654321');

create temporary table res (key text primary key, value jsonb);
grant all on res to authenticated, service_role, anon;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(key text, field text) returns text language sql as
$$ select value ->> got.field from res where res.key = got.key; $$;

-- A case of a firm with a planned lawsuit of the small-claims court of São Paulo on the eproc (its system approved),
-- its claimant (with e-mail and mobile) and lawyer, an accepted petition and a package of it ready to be filed.
create function pg_temp.ready(name text, who uuid, org uuid, cpf text) returns void language plpgsql as $$
declare
  made jsonb;
  lawsuit uuid := gen_random_uuid();
  package uuid := gen_random_uuid();
  file jsonb;
  document uuid := gen_random_uuid();
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  made := public.create_case(org, 'cancellation', 'LA', date '2026-09-20',
    jsonb_build_object('full_name', 'Cliente ' || initcap(translate(name, '_', ' ')), 'cpf', cpf,
                       'phone', '5511999' || lpad((abs(hashtext(name)) % 1000000)::text, 6, '0'),
                       'email', name || '@cliente.invalid'));
  reset role;
  update public.cases set status = 'drafting' where id = (made ->> 'case_id')::uuid;
  insert into public.proceedings (id, org_id, case_id, kind, court, comarca, status)
  values (lawsuit, org, (made ->> 'case_id')::uuid, 'juizado', 'TJSP', 'São Paulo', 'planned');
  update public.proceedings set system = 'eproc', system_approved_by = who, system_approved_at = now() where id = lawsuit;
  insert into public.proceeding_parties (proceeding_id, party_id, org_id) values (lawsuit, (made ->> 'party_id')::uuid, org);
  insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values (lawsuit, who, org);
  perform pg_temp.as_backend();
  set local role service_role;
  file := public.reserve_file(org, 'upload', 'inicial.pdf', 'application/pdf', 300000);
  perform public.confirm_file((file ->> 'file_id')::uuid, repeat('d', 64), 300000, 'application/pdf', 8);
  reset role;
  insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status, decided_at)
  values (document, org, (made ->> 'case_id')::uuid, (file ->> 'file_id')::uuid, 'petition', 'firm', 'accepted', now());
  insert into public.filing_packages (id, org_id, case_id, proceeding_id, court, system, kind, status, petition_document_id,
                                      built_at)
  values (package, org, (made ->> 'case_id')::uuid, lawsuit, 'TJSP', 'eproc', 'juizado', 'ready', document, now());
  insert into public.filing_package_items (org_id, package_id, position, name, file_id, document_id, bytes, pages)
  values (org, package, 1, '01-peticao-inicial.pdf', (file ->> 'file_id')::uuid, document, 300000, 8);
  insert into res values (name, made || jsonb_build_object('proceeding_id', lawsuit, 'package_id', package));
end;
$$;

select pg_temp.ready('primeiro', 'a2640000-0000-4000-8000-000000000001', 'b2640000-0000-4000-8000-00000000000a', '52998224725');
select pg_temp.ready('segundo', 'a2640000-0000-4000-8000-000000000001', 'b2640000-0000-4000-8000-00000000000a', '11144477735');

-- Ana lets ONE file with her login, and it is sealed and checked.
select pg_temp.sign_in('a2640000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_firm_filing_way('b2640000-0000-4000-8000-00000000000a', 'browser',
  public.filing_term_in_force('protocolo-escritorio'));
select public.set_lawyer_filing_way('b2640000-0000-4000-8000-00000000000a', 'eproc-tjsp', 'browser',
  public.filing_term_in_force('protocolo-advogado'));
insert into res values ('login', public.begin_court_login('b2640000-0000-4000-8000-00000000000a', 'eproc-tjsp', '529.***.***-25'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.vault_store_secret('b2640000-0000-4000-8000-00000000000a', pg_temp.got('login', 'connection_id')::uuid,
  1, 'AAAAAAAAAAAAAAAA', 'c2VsYWRv', 'AAAAAAAAAAAAAAAAAAAAAA==');
reset role;

-- ---------- Approving ----------

select pg_temp.sign_in('a2640000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  format($$ select public.approve_filing_batch('b2640000-0000-4000-8000-00000000000a', 'eproc-tjsp', array[%L]::uuid[]) $$,
         pg_temp.got('primeiro', 'package_id')),
  '42501', 'not_a_lawyer',
  'a lawyer of another firm approves nothing of this one'
);
reset role;

select pg_temp.sign_in('a2640000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('batch', public.approve_filing_batch('b2640000-0000-4000-8000-00000000000a', 'eproc-tjsp',
  array[pg_temp.got('primeiro', 'package_id')::uuid]));
reset role;
select ok(
  pg_temp.got('batch', 'code') = 'approved'
  and pg_temp.got('batch', 'packages') = '1'
  and pg_temp.got('batch', 'learning') = 'true'
  and (select channel = 'browser' and status = 'owed' and learning and batch_id = pg_temp.got('batch', 'batch_id')::uuid
       from public.filing_submissions where package_id = pg_temp.got('primeiro', 'package_id')::uuid)
  and (select status = 'approved' and way = 'browser' and person_id = 'a2640000-0000-4000-8000-000000000001'
       from public.filing_batches where id = pg_temp.got('batch', 'batch_id')::uuid),
  'Ana approves a batch of a lawsuit she signs: filed by ONE''s browser, which still learns the eproc of TJSP'
);

select pg_temp.sign_in('a2640000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('again', public.approve_filing_batch('b2640000-0000-4000-8000-00000000000a', 'eproc-tjsp',
  array[pg_temp.got('primeiro', 'package_id')::uuid]));
reset role;
select ok(
  pg_temp.got('again', 'code') = 'nothing_to_file'
  and (select value -> 'skipped' -> 0 ->> 'code' = 'already_submitted' from res where key = 'again'),
  'a package already in a batch is not approved twice'
);

-- ---------- ONE's browser takes the batch ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim', public.claim_filing_batch(pg_temp.got('batch', 'batch_id')::uuid, 'browser'));
insert into res values ('next', public.next_batch_submission(pg_temp.got('batch', 'batch_id')::uuid, 1));
insert into res values ('to_send', public.filing_submission_to_send(pg_temp.got('next', 'submission_id')::uuid, 1));
insert into res values ('open', public.court_login_open(pg_temp.got('batch', 'batch_id')::uuid, 1));
insert into res values ('stale_open', public.court_login_open(pg_temp.got('batch', 'batch_id')::uuid, 7));
reset role;
select ok(
  pg_temp.got('claim', 'claim') = '1' and pg_temp.got('claim', 'host') = 'eproc1g.tjsp.jus.br'
  and pg_temp.got('next', 'learning') = 'true'
  and pg_temp.got('to_send', 'screen_system') = 'eproc-tjsp'
  and (select value -> 'claimants' -> 0 ->> 'email' = 'primeiro@cliente.invalid'
              and value -> 'claimants' -> 0 ->> 'phone' like '5511999%' from res where key = 'to_send')
  and pg_temp.got('open', 'code') = 'read' and pg_temp.got('stale_open', 'code') = 'not_working'
  and (select count(*) = 1 from public.court_login_uses where batch_id = pg_temp.got('batch', 'batch_id')::uuid),
  'ONE''s browser takes the batch and its filing, with the claimant''s e-mail and mobile, and opens Ana''s login for it, on record'
);

-- ---------- The court's code ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('ask', public.ask_filing_batch_code(pg_temp.got('batch', 'batch_id')::uuid, 1, 'app'));
reset role;
select pg_temp.sign_in('a2640000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('b_gives', public.give_filing_batch_code(pg_temp.got('batch', 'batch_id')::uuid, 1,
  'AAAAAAAAAAAAAAAA', 'MTIzNDU2', 'AAAAAAAAAAAAAAAAAAAAAA=='));
reset role;
select pg_temp.sign_in('a2640000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('gives', public.give_filing_batch_code(pg_temp.got('batch', 'batch_id')::uuid, 1,
  'AAAAAAAAAAAAAAAA', 'MTIzNDU2', 'AAAAAAAAAAAAAAAAAAAAAA=='));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('take', public.take_filing_batch_code(pg_temp.got('batch', 'batch_id')::uuid, 1));
insert into res values ('take_again', public.take_filing_batch_code(pg_temp.got('batch', 'batch_id')::uuid, 1));
reset role;
select ok(
  pg_temp.got('ask', 'code') = 'asked'
  and pg_temp.got('b_gives', 'code') = 'not_found'
  and pg_temp.got('gives', 'code') = 'given'
  and pg_temp.got('take', 'code') = 'taken'
  and pg_temp.got('take_again', 'code') = 'none'
  and (select status = 'running' from public.filing_batches where id = pg_temp.got('batch', 'batch_id')::uuid),
  'the court''s code is asked of Ana, given by her alone, and read once by ONE''s browser'
);

-- ---------- Learning: the summary waits for Ana ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('early', public.filing_submission_sending(pg_temp.got('next', 'submission_id')::uuid, 1));
insert into res values ('hold', public.hold_filing_submission(pg_temp.got('next', 'submission_id')::uuid, 1));
insert into res values ('next_held', jsonb_build_object('next', public.next_batch_submission(pg_temp.got('batch', 'batch_id')::uuid, 1)));
reset role;
select ok(
  pg_temp.got('early', 'code') = 'awaits_confirmation'
  and pg_temp.got('hold', 'code') = 'confirming'
  and (select value -> 'next' = 'null'::jsonb from res where key = 'next_held')
  and (select status = 'awaiting_confirmation' from public.filing_batches where id = pg_temp.got('batch', 'batch_id')::uuid),
  'while ONE learns the system, nothing goes before the lawyer confirms the court''s summary'
);

select pg_temp.sign_in('a2640000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('confirm', public.confirm_filing_submission(pg_temp.got('next', 'submission_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('next_confirmed', public.next_batch_submission(pg_temp.got('batch', 'batch_id')::uuid, 1));
insert into res values ('sending', public.filing_submission_sending(pg_temp.got('next', 'submission_id')::uuid, 1));
insert into res values ('filed', public.record_filing_submission(pg_temp.got('next', 'submission_id')::uuid, 1, 'filed',
  null, '10001230720998260100', null, null, date '2026-11-20'));
reset role;
select ok(
  pg_temp.got('confirm', 'code') = 'confirmed'
  and pg_temp.got('next_confirmed', 'confirmed') = 'true'
  and pg_temp.got('sending', 'code') = 'sending'
  and pg_temp.got('filed', 'code') = 'filed'
  and (select status = 'filed' and cnj = '10001230720998260100' from public.proceedings
       where id = pg_temp.got('primeiro', 'proceeding_id')::uuid),
  'Ana confirms the summary, the filing goes, and the lawsuit takes the court''s number'
);

-- ---------- The path ONE learned ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('map', public.save_court_screen_map('eproc-tjsp',
  '[{"tela": "Peticionamento Eletrônico (1 de 5)", "acoes": [{"fazer": "escolher", "alvo": "#selRito", "opcao": "JE"}]}]'::jsonb,
  pg_temp.got('next', 'submission_id')::uuid));
insert into res values ('trust', public.trust_court_screen_map(pg_temp.got('map', 'map_id')::uuid,
  pg_temp.got('next', 'submission_id')::uuid));
insert into res values ('map_of', public.court_screen_map_of('eproc-tjsp'));
insert into res values ('done', public.finish_filing_batch(pg_temp.got('batch', 'batch_id')::uuid, 1));
reset role;
select ok(
  pg_temp.got('map', 'version') = '1'
  and pg_temp.got('trust', 'code') = 'trusted'
  and pg_temp.got('map_of', 'status') = 'trusted'
  and not public.court_screen_learning('eproc-tjsp')
  and pg_temp.got('done', 'code') = 'done',
  'the path ONE learned is kept for the system and trusted once its filing was confirmed and taken'
);

-- ---------- A second batch, stopped ----------

select pg_temp.sign_in('a2640000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('second', public.approve_filing_batch('b2640000-0000-4000-8000-00000000000a', 'eproc-tjsp',
  array[pg_temp.got('segundo', 'package_id')::uuid]));
insert into res values ('stop', public.stop_filing_batch(pg_temp.got('second', 'batch_id')::uuid));
reset role;
select ok(
  pg_temp.got('second', 'learning') = 'false'
  and pg_temp.got('stop', 'code') = 'stopped'
  and not exists (select 1 from public.filing_submissions where package_id = pg_temp.got('segundo', 'package_id')::uuid)
  and (select status = 'stopped' and error = 'by_person' from public.filing_batches where id = pg_temp.got('second', 'batch_id')::uuid),
  'a system learned is followed with no stop at the summary; a batch stopped lets its package go free'
);

-- ---------- Firm B ----------

select pg_temp.sign_in('a2640000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('b_sees', jsonb_build_object(
  'batches', (select count(*) from public.filing_batches where org_id = 'b2640000-0000-4000-8000-00000000000a'),
  'uses', (select count(*) from public.court_login_uses where org_id = 'b2640000-0000-4000-8000-00000000000a'),
  'maps', (select count(*) from public.court_screen_maps)));
reset role;
select ok(
  pg_temp.got('b_sees', 'batches') = '0' and pg_temp.got('b_sees', 'uses') = '0' and pg_temp.got('b_sees', 'maps') = '0',
  'firm B reads none of firm A''s batches nor the uses of its logins, and no firm reads the platform''s maps'
);

select ok(
  not has_table_privilege('authenticated', 'public.filing_batch_codes', 'SELECT')
  and not has_function_privilege('authenticated', 'public.take_filing_batch_code(uuid, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.court_login_open(uuid, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_filing_batch(uuid, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.approve_filing_batch(uuid, text, uuid[])', 'EXECUTE'),
  'only the backend takes a batch, opens a login or reads a code; a lawyer approves'
);

select * from finish();
rollback;
