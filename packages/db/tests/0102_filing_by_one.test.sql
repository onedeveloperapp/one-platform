begin;
create extension if not exists pgtap;
select plan(14);

-- ============================================================
-- ONE files the lawsuit itself, through the court's own machine channel or,
-- for a test case, the test court (0101). A package ready that nothing
-- keeps from being filed is reserved, claimed and sent once; filed, the
-- lawsuit takes its number and receipt; a court out of reach is tried
-- again, one that refuses says why, and one whose answer was lost is never
-- sent again until a lawyer says the court does not have it. A court with
-- no channel, codes missing or files not signed is not sent to; a firm that
-- keeps the filing to a lawyer waits for one to ask. Two firms: nothing of
-- one reaches the other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1020000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@protocolo.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a1020000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@protocolo.invalid', '', now(), '{}', '{"display_name":"Caio Prado"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1020000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-protocolo', 'a1020000-0000-4000-8000-000000000001'),
  ('b1020000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-protocolo', 'a1020000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1020000-0000-4000-8000-00000000000a', 'a1020000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1020000-0000-4000-8000-00000000000b', 'a1020000-0000-4000-8000-000000000002', 'owner', 'advogado');
insert into public.oab_registrations (user_id, uf, number) values
  ('a1020000-0000-4000-8000-000000000001', 'GO', '12345'),
  ('a1020000-0000-4000-8000-000000000002', 'GO', '54321');
-- Firm B keeps the filing to a lawyer.
insert into public.firm_autonomy (org_id, decision, mode) values ('b1020000-0000-4000-8000-00000000000b', 'file_lawsuit', 'approval');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- A case of a firm with a planned lawsuit of the small-claims court of Goiânia (its system approved), its claimant and
-- lawyer, an accepted petition and a package of it ready to be filed.
create function pg_temp.ready(name text, who uuid, org uuid, test boolean) returns void language plpgsql as $$
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
    jsonb_build_object('full_name', 'Cliente ' || initcap(translate(name, '_', ' ')), 'cpf', '52998224725',
                       'phone', '55009997' || lpad((abs(hashtext(name)) % 100000)::text, 5, '0')));
  reset role;
  update public.cases set status = 'drafting', is_test = test where id = (made ->> 'case_id')::uuid;
  insert into public.proceedings (id, org_id, case_id, kind, court, comarca, status)
  values (lawsuit, org, (made ->> 'case_id')::uuid, 'juizado', 'TJGO', 'Goiânia', 'planned');
  update public.proceedings set system = 'projudi', system_approved_by = who, system_approved_at = now() where id = lawsuit;
  insert into public.proceeding_parties (proceeding_id, party_id, org_id) values (lawsuit, (made ->> 'party_id')::uuid, org);
  insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values (lawsuit, who, org);
  perform pg_temp.as_backend();
  set local role service_role;
  file := public.reserve_file(org, 'upload', 'inicial.pdf', 'application/pdf', 300000);
  perform public.confirm_file((file ->> 'file_id')::uuid, repeat('c', 64), 300000, 'application/pdf', 8);
  reset role;
  insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status, decided_at)
  values (document, org, (made ->> 'case_id')::uuid, (file ->> 'file_id')::uuid, 'petition', 'firm', 'accepted', now());
  insert into public.filing_packages (id, org_id, case_id, proceeding_id, court, system, kind, status, petition_document_id,
                                      built_at)
  values (package, org, (made ->> 'case_id')::uuid, lawsuit, 'TJGO', 'projudi', 'juizado', 'ready', document, now());
  insert into public.filing_package_items (org_id, package_id, position, name, file_id, document_id, bytes, pages)
  values (org, package, 1, '01-peticao-inicial.pdf', (file ->> 'file_id')::uuid, document, 300000, 8);
  insert into res values (name, made || jsonb_build_object('proceeding_id', lawsuit, 'package_id', package));
end;
$$;
create function pg_temp.claim(name text) returns jsonb language plpgsql as $$
declare
  answer jsonb;
begin
  perform pg_temp.as_backend();
  set local role service_role;
  answer := coalesce((public.claim_filing_submissions(5, pg_temp.got(name, 'package_id')::uuid) -> 'claimed') -> 0, '{}'::jsonb);
  reset role;
  return answer;
end;
$$;
create function pg_temp.package(name text) returns public.filing_packages language sql as
$$ select * from public.filing_packages where id = pg_temp.got(name, 'package_id')::uuid; $$;
create function pg_temp.submission(name text) returns public.filing_submissions language sql as
$$ select * from public.filing_submissions where package_id = pg_temp.got(name, 'package_id')::uuid; $$;

select pg_temp.ready('test', 'a1020000-0000-4000-8000-000000000001', 'b1020000-0000-4000-8000-00000000000a', true);
select pg_temp.ready('real', 'a1020000-0000-4000-8000-000000000001', 'b1020000-0000-4000-8000-00000000000a', false);
select pg_temp.ready('firm_b', 'a1020000-0000-4000-8000-000000000002', 'b1020000-0000-4000-8000-00000000000b', true);

-- ---------- The data, the decision and who reaches what ----------

select ok(
  (select codes -> 'classes' = '{"juizado": 436, "comum": 7}'::jsonb and not enabled and not confirmed
          and endpoint = 'https://projudi.tjgo.jus.br/IntercomunicacaoService'
   from public.court_filing_channels where court = 'TJGO' and system = 'projudi')
  and (select default_mode = 'auto' from public.autonomy_decisions where key = 'file_lawsuit')
  and not has_function_privilege('authenticated', 'public.claim_filing_submissions(integer, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_filing_submission(uuid, integer, text, text, text, text, uuid, date)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.court_filing_channels', 'SELECT')
  and has_function_privilege('authenticated', 'public.request_filing_submission(uuid)', 'EXECUTE'),
  'the TJGO''s channel is data, off until the court grants it; ONE files alone by default; only the backend sends'
);

-- ---------- A test case: ONE files it in the test court ----------

insert into res values ('claim_test', pg_temp.claim('test'));
select ok(
  pg_temp.got('claim_test', 'channel') = 'test_court'
  and (pg_temp.submission('test')).status = 'claimed',
  'a test case''s package ready is claimed to be filed in the test court'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('to_send', public.filing_submission_to_send(pg_temp.got('claim_test', 'submission_id')::uuid,
  pg_temp.got('claim_test', 'claim')::integer));
insert into res values ('not_held', jsonb_build_object('payload',
  public.filing_submission_to_send(pg_temp.got('claim_test', 'submission_id')::uuid, 99)));
reset role;
select ok(
  pg_temp.got('to_send', 'test_number') ~ '^\d{7}\d{2}2099809\d{4}$'
  and (select payload -> 'claimants' -> 0 ->> 'cpf' = '52998224725' from res where name = 'to_send')
  and (select payload -> 'lawyers' -> 0 -> 'oab' ->> 'uf' = 'GO' from res where name = 'to_send')
  and (select payload -> 'items' -> 0 ->> 'document_kind' = 'petition' from res where name = 'to_send')
  and (select payload -> 'defendant' ->> 'airline' = 'LA' from res where name = 'to_send')
  and (select payload -> 'payload' = 'null'::jsonb from res where name = 'not_held'),
  'the worker holding the claim reads the lawsuit, its people, its lawyers, its files and the number the test court gives'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('sending', public.filing_submission_sending(pg_temp.got('claim_test', 'submission_id')::uuid,
  pg_temp.got('claim_test', 'claim')::integer));
insert into res values ('receipt', public.reserve_file('b1020000-0000-4000-8000-00000000000a', 'filing_receipt', 'recibo.pdf',
  'application/pdf', 4000));
select public.confirm_file(pg_temp.got('receipt', 'file_id')::uuid, repeat('d', 64), 4000, 'application/pdf', 1);
insert into res values ('filed', public.record_filing_submission(pg_temp.got('claim_test', 'submission_id')::uuid,
  pg_temp.got('claim_test', 'claim')::integer, 'filed', 'TESTE-1', pg_temp.got('to_send', 'test_number'),
  'Recebido.', pg_temp.got('receipt', 'file_id')::uuid, null));
reset role;
select ok(
  pg_temp.got('sending', 'code') = 'sending' and pg_temp.got('filed', 'code') = 'filed'
  and (select status = 'filed' and cnj = pg_temp.got('to_send', 'test_number') from public.proceedings
       where id = pg_temp.got('test', 'proceeding_id')::uuid)
  and (pg_temp.package('test')).status = 'filed'
  and exists (select 1 from public.filing_receipts r where r.package_id = pg_temp.got('test', 'package_id')::uuid
                and r.file_id = pg_temp.got('receipt', 'file_id')::uuid and r.recorded_by is null)
  and (pg_temp.submission('test')).status = 'filed' and (pg_temp.submission('test')).protocol = 'TESTE-1'
  and exists (select 1 from public.case_events where case_id = pg_temp.got('test', 'case_id')::uuid
                and kind = 'filed_by_one' and actor_type = 'system'),
  'filed: the lawsuit takes its number, the receipt is kept, the package is closed, and the timeline says ONE filed it'
);

-- ---------- A real court: only through a channel ONE files through, with its codes and the files signed ----------

select ok(
  public.filing_submission_blocker(pg_temp.package('real')) = 'no_channel'
  and pg_temp.claim('real') = '{}'::jsonb,
  'a court whose channel ONE does not file through yet is not sent to'
);

update public.court_filing_channels set enabled = true where court = 'TJGO' and system = 'projudi';
select is(public.filing_submission_blocker(pg_temp.package('real')), 'court_codes_missing',
  'a channel without the codes of the lawsuit''s comarca is not sent to');

update public.court_filing_channels
set codes = codes || jsonb_build_object(
  'localities', jsonb_build_object('Goiânia', '5208707'),
  'judging_bodies', jsonb_build_object('Goiânia|juizado', jsonb_build_object('code', '9999', 'name', 'Juizado de teste', 'ibge', '5208707')))
where court = 'TJGO' and system = 'projudi';
select is(public.filing_submission_blocker(pg_temp.package('real')), 'not_signed',
  'where the court takes the files signed, nothing goes before they are');

update public.filing_packages set signature_status = 'signed', signed_at = now() where id = pg_temp.got('real', 'package_id')::uuid;
insert into res values ('claim_real', pg_temp.claim('real'));

-- ---------- Out of reach, then lost on the way ----------

select pg_temp.as_backend();
set local role service_role;
select public.filing_submission_sending(pg_temp.got('claim_real', 'submission_id')::uuid, pg_temp.got('claim_real', 'claim')::integer);
insert into res values ('unavailable', public.record_filing_submission(pg_temp.got('claim_real', 'submission_id')::uuid,
  pg_temp.got('claim_real', 'claim')::integer, 'unavailable', null, null, 'O tribunal não respondeu.'));
reset role;
select ok(
  pg_temp.got('claim_real', 'channel') = 'mni' and pg_temp.got('unavailable', 'code') = 'retry'
  and (pg_temp.submission('real')).status = 'owed' and (pg_temp.submission('real')).retry_after > now()
  and pg_temp.claim('real') = '{}'::jsonb,
  'a court out of reach is tried again after a wait, and not before'
);

update public.filing_submissions set retry_after = now() - interval '1 minute' where package_id = pg_temp.got('real', 'package_id')::uuid;
insert into res values ('claim_again', pg_temp.claim('real'));
select pg_temp.as_backend();
set local role service_role;
select public.filing_submission_sending(pg_temp.got('claim_again', 'submission_id')::uuid, pg_temp.got('claim_again', 'claim')::integer);
reset role;
-- The worker never came back.
update public.filing_submissions set sent_at = now() - interval '1 hour' where package_id = pg_temp.got('real', 'package_id')::uuid;
select pg_temp.claim('test');
select ok(
  (pg_temp.submission('real')).status = 'unknown'
  and pg_temp.claim('real') = '{}'::jsonb
  and exists (select 1 from public.case_events where case_id = pg_temp.got('real', 'case_id')::uuid and kind = 'filing_unknown'),
  'a filing that went and never came back is unknown, and never sent again by itself'
);

select pg_temp.sign_in('a1020000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('retry_blind', public.retry_filing_submission((pg_temp.submission('real')).id, false));
insert into res values ('retry_checked', public.retry_filing_submission((pg_temp.submission('real')).id, true));
reset role;
select ok(
  pg_temp.got('retry_blind', 'code') = 'confirm_not_in_court' and pg_temp.got('retry_checked', 'code') = 'owed'
  and (pg_temp.submission('real')).status = 'owed',
  'a lawyer sends it again only saying the court''s system does not have the lawsuit'
);

-- ---------- Refused ----------

insert into res values ('claim_third', pg_temp.claim('real'));
select pg_temp.as_backend();
set local role service_role;
select public.filing_submission_sending(pg_temp.got('claim_third', 'submission_id')::uuid, pg_temp.got('claim_third', 'claim')::integer);
insert into res values ('refused', public.record_filing_submission(pg_temp.got('claim_third', 'submission_id')::uuid,
  pg_temp.got('claim_third', 'claim')::integer, 'refused', '2026/0001', null, 'Classe incompatível com o órgão.'));
reset role;
select ok(
  pg_temp.got('refused', 'code') = 'refused' and (pg_temp.submission('real')).status = 'refused'
  and (pg_temp.submission('real')).message = 'Classe incompatível com o órgão.'
  and (select status = 'planned' from public.proceedings where id = pg_temp.got('real', 'proceeding_id')::uuid)
  and (pg_temp.package('real')).status = 'ready',
  'a court that refuses says why, and the lawsuit stays to be filed'
);

-- ---------- A firm that keeps the filing to a lawyer ----------

select ok(
  public.filing_submission_blocker(pg_temp.package('firm_b')) = 'awaits_lawyer'
  and pg_temp.claim('firm_b') = '{}'::jsonb,
  'where the firm keeps the filing to a lawyer, ONE waits for one to ask'
);

select pg_temp.sign_in('a1020000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.request_filing_submission(%L)', pg_temp.got('firm_b', 'package_id')),
  'P0002', 'case_not_found',
  'nobody of another firm asks for a filing of this one'
);
reset role;

select pg_temp.sign_in('a1020000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('asked', public.request_filing_submission(pg_temp.got('firm_b', 'package_id')::uuid));
insert into res values ('asked_again', public.request_filing_submission(pg_temp.got('firm_b', 'package_id')::uuid));
insert into res values ('screen_b', jsonb_build_object('rows', public.case_filing_by_one(pg_temp.got('firm_b', 'case_id')::uuid)));
reset role;
insert into res values ('claim_b', pg_temp.claim('firm_b'));
select ok(
  pg_temp.got('asked', 'code') = 'requested' and pg_temp.got('asked_again', 'code') = 'already_asked'
  and pg_temp.got('claim_b', 'channel') = 'test_court'
  and (select payload -> 'rows' -> 0 -> 'submission' ->> 'requested' = 'true'
              and payload -> 'rows' -> 0 ->> 'mode' = 'approval' from res where name = 'screen_b')
  and not exists (select 1 from public.filing_submissions s where s.org_id = 'b1020000-0000-4000-8000-00000000000b'
                    and s.case_id in (select id from public.cases where org_id = 'b1020000-0000-4000-8000-00000000000a')),
  'a lawyer of the firm asks once, ONE then files it, and the screen says so; nothing of one firm reaches the other'
);

select * from finish();
rollback;
