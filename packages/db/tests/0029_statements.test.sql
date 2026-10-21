begin;
create extension if not exists pgtap;
select plan(27);

-- ============================================================
-- The client's account of what happened, the administrative complaint and
-- the certificate inventory (0026). A statement is spoken or written, by the
-- firm or by the client through their link; the backend transcribes it and
-- asks for its chronology, which a person of the firm approves and the
-- client then confirms. Two firms, and two cases in one of them: nothing of
-- one reaches the other.
--
-- Every person, firm and CPF here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('af100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('af100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('af100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('bf100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'af100000-0000-4000-8000-000000000001'),
  ('bf100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'af100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bf100000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('bf100000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('bf100000-0000-4000-8000-00000000000b', 'af100000-0000-4000-8000-000000000004', 'owner', 'advogado');
-- Both firms have a person approve each chronology (0016): what follows is the queue's path. ONE deciding alone is 0045's.
insert into public.firm_autonomy (org_id, decision, mode) values
  ('bf100000-0000-4000-8000-00000000000a', 'chronology', 'approval'),
  ('bf100000-0000-4000-8000-00000000000b', 'chronology', 'approval');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_client() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.hash(token text) returns text language sql as
$$ select encode(sha256(convert_to(token, 'UTF8')), 'hex'); $$;
-- One statement of what a link read (`client_link_statements`), by its id: never by its place in the list.
create function pg_temp.told(name text, statement uuid) returns jsonb language sql as
$$ select e from res, jsonb_array_elements(res.payload -> 'statements') e
   where res.name = told.name and e ->> 'id' = told.statement::text; $$;
-- A run of one of the statement's tasks, finished with an answer (as the service role). Each claim is its own run.
create function pg_temp.ran(org uuid, task text, statement uuid, output jsonb, claim integer default 1) returns jsonb language plpgsql as $$
declare
  started jsonb := public.start_ai_run(org, task, repeat('f', 64), null, 'case_statement', statement::text,
    task || ':' || statement::text || ':' || claim::text);
begin
  return public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded', output, 900, 400)
    || jsonb_build_object('run_id', started ->> 'run_id');
end;
$$;
-- The backend claims one statement, and its wait after a passing failure is taken as over.
create function pg_temp.claim(statement uuid) returns integer language plpgsql as $$
declare
  claimed integer;
begin
  update public.case_statements set work_after = null where id = statement;
  select c.claim into claimed from public.claim_case_statements(1, statement) c;
  return claimed;
end;
$$;

-- Two cases of firm A, each with its client's link; a case of firm B.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('bf100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02", "phone": "62999990001"}'::jsonb));
insert into res values ('link', public.create_client_link(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, pg_temp.hash('token-do-relato-1234567890')));
insert into res values ('case_2', public.create_case('bf100000-0000-4000-8000-00000000000a', 'cancellation', null, null,
  '{"full_name": "João Teste", "birth_date": "1979-01-15"}'::jsonb));
insert into res values ('link_2', public.create_client_link(pg_temp.got('case_2', 'case_id')::uuid,
  pg_temp.got('case_2', 'person_id')::uuid, pg_temp.hash('token-de-outro-caso-0987654321')));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('bf100000-0000-4000-8000-00000000000b', 'cancellation', null, null,
  '{"full_name": "Paulo Teste"}'::jsonb));
reset role;

-- An audio the firm holds (one that came over WhatsApp), a PDF that is not one, and an audio of firm B.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('audio', public.reserve_file('bf100000-0000-4000-8000-00000000000a', 'whatsapp', 'audio.ogg', 'audio/ogg', 5000));
select public.confirm_file(pg_temp.got('audio', 'file_id')::uuid, repeat('a', 64), 5000, 'audio/ogg', null);
insert into res values ('pdf', public.reserve_file('bf100000-0000-4000-8000-00000000000a', 'upload', 'doc.pdf', 'application/pdf', 5000));
select public.confirm_file(pg_temp.got('pdf', 'file_id')::uuid, repeat('b', 64), 5000, 'application/pdf', 1);
insert into res values ('audio_b', public.reserve_file('bf100000-0000-4000-8000-00000000000b', 'whatsapp', 'audio-b.ogg', 'audio/ogg', 5000));
select public.confirm_file(pg_temp.got('audio_b', 'file_id')::uuid, repeat('c', 64), 5000, 'audio/ogg', null);
reset role;

-- ---------- The firm adds what the client told ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('both', public.add_case_statement(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('case', 'party_id')::uuid,
  pg_temp.got('audio', 'file_id')::uuid, 'Um texto junto com o áudio, o que não pode acontecer aqui.'));
insert into res values ('nobody', public.add_case_statement(pg_temp.got('case', 'case_id')::uuid, null, null,
  'Um relato que não é de ninguém do caso, com tamanho suficiente para passar.'));
insert into res values ('short', public.add_case_statement(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'party_id')::uuid, null, 'Curto.'));
insert into res values ('not_audio', public.add_case_statement(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'party_id')::uuid, pg_temp.got('pdf', 'file_id')::uuid));
insert into res values ('other_firm_audio', public.add_case_statement(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'party_id')::uuid, pg_temp.got('audio_b', 'file_id')::uuid));
insert into res values ('spoken', public.add_case_statement(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'party_id')::uuid, pg_temp.got('audio', 'file_id')::uuid));
insert into res values ('spoken_twice', public.add_case_statement(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'party_id')::uuid, pg_temp.got('audio', 'file_id')::uuid));
reset role;

select ok(
  pg_temp.got('both', 'code') = 'statement_required'
  and pg_temp.got('nobody', 'code') = 'party_not_found'
  and pg_temp.got('short', 'code') = 'statement_length'
  and pg_temp.got('not_audio', 'code') = 'file_not_found'
  and pg_temp.got('other_firm_audio', 'code') = 'file_not_found'
  and pg_temp.got('spoken_twice', 'code') = 'already_attached'
  and pg_temp.got('spoken', 'code') = 'added'
  and (select source = 'whatsapp' and work = 'transcribe' and transcript is null and chronology_status = 'none'
       from public.case_statements where id = pg_temp.got('spoken', 'statement_id')::uuid),
  'a statement is somebody''s, an audio the firm holds or its text, never both, and an audio waits to be transcribed'
);

select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  format('select public.add_case_statement(%L, null, null, %L)', pg_temp.got('case', 'case_id'),
    'Um relato escrito por alguém de outro escritório, com tamanho suficiente.'),
  'P0002', null,
  'another firm adds nothing to a case of this one'
);
select is((select count(*)::integer from public.case_statements), 0, 'and reads none of its statements');
reset role;

-- ---------- The backend transcribes, then asks for the chronology ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select count(*) from public.claim_case_statements(10)$$, '42501', null,
  'a person never claims a statement: only the backend works on it');
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim', (select jsonb_build_object('ids', jsonb_agg(c.statement_id), 'claims', jsonb_agg(c.claim))
  from public.claim_case_statements(10) c));
-- A worker reads the statement only under the claim it holds.
insert into res values ('stale_read', jsonb_build_object('count',
  (select count(*) from public.case_statement_to_process(pg_temp.got('spoken', 'statement_id')::uuid, 7))));
insert into res select 'details', to_jsonb(d) from public.case_statement_to_process(pg_temp.got('spoken', 'statement_id')::uuid, 1) d;
insert into res values ('claim_again', jsonb_build_object('count', (select count(*) from public.claim_case_statements(10))));
insert into res values ('run_text', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', 'caso.relato.transcricao',
  pg_temp.got('spoken', 'statement_id')::uuid, '{"texto": "Cheguei ao aeroporto às oito e o voo só saiu às quatro da tarde."}'::jsonb));
-- And says what it did only under that claim.
insert into res values ('not_its_claim', public.record_statement_work(pg_temp.got('spoken', 'statement_id')::uuid, 7, 'transcribed',
  pg_temp.got('run_text', 'run_id')::uuid));
insert into res values ('transcribed', public.record_statement_work(pg_temp.got('spoken', 'statement_id')::uuid, 1, 'transcribed',
  pg_temp.got('run_text', 'run_id')::uuid));
insert into res values ('not_held', public.record_statement_work(pg_temp.got('spoken', 'statement_id')::uuid, 1, 'failed'));
reset role;

select ok(
  (select payload -> 'ids' ? pg_temp.got('spoken', 'statement_id') and payload -> 'claims' = '[1]'::jsonb from res where name = 'claim')
  and pg_temp.got('stale_read', 'count') = '0'
  and pg_temp.got('details', 'work') = 'transcribe' and pg_temp.got('details', 'detected_mime') = 'audio/ogg'
  and pg_temp.got('details', 'claim') = '1' and pg_temp.got('details', 'airline') = 'Gol'
  and pg_temp.got('claim_again', 'count') = '0'
  and pg_temp.got('run_text', 'approval_id') is null
  and pg_temp.got('not_its_claim', 'code') = 'not_working'
  and pg_temp.got('transcribed', 'code') = 'transcribed'
  and pg_temp.got('not_held', 'code') = 'not_working'
  and (select transcript like 'Cheguei ao aeroporto%' and work = 'chronology' and work_claimed_at is null and work_attempts = 0
              and transcript_run_id = pg_temp.got('run_text', 'run_id')::uuid
       from public.case_statements where id = pg_temp.got('spoken', 'statement_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'statement_transcribed' and actor_type = 'ai'),
  'the backend claims a statement once and works only under that claim; the run''s own answer becomes its text'
);

-- The chronology waits in the firm's queue. A second answer about the same statement never joins it.
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('spoken', 'statement_id')::uuid);
insert into res values ('run_chrono', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', 'caso.relato.cronologia',
  pg_temp.got('spoken', 'statement_id')::uuid,
  '{"cronologia": "20/09/2026, 08:00: chegou ao aeroporto.\n20/09/2026, 16:00: o voo saiu.", "perguntas": "A que horas chegou ao destino?"}'::jsonb, 2));
insert into res values ('run_second', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', 'caso.relato.cronologia',
  pg_temp.got('spoken', 'statement_id')::uuid, '{"cronologia": "Outra resposta sobre o mesmo relato.", "perguntas": ""}'::jsonb, 99));
insert into res values ('proposed', public.record_statement_work(pg_temp.got('spoken', 'statement_id')::uuid, 2, 'proposed',
  pg_temp.got('run_second', 'run_id')::uuid));
reset role;

select ok(
  pg_temp.got('run_chrono', 'approval_id') is not null
  and pg_temp.got('run_second', 'approval_id') is null
  and (select status = 'withdrawn' from public.approvals where run_id = pg_temp.got('run_second', 'run_id')::uuid)
  and pg_temp.got('proposed', 'code') = 'proposed'
  and (select chronology_status = 'proposed' and work is null and chronology is null
              and chronology_run_id = pg_temp.got('run_chrono', 'run_id')::uuid
       from public.case_statements where id = pg_temp.got('spoken', 'statement_id')::uuid)
  and (select approver_functions @> array['advogado']::public.firm_function[]
              and not approver_functions @> array['atendimento']::public.firm_function[]
       from public.approvals where id = pg_temp.got('run_chrono', 'approval_id')::uuid),
  'the chronology proposed waits in the queue for who may approve it; a second answer about the statement is withdrawn, and the statement waits for the first'
);

-- A passing failure waits, is tried again, then given up.
update public.platform_settings set value = jsonb_set(value, '{max_attempts}', '3') where key = 'statements';
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('written', public.add_case_statement(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'party_id')::uuid, null,
  'O voo foi cancelado sem aviso e só consegui embarcar no dia seguinte, depois de dormir no aeroporto.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select count(*) from public.claim_case_statements(10, pg_temp.got('written', 'statement_id')::uuid);
insert into res values ('retry_1', public.record_statement_work(pg_temp.got('written', 'statement_id')::uuid, 1, 'retry', null, 'provider_unavailable'));
insert into res values ('held_back', jsonb_build_object('count',
  (select count(*) from public.claim_case_statements(10, pg_temp.got('written', 'statement_id')::uuid))));
reset role;
insert into res select 'waits', jsonb_build_object('minutes', round(extract(epoch from (work_after - now())) / 60))
from public.case_statements where id = pg_temp.got('written', 'statement_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('written', 'statement_id')::uuid);
select public.record_statement_work(pg_temp.got('written', 'statement_id')::uuid, 2, 'retry', null, 'provider_unavailable');
reset role;
insert into res select 'waits_longer', jsonb_build_object('minutes', round(extract(epoch from (work_after - now())) / 60))
from public.case_statements where id = pg_temp.got('written', 'statement_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('written', 'statement_id')::uuid);
insert into res values ('retry_3', public.record_statement_work(pg_temp.got('written', 'statement_id')::uuid, 3, 'retry', null, 'provider_unavailable'));
reset role;

select ok(
  pg_temp.got('written', 'code') = 'added'
  and pg_temp.got('retry_1', 'code') = 'retry' and pg_temp.got('held_back', 'count') = '0' and pg_temp.got('waits', 'minutes') = '10'
  and pg_temp.got('waits_longer', 'minutes') = '40'
  and pg_temp.got('retry_3', 'code') = 'failed'
  and (select work is null and work_error = 'provider_unavailable' and transcript is not null and source = 'firm'
              and chronology_run_id is null
       from public.case_statements where id = pg_temp.got('written', 'statement_id')::uuid),
  'a written statement needs no transcription; a passing failure of its chronology waits longer each time, then is given up'
);

-- A worker that fell behind: its claim is put back in line and taken by another, under a new number.
-- The old number reads nothing and says nothing. A statement nobody finishes is given up in the end.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('slow', public.add_case_statement(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'party_id')::uuid, null,
  'Um relato cujo trabalho ninguém termina a tempo, para ver o que a fila faz com ele.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('slow_first', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('slow', 'statement_id')::uuid)));
reset role;
update public.case_statements set work_claimed_at = now() - interval '2 hours' where id = pg_temp.got('slow', 'statement_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('slow_second', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('slow', 'statement_id')::uuid)));
insert into res values ('slow_reads', jsonb_build_object(
  'old', (select count(*) from public.case_statement_to_process(pg_temp.got('slow', 'statement_id')::uuid, 1)),
  'new', (select count(*) from public.case_statement_to_process(pg_temp.got('slow', 'statement_id')::uuid, 2))));
insert into res values ('slow_old_word', public.record_statement_work(pg_temp.got('slow', 'statement_id')::uuid, 1, 'retry', null, 'provider_unavailable'));
reset role;
insert into res select 'slow_held', jsonb_build_object('claimed', work_claimed_at is not null, 'attempts', work_attempts)
from public.case_statements where id = pg_temp.got('slow', 'statement_id')::uuid;
update public.case_statements set work_claimed_at = now() - interval '2 hours' where id = pg_temp.got('slow', 'statement_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('slow_third', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('slow', 'statement_id')::uuid)));
reset role;
update public.case_statements set work_claimed_at = now() - interval '2 hours' where id = pg_temp.got('slow', 'statement_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('slow_given_up', jsonb_build_object('count',
  (select count(*) from public.claim_case_statements(10, pg_temp.got('slow', 'statement_id')::uuid))));
reset role;

select ok(
  pg_temp.got('slow_first', 'claim') = '1' and pg_temp.got('slow_second', 'claim') = '2'
  and pg_temp.got('slow_reads', 'old') = '0' and pg_temp.got('slow_reads', 'new') = '1'
  and pg_temp.got('slow_old_word', 'code') = 'not_working'
  and pg_temp.got('slow_held', 'claimed') = 'true' and pg_temp.got('slow_held', 'attempts') = '2'
  and pg_temp.got('slow_third', 'claim') = '3'
  and pg_temp.got('slow_given_up', 'count') = '0'
  and (select work is null and work_error = 'abandoned' and work_claimed_at is null
       from public.case_statements where id = pg_temp.got('slow', 'statement_id')::uuid),
  'a claim nobody finished is taken by another under a new number: the old one reads and says nothing, and the work is given up in the end'
);

-- A firm that lets ONE decide: the proposal is the chronology the client reads, recorded as the AI's.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ask_again', public.request_statement_chronology(pg_temp.got('written', 'statement_id')::uuid));
insert into res values ('ask_while_waiting', public.request_statement_chronology(pg_temp.got('spoken', 'statement_id')::uuid));
reset role;
-- The firm lets ONE send the order of the facts to the client by itself (0016).
update public.firm_autonomy set mode = 'auto'
where org_id = 'bf100000-0000-4000-8000-00000000000a' and decision = 'chronology';
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('written', 'statement_id')::uuid);
insert into res select 'details_again', to_jsonb(d) from public.case_statement_to_process(pg_temp.got('written', 'statement_id')::uuid, 4) d;
insert into res values ('run_alone', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', 'caso.relato.cronologia',
  pg_temp.got('written', 'statement_id')::uuid, '{"cronologia": "O voo foi cancelado sem aviso.\nEmbarcou no dia seguinte.", "perguntas": ""}'::jsonb, 4));
insert into res values ('alone', public.record_statement_work(pg_temp.got('written', 'statement_id')::uuid, 4, 'proposed',
  pg_temp.got('run_alone', 'run_id')::uuid));
reset role;
update public.firm_autonomy set mode = 'approval'
where org_id = 'bf100000-0000-4000-8000-00000000000a' and decision = 'chronology';

select ok(
  pg_temp.got('ask_again', 'code') = 'requested'
  and pg_temp.got('ask_while_waiting', 'code') = 'chronology_in_progress'
  and pg_temp.got('details_again', 'claim') = '4'
  and pg_temp.got('run_alone', 'approval_id') is null
  and pg_temp.got('alone', 'code') = 'proposed'
  and (select chronology_status = 'approved' and chronology like 'O voo foi cancelado%' and work is null
       from public.case_statements where id = pg_temp.got('written', 'statement_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'chronology_approved' and actor_type = 'ai'),
  'asked again, a chronology is another run; with a task that earned autonomy the proposal goes to the client as the AI''s'
);

-- ---------- The firm approves, the client confirms ----------

-- Before the firm approved it, the client reads no chronology.
select pg_temp.as_client();
set local role anon;
insert into res values ('client_before', public.client_link_statements('token-do-relato-1234567890'));
insert into res values ('answer_early', public.client_link_answer_chronology('token-do-relato-1234567890',
  pg_temp.got('spoken', 'statement_id')::uuid, true));
reset role;

select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('bia_approves', public.decide_approval(pg_temp.got('run_chrono', 'approval_id')::uuid, 'approved'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana_approves', public.decide_approval(pg_temp.got('run_chrono', 'approval_id')::uuid, 'approved',
  '{"cronologia": "20/09/2026, 08:00: chegou ao aeroporto de Goiânia.\n20/09/2026, 16:00: o voo saiu.", "perguntas": ""}'::jsonb));
reset role;

select ok(
  pg_temp.told('client_before', pg_temp.got('spoken', 'statement_id')::uuid) ->> 'chronology' is null
  and pg_temp.told('client_before', pg_temp.got('spoken', 'statement_id')::uuid) ->> 'chronology_status' = 'none'
  and pg_temp.got('answer_early', 'code') = 'chronology_not_ready'
  and pg_temp.got('bia_approves', 'code') = 'not_an_approver'
  and pg_temp.got('ana_approves', 'code') = 'approved'
  and (select chronology_status = 'approved' and chronology like '%aeroporto de Goiânia%'
       from public.case_statements where id = pg_temp.got('spoken', 'statement_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'chronology_approved' and actor_type = 'person'),
  'the client reads no chronology before a person who may approve it did; approved, corrected or not, it is the statement''s'
);

-- The client answers by their own link: the link of another case of the same firm reads and answers nothing of this one.
select pg_temp.as_client();
set local role anon;
insert into res values ('client_reads', public.client_link_statements('token-do-relato-1234567890'));
insert into res values ('other_link_reads', public.client_link_statements('token-de-outro-caso-0987654321'));
insert into res values ('other_link_answers', public.client_link_answer_chronology('token-de-outro-caso-0987654321',
  pg_temp.got('spoken', 'statement_id')::uuid, true));
insert into res values ('contest_empty', public.client_link_answer_chronology('token-do-relato-1234567890',
  pg_temp.got('spoken', 'statement_id')::uuid, false, 'não'));
insert into res values ('contest', public.client_link_answer_chronology('token-do-relato-1234567890',
  pg_temp.got('spoken', 'statement_id')::uuid, false, 'O voo saiu às 17h, não às 16h.'));
insert into res values ('confirm', public.client_link_answer_chronology('token-do-relato-1234567890',
  pg_temp.got('spoken', 'statement_id')::uuid, true));
insert into res values ('wrong_token', public.client_link_answer_chronology('um-token-que-nao-abre-nada-1234567890',
  pg_temp.got('spoken', 'statement_id')::uuid, true));
reset role;

select ok(
  pg_temp.told('client_reads', pg_temp.got('spoken', 'statement_id')::uuid) ->> 'chronology' like '%aeroporto de Goiânia%'
  and pg_temp.got('other_link_reads', 'code') = 'ready'
  and (select jsonb_array_length(payload -> 'statements') = 0 from res where name = 'other_link_reads')
  and pg_temp.got('other_link_answers', 'code') = 'not_found'
  and pg_temp.got('contest_empty', 'code') = 'note_required'
  and pg_temp.got('contest', 'code') = 'contested'
  and pg_temp.got('confirm', 'code') = 'confirmed'
  and pg_temp.got('wrong_token', 'code') = 'link_not_open'
  and (select chronology_status = 'confirmed' and client_note is null and client_answered_at is not null
       from public.case_statements where id = pg_temp.got('spoken', 'statement_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'client_chronology_contested' and actor_type = 'client'),
  'the client says what is wrong in the chronology, or confirms it, only by the link of their own case'
);

-- The case moved on to the draft: the client still answers a chronology, though they send nothing new.
update public.cases set status = 'drafting' where id = pg_temp.got('case', 'case_id')::uuid;
select pg_temp.as_client();
set local role anon;
insert into res values ('late_answer', public.client_link_answer_chronology('token-do-relato-1234567890',
  pg_temp.got('written', 'statement_id')::uuid, false, 'Embarquei dois dias depois, não no dia seguinte.'));
insert into res values ('late_statement', public.client_link_write_statement('token-do-relato-1234567890',
  'Um relato enviado depois que o caso já seguiu para a minuta, o que o link não aceita mais.'));
reset role;
update public.cases set status = 'documents' where id = pg_temp.got('case', 'case_id')::uuid;

select ok(
  pg_temp.got('late_answer', 'code') = 'contested' and pg_temp.got('late_statement', 'code') = 'case_not_editable',
  'answering a chronology is not tied to the stage of the case; sending a new account is'
);

-- The client said it is wrong: the firm asks for another, which reads the one before and what the
-- client said. Its run finishes and waits, and the worker's word gets lost (it says "try again"):
-- the queue speaks first, and the statement waits with that answer instead of being worked on again.
-- Approved, the new chronology answers the client's note.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ask_after_contest', public.request_statement_chronology(pg_temp.got('written', 'statement_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('written', 'statement_id')::uuid);
insert into res select 'details_contested', to_jsonb(d) from public.case_statement_to_process(pg_temp.got('written', 'statement_id')::uuid, 5) d;
insert into res values ('run_lost', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', 'caso.relato.cronologia',
  pg_temp.got('written', 'statement_id')::uuid, '{"cronologia": "O voo foi cancelado sem aviso.\nEmbarcou dois dias depois.", "perguntas": ""}'::jsonb, 5));
insert into res values ('lost_word', public.record_statement_work(pg_temp.got('written', 'statement_id')::uuid, 5, 'retry', null, 'store_unavailable'));
insert into res values ('sweep', jsonb_build_object('count', (select count(*) from public.claim_case_statements(10))));
reset role;
insert into res select 'after_lost', jsonb_build_object('status', chronology_status, 'work', work, 'run', chronology_run_id, 'note', client_note)
from public.case_statements where id = pg_temp.got('written', 'statement_id')::uuid;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('approve_lost', public.decide_approval(pg_temp.got('run_lost', 'approval_id')::uuid, 'approved'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('late_worker', public.record_statement_work(pg_temp.got('written', 'statement_id')::uuid, 5, 'proposed',
  pg_temp.got('run_lost', 'run_id')::uuid));
reset role;

select ok(
  pg_temp.got('ask_after_contest', 'code') = 'requested'
  and pg_temp.got('details_contested', 'client_note') like 'Embarquei dois dias depois%'
  and pg_temp.got('details_contested', 'previous_chronology') like 'O voo foi cancelado%'
  and pg_temp.got('lost_word', 'code') = 'proposed'
  and pg_temp.got('sweep', 'count') = '0'
  and pg_temp.got('after_lost', 'status') = 'proposed' and pg_temp.got('after_lost', 'work') is null
  and pg_temp.got('after_lost', 'run') = pg_temp.got('run_lost', 'run_id')
  and pg_temp.got('after_lost', 'note') like 'Embarquei dois dias depois%'
  and pg_temp.got('approve_lost', 'code') = 'approved'
  and pg_temp.got('late_worker', 'code') = 'not_working'
  and (select chronology_status = 'approved' and chronology like '%dois dias depois%' and client_note is null
       from public.case_statements where id = pg_temp.got('written', 'statement_id')::uuid),
  'a failure said while the answer already waits is no failure: the statement waits with it, and the new chronology answers the client''s note'
);

-- The firm takes back a chronology it approved and the client has not answered; never one the client confirmed.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('take_back', public.request_statement_chronology(pg_temp.got('written', 'statement_id')::uuid));
insert into res values ('ask_confirmed', public.request_statement_chronology(pg_temp.got('spoken', 'statement_id')::uuid));
insert into res values ('remove_confirmed', public.remove_case_statement(pg_temp.got('spoken', 'statement_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('written', 'statement_id')::uuid);
insert into res values ('run_back', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', 'caso.relato.cronologia',
  pg_temp.got('written', 'statement_id')::uuid, '{"cronologia": "O voo foi cancelado sem aviso.\nDormiu no aeroporto.\nEmbarcou dois dias depois.", "perguntas": ""}'::jsonb, 6));
reset role;
-- The person decides before the worker said that it waits: the decision takes effect all the same.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('approve_back', public.decide_approval(pg_temp.got('run_back', 'approval_id')::uuid, 'approved'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('back_late_worker', public.record_statement_work(pg_temp.got('written', 'statement_id')::uuid, 6, 'proposed',
  pg_temp.got('run_back', 'run_id')::uuid));
-- An answer that arrives for a statement that no longer waits for one never asks for a decision.
insert into res values ('run_late', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', 'caso.relato.cronologia',
  pg_temp.got('written', 'statement_id')::uuid, '{"cronologia": "Uma resposta que chegou tarde demais.", "perguntas": ""}'::jsonb, 77));
reset role;

select ok(
  pg_temp.got('take_back', 'code') = 'requested'
  and pg_temp.got('ask_confirmed', 'code') = 'chronology_in_progress'
  and pg_temp.got('remove_confirmed', 'code') = 'statement_confirmed'
  and pg_temp.got('approve_back', 'code') = 'approved'
  and pg_temp.got('back_late_worker', 'code') = 'not_working'
  and pg_temp.got('run_late', 'approval_id') is null
  and (select status = 'withdrawn' from public.approvals where run_id = pg_temp.got('run_late', 'run_id')::uuid)
  and (select chronology_status = 'approved' and chronology like '%Dormiu no aeroporto%' and work is null
              and chronology_run_id = pg_temp.got('run_back', 'run_id')::uuid
       from public.case_statements where id = pg_temp.got('written', 'statement_id')::uuid)
  and exists (select 1 from public.case_statements where id = pg_temp.got('spoken', 'statement_id')::uuid),
  'the firm takes back a chronology the client has not answered, and a decision made before the worker spoke takes effect; one the client confirmed is neither asked again nor removed'
);

-- ---------- The client tells it themselves ----------

select pg_temp.as_client();
set local role anon;
insert into res values ('client_short', public.client_link_write_statement('token-do-relato-1234567890', 'Atrasou.'));
insert into res values ('client_writes', public.client_link_write_statement('token-do-relato-1234567890',
  'Meu voo de Goiânia para São Paulo atrasou oito horas e perdi um compromisso de trabalho.'));
insert into res values ('client_audio', public.client_link_reserve_statement('token-do-relato-1234567890', 'relato.m4a', 'audio/mp4', 800000));
insert into res values ('client_pdf', public.client_link_reserve_statement('token-do-relato-1234567890', 'relato.pdf', 'application/pdf', 800000));
insert into res values ('finish_early', public.client_link_finish_statement('token-do-relato-1234567890',
  pg_temp.got('client_audio', 'statement_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.confirm_file(pg_temp.got('client_audio', 'file_id')::uuid, repeat('d', 64), 800000, 'audio/mp4', null);
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('other_link_finishes', public.client_link_finish_statement('token-de-outro-caso-0987654321',
  pg_temp.got('client_audio', 'statement_id')::uuid));
insert into res values ('finish', public.client_link_finish_statement('token-do-relato-1234567890',
  pg_temp.got('client_audio', 'statement_id')::uuid));
reset role;

select ok(
  pg_temp.got('client_short', 'code') = 'statement_length'
  and pg_temp.got('client_writes', 'code') = 'sent'
  and pg_temp.got('client_audio', 'code') = 'reserved'
  and pg_temp.got('client_pdf', 'code') = 'type_not_allowed'
  and pg_temp.got('finish_early', 'code') = 'not_uploaded'
  and pg_temp.got('other_link_finishes', 'code') = 'not_found'
  and pg_temp.got('finish', 'code') = 'sent'
  and (select source = 'client' and work = 'chronology' and party_id = pg_temp.got('case', 'party_id')::uuid
       from public.case_statements where id = pg_temp.got('client_writes', 'statement_id')::uuid)
  and (select status = 'received' and work = 'transcribe'
       from public.case_statements where id = pg_temp.got('client_audio', 'statement_id')::uuid)
  and (select count(*) = 2 from public.case_events where kind = 'client_statement_sent' and actor_type = 'client'),
  'the client writes their account or sends its audio through their own link, and it is theirs in the case'
);

-- ---------- A proposal turned down, and a statement removed ----------

select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('client_writes', 'statement_id')::uuid);
insert into res values ('run_cw', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', 'caso.relato.cronologia',
  pg_temp.got('client_writes', 'statement_id')::uuid, '{"cronologia": "O voo atrasou oito horas.", "perguntas": ""}'::jsonb, 1));
select public.record_statement_work(pg_temp.got('client_writes', 'statement_id')::uuid, 1, 'proposed', pg_temp.got('run_cw', 'run_id')::uuid);
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('reject_cw', public.decide_approval(pg_temp.got('run_cw', 'approval_id')::uuid, 'rejected', null,
  'Faltam os horários que o cliente disse.'));
reset role;
insert into res select 'after_reject', jsonb_build_object('status', chronology_status, 'chronology', chronology, 'work', work)
from public.case_statements where id = pg_temp.got('client_writes', 'statement_id')::uuid;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ask_after_reject', public.request_statement_chronology(pg_temp.got('client_writes', 'statement_id')::uuid));
reset role;

select ok(
  pg_temp.got('reject_cw', 'code') = 'rejected'
  and pg_temp.got('after_reject', 'status') = 'dismissed' and pg_temp.got('after_reject', 'chronology') is null
  and pg_temp.got('after_reject', 'work') is null
  and exists (select 1 from public.case_events where kind = 'chronology_dismissed' and actor_type = 'person')
  and pg_temp.got('ask_after_reject', 'code') = 'requested',
  'a proposal turned down is nobody''s chronology, and the firm may ask for another'
);

select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('client_writes', 'statement_id')::uuid);
insert into res values ('run_cw_2', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', 'caso.relato.cronologia',
  pg_temp.got('client_writes', 'statement_id')::uuid, '{"cronologia": "O voo atrasou oito horas e o cliente perdeu um compromisso.", "perguntas": ""}'::jsonb, 2));
select public.record_statement_work(pg_temp.got('client_writes', 'statement_id')::uuid, 2, 'proposed', pg_temp.got('run_cw_2', 'run_id')::uuid);
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  format('select public.remove_case_statement(%L)', pg_temp.got('client_writes', 'statement_id')),
  'P0002', null,
  'another firm removes no statement of this one'
);
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('remove_cw', public.remove_case_statement(pg_temp.got('client_writes', 'statement_id')::uuid));
reset role;

-- Removed while the model was still answering: the answer that arrives afterwards asks nobody anything.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('gone', public.add_case_statement(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'party_id')::uuid, null,
  'Um relato registrado na pessoa errada, removido enquanto a cronologia ainda era proposta.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('gone', 'statement_id')::uuid);
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('remove_gone', public.remove_case_statement(pg_temp.got('gone', 'statement_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('run_gone', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', 'caso.relato.cronologia',
  pg_temp.got('gone', 'statement_id')::uuid, '{"cronologia": "Uma cronologia de um relato que não existe mais.", "perguntas": ""}'::jsonb, 1));
insert into res values ('gone_worker', public.record_statement_work(pg_temp.got('gone', 'statement_id')::uuid, 1, 'proposed',
  pg_temp.got('run_gone', 'run_id')::uuid));
reset role;

select ok(
  pg_temp.got('remove_cw', 'code') = 'removed'
  and not exists (select 1 from public.case_statements where id = pg_temp.got('client_writes', 'statement_id')::uuid)
  and (select status = 'withdrawn' from public.approvals where id = pg_temp.got('run_cw_2', 'approval_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'statement_removed' and actor_type = 'person')
  and pg_temp.got('remove_gone', 'code') = 'removed'
  and pg_temp.got('run_gone', 'approval_id') is null
  and (select status = 'withdrawn' from public.approvals where run_id = pg_temp.got('run_gone', 'run_id')::uuid)
  and pg_temp.got('gone_worker', 'code') = 'not_working'
  and not exists (select 1 from public.approvals where org_id = 'bf100000-0000-4000-8000-00000000000a' and status = 'pending'),
  'a statement removed takes what waited of it out of the queue, and an answer that arrives after it is gone asks nobody anything'
);

-- ---------- A transcription that waits for a person ----------

-- The task lost its autonomy: the text waits in the queue. The worker dies before saying so, and the
-- sweep takes the statement as waiting. Turned down, a person asks for it again; approved, it is the text.
update public.ai_tasks set autonomy = 'approval' where slug = 'caso.relato.transcricao';
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('client_audio', 'statement_id')::uuid);
insert into res values ('run_ca', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', 'caso.relato.transcricao',
  pg_temp.got('client_audio', 'statement_id')::uuid, '{"texto": "O voo atrasou e perdi a conexão em Guarulhos."}'::jsonb, 1));
select count(*) from public.claim_case_statements(10);
reset role;
insert into res select 'ca_waits', jsonb_build_object('work', work, 'run', transcript_run_id, 'transcript', transcript)
from public.case_statements where id = pg_temp.got('client_audio', 'statement_id')::uuid;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ca_early', public.request_statement_transcription(pg_temp.got('client_audio', 'statement_id')::uuid));
insert into res values ('ca_reject', public.decide_approval(pg_temp.got('run_ca', 'approval_id')::uuid, 'rejected', null,
  'A transcrição não bate com o áudio.'));
reset role;
insert into res select 'ca_rejected', jsonb_build_object('work', work, 'error', work_error, 'transcript', transcript)
from public.case_statements where id = pg_temp.got('client_audio', 'statement_id')::uuid;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ca_again', public.request_statement_transcription(pg_temp.got('client_audio', 'statement_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('client_audio', 'statement_id')::uuid);
insert into res values ('run_ca_2', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', 'caso.relato.transcricao',
  pg_temp.got('client_audio', 'statement_id')::uuid, '{"texto": "O voo atrasou e perdi a conexão em Guarulhos, no dia vinte."}'::jsonb, 2));
insert into res values ('ca_recorded', public.record_statement_work(pg_temp.got('client_audio', 'statement_id')::uuid, 2, 'transcribed',
  pg_temp.got('run_ca_2', 'run_id')::uuid));
reset role;
-- Turned down again and asked again: this time a person approves before the worker said that it waits.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
select public.decide_approval(pg_temp.got('run_ca_2', 'approval_id')::uuid, 'rejected', null, 'Ainda não bate com o áudio.');
select public.request_statement_transcription(pg_temp.got('client_audio', 'statement_id')::uuid);
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('client_audio', 'statement_id')::uuid);
insert into res values ('run_ca_3', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', 'caso.relato.transcricao',
  pg_temp.got('client_audio', 'statement_id')::uuid, '{"texto": "O voo atrasou e perdi a conexão em Guarulhos, no dia vinte."}'::jsonb, 3));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ca_approve', public.decide_approval(pg_temp.got('run_ca_3', 'approval_id')::uuid, 'approved'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('ca_late_worker', public.record_statement_work(pg_temp.got('client_audio', 'statement_id')::uuid, 3, 'transcribed',
  pg_temp.got('run_ca_3', 'run_id')::uuid));
reset role;
update public.ai_tasks set autonomy = 'autonomous' where slug = 'caso.relato.transcricao';

select ok(
  pg_temp.got('ca_waits', 'work') is null and pg_temp.got('ca_waits', 'run') = pg_temp.got('run_ca', 'run_id')
  and pg_temp.got('ca_waits', 'transcript') is null
  and pg_temp.got('ca_early', 'code') = 'transcription_in_progress'
  and pg_temp.got('ca_reject', 'code') = 'rejected'
  and pg_temp.got('ca_rejected', 'work') is null and pg_temp.got('ca_rejected', 'error') = 'transcript_dismissed'
  and pg_temp.got('ca_rejected', 'transcript') is null
  and pg_temp.got('ca_again', 'code') = 'requested'
  and pg_temp.got('ca_recorded', 'code') = 'waiting'
  and pg_temp.got('ca_approve', 'code') = 'approved'
  and pg_temp.got('ca_late_worker', 'code') = 'not_working'
  and (select transcript like '%no dia vinte.' and work = 'chronology' and transcript_run_id = pg_temp.got('run_ca_3', 'run_id')::uuid
       from public.case_statements where id = pg_temp.got('client_audio', 'statement_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'statement_transcribed' and actor_type = 'person'),
  'a transcription that waits is the text only once approved, even before its worker spoke: taken as waiting by the sweep, asked again after being turned down'
);

-- ---------- What the sweep does with an audio left behind, and a person with one never transcribed ----------

-- An audio whose page never came back: the one that arrived and was kept is received by the sweep,
-- the one whose reservation ended goes away.
select pg_temp.as_client();
set local role anon;
insert into res values ('left_stored', public.client_link_reserve_statement('token-do-relato-1234567890', 'um.ogg', 'audio/ogg', 90000));
insert into res values ('left_expired', public.client_link_reserve_statement('token-do-relato-1234567890', 'dois.ogg', 'audio/ogg', 90000));
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.confirm_file(pg_temp.got('left_stored', 'file_id')::uuid, repeat('e', 64), 90000, 'audio/ogg', null);
reset role;
delete from public.files where id = pg_temp.got('left_expired', 'file_id')::uuid;
update public.case_statements set created_at = now() - interval '2 hours'
where id in (pg_temp.got('left_stored', 'statement_id')::uuid, pg_temp.got('left_expired', 'statement_id')::uuid);
select pg_temp.as_backend();
set local role service_role;
select count(*) from public.claim_case_statements(1, pg_temp.got('spoken', 'statement_id')::uuid);
reset role;

select ok(
  (select status = 'received' and work = 'transcribe' from public.case_statements
   where id = pg_temp.got('left_stored', 'statement_id')::uuid)
  and not exists (select 1 from public.case_statements where id = pg_temp.got('left_expired', 'statement_id')::uuid)
  and (select statement_count = 4 from public.client_links where case_id = pg_temp.got('case', 'case_id')::uuid),
  'an audio left behind is received when it arrived and dropped when it never did, and every attempt stays counted'
);

-- The transcription cannot be made (no key in this environment): a person hears the audio and writes it down.
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('left_stored', 'statement_id')::uuid);
insert into res values ('no_key', public.record_statement_work(pg_temp.got('left_stored', 'statement_id')::uuid, 1, 'failed', null, 'provider_not_configured'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('hand_short', public.write_statement_text(pg_temp.got('left_stored', 'statement_id')::uuid, 'Pouco.'));
insert into res values ('hand', public.write_statement_text(pg_temp.got('left_stored', 'statement_id')::uuid,
  'No áudio, a cliente conta que o voo atrasou seis horas e que não recebeu alimentação.'));
insert into res values ('hand_twice', public.write_statement_text(pg_temp.got('left_stored', 'statement_id')::uuid,
  'Um segundo texto para um relato que já tem o seu, o que não é aceito.'));
insert into res values ('hand_then_model', public.request_statement_transcription(pg_temp.got('left_stored', 'statement_id')::uuid));
reset role;
-- Its chronology fails for a passing reason and waits: a person asks that it be tried now.
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('left_stored', 'statement_id')::uuid);
select public.record_statement_work(pg_temp.got('left_stored', 'statement_id')::uuid, 2, 'retry', null, 'provider_unavailable');
insert into res values ('resume_held_back', jsonb_build_object('count',
  (select count(*) from public.claim_case_statements(10, pg_temp.got('left_stored', 'statement_id')::uuid))));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('resume', public.resume_statement_work(pg_temp.got('left_stored', 'statement_id')::uuid));
insert into res values ('resume_nothing', public.resume_statement_work(pg_temp.got('spoken', 'statement_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('resume_claimed', jsonb_build_object('count',
  (select count(*) from public.claim_case_statements(10, pg_temp.got('left_stored', 'statement_id')::uuid))));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('resume_busy', public.resume_statement_work(pg_temp.got('left_stored', 'statement_id')::uuid));
reset role;

select ok(
  pg_temp.got('no_key', 'code') = 'failed'
  and pg_temp.got('hand_short', 'code') = 'statement_length'
  and pg_temp.got('hand', 'code') = 'saved'
  and pg_temp.got('hand_twice', 'code') = 'nothing_to_transcribe'
  and pg_temp.got('hand_then_model', 'code') = 'nothing_to_transcribe'
  and (select transcript like 'No áudio, a cliente conta%' and transcript_run_id is null and work = 'chronology'
       from public.case_statements where id = pg_temp.got('left_stored', 'statement_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'statement_written' and actor_type = 'person')
  and pg_temp.got('resume_held_back', 'count') = '0'
  and pg_temp.got('resume', 'code') = 'requested'
  and pg_temp.got('resume_nothing', 'code') = 'nothing_owed'
  and pg_temp.got('resume_claimed', 'count') = '1'
  and pg_temp.got('resume_busy', 'code') = 'work_in_progress',
  'an audio that could not be transcribed is written down by a person; work that waits after a failure is resumed by a person, never work somebody holds'
);

-- A link sends only so many statements.
update public.platform_settings set value = jsonb_set(value, '{per_link}', '4') where key = 'statements';
select pg_temp.as_client();
set local role anon;
select is(
  public.client_link_write_statement('token-do-relato-1234567890',
    'Mais um relato, que passa do limite de relatos que um link pode enviar para o escritório.') ->> 'code',
  'statement_limit',
  'a link sends only so many statements, counting every one'
);
reset role;

-- ---------- The administrative complaint ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('complaint_bad', public.save_admin_complaint(pg_temp.got('case', 'case_id')::uuid, null,
  '{"channel": "fax"}'::jsonb));
insert into res values ('complaint_dates', public.save_admin_complaint(pg_temp.got('case', 'case_id')::uuid, null,
  '{"channel": "anac_passageiro", "filed_on": "2026-10-01", "answered_on": "2026-09-01"}'::jsonb));
insert into res values ('complaint', public.save_admin_complaint(pg_temp.got('case', 'case_id')::uuid, null,
  '{"channel": "anac_passageiro", "protocol": "2026.10/000123456", "filed_on": "2026-10-01", "answer_due_on": "2026-10-11"}'::jsonb));
insert into res values ('complaint_answer', public.save_admin_complaint(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('complaint', 'complaint_id')::uuid,
  '{"channel": "anac_passageiro", "protocol": "2026.10/000123456", "filed_on": "2026-10-01", "answered_on": "2026-10-09",
    "outcome": "answered", "notes": "A companhia ofereceu um voucher, recusado."}'::jsonb));
-- A complaint of one case is not saved through another case of the same firm.
insert into res values ('complaint_other_case', public.save_admin_complaint(pg_temp.got('case_2', 'case_id')::uuid,
  pg_temp.got('complaint', 'complaint_id')::uuid, '{"channel": "procon"}'::jsonb));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('complaints_b', jsonb_build_object('count', (select count(*) from public.admin_complaints)));
select throws_ok(
  format('select public.remove_admin_complaint(%L)', pg_temp.got('complaint', 'complaint_id')),
  'P0002', null,
  'another firm removes no complaint of this one'
);
reset role;

select ok(
  pg_temp.got('complaint_bad', 'code') = 'invalid_channel'
  and pg_temp.got('complaint_dates', 'code') = 'invalid_data'
  and pg_temp.got('complaint', 'code') = 'saved'
  and pg_temp.got('complaint_answer', 'code') = 'saved'
  and pg_temp.got('complaint_other_case', 'code') = 'not_found'
  and pg_temp.got('complaints_b', 'count') = '0'
  and (select count(*) = 1 and bool_and(outcome = 'answered' and protocol = '2026.10/000123456' and answered_on = date '2026-10-09')
       from public.admin_complaints where case_id = pg_temp.got('case', 'case_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'complaint_saved'),
  'a complaint is recorded with its channel, protocol and dates, and what came of it, only in its own case and firm'
);

-- ---------- What needs somebody today ----------

-- A client says the chronology is wrong, and a complaint passes the day its answer was due.
select pg_temp.as_client();
set local role anon;
select public.client_link_answer_chronology('token-do-relato-1234567890',
  pg_temp.got('written', 'statement_id')::uuid, false, 'Faltou dizer que dormi no aeroporto.');
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
select public.save_admin_complaint(pg_temp.got('case', 'case_id')::uuid, null,
  '{"channel": "procon", "filed_on": "2026-01-02", "answer_due_on": "2026-01-12"}'::jsonb);
insert into res values ('today_a', public.firm_today('bf100000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('today_b', public.firm_today('bf100000-0000-4000-8000-00000000000b'));
reset role;

select ok(
  pg_temp.got('today_a', 'chronologies_contested') = '1' and pg_temp.got('today_a', 'complaints_overdue') = '1'
  and pg_temp.got('today_b', 'chronologies_contested') = '0' and pg_temp.got('today_b', 'complaints_overdue') = '0',
  'the home counts the cases whose chronology a client contested and whose complaint is overdue, each firm its own'
);

-- ---------- The certificate inventory ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('cert_not_lawyer', public.save_certificate_entry('bf100000-0000-4000-8000-00000000000a', 'projudi', 'a3_token'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('cert_bad', public.save_certificate_entry('bf100000-0000-4000-8000-00000000000a', 'projudi', 'pendrive'));
insert into res values ('cert', public.save_certificate_entry('bf100000-0000-4000-8000-00000000000a', 'projudi', 'a3_token',
  'Certisign', date '2027-05-01'));
insert into res values ('cert_checked', public.save_certificate_entry('bf100000-0000-4000-8000-00000000000a', 'projudi', 'a3_token',
  'Certisign', date '2027-05-01', true));
insert into res values ('cert_other_firm', public.save_certificate_entry('bf100000-0000-4000-8000-00000000000b', 'projudi', 'a1'));
reset role;

select ok(
  pg_temp.got('cert_not_lawyer', 'code') = 'not_a_lawyer'
  and pg_temp.got('cert_bad', 'code') = 'invalid_kind'
  and pg_temp.got('cert', 'code') = 'saved'
  and pg_temp.got('cert_checked', 'code') = 'saved'
  and pg_temp.got('cert_other_firm', 'code') = 'not_a_lawyer'
  and (select count(*) = 1 and bool_and(kind = 'a3_token' and issuer = 'Certisign' and station_checked_at is not null)
       from public.certificate_inventory),
  'a lawyer declares what they sign with in each system of their own firm, and when their station was last checked'
);
select is(
  (select coalesce(array_agg(column_name::text order by column_name), '{}')
   from information_schema.columns where table_schema = 'public' and table_name = 'certificate_inventory'),
  array['created_at', 'id', 'issuer', 'kind', 'org_id', 'station_checked_at', 'system', 'updated_at', 'user_id', 'valid_until'],
  'the inventory holds the kind, the issuer and two dates: nothing of a certificate itself'
);

select * from finish();
rollback;
