begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- The lawyer's extension files a batch on the court's screen (0267). Ana,
-- partner of firm A, files through her extension at the eproc of TJSP: she
-- links it with a code, approves a batch, and her extension takes it, holds
-- the first filing at the court's summary, confirms it by its link and marks
-- it as going; the court's answer cannot be read, and the filing is unknown.
-- Ana says the court's system does not have it, and the package is free for
-- a new batch. A test case never goes to a court's screen, and the sweep of
-- the court's channel leaves a batch's filing alone. Caio, of firm B, sends
-- nothing of firm A again.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2670000-0000-4000-8000-000000000001', 'ana@lima-extensao.invalid', 'Ana Lima'),
  ('a2670000-0000-4000-8000-000000000002', 'caio@prado-extensao.invalid', 'Caio Prado')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2670000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-extensao', 'a2670000-0000-4000-8000-000000000001'),
  ('b2670000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-extensao', 'a2670000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2670000-0000-4000-8000-00000000000a', 'a2670000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2670000-0000-4000-8000-00000000000b', 'a2670000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.oab_registrations (user_id, uf, number) values
  ('a2670000-0000-4000-8000-000000000001', 'SP', '123456'),
  ('a2670000-0000-4000-8000-000000000002', 'SP', '654321');

create temporary table res (key text primary key, value jsonb);
grant all on res to authenticated, service_role, anon;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(key text, field text) returns text language sql as
$$ select value ->> got.field from res where res.key = got.key; $$;

-- A case of a firm with a planned lawsuit of the small-claims court of São Paulo on the eproc (its system approved),
-- its claimant and lawyer, an accepted petition and a package of it ready to be filed.
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
  perform public.confirm_file((file ->> 'file_id')::uuid, repeat('e', 64), 300000, 'application/pdf', 8);
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

select pg_temp.ready('real', 'a2670000-0000-4000-8000-000000000001', 'b2670000-0000-4000-8000-00000000000a', '52998224725');
select pg_temp.ready('teste', 'a2670000-0000-4000-8000-000000000001', 'b2670000-0000-4000-8000-00000000000a', '11144477735');
update public.cases set is_test = true where id = pg_temp.got('teste', 'case_id')::uuid;

-- Ana files through her extension at the eproc of TJSP, and links it with the code ONE showed her.
select pg_temp.sign_in('a2670000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_firm_filing_way('b2670000-0000-4000-8000-00000000000a', 'extension',
  public.filing_term_in_force('protocolo-escritorio'));
select public.set_lawyer_filing_way('b2670000-0000-4000-8000-00000000000a', 'eproc-tjsp', 'extension',
  public.filing_term_in_force('protocolo-advogado'));
select public.begin_extension_link('b2670000-0000-4000-8000-00000000000a', repeat('c', 64));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('link', public.claim_extension_link(repeat('c', 64), repeat('f', 64), 'Chrome do escritório'));
reset role;

-- ---------- A test case stays off the court's screen ----------

select pg_temp.sign_in('a2670000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('test_batch', public.approve_filing_batch('b2670000-0000-4000-8000-00000000000a', 'eproc-tjsp',
  array[pg_temp.got('teste', 'package_id')::uuid]));
reset role;
select ok(
  pg_temp.got('test_batch', 'code') = 'nothing_to_file'
  and (select value -> 'skipped' -> 0 ->> 'code' = 'test_case' from res where key = 'test_batch')
  and not exists (select 1 from public.filing_submissions where package_id = pg_temp.got('teste', 'package_id')::uuid),
  'a test case is never approved to be filed on a court''s screen: the test court files it'
);

-- A batch's filing of a test case from before this migration: the sweep of the court's channel leaves it alone.
insert into public.filing_batches (id, org_id, person_id, system_key, way)
values ('c2670000-0000-4000-8000-0000000000aa', 'b2670000-0000-4000-8000-00000000000a',
        'a2670000-0000-4000-8000-000000000001', 'eproc-tjsp', 'extension');
insert into public.filing_submissions (org_id, case_id, proceeding_id, package_id, channel, batch_id, learning, requested_by)
values ('b2670000-0000-4000-8000-00000000000a', pg_temp.got('teste', 'case_id')::uuid,
        pg_temp.got('teste', 'proceeding_id')::uuid, pg_temp.got('teste', 'package_id')::uuid, 'extension',
        'c2670000-0000-4000-8000-0000000000aa', true, 'a2670000-0000-4000-8000-000000000001');
select pg_temp.as_backend();
set local role service_role;
select lives_ok(
  format($$ insert into res values ('sweep', public.claim_filing_submissions(5, %L)) $$, pg_temp.got('teste', 'package_id')),
  'the sweep of the court''s channel runs beside a batch''s filing'
);
reset role;
select ok(
  (select jsonb_array_length(value -> 'claimed') = 0 from res where key = 'sweep')
  and (select status = 'owed' and channel = 'extension' and claims = 0 from public.filing_submissions
       where package_id = pg_temp.got('teste', 'package_id')::uuid),
  'and claims none of it: a batch''s filing is its runner''s'
);

-- ---------- Ana's extension files a batch, and its answer cannot be read ----------

select pg_temp.sign_in('a2670000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('batch', public.approve_filing_batch('b2670000-0000-4000-8000-00000000000a', 'eproc-tjsp',
  array[pg_temp.got('real', 'package_id')::uuid]));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('linked', public.extension_link_of(repeat('f', 64)));
insert into res values ('claim', public.claim_filing_batch(pg_temp.got('batch', 'batch_id')::uuid, 'extension'));
insert into res values ('next', public.next_batch_submission(pg_temp.got('batch', 'batch_id')::uuid, 1));
insert into res values ('hold', public.hold_filing_submission(pg_temp.got('next', 'submission_id')::uuid, 1));
insert into res values ('confirm', public.confirm_filing_submission_by_link(pg_temp.got('next', 'submission_id')::uuid,
  pg_temp.got('link', 'link_id')::uuid));
insert into res values ('sending', public.filing_submission_sending(pg_temp.got('next', 'submission_id')::uuid, 1));
insert into res values ('unknown', public.record_filing_submission(pg_temp.got('next', 'submission_id')::uuid, 1,
  'unknown', null, null, 'A tela do tribunal não mostrou o recibo.'));
insert into res values ('done', public.finish_filing_batch(pg_temp.got('batch', 'batch_id')::uuid, 1));
reset role;
select ok(
  pg_temp.got('linked', 'user_id') = 'a2670000-0000-4000-8000-000000000001'
  and pg_temp.got('claim', 'way') = 'extension' and pg_temp.got('claim', 'learning') = 'true'
  and pg_temp.got('hold', 'code') = 'confirming' and pg_temp.got('confirm', 'code') = 'confirmed'
  and pg_temp.got('sending', 'code') = 'sending' and pg_temp.got('unknown', 'code') = 'unknown'
  and pg_temp.got('done', 'code') = 'done'
  and (select status = 'unknown' and confirmed_by = 'a2670000-0000-4000-8000-000000000001'
       from public.filing_submissions where id = pg_temp.got('next', 'submission_id')::uuid),
  'Ana''s extension takes her batch, holds the first filing at the summary, confirms it by its link, and the answer is unknown'
);

-- ---------- Sending it again ----------

select pg_temp.sign_in('a2670000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  format($$ select public.retry_filing_submission(%L, true) $$, pg_temp.got('next', 'submission_id')),
  'P0002', 'case_not_found',
  'Caio, of firm B, sends nothing of firm A again'
);
reset role;

select pg_temp.sign_in('a2670000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('unsaid', public.retry_filing_submission(pg_temp.got('next', 'submission_id')::uuid, false));
insert into res values ('retry', public.retry_filing_submission(pg_temp.got('next', 'submission_id')::uuid, true));
insert into res values ('again', public.approve_filing_batch('b2670000-0000-4000-8000-00000000000a', 'eproc-tjsp',
  array[pg_temp.got('real', 'package_id')::uuid]));
reset role;
select ok(
  pg_temp.got('unsaid', 'code') = 'confirm_not_in_court'
  and pg_temp.got('retry', 'code') = 'freed'
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('real', 'case_id')::uuid
              and e.kind = 'filing_retried' and e.data ->> 'freed' = 'true')
  and pg_temp.got('again', 'code') = 'approved'
  and (select count(*) = 1 and bool_and(batch_id = pg_temp.got('again', 'batch_id')::uuid and status = 'owed')
       from public.filing_submissions where package_id = pg_temp.got('real', 'package_id')::uuid),
  'once Ana says the court''s system does not have it, the package is free and goes in a new batch'
);

-- ---------- Firm B ----------

select pg_temp.sign_in('a2670000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('b_sees', jsonb_build_object(
  'batches', (select count(*) from public.filing_batches where org_id = 'b2670000-0000-4000-8000-00000000000a'),
  'links', (select count(*) from public.extension_links where org_id = 'b2670000-0000-4000-8000-00000000000a'),
  'filings', (select count(*) from public.filing_submissions where org_id = 'b2670000-0000-4000-8000-00000000000a')));
reset role;
select ok(
  pg_temp.got('b_sees', 'batches') = '0' and pg_temp.got('b_sees', 'links') = '0' and pg_temp.got('b_sees', 'filings') = '0',
  'firm B reads none of firm A''s batches, extension links or filings'
);

select * from finish();
rollback;
