begin;
create extension if not exists pgtap;
select plan(13);

-- ============================================================
-- The piece leaves to complete only what its claim cannot stand without,
-- and ONE asks the client what it lacks (0099). The essentials by kind of
-- problem reach the piece; a piece the AI wrote, still with a [COMPLETAR]
-- and untouched, has ONE interview the client on what it lacks, only those
-- questions, never one answered before, never when the firm went on without
-- it; while the client is asked no piece is written again, and once they
-- answered it is, once. Two firms: nothing of one reaches the other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1010000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@pendencia.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a1010000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@pendencia.invalid', '', now(), '{}', '{"display_name":"Caio Prado"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1010000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-pendencia', 'a1010000-0000-4000-8000-000000000001'),
  ('b1010000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-pendencia', 'a1010000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1010000-0000-4000-8000-00000000000a', 'a1010000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1010000-0000-4000-8000-00000000000b', 'a1010000-0000-4000-8000-000000000002', 'owner', 'advogado');
insert into public.draft_templates (id, org_id, name, body) values
  ('d1010000-0000-4000-8000-00000000000a', 'b1010000-0000-4000-8000-00000000000a', 'Inicial do juizado',
   'Modelo de teste do escritório A, com o texto de uma peça.'),
  ('d1010000-0000-4000-8000-00000000000b', 'b1010000-0000-4000-8000-00000000000b', 'Inicial do juizado',
   'Modelo de teste do escritório B, com o texto de uma peça.');
-- Firm B keeps the start of a piece to a person.
insert into public.firm_autonomy (org_id, decision, mode) values ('b1010000-0000-4000-8000-00000000000b', 'start_piece', 'approval');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- A case of a firm, with a planned lawsuit and the AI's first text of its piece, written five hours ago by a run
-- that answered `said` (null: a run of a version before 0099, which said nothing of what it left to complete).
-- `edited` adds a version a lawyer wrote.
create function pg_temp.drafted(name text, who uuid, org uuid, template uuid, body text, said jsonb,
                                incident text default 'cancellation', edited boolean default false)
returns void language plpgsql as $$
declare
  made jsonb;
  lawsuit uuid := gen_random_uuid();
  draft uuid := gen_random_uuid();
  started jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  made := public.create_case(org, incident, 'LA', date '2026-09-20',
    jsonb_build_object('full_name', 'Cliente ' || initcap(translate(name, '_', ' ')),
                       'phone', '55009998' || lpad((abs(hashtext(name)) % 100000)::text, 5, '0')));
  reset role;
  update public.cases set status = 'drafting' where id = (made ->> 'case_id')::uuid;
  insert into public.proceedings (id, org_id, case_id, kind, court, status)
  values (lawsuit, org, (made ->> 'case_id')::uuid, 'juizado', 'TJGO', 'planned');
  insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_id, template_name, template_body, mode, status,
                                  version, requested_auto, requested_at)
  values (draft, org, (made ->> 'case_id')::uuid, lawsuit, template, 'Inicial do juizado',
          'Modelo de teste com o texto de uma peça.', 'ai', 'proposed', case when edited then 2 else 1 end, true,
          now() - interval '5 hours');
  perform pg_temp.as_backend();
  set local role service_role;
  started := public.start_ai_run(org, 'caso.peca.minuta', repeat('f', 64), null, 'case_draft', draft::text,
    'caso.peca.minuta:' || draft::text || ':1');
  perform public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded',
    jsonb_build_object('texto', body, 'observacoes', '[]'::jsonb)
      || case when said is null then '{}'::jsonb else jsonb_build_object('pendencias', said) end, 900, 400);
  reset role;
  insert into public.case_draft_versions (org_id, draft_id, version, author, body, run_id, created_at)
  values (org, draft, 1, 'ai', body, (started ->> 'run_id')::uuid, now() - interval '5 hours');
  if edited then
    insert into public.case_draft_versions (org_id, draft_id, version, author, author_id, body, based_on, created_at)
    values (org, draft, 2, 'person', who, body || ' Corrigido por um advogado.', 1, now() - interval '4 hours');
  end if;
  insert into res values (name, made || jsonb_build_object('proceeding_id', lawsuit, 'draft_id', draft));
end;
$$;
create function pg_temp.scope(name text) returns text[] language sql as
$$ select public.piece_interview_scope(pg_temp.got(name, 'case_id')::uuid); $$;
create function pg_temp.redo(name text) returns integer language sql as
$$ select count(*)::integer from public.case_pieces_to_redo(pg_temp.got(name, 'case_id')::uuid); $$;

-- ---------- What a piece cannot stand without, and the instructions ----------

select pg_temp.drafted('due', 'a1010000-0000-4000-8000-000000000001', 'b1010000-0000-4000-8000-00000000000a',
  'd1010000-0000-4000-8000-00000000000a', 'Excelentíssimo Juízo. [COMPLETAR: quando chegou] [COMPLETAR: os gastos]',
  '["gastos", "chegada", "voo", "outro", "assistencia"]'::jsonb);
select pg_temp.drafted('downgrade', 'a1010000-0000-4000-8000-000000000001', 'b1010000-0000-4000-8000-00000000000a',
  'd1010000-0000-4000-8000-00000000000a', 'Excelentíssimo Juízo. Texto completo.', '[]'::jsonb, 'downgrade');

select pg_temp.as_backend();
set local role service_role;
insert into res values ('essentials', jsonb_build_object(
  'cancellation', public.piece_essentials(pg_temp.got('due', 'case_id')::uuid),
  'downgrade', public.piece_essentials(pg_temp.got('downgrade', 'case_id')::uuid)));
reset role;
select ok(
  pg_temp.got('essentials', 'cancellation')::jsonb = '["voo", "chegada"]'::jsonb
  and pg_temp.got('essentials', 'downgrade')::jsonb = '["voo"]'::jsonb
  and (select strpos(system_prompt, '"essenciais"') > 0 and strpos(system_prompt, '- pendencias:') > 0
              and output_schema -> 'required' = '["texto", "pendencias", "observacoes"]'::jsonb
              and (output_schema #> '{properties,pendencias,items,enum}') ? 'chegada'
       from public.prompt_versions where task = 'caso.peca.minuta' and is_active)
  and (select count(*) = 1 from public.prompt_versions where task = 'caso.peca.minuta' and is_active),
  'the piece reads what its claim cannot stand without, and says what each [COMPLETAR] asks'
);

select ok(
  not has_function_privilege('authenticated', 'public.piece_essentials(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.piece_interview_scope(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.interview_questions_of(text)', 'EXECUTE')
  and public.interview_questions_of('delay') = array['aviso_local', 'aviso_quando', 'motivo', 'chegada', 'assistencia',
                                                      'gastos', 'consequencias', 'acompanhantes', 'bagagem']
  and public.interview_questions_of('baggage_lost') = '{}'::text[],
  'only the backend reads them, and the questions of a problem are the rule''s'
);

-- ---------- ONE asks the client what the piece lacks ----------

select is(pg_temp.scope('due'), array['chegada', 'assistencia', 'gastos'],
  'what the piece leaves to complete, as it said it, in the order the questions are asked; never the flight nor another');

select pg_temp.as_backend();
set local role service_role;
insert into res select 'to_start', jsonb_build_object('cases', coalesce(jsonb_agg(c), '[]'::jsonb))
from public.interviews_to_start(50) c;
insert into res values ('started', public.interview_start(pg_temp.got('due', 'case_id')::uuid));
insert into res values ('facts', public.interview_for_work(pg_temp.got('started', 'interview_id')::uuid, null));
reset role;
select ok(
  (select payload -> 'cases' ? pg_temp.got('due', 'case_id') from res where name = 'to_start')
  and pg_temp.got('started', 'code') = 'started'
  and (select scope = array['chegada', 'assistencia', 'gastos'] and status = 'open'
       from public.case_interviews where case_id = pg_temp.got('due', 'case_id')::uuid)
  and pg_temp.got('facts', 'scope')::jsonb = '["chegada", "assistencia", "gastos"]'::jsonb
  and exists (select 1 from public.case_events where case_id = pg_temp.got('due', 'case_id')::uuid
                and kind = 'interview_started' and data ->> 'piece' = 'true'),
  'the sweep opens the interview with only those questions, and the timeline says ONE interviews the client'
);

-- ---------- While the client is asked, the piece waits; once they answered, it is written again ----------

select pg_temp.as_backend();
set local role service_role;
select public.interview_answer(pg_temp.got('started', 'interview_id')::uuid, 'chegada', 'answered',
  'Chegou no dia seguinte, às 9h.', 'cheguei no outro dia as 9', '{"quando": "2026-09-21T09:00"}'::jsonb);
select public.interview_answer(pg_temp.got('started', 'interview_id')::uuid, 'assistencia', 'unknown');
reset role;
select is(pg_temp.redo('due'), 0, 'no piece is written again while the client is being asked');

select pg_temp.as_backend();
set local role service_role;
select public.interview_answer(pg_temp.got('started', 'interview_id')::uuid, 'gastos', 'answered',
  'Gastou R$ 80 com um táxi.', 'gastei 80 de taxi');
insert into res values ('finished', public.interview_finish(pg_temp.got('started', 'interview_id')::uuid, null));
reset role;
select ok(
  pg_temp.got('finished', 'code') = 'done' and pg_temp.redo('due') = 1
  and (select count(*) = 1 from public.case_pieces_to_redo(pg_temp.got('due', 'case_id')::uuid) r
       where r.draft_id = pg_temp.got('due', 'draft_id')::uuid),
  'once the client answered, ONE writes the piece again with the answers'
);
select ok(
  pg_temp.scope('due') = '{}'::text[]
  and (select payload -> 'cases' ? pg_temp.got('due', 'case_id') = false
       from (select jsonb_build_object('cases', coalesce(jsonb_agg(c), '[]'::jsonb)) as payload
             from public.interviews_to_start(50) c) x),
  'a question answered, or said not known, is never asked again'
);

-- A piece written again that still lacks something never answered opens the interview done before, with only that.
update public.case_drafts set status = 'cancelled' where id = pg_temp.got('due', 'draft_id')::uuid;
select pg_temp.drafted('due_again', 'a1010000-0000-4000-8000-000000000001', 'b1010000-0000-4000-8000-00000000000a',
  'd1010000-0000-4000-8000-00000000000a', 'Excelentíssimo Juízo. [COMPLETAR: o motivo]', '["motivo", "gastos"]'::jsonb);
update public.case_drafts set case_id = pg_temp.got('due', 'case_id')::uuid,
  proceeding_id = pg_temp.got('due', 'proceeding_id')::uuid
where id = pg_temp.got('due_again', 'draft_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('reopened', public.interview_start(pg_temp.got('due', 'case_id')::uuid));
reset role;
select ok(
  pg_temp.got('reopened', 'code') = 'started'
  and pg_temp.got('reopened', 'interview_id') = pg_temp.got('started', 'interview_id')
  and (select status = 'open' and scope = array['motivo'] and finished_at is null
       from public.case_interviews where case_id = pg_temp.got('due', 'case_id')::uuid),
  'the interview done before is opened again with what the new piece lacks and nobody answered'
);

-- ---------- A piece written before 0099 ----------

select pg_temp.drafted('legacy', 'a1010000-0000-4000-8000-000000000001', 'b1010000-0000-4000-8000-00000000000a',
  'd1010000-0000-4000-8000-00000000000a', 'Excelentíssimo Juízo. [COMPLETAR: o que a ré ofereceu]', null);
select pg_temp.sign_in('a1010000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('statement', public.add_case_statement(pg_temp.got('legacy', 'case_id')::uuid,
  pg_temp.got('legacy', 'party_id')::uuid, null,
  'O voo para Recife foi cancelado quando eu já estava no aeroporto, e passei a noite lá esperando.'));
reset role;
update public.case_statements
set chronology = '20/09/2026, 21:30: o voo foi cancelado.', chronology_status = 'approved', work = null,
    missing_topics = array['solucao', 'gastos'],
    questions = array['O que a companhia ofereceu?', 'Você teve algum gasto?']
where id = pg_temp.got('statement', 'statement_id')::uuid;
select pg_temp.drafted('legacy_bare', 'a1010000-0000-4000-8000-000000000001', 'b1010000-0000-4000-8000-00000000000a',
  'd1010000-0000-4000-8000-00000000000a', 'Excelentíssimo Juízo. [COMPLETAR: os fatos]', null, 'delay');
select ok(
  pg_temp.scope('legacy') = array['solucao', 'gastos']
  and pg_temp.scope('legacy_bare') = array['aviso_local', 'aviso_quando', 'motivo', 'chegada', 'assistencia', 'gastos',
                                           'consequencias', 'acompanhantes', 'bagagem'],
  'a piece written before says nothing of what it lacks: the account''s gaps stand for it, else every question'
);
select pg_temp.as_backend();
set local role service_role;
insert into res values ('legacy_started', public.interview_start(pg_temp.got('legacy', 'case_id')::uuid));
reset role;
select ok(
  pg_temp.got('legacy_started', 'code') = 'started'
  and (select missing_topics = '{}' and questions = '{}' from public.case_statements
       where id = pg_temp.got('statement', 'statement_id')::uuid),
  'the account''s own questions are no longer asked once the interview asks them'
);

-- ---------- What stays a lawyer's ----------

select pg_temp.drafted('edited', 'a1010000-0000-4000-8000-000000000001', 'b1010000-0000-4000-8000-00000000000a',
  'd1010000-0000-4000-8000-00000000000a', 'Excelentíssimo Juízo. [COMPLETAR: quando chegou]', '["chegada"]'::jsonb,
  'cancellation', true);
select pg_temp.drafted('late', 'a1010000-0000-4000-8000-000000000001', 'b1010000-0000-4000-8000-00000000000a',
  'd1010000-0000-4000-8000-00000000000a', 'Excelentíssimo Juízo. [COMPLETAR: o que ofereceu]', '["solucao"]'::jsonb, 'delay');
select pg_temp.drafted('firm_b', 'a1010000-0000-4000-8000-000000000002', 'b1010000-0000-4000-8000-00000000000b',
  'd1010000-0000-4000-8000-00000000000b', 'Excelentíssimo Juízo. [COMPLETAR: quando chegou]', '["chegada"]'::jsonb);
select ok(
  pg_temp.scope('edited') = '{}'::text[] and pg_temp.scope('late') = '{}'::text[]
  and pg_temp.scope('firm_b') = '{}'::text[] and pg_temp.scope('downgrade') = '{}'::text[],
  'nothing is asked for a piece a lawyer edited, a question its problem does not have, a firm that keeps the piece to a person, or a piece with nothing to complete'
);

-- The firm goes on without the client: the interview is closed, never opened again, and nothing is written again.
select pg_temp.drafted('closed', 'a1010000-0000-4000-8000-000000000001', 'b1010000-0000-4000-8000-00000000000a',
  'd1010000-0000-4000-8000-00000000000a', 'Excelentíssimo Juízo. [COMPLETAR: quando chegou]', '["chegada"]'::jsonb);
select pg_temp.as_backend();
set local role service_role;
select public.interview_start(pg_temp.got('closed', 'case_id')::uuid);
reset role;
select pg_temp.sign_in('a1010000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('went_on', public.close_case_interview(pg_temp.got('closed', 'case_id')::uuid));
reset role;
select ok(
  pg_temp.got('went_on', 'code') = 'closed'
  and pg_temp.scope('closed') = '{}'::text[] and pg_temp.redo('closed') = 0,
  'a firm that goes on without the client is never asked again, and has nothing written again for nothing'
);

select ok(
  not exists (select 1 from public.case_interviews where org_id = 'b1010000-0000-4000-8000-00000000000b')
  and not exists (
    select 1 from public.case_interviews i join public.cases c on c.id = i.case_id where c.org_id <> i.org_id
  ),
  'nothing of one firm''s interviews reaches the other'
);

select * from finish();
rollback;
