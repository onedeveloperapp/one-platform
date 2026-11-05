-- ============================================================
-- 0099_piece_asks_what_it_lacks: the piece leaves to complete only what its
-- claim cannot stand without, and ONE asks the client what it lacks (the
-- owner's decision of 2026-11-05).
--
-- The redone piece of the owner's case still had six [COMPLETAR], each a
-- fact only the client knew (the wait, the assistance, the commitment lost,
-- the expenses, twice, and what the airline offered), and a lawyer was the
-- only way out. Two changes, so a lawyer completes a piece as rarely as can
-- be:
--
--   1. The piece writes a [COMPLETAR] only for an essential fact of its
--      case, once (`drafts.essentials` by kind of problem: the flight and,
--      where a passenger was late or stranded, when they arrived; a bag's
--      problem, what happened to the bag). Any other fact not given is
--      written at the detail the client gave it or left out, and a claim no
--      fact supports leaves the piece (material damages with no expense of a
--      known amount), each said to the lawyer in the notes. The piece says
--      what each [COMPLETAR] asks (`pendencias`), in the codes of the
--      interview. A fourth version of `caso.peca.minuta`; the facts handed to
--      it carry `essenciais` (`piece_essentials`).
--   2. A piece ONE wrote that still has a [COMPLETAR] and no lawyer touched,
--      as the firm lets ONE start pieces, has ONE ask the client what it
--      lacks, one question at a time, through the interview (0095): opened
--      with only those questions (`case_interviews.scope`), or opened again
--      when it was done, never when the firm went on without it; a question
--      answered before is never asked again. Once the client answers, ONE
--      writes the piece again (0097): an account changes when an answer comes
--      (`case_account_changed_at` reads the answers, not the end of an
--      interview, so a firm that goes on without the client never has the
--      piece written again for nothing), and no piece is written again while
--      the client is being asked (`case_pieces_to_redo`). The template that
--      asks to go on outside the 24 hours serves a case in any stage before
--      the court (`interview_resumes_owed`).
-- ============================================================

-- ---------- 1. What a piece cannot stand without ----------

update public.platform_settings
set value = value || jsonb_build_object('essentials', jsonb_build_object(
  'delay', jsonb_build_array('voo', 'chegada'),
  'cancellation', jsonb_build_array('voo', 'chegada'),
  'overbooking', jsonb_build_array('voo', 'chegada'),
  'missed_connection', jsonb_build_array('voo', 'chegada'),
  'downgrade', jsonb_build_array('voo'),
  'baggage_lost', jsonb_build_array('voo', 'bagagem'),
  'baggage_damaged', jsonb_build_array('voo', 'bagagem'),
  'baggage_delayed', jsonb_build_array('voo', 'bagagem'),
  'other', jsonb_build_array('voo')
))
where key = 'drafts' and not (value ? 'essentials');

/**
 * The facts a case's piece cannot stand without, by its kind of problem (the
 * setting `drafts.essentials`): what the piece reads as `essenciais`. Only
 * the codes the piece knows. Service role.
 */
create or replace function public.piece_essentials(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(e.code order by e.n)
    from public.cases c
    cross join public.platform_settings s
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(s.value -> 'essentials' -> c.incident) = 'array' then s.value -> 'essentials' -> c.incident
           else jsonb_build_array('voo') end
    ) with ordinality as e(code, n)
    where c.id = target_case and s.key = 'drafts' and e.code in ('voo', 'chegada', 'bagagem')
  ), jsonb_build_array('voo'));
end;
$$;

revoke all on function public.piece_essentials(uuid) from public, anon, authenticated;

insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'caso.peca.minuta',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'caso.peca.minuta'),
  v.provider, v.model, v.effort,
  replace(replace(replace(v.system_prompt,
    'Escreva [COMPLETAR: o que falta] só para o que nem eles, nem a entrevista, nem os relatos respondem.',
    'Em "essenciais" estão os fatos sem os quais o pedido deste caso não se sustenta: "voo" (o voo, o dia e o problema), "chegada" (quando a parte autora chegou de fato ao destino) e "bagagem" (o que aconteceu com a bagagem). Escreva [COMPLETAR: o que falta] só para um fato essencial que nem eles, nem a entrevista, nem os relatos respondem, e uma única vez para cada fato. Um fato que não é essencial e não foi dado fica fora do texto, sem [COMPLETAR]: escreva o que se sabe no nível de detalhe em que foi dito (por exemplo, "perdeu um compromisso profissional no destino", sem dizer qual nem quando) e registre em "observacoes" o que ficou de fora. Nunca afirme como fato o que o cliente não disse, como a falta de assistência ou de oferta de reacomodação. Um pedido ou uma seção que nenhum fato recebido sustenta sai da peça, e a saída vai para "observacoes": em especial, quando nem "gastos", nem a entrevista, nem os relatos trazem um gasto com o seu valor, retire o pedido de danos materiais e o que só a ele serve.'),
    'O que o cliente disse que não lembra também não leva [COMPLETAR]: escreva o fato sem esse detalhe.',
    'O que o cliente disse que não lembra também não leva [COMPLETAR], salvo um fato essencial: escreva o fato sem esse detalhe.'),
    '- observacoes: lista curta do que o advogado precisa conferir ou completar',
    '- pendencias: o que os [COMPLETAR] do texto pedem, cada código uma vez: "voo", "chegada", "bagagem", "aviso_local" (se a parte autora já estava no aeroporto quando soube), "aviso_quando" (quando e por onde a companhia avisou), "motivo" (o motivo que a companhia deu), "solucao" (o que a companhia ofereceu no lugar do voo), "assistencia", "gastos", "consequencias", "acompanhantes" ou "outro". Lista vazia quando o texto não tem [COMPLETAR].
- observacoes: lista curta do que o advogado precisa conferir ou completar'),
  jsonb_set(
    jsonb_set(v.output_schema, '{required}', '["texto", "pendencias", "observacoes"]'::jsonb),
    '{properties,pendencias}',
    jsonb_build_object(
      'type', 'array',
      'description', 'O que os [COMPLETAR] do texto pedem, cada código uma vez.',
      'items', jsonb_build_object('type', 'string', 'enum', jsonb_build_array(
        'voo', 'chegada', 'bagagem', 'aviso_local', 'aviso_quando', 'motivo', 'solucao', 'assistencia', 'gastos',
        'consequencias', 'acompanhantes', 'outro'))
    )),
  v.max_tokens, false,
  'Só o essencial leva [COMPLETAR], uma vez; o resto sai da peça e vai para as observações; diz o que cada [COMPLETAR] pede.'
from public.prompt_versions v
where v.task = 'caso.peca.minuta' and v.is_active
  and strpos(v.system_prompt, '"essenciais"') = 0
  and strpos(v.system_prompt, 'Escreva [COMPLETAR: o que falta] só para o que nem eles, nem a entrevista, nem os relatos respondem.') > 0;

-- In force: one version per task, so the one in force leaves before the new one comes in.
update public.prompt_versions as v set is_active = false
where v.task = 'caso.peca.minuta' and v.is_active
  and strpos(v.system_prompt, '"essenciais"') = 0
  and exists (
    select 1 from public.prompt_versions w
    where w.task = v.task and w.version > v.version and strpos(w.system_prompt, '"essenciais"') > 0
  );
update public.prompt_versions set is_active = true
where task = 'caso.peca.minuta'
  and version = (
    select max(w.version) from public.prompt_versions w
    where w.task = 'caso.peca.minuta' and strpos(w.system_prompt, '"essenciais"') > 0
  )
  and not exists (select 1 from public.prompt_versions w where w.task = 'caso.peca.minuta' and w.is_active);

-- ---------- 2. ONE asks the client what the piece lacks ----------

alter table public.case_interviews add column scope text[];
alter table public.case_interviews add constraint case_interviews_scope_check check (
  scope is null or (cardinality(scope) between 1 and 10 and scope <@ array[
    'aviso_local', 'aviso_quando', 'motivo', 'solucao', 'chegada', 'assistencia', 'gastos', 'consequencias',
    'acompanhantes', 'bagagem']::text[]));

comment on column public.case_interviews.scope is
  'The questions this interview asks, when it asks what a piece lacks (0099); empty: every question of its problem.';

/**
 * The questions of a kind of problem, in the order they are asked: the same
 * list as `questionsFor` of `@flyee/rules/interview` (a delay has nothing
 * offered in its place; a bag's problem has its own questions, not these).
 * Internal.
 */
create or replace function public.interview_questions_of(target_incident text)
returns text[]
language sql
immutable
as $$
  select case
    when target_incident = 'downgrade' then array['motivo', 'gastos', 'consequencias', 'acompanhantes', 'bagagem']
    when target_incident = 'delay' then array['aviso_local', 'aviso_quando', 'motivo', 'chegada', 'assistencia', 'gastos',
                                              'consequencias', 'acompanhantes', 'bagagem']
    when target_incident in ('cancellation', 'overbooking', 'missed_connection', 'other') then
      array['aviso_local', 'aviso_quando', 'motivo', 'solucao', 'chegada', 'assistencia', 'gastos', 'consequencias',
            'acompanhantes', 'bagagem']
    else '{}'::text[]
  end;
$$;

revoke all on function public.interview_questions_of(text) from public, anon, authenticated;

/**
 * What ONE asks the client for a piece of the case: the questions its pieces
 * leave to complete (each piece the AI wrote, still with a [COMPLETAR],
 * that no lawyer edited, sent back or had rewritten, of a lawsuit still
 * planned, as the firm lets ONE start pieces), as each piece said it
 * (`pendencias`, 0099); a piece written before says nothing, and the
 * account's own gaps stand for it, else every question of the problem.
 * Only questions of the case's problem never answered, in the order they are
 * asked; empty when ONE asks nothing: a case that ended or is in court, no
 * adult to answer, an interview the client is being asked or the firm went
 * on without. Internal.
 */
create or replace function public.piece_interview_scope(target_case uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  status_now text;
  applicable text[];
  wanted text[] := '{}';
  piece record;
  topics text[];
begin
  select * into current_case from public.cases where id = target_case;
  if not found or current_case.status in ('filed', 'closed', 'declined') then
    return '{}';
  end if;
  applicable := public.interview_questions_of(current_case.incident);
  if cardinality(applicable) = 0
     or public.firm_autonomy_mode(current_case.org_id, 'start_piece') <> 'auto'
     or public.case_interview_person(current_case.id) is null then
    return '{}';
  end if;
  select i.status into status_now from public.case_interviews i where i.case_id = current_case.id;
  if status_now is not null and status_now <> 'done' then
    return '{}';
  end if;
  for piece in
    select r.output
    from public.case_drafts d
    join public.proceedings p on p.id = d.proceeding_id and p.status = 'planned'
    join public.case_draft_versions v on v.draft_id = d.id and v.version = d.version
    left join public.ai_runs r on r.id = v.run_id
    where d.case_id = current_case.id and d.status = 'proposed' and d.work is null and d.mode = 'ai'
      and d.revision_note is null and d.revisions = 0
      and strpos(v.body, '[COMPLETAR') > 0
      and not exists (
        select 1 from public.case_draft_versions w
        where w.draft_id = d.id and (w.author = 'person' or w.note is not null)
      )
  loop
    if jsonb_typeof(piece.output -> 'pendencias') = 'array' then
      wanted := wanted || array(select jsonb_array_elements_text(piece.output -> 'pendencias'));
    else
      select coalesce(array_agg(distinct t.topic), '{}') into topics
      from public.case_statements s cross join lateral unnest(s.missing_topics) as t(topic)
      where s.case_id = current_case.id;
      if cardinality(topics) > 0 then
        wanted := wanted || array(
          select m.question from unnest(topics) as t(topic)
          join (values ('aviso', 'aviso_local'), ('aviso', 'aviso_quando'), ('aviso', 'motivo'), ('solucao', 'solucao'),
                       ('chegada', 'chegada'), ('assistencia', 'assistencia'), ('gastos', 'gastos'),
                       ('consequencias', 'consequencias')) as m(topic, question) on m.topic = t.topic);
      else
        wanted := wanted || applicable;
      end if;
    end if;
  end loop;
  return array(
    select q.question from unnest(applicable) with ordinality as q(question, n)
    where q.question = any (wanted)
      and not exists (
        select 1 from public.case_interview_answers a where a.case_id = current_case.id and a.question = q.question)
    order by q.n
  );
end;
$$;

revoke all on function public.piece_interview_scope(uuid) from public, anon, authenticated;

/**
 * Opens a case's interview when it is owed one (0095), or to ask what its
 * piece lacks: a new interview with only those questions, or the one done
 * before opened again with them (replaces the one of 0095). The free
 * account's gaps are no longer asked, and the timeline says ONE interviews
 * the passenger. Service role.
 */
create or replace function public.interview_start(target_case uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  existing public.case_interviews%rowtype;
  asked text[];
  created uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case for no key update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'case_not_found');
  end if;
  select * into existing from public.case_interviews i where i.case_id = current_case.id for update;
  if existing.id is not null and existing.status <> 'done' then
    return jsonb_build_object('ok', true, 'code', 'already', 'interview_id', existing.id);
  end if;
  if existing.id is null and public.interview_owed(current_case.id) then
    insert into public.case_interviews (org_id, case_id, person_id)
    values (current_case.org_id, current_case.id, public.case_interview_person(current_case.id))
    returning id into created;
  else
    asked := public.piece_interview_scope(current_case.id);
    if cardinality(asked) = 0 then
      if existing.id is not null then
        return jsonb_build_object('ok', true, 'code', 'already', 'interview_id', existing.id);
      end if;
      return jsonb_build_object('ok', false, 'code', 'not_owed');
    end if;
    if existing.id is not null then
      update public.case_interviews set
        status = 'open', scope = asked, finished_at = null, closed_by = null,
        current_question = null, asked_at = null, asks = 0, reminded_at = null, resumed_at = null, resumes = 0,
        person_id = coalesce(person_id, public.case_interview_person(current_case.id))
      where id = existing.id;
      created := existing.id;
    else
      insert into public.case_interviews (org_id, case_id, person_id, scope)
      values (current_case.org_id, current_case.id, public.case_interview_person(current_case.id), asked)
      returning id into created;
    end if;
  end if;
  update public.case_statements set missing_topics = '{}', questions = '{}'
  where case_id = current_case.id and (cardinality(missing_topics) > 0 or cardinality(questions) > 0);
  perform public.record_case_event(current_case.org_id, current_case.id, 'interview_started', 'system',
    jsonb_build_object('interview', created, 'piece', asked is not null));
  return jsonb_build_object('ok', true, 'code', 'started', 'interview_id', created);
end;
$$;

revoke all on function public.interview_start(uuid) from public, anon, authenticated;

/** The cases owed an interview, or owed one for their piece, the oldest first, for the sweep (replaces the one of 0095). Service role. */
create or replace function public.interviews_to_start(target_limit integer default 20)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  select c.id from public.cases c
  where c.status not in ('filed', 'closed', 'declined')
    and c.incident in ('delay', 'cancellation', 'overbooking', 'missed_connection', 'downgrade', 'other')
    and not exists (select 1 from public.case_interviews i where i.case_id = c.id and i.status <> 'done')
    and (
      (c.status in ('intake', 'documents', 'signature')
       and not exists (select 1 from public.case_interviews i where i.case_id = c.id)
       and public.interview_owed(c.id))
      or (exists (select 1 from public.case_drafts d
                  where d.case_id = c.id and d.status = 'proposed' and d.mode = 'ai' and d.work is null)
          and cardinality(public.piece_interview_scope(c.id)) > 0)
    )
  order by c.created_at, c.id
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;

revoke all on function public.interviews_to_start(integer) from public, anon, authenticated;

/**
 * What the rule of the interview reads of its case (replaces the one of
 * 0095, adding `scope`: the questions it asks when it asks what a piece
 * lacks). Internal.
 */
create or replace function public.interview_facts(target_interview uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  interview public.case_interviews%rowtype;
  current_case public.cases%rowtype;
  leg public.flight_segments%rowtype;
  alert record;
  followed timestamp;
  talk public.wa_conversations%rowtype;
begin
  select * into interview from public.case_interviews where id = target_interview;
  if not found then
    return null;
  end if;
  select * into current_case from public.cases where id = interview.case_id;
  select * into leg from public.flight_segments s
  where s.case_id = current_case.id order by s.affected desc, s.position limit 1;
  select a.kind, a.delay_minutes, a.leg_position, a.trip_id into alert
  from public.flight_alerts a join public.tracked_trips t on t.id = a.trip_id
  where t.case_id = current_case.id
  order by a.created_at desc limit 1;
  if alert.trip_id is not null then
    select l.arrived_local into followed from public.tracked_legs l
    where l.trip_id = alert.trip_id and l.position = coalesce(alert.leg_position, l.position) and l.arrived_local is not null
    order by l.position desc limit 1;
  end if;
  talk := public.interview_conversation(interview.id);
  return jsonb_build_object(
    'id', interview.id,
    'case_id', interview.case_id,
    'status', interview.status,
    'rule_version', interview.rule_version,
    'scope', to_jsonb(interview.scope),
    'current_question', interview.current_question,
    'asked_at', interview.asked_at,
    'asks', interview.asks,
    'reminded_at', interview.reminded_at,
    'resumed_at', interview.resumed_at,
    'started_at', interview.started_at,
    'finished_at', interview.finished_at,
    'first_name', (select initcap(lower(split_part(btrim(p.full_name), ' ', 1))) from public.people p where p.id = interview.person_id),
    'incident', current_case.incident,
    'flight_date', current_case.flight_date,
    'alert', case when alert.kind is not null then jsonb_build_object('kind', alert.kind, 'delay_minutes', alert.delay_minutes) end,
    'airline_cause', nullif(btrim(coalesce(current_case.airline_stated_cause, '')), ''),
    'scheduled_departure', to_char(leg.scheduled_departure_local, 'YYYY-MM-DD"T"HH24:MI'),
    'scheduled_arrival', to_char(leg.scheduled_arrival_local, 'YYYY-MM-DD"T"HH24:MI'),
    'actual_arrival', to_char(coalesce(leg.actual_arrival_local, followed), 'YYYY-MM-DD"T"HH24:MI'),
    'companions_known', exists (select 1 from public.tracked_trips t where t.case_id = current_case.id)
      or (select count(distinct cp.person_id) from public.case_parties cp where cp.case_id = current_case.id) > 1,
    -- Where ONE can ask now: a conversation it holds, inside the 24 hours.
    'in_chat', talk.id is not null and talk.agent = 'one' and public.wa_window_open(talk.last_inbound_at),
    'answers', coalesce((
      select jsonb_object_agg(a.question, jsonb_build_object(
        'status', a.status, 'answer', a.answer, 'words', a.words, 'sim_nao', a.facts ->> 'sim_nao',
        'quando', a.facts ->> 'quando', 'source', a.source, 'reason', a.reason, 'answered_at', a.answered_at))
      from public.case_interview_answers a where a.interview_id = interview.id
    ), '{}'::jsonb)
  );
end;
$$;

revoke all on function public.interview_facts(uuid) from public, anon, authenticated;

/**
 * The open interviews whose passenger is owed the firm's template to go on
 * (replaces the one of 0095: a case in any stage before the court, since an
 * interview may ask what a piece lacks). The rest as in 0095. Service role.
 */
create or replace function public.interview_resumes_owed(target_limit integer default 20)
returns table (interview_id uuid, org_id uuid, first_name text, firm text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  every integer := greatest(public.interview_setting('resume_hours', 24), 1);
  most integer := greatest(public.interview_setting('max_resumes', 2), 0);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  select i.id, i.org_id, initcap(lower(split_part(btrim(p.full_name), ' ', 1))), o.name
  from public.case_interviews i
  join public.cases c on c.id = i.case_id and c.status not in ('filed', 'closed', 'declined')
  join public.people p on p.id = i.person_id
  join public.organizations o on o.id = i.org_id
  cross join lateral (select (public.interview_conversation(i.id)).*) talk
  where i.status = 'open'
    and i.resumes < most
    and (i.resumed_at is null or i.resumed_at < now() - make_interval(hours => every))
    and talk.id is not null and talk.agent = 'one'
    and talk.last_inbound_at is not null and not public.wa_window_open(talk.last_inbound_at)
    and public.notice_person_blocker(i.org_id, i.person_id) is null
    and exists (
      select 1 from public.firm_notice_kinds k join public.wa_templates t on t.id = k.template_id
      where k.org_id = i.org_id and k.kind = 'case_questions' and k.enabled and t.status = 'approved' and t.category = 'utility'
    )
  order by i.resumed_at nulls first, i.started_at
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;

revoke all on function public.interview_resumes_owed(integer) from public, anon, authenticated;

-- ---------- The piece is written again once the client answered ----------

/**
 * When a case's account last changed (replaces the one of 0097): its order
 * of the facts approved or confirmed, or an answer the client gave to the
 * interview (or the firm for them), "not known" included. The end of an
 * interview is no change of its own: one the firm went on without brings
 * nothing new. Null when it never had one. Internal.
 */
create or replace function public.case_account_changed_at(target_case uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    (select max(e.at) from public.case_events e
     where e.case_id = target_case and e.kind in ('chronology_approved', 'client_chronology_confirmed')),
    (select max(a.answered_at) from public.case_interview_answers a
     where a.case_id = target_case and a.status in ('answered', 'unknown'))
  );
$$;

revoke all on function public.case_account_changed_at(uuid) from public, anon, authenticated;

/**
 * The pieces ONE writes again in a case (replaces the one of 0098): as
 * there, and never while the client is being asked (an open interview),
 * so every answer reaches one rewriting. Internal.
 */
create or replace function public.case_pieces_to_redo(target_case uuid)
returns table (draft_id uuid, proceeding_id uuid, template_id uuid, kind text)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.proceeding_id, d.template_id, p.kind
  from public.cases k
  join public.case_drafts d on d.case_id = k.id
  join public.proceedings p on p.id = d.proceeding_id and p.status = 'planned'
  join public.case_draft_versions v on v.draft_id = d.id and v.version = d.version
  where k.id = target_case
    and k.status not in ('filed', 'closed', 'declined')
    and d.status = 'proposed' and d.work is null and d.mode = 'ai'
    and d.revision_note is null and d.revisions = 0
    and strpos(v.body, '[COMPLETAR') > 0
    and not exists (
      select 1 from public.case_draft_versions w
      where w.draft_id = d.id and (w.author = 'person' or w.note is not null)
    )
    and not exists (select 1 from public.case_interviews i where i.case_id = k.id and i.status = 'open')
    and v.created_at < public.case_account_changed_at(k.id)
    and public.firm_autonomy_mode(k.org_id, 'start_piece') = 'auto'
    and public.case_account_state(k.id) in ('ready', 'incomplete')
  order by d.requested_at, d.id;
$$;

revoke all on function public.case_pieces_to_redo(uuid) from public, anon, authenticated;
