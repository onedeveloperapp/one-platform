begin;
create extension if not exists pgtap;
select plan(16);

-- ============================================================
-- Filing by hand, with ONE's guide (0269). Ana, partner of firm A, signs
-- two lawsuits of the small-claims court of São Paulo on the eproc, each
-- with a package ready to file: one built three days ago, one today. The
-- guide reads what the court's screen asks of the first (the eproc of TJSP
-- asks each claimant's e-mail and mobile); the center says it waits; the
-- reminder goes once a round, said as skipped where Ana has no WhatsApp,
-- and not again before the setting's days; a package ONE files is nobody's
-- to file by hand. Caio, of firm B, reads nothing of it.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2690000-0000-4000-8000-000000000001', 'ana@lima-mao.invalid', 'Ana Lima'),
  ('a2690000-0000-4000-8000-000000000002', 'caio@prado-mao.invalid', 'Caio Prado')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2690000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-mao', 'a2690000-0000-4000-8000-000000000001'),
  ('b2690000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-mao', 'a2690000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2690000-0000-4000-8000-00000000000a', 'a2690000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2690000-0000-4000-8000-00000000000b', 'a2690000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.oab_registrations (user_id, uf, number) values
  ('a2690000-0000-4000-8000-000000000001', 'SP', '123456'),
  ('a2690000-0000-4000-8000-000000000002', 'SP', '654321');

create temporary table res (key text primary key, value jsonb);
grant all on res to authenticated, service_role, anon;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(key text, field text) returns text language sql as
$$ select value ->> got.field from res where res.key = got.key; $$;

-- A case with a planned lawsuit of the small-claims court of São Paulo on the eproc (its system approved), its
-- claimant (with e-mail and mobile) and lawyer, an accepted petition and a package of it ready, built `built` ago.
create function pg_temp.ready(name text, who uuid, org uuid, cpf text, built interval) returns void language plpgsql as $$
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
    jsonb_build_object('full_name', 'Cliente ' || initcap(name), 'cpf', cpf, 'phone', '5511999990001',
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
  values (package, org, (made ->> 'case_id')::uuid, lawsuit, 'TJSP', 'eproc', 'juizado', 'ready', document, now() - built);
  insert into public.filing_package_items (org_id, package_id, position, name, file_id, document_id, bytes, pages)
  values (org, package, 1, '01-peticao-inicial.pdf', (file ->> 'file_id')::uuid, document, 300000, 8);
  insert into res values (name, made || jsonb_build_object('proceeding_id', lawsuit, 'package_id', package));
end;
$$;

select pg_temp.ready('primeiro', 'a2690000-0000-4000-8000-000000000001', 'b2690000-0000-4000-8000-00000000000a',
  '52998224725', interval '3 days');
select pg_temp.ready('segundo', 'a2690000-0000-4000-8000-000000000001', 'b2690000-0000-4000-8000-00000000000a',
  '11144477735', interval '1 hour');

-- ---------- Where a court's screen asks each claimant's contact ----------

select is((select array_agg(s.key order by s.key) from public.court_screen_systems s where s.asks_contact),
  array['eproc-tjsp'], 'the eproc of TJSP alone asks each claimant''s e-mail and mobile');

-- ---------- The sheet ----------

select pg_temp.sign_in('a2690000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('sheet', public.filing_package_sheet(pg_temp.got('primeiro', 'package_id')::uuid));
reset role;
select is((select value -> 'screen' ->> 'name' from res where key = 'sheet'), 'eproc do TJSP',
  'the guide names the court''s screen');
select is((select value -> 'screen' ->> 'asks_contact' from res where key = 'sheet'), 'true',
  'and says it asks each claimant''s contact');
select is((select (value -> 'claimants' -> 0) ->> 'email' from res where key = 'sheet'), 'primeiro@cliente.invalid',
  'each claimant comes with their contact');
select is((select (value -> 'lawyers' -> 0 -> 'oab') ->> 'number' from res where key = 'sheet'), '123456',
  'each lawyer with their registration at the bar');
select is((select value -> 'codes' from res where key = 'sheet'), '{"class": 436, "subject": 4830, "moral": 7779}'::jsonb,
  'with the codes of the CNJ''s tables for the class and the subjects');
select is((select jsonb_array_length(value -> 'items') from res where key = 'sheet'), 1, 'and the files in order');

select pg_temp.sign_in('a2690000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(format('select public.filing_package_sheet(%L)', pg_temp.got('primeiro', 'package_id')), 'P0002', null,
  'another firm reads nothing of the package');
reset role;

-- ---------- What waits, in the center ----------

select pg_temp.sign_in('a2690000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('attention', public.firm_filing_attention('b2690000-0000-4000-8000-00000000000a'));
reset role;
select is((select jsonb_path_query_array(value, '$.waiting[*].package_id') from res where key = 'attention'),
  jsonb_build_array(pg_temp.got('primeiro', 'package_id')),
  'the package built three days ago waits; the one built today does not yet');
select is((select value -> 'waiting' -> 0 -> 'lawyers' from res where key = 'attention'),
  '["a2690000-0000-4000-8000-000000000001"]'::jsonb, 'with the lawyers of its lawsuit');

select pg_temp.sign_in('a2690000-0000-4000-8000-000000000002');
set local role authenticated;
select is(public.firm_filing_attention('b2690000-0000-4000-8000-00000000000b') -> 'waiting', '[]'::jsonb,
  'another firm''s center says nothing of it');
reset role;

-- ---------- The reminder ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('owed', public.filing_waits_owed(50));
select is((select jsonb_path_query_array(value, '$[*] ? (@.org_id == "b2690000-0000-4000-8000-00000000000a").round') from res where key = 'owed'),
  '[1]'::jsonb, 'one reminder is owed, the first round to its lawyer');
insert into res values ('kept', public.reserve_filing_waits(pg_temp.got('primeiro', 'package_id')::uuid,
  'a2690000-0000-4000-8000-000000000001', 1, array['Ana', 'A ação do caso 1', 'eproc do TJSP', 'sexta-feira, 20 de novembro']));
select is((select value ->> 'reason' from res where key = 'kept'), 'no_phone',
  'with no WhatsApp in her profile the round is kept as skipped, and the bell rings all the same');
select is(public.reserve_filing_waits(pg_temp.got('primeiro', 'package_id')::uuid, 'a2690000-0000-4000-8000-000000000001', 1,
  array['Ana', 'A ação do caso 1', 'eproc do TJSP', 'sexta-feira, 20 de novembro']) ->> 'code', 'already',
  'a round goes once');
select is((select count(*)::integer from jsonb_array_elements(public.filing_waits_owed(50)) o
           where o ->> 'org_id' = 'b2690000-0000-4000-8000-00000000000a'), 0,
  'and the next round waits for the setting''s days');
reset role;

-- A package ONE files is nobody's to file by hand.
insert into public.filing_submissions (org_id, case_id, proceeding_id, package_id, channel, status)
values ('b2690000-0000-4000-8000-00000000000a', pg_temp.got('primeiro', 'case_id')::uuid,
        pg_temp.got('primeiro', 'proceeding_id')::uuid, pg_temp.got('primeiro', 'package_id')::uuid, 'test_court', 'owed');
select pg_temp.sign_in('a2690000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.firm_filing_attention('b2690000-0000-4000-8000-00000000000a') -> 'waiting', '[]'::jsonb,
  'a package ONE files waits for nobody');
reset role;

select * from finish();
rollback;
