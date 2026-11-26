begin;
create extension if not exists pgtap;
select plan(14);

-- ============================================================
-- ONE asks a lawyer for their access where a lawsuit of theirs goes to a court's screen they never said how to file
-- at (0304), and the PJe of the TJRJ joins, by the extension alone. Firm A files through ONE's browser. Ana, its
-- partner, signs three lawsuits with a package ready: one at the eproc of the TJSP, one there with Bia, and one at
-- the PJe of the TJRJ. ONE needs Ana's access at both systems and Bia's at the eproc; once Bia hands hers to ONE, the
-- lawsuit they sign together asks nobody; Ana is asked once, said as skipped where she has no WhatsApp. Firm B chose
-- no way: ONE asks nothing of its lawyer, and reads nothing of firm A's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a3040000-0000-4000-8000-000000000001', 'ana@lima-acesso.invalid', 'Ana Lima'),
  ('a3040000-0000-4000-8000-000000000002', 'bia@lima-acesso.invalid', 'Bia Souza'),
  ('a3040000-0000-4000-8000-000000000003', 'caio@prado-acesso.invalid', 'Caio Prado')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b3040000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-acesso', 'a3040000-0000-4000-8000-000000000001'),
  ('b3040000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-acesso', 'a3040000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b3040000-0000-4000-8000-00000000000a', 'a3040000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b3040000-0000-4000-8000-00000000000a', 'a3040000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b3040000-0000-4000-8000-00000000000b', 'a3040000-0000-4000-8000-000000000003', 'owner', 'socio');
insert into public.oab_registrations (user_id, uf, number) values
  ('a3040000-0000-4000-8000-000000000001', 'RJ', '123456'),
  ('a3040000-0000-4000-8000-000000000002', 'SP', '234567'),
  ('a3040000-0000-4000-8000-000000000003', 'SP', '654321');
insert into public.firm_filing_ways (org_id, way, term_id, decided_by)
select 'b3040000-0000-4000-8000-00000000000a', 'browser', t.id, 'a3040000-0000-4000-8000-000000000001'
from public.consent_terms t where t.slug = 'protocolo-escritorio' and t.is_active;

create temporary table res (key text primary key, value jsonb);
grant all on res to authenticated, service_role, anon;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(key text, field text) returns text language sql as
$$ select value ->> got.field from res where res.key = got.key; $$;

-- A case with a planned small-claims lawsuit at a court and system (its system approved), its claimant (with e-mail
-- and mobile) and lawyers, an accepted petition and a package of it ready, built `built` ago.
create function pg_temp.ready(name text, lawyers uuid[], org uuid, cpf text, built interval, court text,
                              comarca text, sys text) returns void language plpgsql as $$
declare
  made jsonb;
  lawsuit uuid := gen_random_uuid();
  package uuid := gen_random_uuid();
  file jsonb;
  document uuid := gen_random_uuid();
begin
  perform pg_temp.sign_in(lawyers[1]);
  set local role authenticated;
  made := public.create_case(org, 'cancellation', 'LA', date '2026-09-20',
    jsonb_build_object('full_name', 'Cliente ' || initcap(name), 'cpf', cpf, 'phone', '5521999990001',
                       'email', name || '@cliente.invalid'));
  reset role;
  update public.cases set status = 'drafting' where id = (made ->> 'case_id')::uuid;
  insert into public.proceedings (id, org_id, case_id, kind, court, comarca, status)
  values (lawsuit, org, (made ->> 'case_id')::uuid, 'juizado', court, comarca, 'planned');
  update public.proceedings set system = sys, system_approved_by = lawyers[1], system_approved_at = now()
  where id = lawsuit;
  insert into public.proceeding_parties (proceeding_id, party_id, org_id) values (lawsuit, (made ->> 'party_id')::uuid, org);
  insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) select lawsuit, l, org from unnest(lawyers) l;
  perform pg_temp.as_backend();
  set local role service_role;
  file := public.reserve_file(org, 'upload', 'inicial.pdf', 'application/pdf', 300000);
  perform public.confirm_file((file ->> 'file_id')::uuid, repeat('d', 64), 300000, 'application/pdf', 8);
  reset role;
  insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status, decided_at)
  values (document, org, (made ->> 'case_id')::uuid, (file ->> 'file_id')::uuid, 'petition', 'firm', 'accepted', now());
  insert into public.filing_packages (id, org_id, case_id, proceeding_id, court, system, kind, status, petition_document_id,
                                      built_at)
  values (package, org, (made ->> 'case_id')::uuid, lawsuit, court, sys, 'juizado', 'ready', document, now() - built);
  insert into public.filing_package_items (org_id, package_id, position, name, file_id, document_id, bytes, pages)
  values (org, package, 1, '01-peticao-inicial.pdf', (file ->> 'file_id')::uuid, document, 300000, 8);
  insert into res values (name, made || jsonb_build_object('proceeding_id', lawsuit, 'package_id', package));
end;
$$;

select pg_temp.ready('primeiro', array['a3040000-0000-4000-8000-000000000001']::uuid[],
  'b3040000-0000-4000-8000-00000000000a', '52998224725', interval '3 hours', 'TJSP', 'São Paulo', 'eproc');
select pg_temp.ready('segundo', array['a3040000-0000-4000-8000-000000000001', 'a3040000-0000-4000-8000-000000000002']::uuid[],
  'b3040000-0000-4000-8000-00000000000a', '11144477735', interval '2 hours', 'TJSP', 'São Paulo', 'eproc');
select pg_temp.ready('terceiro', array['a3040000-0000-4000-8000-000000000001']::uuid[],
  'b3040000-0000-4000-8000-00000000000a', '12345678909', interval '1 hour', 'TJRJ', 'Rio de Janeiro', 'pje');
select pg_temp.ready('outro', array['a3040000-0000-4000-8000-000000000003']::uuid[],
  'b3040000-0000-4000-8000-00000000000b', '52998224725', interval '1 hour', 'TJSP', 'São Paulo', 'eproc');

-- What ONE owes now, as the backend reads it: "<package name>/<lawyer's first letter>/<system>", oldest first.
create function pg_temp.owed() returns text language plpgsql as $$
declare
  answer text;
begin
  perform pg_temp.as_backend();
  execute 'set local role service_role';
  select string_agg(r.key || '/' || left(u.raw_user_meta_data ->> 'display_name', 1) || '/' || o.system_key, ','
                    order by o.package_id = (pg_temp.got('primeiro', 'package_id'))::uuid desc,
                             o.package_id = (pg_temp.got('segundo', 'package_id'))::uuid desc,
                             u.raw_user_meta_data ->> 'display_name')
  into answer
  from public.filing_access_owed(50, null, null) o
  join res r on (r.value ->> 'package_id')::uuid = o.package_id
  join auth.users u on u.id = o.user_id;
  execute 'reset role';
  return coalesce(answer, '');
end;
$$;

-- ---------- The PJe of the TJRJ ----------

select ok(
  (select login_kind = 'certificate' and ways = array['extension'] and host = 'tjrj.pje.jus.br'
   from public.court_screen_systems where key = 'pje-tjrj'),
  'the PJe of the TJRJ is a system ONE files on by the extension alone: the lawyer signs with their own certificate'
);
select throws_ok(
  $$update public.court_screen_systems set ways = array['browser', 'extension'] where key = 'pje-tjrj'$$,
  '23514', null,
  'ONE''s own browser is never turned on where the court signs in by a certificate'
);

select pg_temp.sign_in('a3040000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  public.set_lawyer_filing_way('b3040000-0000-4000-8000-00000000000a', 'pje-tjrj', 'browser', null) ->> 'code',
  'way_not_offered',
  'nor may a lawyer choose it there'
);
reset role;

-- ---------- Whose access ONE needs ----------

select is(pg_temp.owed(), 'primeiro/A/eproc-tjsp,segundo/A/eproc-tjsp,segundo/B/eproc-tjsp,terceiro/A/pje-tjrj',
  'each lawyer of a package ready at a court''s screen they never said how to file at, at each system; never of a firm with no way');

insert into public.lawyer_filing_ways (org_id, user_id, system_key, way, term_id)
select 'b3040000-0000-4000-8000-00000000000a', 'a3040000-0000-4000-8000-000000000002', 'eproc-tjsp', 'extension', t.id
from public.consent_terms t where t.slug = 'protocolo-advogado' and t.is_active;
select is(pg_temp.owed(), 'primeiro/A/eproc-tjsp,terceiro/A/pje-tjrj',
  'a lawsuit a lawyer of it already hands to ONE there asks nobody else, nor the lawyer who chose');

insert into public.lawyer_filing_ways (org_id, user_id, system_key, way, term_id) values
  ('b3040000-0000-4000-8000-00000000000a', 'a3040000-0000-4000-8000-000000000001', 'eproc-tjsp', 'hand', null);
select is(pg_temp.owed(), 'terceiro/A/pje-tjrj', 'filing by hand is a choice: ONE asks it no more');
delete from public.lawyer_filing_ways
where user_id = 'a3040000-0000-4000-8000-000000000001' and system_key = 'eproc-tjsp';

-- ---------- The ask kept ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('ask', public.reserve_filing_access_ask(pg_temp.got('terceiro', 'package_id')::uuid,
  'a3040000-0000-4000-8000-000000000001', array['Ana', 'PJe do TJRJ', 'a ação do caso está pronta']));
insert into res values ('again', public.reserve_filing_access_ask(pg_temp.got('terceiro', 'package_id')::uuid,
  'a3040000-0000-4000-8000-000000000001', array['Ana', 'PJe do TJRJ', 'a ação do caso está pronta']));
insert into res values ('not_owed', public.reserve_filing_access_ask(pg_temp.got('segundo', 'package_id')::uuid,
  'a3040000-0000-4000-8000-000000000002', array['Bia', 'eproc do TJSP', 'a ação do caso está pronta']));
reset role;

select is(
  (select jsonb_build_object('code', value ->> 'code', 'reason', value ->> 'reason', 'system', value ->> 'system_key',
                             'case', value ->> 'case_id' = pg_temp.got('terceiro', 'case_id'))
   from res where key = 'ask'),
  '{"code": "skipped", "reason": "no_phone", "system": "pje-tjrj", "case": true}'::jsonb,
  'the ask is kept, said as skipped on WhatsApp where the lawyer has none (the bell rings all the same), with the case to open'
);
select is((select value ->> 'code' from res where key = 'again'), 'not_owed', 'once');
select is((select value ->> 'code' from res where key = 'not_owed'), 'not_owed',
  'a lawyer who chose is never asked');
select is(pg_temp.owed(), 'primeiro/A/eproc-tjsp', 'and what was asked is owed no more');
select is(
  (select count(*)::integer from public.audit_events
   where action = 'filing_access.asked' and entity_id = pg_temp.got('terceiro', 'proceeding_id')),
  1, 'on the firm''s record');

-- ---------- Who reads it ----------

select pg_temp.sign_in('a3040000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select count(*)::integer from public.filing_access_asks), 1, 'the firm''s people read its asks');
reset role;
select pg_temp.sign_in('a3040000-0000-4000-8000-000000000003');
set local role authenticated;
select is((select count(*)::integer from public.filing_access_asks), 0, 'another firm reads none of them');
select throws_ok(
  $$select public.reserve_filing_access_ask('00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', array['a'])$$,
  '42501', null, 'and nobody but the backend keeps one');
reset role;

select * from finish();
rollback;
