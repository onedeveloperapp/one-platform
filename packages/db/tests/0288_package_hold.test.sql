begin;
create extension if not exists pgtap;
select plan(15);

-- ============================================================
-- What holds a package, by one rule (0288). Ana, partner of firm A, signs
-- five lawsuits of the small-claims court of São Paulo on the eproc, whose
-- screen asks each claimant's e-mail and mobile, each with a package ready
-- three days ago: one complete; one whose claimant has no e-mail; one built
-- for the lawsuit as it was; a minor with no contact of their own whose
-- mother has hers; a minor with an e-mail whose father has none. The queue
-- reads the holds, ONE's channel and the lawyer's batch hold the same, the
-- reminder leaves them out, and the e-mail given frees the package. Caio,
-- of firm B, reads nothing of it.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2880000-0000-4000-8000-000000000001', 'ana@lima-hold.invalid', 'Ana Lima'),
  ('a2880000-0000-4000-8000-000000000002', 'caio@prado-hold.invalid', 'Caio Prado')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2880000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-hold', 'a2880000-0000-4000-8000-000000000001'),
  ('b2880000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-hold', 'a2880000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2880000-0000-4000-8000-00000000000a', 'a2880000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2880000-0000-4000-8000-00000000000b', 'a2880000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.oab_registrations (user_id, uf, number) values
  ('a2880000-0000-4000-8000-000000000001', 'SP', '123456'),
  ('a2880000-0000-4000-8000-000000000002', 'SP', '654321');

create temporary table res (key text primary key, value jsonb);
grant all on res to authenticated, service_role, anon;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(key text, field text) returns text language sql as
$$ select value ->> got.field from res where res.key = got.key; $$;
create function pg_temp.package(key text) returns public.filing_packages language sql as
$$ select f from public.filing_packages f where f.id = pg_temp.got(key, 'package_id')::uuid; $$;

-- A case with a planned lawsuit of the small-claims court of São Paulo on the eproc (its system approved), its
-- claimant (with the contact given) and lawyer, an accepted petition and a package of it ready three days ago.
create function pg_temp.ready(name text, who uuid, org uuid, cpf text, contact jsonb) returns void language plpgsql as $$
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
    jsonb_strip_nulls(jsonb_build_object('full_name', 'Cliente ' || initcap(name), 'cpf', cpf)) || contact);
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
  perform public.confirm_file((file ->> 'file_id')::uuid, repeat('e', 64), 300000, 'application/pdf', 8);
  reset role;
  insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status, decided_at)
  values (document, org, (made ->> 'case_id')::uuid, (file ->> 'file_id')::uuid, 'petition', 'firm', 'accepted', now());
  insert into public.filing_packages (id, org_id, case_id, proceeding_id, court, system, kind, status, petition_document_id,
                                      built_at)
  values (package, org, (made ->> 'case_id')::uuid, lawsuit, 'TJSP', 'eproc', 'juizado', 'ready', document,
          now() - interval '3 days');
  insert into public.filing_package_items (org_id, package_id, position, name, file_id, document_id, bytes, pages)
  values (org, package, 1, '01-peticao-inicial.pdf', (file ->> 'file_id')::uuid, document, 300000, 8);
  insert into res values (name, made || jsonb_build_object('proceeding_id', lawsuit, 'package_id', package));
end;
$$;

-- The claimant becomes a minor, answered for by a guardian of the case with the contact given.
create function pg_temp.minor(name text, org uuid, guardian_contact jsonb) returns void language plpgsql as $$
declare
  guardian_person uuid := gen_random_uuid();
  guardian_party uuid := gen_random_uuid();
begin
  insert into public.people (id, org_id, full_name, email, phone)
  values (guardian_person, org, 'Responsável ' || initcap(name), guardian_contact ->> 'email', guardian_contact ->> 'phone');
  insert into public.case_parties (id, org_id, case_id, person_id, role)
  values (guardian_party, org, pg_temp.got(name, 'case_id')::uuid, guardian_person, 'guardian');
  update public.people set birth_date = date '2016-05-10'
  where id = (select cp.person_id from public.case_parties cp where cp.id = pg_temp.got(name, 'party_id')::uuid);
  update public.case_parties set guardian_id = guardian_party where id = pg_temp.got(name, 'party_id')::uuid;
  -- A lawyer split the family (a minor in the small-claims court): what holds the lawsuit is not this test's.
  update public.cases set family_choice = 'split', family_choice_reason = 'Escolha do advogado no teste'
  where id = pg_temp.got(name, 'case_id')::uuid;
end;
$$;

select pg_temp.ready('completo', 'a2880000-0000-4000-8000-000000000001', 'b2880000-0000-4000-8000-00000000000a',
  '52998224725', '{"email": "completo@cliente.invalid", "phone": "5511999990001"}');
select pg_temp.ready('sememail', 'a2880000-0000-4000-8000-000000000001', 'b2880000-0000-4000-8000-00000000000a',
  '11144477735', '{"phone": "5511999990002"}');
select pg_temp.ready('mudou', 'a2880000-0000-4000-8000-000000000001', 'b2880000-0000-4000-8000-00000000000a',
  '12345678909', '{"email": "mudou@cliente.invalid", "phone": "5511999990003"}');
select pg_temp.ready('menor', 'a2880000-0000-4000-8000-000000000001', 'b2880000-0000-4000-8000-00000000000a',
  null, '{}');
select pg_temp.ready('menorpai', 'a2880000-0000-4000-8000-000000000001', 'b2880000-0000-4000-8000-00000000000a',
  null, '{"email": "menorpai@cliente.invalid", "phone": "5511999990005"}');
select pg_temp.ready('prado', 'a2880000-0000-4000-8000-000000000002', 'b2880000-0000-4000-8000-00000000000b',
  '52998224725', '{}');

select pg_temp.minor('menor', 'b2880000-0000-4000-8000-00000000000a',
  '{"email": "mae@cliente.invalid", "phone": "5511999990004"}');
select pg_temp.minor('menorpai', 'b2880000-0000-4000-8000-00000000000a', '{"phone": "5511999990006"}');
-- The lawsuit moved to the civil court after its package was built.
update public.proceedings set kind = 'comum' where id = pg_temp.got('mudou', 'proceeding_id')::uuid;

-- ---------- What holds each package ----------

select pg_temp.sign_in('a2880000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res
select 'holds', coalesce(jsonb_object_agg(h.package_id, h.code), '{}'::jsonb)
from public.filing_package_holds('b2880000-0000-4000-8000-00000000000a', array[
  pg_temp.got('completo', 'package_id')::uuid, pg_temp.got('sememail', 'package_id')::uuid,
  pg_temp.got('mudou', 'package_id')::uuid, pg_temp.got('menor', 'package_id')::uuid,
  pg_temp.got('menorpai', 'package_id')::uuid, pg_temp.got('prado', 'package_id')::uuid]) h;
reset role;

select is((select value ->> pg_temp.got('sememail', 'package_id') from res where key = 'holds'), 'contact_missing',
  'a claimant with no e-mail holds the package where the eproc asks it');
select is((select value ->> pg_temp.got('mudou', 'package_id') from res where key = 'holds'), 'package_outdated',
  'a package built for the lawsuit as it was is held');
select is((select value ->> pg_temp.got('menorpai', 'package_id') from res where key = 'holds'), 'contact_missing',
  'a minor''s contact is who answers for them: a father with no e-mail holds it');
select ok((select not (value ? pg_temp.got('menor', 'package_id')) from res where key = 'holds'),
  'a minor with no contact of their own goes with their mother''s');
select ok((select not (value ? pg_temp.got('completo', 'package_id')) from res where key = 'holds'),
  'a complete package is held by nothing');
select ok((select not (value ? pg_temp.got('prado', 'package_id')) from res where key = 'holds'),
  'a package of another firm is left out');

-- ---------- ONE's own filing holds it the same ----------

select is(public.filing_submission_blocker(pg_temp.package('sememail')), 'contact_missing',
  'the court''s channel does not take it');
select is(public.filing_screen_blocker(pg_temp.package('sememail'), 'a2880000-0000-4000-8000-000000000001'),
  'contact_missing', 'nor ONE''s browser or the lawyer''s extension');
select is(public.filing_screen_blocker(pg_temp.package('completo'), 'a2880000-0000-4000-8000-000000000001'),
  null, 'while a complete package goes to a batch');

-- ---------- The reminder ----------

select is((select array_agg(w.package_id order by w.package_id)
           from public.filing_packages_waiting('b2880000-0000-4000-8000-00000000000a') w),
  (select array_agg(id order by id) from public.filing_packages
   where id in (pg_temp.got('completo', 'package_id')::uuid, pg_temp.got('menor', 'package_id')::uuid)),
  'the reminder to file by hand names only the packages nothing holds');

-- ---------- The e-mail given frees it ----------

update public.people set email = 'sememail@cliente.invalid'
where id = (select cp.person_id from public.case_parties cp where cp.id = pg_temp.got('sememail', 'party_id')::uuid);
select is(public.filing_package_hold(pg_temp.package('sememail')), null, 'the e-mail given, nothing holds it');

update public.people set phone = null
where id = (select cp.person_id from public.case_parties cp where cp.id = pg_temp.got('sememail', 'party_id')::uuid);
select is(public.filing_package_hold(pg_temp.package('sememail')), 'contact_missing', 'and the mobile taken away holds it again');

-- ---------- Another firm ----------

select pg_temp.sign_in('a2880000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(format('select * from public.filing_package_holds(%L, array[%L]::uuid[])',
  'b2880000-0000-4000-8000-00000000000a', pg_temp.got('sememail', 'package_id')), '42501', null,
  'another firm cannot ask what holds firm A''s packages');
select is((select count(*)::integer from public.filing_package_holds('b2880000-0000-4000-8000-00000000000b',
  array[pg_temp.got('sememail', 'package_id')::uuid])), 0, 'nor read them through its own');
reset role;

select pg_temp.sign_in('a2880000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok('select public.filing_package_hold(f) from public.filing_packages f limit 1', '42501', null,
  'the rule itself is internal');
reset role;

select * from finish();
rollback;
