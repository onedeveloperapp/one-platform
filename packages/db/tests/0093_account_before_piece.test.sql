begin;
create extension if not exists pgtap;
select plan(13);

-- ============================================================
-- ONE waits for the client's account before it creates the lawsuits, and
-- asks the client exactly what the piece needs (0090). An account is
-- missing, being prepared, missing something, contested or ready
-- (`case_account_state`); the order of the facts says what is missing and
-- what to ask; the client answers on their link and ONE orders the account
-- again by itself, within the setting's rounds; a client who says the order
-- is wrong has it ordered again by ONE too; a change of an account wakes
-- the case. Two firms: nothing of one reaches the other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a9300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@relato.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a9300000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@relato.invalid', '', now(), '{}', '{"display_name":"Caio Prado"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b9300000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-relato', 'a9300000-0000-4000-8000-000000000001'),
  ('b9300000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-relato', 'a9300000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b9300000-0000-4000-8000-00000000000a', 'a9300000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b9300000-0000-4000-8000-00000000000b', 'a9300000-0000-4000-8000-000000000003', 'owner', 'advogado');

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
create function pg_temp.state(target uuid) returns text language sql as
$$ select public.case_account_state(target); $$;
-- One statement of what a link read (`client_link_statements`), by its id.
create function pg_temp.told(name text, statement uuid) returns jsonb language sql as
$$ select e from res, jsonb_array_elements(res.payload -> 'statements') e
   where res.name = told.name and e ->> 'id' = told.statement::text; $$;
-- The backend claims a statement and finishes its run of the order of the facts with an answer; ONE decides
-- alone (the firm's default), so the answer is the statement's order at once.
create function pg_temp.ordered(org uuid, statement uuid, output jsonb) returns jsonb language plpgsql as $$
declare
  claimed integer;
  started jsonb;
begin
  update public.case_statements set work_after = null where id = statement;
  select c.claim into claimed from public.claim_case_statements(1, statement) c;
  started := public.start_ai_run(org, 'caso.relato.cronologia', repeat('e', 64), null, 'case_statement', statement::text,
    'caso.relato.cronologia:' || statement::text || ':' || claimed::text);
  perform public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded', output, 900, 400);
  return public.record_statement_work(statement, claimed, 'proposed', (started ->> 'run_id')::uuid);
end;
$$;

-- Firm A: Ana's case, with a leg whose flight ANAC's record says was cancelled, and her link. Firm B: a case.
select pg_temp.sign_in('a9300000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('b9300000-0000-4000-8000-00000000000a', 'cancellation', 'LA', date '2026-09-20',
  '{"full_name": "Ana Teste", "cpf": "12345678909", "birth_date": "1985-04-02", "phone": "5500999993001"}'::jsonb));
insert into res values ('link', public.create_client_link(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, encode(sha256(convert_to('token-do-relato-0093-aaaaaaaaaaaaaaaa', 'UTF8')), 'hex')));
reset role;
insert into public.flight_segments (id, org_id, case_id, position, flight_number, origin_iata, destination_iata,
                                    scheduled_departure_local, scheduled_arrival_local, affected) values
  ('c9300000-0000-4000-8000-0000000000f1', 'b9300000-0000-4000-8000-00000000000a', pg_temp.got('case', 'case_id')::uuid, 1,
   'LA3456', 'GRU', 'REC', '2026-09-20 21:30', '2026-09-21 00:50', true);
update public.flight_checks set status = 'found', record = '{"state": "cancelado", "actualDeparture": null, "actualArrival": null}'::jsonb
where segment_id = 'c9300000-0000-4000-8000-0000000000f1' and source = 'vra';
select pg_temp.sign_in('a9300000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('case_b', public.create_case('b9300000-0000-4000-8000-00000000000b', 'delay', 'AD', date '2026-09-20',
  '{"full_name": "Davi Teste", "phone": "5500999993003"}'::jsonb));
reset role;

-- ---------- The instructions, and who reads what ----------

select ok(
  (select output_schema -> 'properties' ? 'faltam' and output_schema -> 'required' ? 'perguntas'
   from public.prompt_versions where task = 'caso.relato.cronologia' and is_active)
  and public.statement_account_topics() = array['aviso', 'solucao', 'chegada', 'assistencia', 'gastos', 'consequencias']
  and not has_function_privilege('authenticated', 'public.case_account_state(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.case_account(uuid)', 'EXECUTE')
  and has_function_privilege('anon', 'public.client_link_complete_statement(text, uuid, text)', 'EXECUTE'),
  'the order of the facts says what is missing, and only the database reads where an account stands'
);

-- ---------- Nothing told: ONE waits for the client ----------

select is(pg_temp.state(pg_temp.got('case', 'case_id')::uuid), 'missing', 'a case whose client told nothing has its account missing');

-- The client writes what happened: the case is woken for ONE, and the account is being prepared.
update public.case_advances set after = 'tomorrow', woken_at = null where case_id = pg_temp.got('case', 'case_id')::uuid;
select pg_temp.as_client();
set local role anon;
insert into res values ('written', public.client_link_write_statement('token-do-relato-0093-aaaaaaaaaaaaaaaa',
  'O voo das 21h30 para Recife foi cancelado quando eu já estava no aeroporto, e passei a noite lá esperando.'));
reset role;
select ok(
  pg_temp.got('written', 'code') = 'sent'
  and pg_temp.state(pg_temp.got('case', 'case_id')::uuid) = 'preparing'
  and (select after is null and woken_at is not null from public.case_advances where case_id = pg_temp.got('case', 'case_id')::uuid),
  'an account sent wakes the case, and is being prepared'
);

-- ---------- The order of the facts says what is missing ----------

select pg_temp.as_backend();
set local role service_role;
insert into res select 'claim_first', jsonb_build_object('claim', c.claim)
from public.claim_case_statements(1, pg_temp.got('written', 'statement_id')::uuid) c;
insert into res select 'details', to_jsonb(d)
from public.case_statement_to_process(pg_temp.got('written', 'statement_id')::uuid, pg_temp.got('claim_first', 'claim')::integer) d;
update public.case_statements set work_claimed_at = null where id = pg_temp.got('written', 'statement_id')::uuid;
insert into res values ('first_order', pg_temp.ordered('b9300000-0000-4000-8000-00000000000a',
  pg_temp.got('written', 'statement_id')::uuid,
  '{"cronologia": "20/09/2026, 21:30: o voo LA3456 foi cancelado.\nPassou a noite no aeroporto.",
    "faltam": ["chegada", "gastos", "outro"],
    "perguntas": ["Em que dia e a que horas você chegou a Recife!", "Você teve algum gasto — comida ou transporte?"]}'::jsonb));
reset role;
select ok(
  (select payload -> 'trip' -> 0 ->> 'voo' = 'LA3456'
          and payload -> 'trip' -> 0 -> 'registro_oficial' ->> 'situacao' = 'cancelado'
          and payload ->> 'client_added' is null
   from res where name = 'details')
  and pg_temp.got('first_order', 'code') = 'proposed',
  'the order of the facts reads the trip as the case registers it, with what ANAC''s record says of the flight'
);
select ok(
  (select chronology_status = 'approved' and missing_topics = array['chegada', 'gastos']
          and questions = array['Em que dia e a que horas você chegou a Recife.', 'Você teve algum gasto, comida ou transporte?']
   from public.case_statements where id = pg_temp.got('written', 'statement_id')::uuid)
  and pg_temp.state(pg_temp.got('case', 'case_id')::uuid) = 'incomplete',
  'what is missing is kept as the setting names it, the questions plain, and the account is incomplete'
);

-- ---------- The client answers on their link, and ONE orders it again ----------

select pg_temp.as_client();
set local role anon;
insert into res values ('link_read', public.client_link_statements('token-do-relato-0093-aaaaaaaaaaaaaaaa'));
insert into res values ('answered', public.client_link_complete_statement('token-do-relato-0093-aaaaaaaaaaaaaaaa',
  pg_temp.got('written', 'statement_id')::uuid, 'Cheguei a Recife no dia 21 às 14h. Gastei R$ 60 com comida.'));
insert into res values ('answered_again', public.client_link_complete_statement('token-do-relato-0093-aaaaaaaaaaaaaaaa',
  pg_temp.got('written', 'statement_id')::uuid, 'Mais uma resposta.'));
reset role;
select ok(
  pg_temp.got('link_read', 'account') = 'incomplete'
  and pg_temp.told('link_read', pg_temp.got('written', 'statement_id')::uuid) -> 'questions'
      = '["Em que dia e a que horas você chegou a Recife.", "Você teve algum gasto, comida ou transporte?"]'::jsonb
  and pg_temp.got('answered', 'code') = 'sent' and pg_temp.got('answered_again', 'code') = 'nothing_to_answer'
  and (select rounds = 1 and work = 'chronology' and chronology_status = 'none' and client_added like 'Cheguei a Recife%'
       from public.case_statements where id = pg_temp.got('written', 'statement_id')::uuid)
  and pg_temp.state(pg_temp.got('case', 'case_id')::uuid) = 'preparing'
  and exists (select 1 from public.case_events where kind = 'client_statement_completed' and actor_type = 'client'),
  'the client reads the questions on their link and answers them once, and ONE orders the account again'
);

select pg_temp.as_backend();
set local role service_role;
insert into res select 'claim_again', jsonb_build_object('claim', c.claim)
from public.claim_case_statements(1, pg_temp.got('written', 'statement_id')::uuid) c;
insert into res select 'details_again', to_jsonb(d)
from public.case_statement_to_process(pg_temp.got('written', 'statement_id')::uuid, pg_temp.got('claim_again', 'claim')::integer) d;
update public.case_statements set work_claimed_at = null where id = pg_temp.got('written', 'statement_id')::uuid;
insert into res values ('second_order', pg_temp.ordered('b9300000-0000-4000-8000-00000000000a',
  pg_temp.got('written', 'statement_id')::uuid,
  '{"cronologia": "20/09/2026, 21:30: o voo LA3456 foi cancelado.\n21/09/2026, 14:00: chegou a Recife.\nGastou R$ 60 com comida.",
    "faltam": [], "perguntas": []}'::jsonb));
reset role;
select ok(
  (select payload ->> 'client_added' like 'Cheguei a Recife%' and payload ->> 'previous_chronology' like '%foi cancelado%'
   from res where name = 'details_again')
  and (select chronology_status = 'approved' and missing_topics = '{}' and questions = '{}' and client_added is null
       from public.case_statements where id = pg_temp.got('written', 'statement_id')::uuid)
  and pg_temp.state(pg_temp.got('case', 'case_id')::uuid) = 'ready',
  'the next order reads the one before and the answers, and an account with nothing missing is ready'
);

-- ---------- A client who says the order is wrong ----------

select pg_temp.as_client();
set local role anon;
insert into res values ('contested', public.client_link_answer_chronology('token-do-relato-0093-aaaaaaaaaaaaaaaa',
  pg_temp.got('written', 'statement_id')::uuid, false, 'O voo era às 21h50, não às 21h30.'));
insert into res values ('while_ordering', public.client_link_answer_chronology('token-do-relato-0093-aaaaaaaaaaaaaaaa',
  pg_temp.got('written', 'statement_id')::uuid, true));
reset role;
select ok(
  pg_temp.got('contested', 'code') = 'contested' and pg_temp.got('contested', 'reordering') = 'true'
  and pg_temp.got('while_ordering', 'code') = 'chronology_not_ready'
  and (select rounds = 2 and work = 'chronology' and chronology_status = 'none' and client_note like 'O voo era%'
       from public.case_statements where id = pg_temp.got('written', 'statement_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'chronology_requested' and actor_type = 'system')
  and pg_temp.state(pg_temp.got('case', 'case_id')::uuid) = 'preparing',
  'what the client says is wrong is ordered again by ONE at once, reading their words'
);

-- ---------- The rounds ----------

-- One round left: the next order still misses a point, and the client is asked it once more; past the rounds,
-- what is missing goes as it is, and a correction waits for a person.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('third_order', pg_temp.ordered('b9300000-0000-4000-8000-00000000000a',
  pg_temp.got('written', 'statement_id')::uuid,
  '{"cronologia": "20/09/2026, 21:50: o voo LA3456 foi cancelado.", "faltam": ["chegada"],
    "perguntas": ["Quando você chegou a Recife?"]}'::jsonb));
reset role;
insert into res select 'before_last', jsonb_build_object('state', pg_temp.state(pg_temp.got('case', 'case_id')::uuid));
select pg_temp.as_client();
set local role anon;
insert into res values ('last_answer', public.client_link_complete_statement('token-do-relato-0093-aaaaaaaaaaaaaaaa',
  pg_temp.got('written', 'statement_id')::uuid, 'Não lembro o horário.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('fourth_order', pg_temp.ordered('b9300000-0000-4000-8000-00000000000a',
  pg_temp.got('written', 'statement_id')::uuid,
  '{"cronologia": "20/09/2026, 21:50: o voo LA3456 foi cancelado.", "faltam": ["consequencias"],
    "perguntas": ["O que você perdeu por causa do cancelamento?"]}'::jsonb));
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('link_after_rounds', public.client_link_statements('token-do-relato-0093-aaaaaaaaaaaaaaaa'));
insert into res values ('no_more_rounds', public.client_link_complete_statement('token-do-relato-0093-aaaaaaaaaaaaaaaa',
  pg_temp.got('written', 'statement_id')::uuid, 'Perdi uma reunião.'));
insert into res values ('contest_after_rounds', public.client_link_answer_chronology('token-do-relato-0093-aaaaaaaaaaaaaaaa',
  pg_temp.got('written', 'statement_id')::uuid, false, 'Faltou dizer que dormi no chão.'));
reset role;
select ok(
  pg_temp.got('before_last', 'state') = 'incomplete'
  and pg_temp.got('last_answer', 'code') = 'sent'
  and pg_temp.got('link_after_rounds', 'account') = 'ready'
  and pg_temp.told('link_after_rounds', pg_temp.got('written', 'statement_id')::uuid) -> 'questions' = '[]'::jsonb
  and pg_temp.got('no_more_rounds', 'code') = 'too_many'
  and pg_temp.got('contest_after_rounds', 'reordering') = 'false'
  and pg_temp.state(pg_temp.got('case', 'case_id')::uuid) = 'contested',
  'past the rounds, what is missing goes as it is, and a correction waits for a person'
);

-- ---------- A person of the firm approves an order that waited for them ----------

-- Firm B keeps the order of the facts to a person: an answer waits in its queue, and approving it keeps what it
-- says is missing.
insert into public.firm_autonomy (org_id, decision, mode) values ('b9300000-0000-4000-8000-00000000000b', 'chronology', 'approval');
select pg_temp.sign_in('a9300000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('b_statement', public.add_case_statement(pg_temp.got('case_b', 'case_id')::uuid,
  pg_temp.got('case_b', 'party_id')::uuid, null,
  'O voo atrasou seis horas e ninguém da companhia deu informação durante a espera no aeroporto.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('b_order', pg_temp.ordered('b9300000-0000-4000-8000-00000000000b',
  pg_temp.got('b_statement', 'statement_id')::uuid,
  '{"cronologia": "O voo atrasou seis horas.", "faltam": ["assistencia"], "perguntas": ["Você recebeu alimentação durante a espera?"]}'::jsonb));
reset role;
insert into res select 'b_waiting', jsonb_build_object('state', pg_temp.state(pg_temp.got('case_b', 'case_id')::uuid));
select pg_temp.sign_in('a9300000-0000-4000-8000-000000000003');
set local role authenticated;
select public.decide_approval(a.id, 'approved', null, null)
from public.approvals a where a.org_id = 'b9300000-0000-4000-8000-00000000000b' and a.status = 'pending';
reset role;
select ok(
  pg_temp.got('b_waiting', 'state') = 'proposed'
  and (select chronology_status = 'approved' and missing_topics = array['assistencia']
              and questions = array['Você recebeu alimentação durante a espera?']
       from public.case_statements where id = pg_temp.got('b_statement', 'statement_id')::uuid)
  and pg_temp.state(pg_temp.got('case_b', 'case_id')::uuid) = 'incomplete',
  'an order a person approves keeps what it says is missing, and the client is asked it'
);

-- ---------- Another firm ----------

select pg_temp.sign_in('a9300000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  format('select public.case_account(%L)', pg_temp.got('case', 'case_id')),
  'P0002', 'case_not_found', 'another firm reads nothing of where a case''s account stands');
insert into res values ('own_b', public.case_account(pg_temp.got('case_b', 'case_id')::uuid));
reset role;
select ok(
  pg_temp.got('own_b', 'state') = 'incomplete' and pg_temp.got('own_b', 'max_rounds') = '3',
  'and reads its own'
);
select pg_temp.as_client();
set local role anon;
select is(
  public.client_link_complete_statement('token-do-relato-0093-aaaaaaaaaaaaaaaa',
    pg_temp.got('b_statement', 'statement_id')::uuid, 'Recebi um lanche.') ->> 'code',
  'not_found',
  'a client''s link answers nothing of a statement of another firm'
);
reset role;

select * from finish();
rollback;
