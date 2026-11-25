begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- ============================================================
-- The history of a lawsuit sets ONE to no work about what had passed (0289). Firm A's lawyer attaches the receipt of
-- a lawsuit filed long before its case was in ONE, and ONE reads its history: an intimation published 250 days ago,
-- one 20 days ago whose deadline has gone, and one 3 days ago whose deadline is still to come; beside them, one the
-- DJEN made available to her registration only now, of the same old day. Once triaged, the old one of the history owes
-- no reading of what it asks, the recent ones do; and once read, ONE starts by itself the piece of the one whose
-- deadline is still to come and of the one the DJEN made available, never of the one whose day is gone. Firm B reads
-- nothing of firm A's.
--
-- Every person, firm and number here is invented: the lawsuits are of 2099, and the CPF one every manual uses as an
-- example.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2890000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'lia@melo-passado.invalid', '', now(), '{}', '{"display_name":"Lia Melo"}', now(), now()),
  ('a2890000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@prado-passado.invalid', '', now(), '{}', '{"display_name":"Davi Prado"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2890000-0000-4000-8000-00000000000a', 'Melo Advogados', 'melo-passado', 'a2890000-0000-4000-8000-000000000001'),
  ('b2890000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-passado', 'a2890000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2890000-0000-4000-8000-00000000000a', 'a2890000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2890000-0000-4000-8000-00000000000b', 'a2890000-0000-4000-8000-000000000002', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert, update on res to authenticated, service_role, anon;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, key text) returns text language sql as
$$ select payload ->> key from res where res.name = got.name; $$;
create function pg_temp.stored(org uuid, who uuid, name text, mark text) returns uuid language plpgsql as $$
declare
  reserved jsonb := public.reserve_file(org, 'upload', name, 'application/pdf', 1000, who);
begin
  perform public.confirm_file((reserved ->> 'file_id')::uuid, repeat(mark, 64), 1000, 'application/pdf', 1);
  return (reserved ->> 'file_id')::uuid;
end;
$$;

-- A case of a delayed flight 400 days ago, its lawsuit at the small-claims court of São Paulo with its package
-- built, and the receipt of its filing 300 days ago, attached with the lawyer's word that it was filed before ONE.
create function pg_temp.lawsuit(org uuid, owner uuid, name text, mark text) returns void language plpgsql as $$
declare
  made jsonb;
  saved jsonb;
  file uuid;
  receipt uuid;
  attached jsonb;
  package uuid := gen_random_uuid();
begin
  perform pg_temp.sign_in(owner);
  set local role authenticated;
  made := public.create_case(org, 'delay', 'G3', current_date - 400,
    '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02"}'::jsonb);
  saved := public.save_proceeding((made ->> 'case_id')::uuid, null,
    '{"kind": "juizado", "court": "TJSP", "comarca": "São Paulo", "forum_basis": "domicile", "system": "eproc"}'::jsonb,
    array[(made ->> 'party_id')::uuid]);
  perform public.decide_court_system((saved ->> 'proceeding_id')::uuid, true);
  reset role;
  perform pg_temp.as_backend();
  set local role service_role;
  file := pg_temp.stored(org, owner, 'peticao-' || mark || '.pdf', mark);
  receipt := pg_temp.stored(org, owner, 'recibo-' || mark || '.pdf', case mark when 'a' then 'c' else 'd' end);
  reset role;
  perform pg_temp.sign_in(owner);
  set local role authenticated;
  attached := public.attach_case_document((made ->> 'case_id')::uuid, file, 'petition');
  perform public.decide_case_document((attached ->> 'document_id')::uuid, 'accepted');
  reset role;
  insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values ((saved ->> 'proceeding_id')::uuid, owner, org);
  insert into public.filing_packages (id, org_id, case_id, proceeding_id, court, system, kind, status, petition_document_id, built_at)
  values (package, org, (made ->> 'case_id')::uuid, (saved ->> 'proceeding_id')::uuid, 'TJSP', 'eproc', 'juizado',
          'ready', (attached ->> 'document_id')::uuid, now());
  perform pg_temp.sign_in(owner);
  set local role authenticated;
  insert into res values (name || '_filed', public.attach_filing_receipt(package, receipt, '1000286-84.2099.8.26.0100',
    current_date - 300, true));
  reset role;
  insert into res values (name, jsonb_build_object('case', made ->> 'case_id', 'proceeding', saved ->> 'proceeding_id'));
end;
$$;

select pg_temp.lawsuit('b2890000-0000-4000-8000-00000000000a', 'a2890000-0000-4000-8000-000000000001', 'a', 'a');
select pg_temp.lawsuit('b2890000-0000-4000-8000-00000000000b', 'a2890000-0000-4000-8000-000000000002', 'b', 'b');

create function pg_temp.item(hash text, day date, body text) returns jsonb language sql as
$$ select jsonb_build_object('hash', hash, 'court', 'TJSP', 'cnj', '10002868420998260100', 'available_on', day::text,
     'kind', 'Intimação', 'document_type', null, 'text', body, 'head', body, 'tail', null, 'link', null,
     'unit', '1º Juizado Especial Cível de São Paulo', 'class_name', 'Procedimento do Juizado Especial Cível',
     'active', true, 'cancel_reason', null); $$;

-- ONE reads each firm's history: firm A's three intimations, firm B's one of 250 days ago.
create function pg_temp.history(name text, items jsonb) returns jsonb language plpgsql as $$
declare
  owed uuid := (select r.id from public.proceeding_history_reads r
                where r.proceeding_id = pg_temp.got(name, 'proceeding')::uuid);
  claimed record;
begin
  perform pg_temp.as_backend();
  set local role service_role;
  select * into claimed from public.claim_proceeding_history_reads(1, owed);
  return public.record_proceeding_history(claimed.read_id, claimed.claim, 'done', items);
end;
$$;
select pg_temp.history('a', jsonb_build_array(
  pg_temp.item('p289old1abcdefghijklmnopqrstuv', current_date - 250, 'Manifeste-se a parte autora sobre os documentos.'),
  pg_temp.item('p289gone1bcdefghijklmnopqrstuv', current_date - 20, 'Manifeste-se a parte autora em cinco dias.'),
  pg_temp.item('p289open1bcdefghijklmnopqrstuv', current_date - 3, 'Manifeste-se a parte autora em quinze dias.')));
reset role;
select pg_temp.history('b', jsonb_build_array(
  pg_temp.item('p289oldbabcdefghijklmnopqrstuv', current_date - 250, 'Manifeste-se a parte autora.')));
reset role;

-- The DJEN made one of the same old day available to firm A's lawyer only now: read as before, by its capture.
insert into public.publications (org_id, hash, court, cnj, available_on, kind, body, head, lawyer_ids, proceeding_id, case_id)
values ('b2890000-0000-4000-8000-00000000000a', 'p289djen1bcdefghijklmnopqrstuv', 'TJSP', '10002868420998260100',
        current_date - 250, 'Intimação', 'Especifiquem as partes as provas.', 'Especifiquem as partes as provas.',
        array['a2890000-0000-4000-8000-000000000001'::uuid], pg_temp.got('a', 'proceeding')::uuid, pg_temp.got('a', 'case')::uuid);

create function pg_temp.publication(hash text) returns uuid language sql as
$$ select p.id from public.publications p where p.hash = publication.hash; $$;
create function pg_temp.owes(hash text) returns boolean language sql as
$$ select exists (select 1 from public.publication_actions a where a.publication_id = pg_temp.publication(hash)); $$;

select is(pg_temp.got('a_filed', 'code') || ' ' || pg_temp.got('b_filed', 'code'), 'filed filed',
  'each firm''s lawsuit is filed before ONE, with its history read');

-- ONE triaged them all: each opens a term.
update public.publications set category = 'prazo', ai_applied = true, triaged_at = now()
where hash like 'p289%';

-- ---------- 1. The reading of what a publication asks ----------

select ok(not pg_temp.owes('p289old1abcdefghijklmnopqrstuv'),
  'an intimation of the history published long ago owes no reading of what it asks');
select ok(pg_temp.owes('p289gone1bcdefghijklmnopqrstuv') and pg_temp.owes('p289open1bcdefghijklmnopqrstuv'),
  'the recent ones of the history do');
select ok(pg_temp.owes('p289djen1bcdefghijklmnopqrstuv'),
  'one the DJEN made available to the lawyer is read by the day it was captured, as before');
select ok(not pg_temp.owes('p289oldbabcdefghijklmnopqrstuv'), 'nor does firm B''s old one');

-- ---------- 2. The pieces ONE starts by itself ----------

-- ONE read them: a manifestation each. Its deadlines: the one of 20 days ago gone (settled by 0286), the one of 3
-- days ago still to come, the DJEN's one still to come.
update public.publication_actions set status = 'done', action = 'manifestacao', done_at = now(), reason = 'Manifestação.'
where publication_id in (select id from public.publications where hash like 'p289%');
create function pg_temp.deadline(hash text, trigger_day date, due date) returns text language sql as $$
  insert into public.deadlines (org_id, cnj, court, case_id, proceeding_id, publication_id, title, trigger, trigger_on,
                                days, counting, computed_due_on, computed_revision, computed_at)
  values ('b2890000-0000-4000-8000-00000000000a', '10002868420998260100', 'TJSP', pg_temp.got('a', 'case')::uuid,
          pg_temp.got('a', 'proceeding')::uuid, pg_temp.publication(hash), 'Manifestação', 'publication',
          trigger_day, 5, 'business', due, 1, now())
  returning status;
$$;
select is(pg_temp.deadline('p289gone1bcdefghijklmnopqrstuv', current_date - 20, current_date - 13), 'done',
  'the deadline of the history whose day is gone came in settled');
select is(pg_temp.deadline('p289open1bcdefghijklmnopqrstuv', current_date - 3, current_date + 4)
       || ' ' || pg_temp.deadline('p289djen1bcdefghijklmnopqrstuv', current_date, current_date + 7),
  'proposed proposed', 'the ones still to come are open');

select pg_temp.as_backend();
set local role service_role;
insert into res values ('owed', public.intermediate_pieces_owed(50));
reset role;
create function pg_temp.piece_owed(hash text) returns boolean language sql as
$$ select exists (select 1 from jsonb_array_elements((select payload from res where name = 'owed')) x
                  where x ->> 'publication_id' = pg_temp.publication(hash)::text and x ->> 'kind' = 'manifestacao'); $$;
select ok(pg_temp.piece_owed('p289open1bcdefghijklmnopqrstuv'),
  'ONE starts the piece of a publication of the history whose deadline is still to come');
select ok(not pg_temp.piece_owed('p289gone1bcdefghijklmnopqrstuv'),
  'never of one whose deadline is gone');
select ok(pg_temp.piece_owed('p289djen1bcdefghijklmnopqrstuv'),
  'one the DJEN made available is as before');

-- ---------- Each firm its own ----------

select pg_temp.sign_in('a2890000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select count(*)::integer from public.publication_actions), 0,
  'another firm reads nothing of what ONE read of firm A''s publications');
select throws_ok($$select public.intermediate_pieces_owed(5)$$, '42501', null,
  'a person cannot list what ONE starts by itself');
reset role;
select ok(not has_function_privilege('authenticated', 'public.publications_owe_action()', 'EXECUTE'),
  'nobody calls the trigger''s function');

select * from finish();
rollback;
