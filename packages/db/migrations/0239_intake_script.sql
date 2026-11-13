-- ============================================================
-- The chat's script adjusted by the owner (2026-11-13), the database's
-- side (0239). ONE asks first what decides the right and stops at the
-- first answer that rules it out (the backend's, with `qualificacao-v2`);
-- the airline and the flight's number are never asked, the documents bring
-- them; when the passenger should have arrived and did is asked instead,
-- and the intake's task reads both times (its fourth instructions, published
-- in a new version of each module that pins it). The name and who
-- travelled along wait for the "Quero seguir" (the backend's).
--
-- After the signature, the client tells what happened in their own words,
-- by audio or text, instead of the interview's questions: ONE asks for it in
-- the chat (`chat_questions_owed` gains `account`, after a bill's holder),
-- what they write becomes their account (`one_write_account`; an audio
-- already did, 0050), and what it misses for the piece is asked one question
-- at a time as before (0092, 0235). The interview of the start is no longer
-- owed (`interview_owed`); the one a piece asks for what it lacks stays
-- (0099). The step of the account ends once an account of the case arrives.
-- ============================================================

-- ---------- The fourth instructions of `atendimento.entrada`: the arrival, never the flight's number ----------

insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'atendimento.entrada',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'atendimento.entrada'),
  v.provider, v.model, v.effort,
  replace(v.system_prompt,
    '- atraso_horas: para um atraso ou uma conexão perdida, com quantas horas de atraso ela chegou ao destino final, como número ("6" ou "4.5"); vazio quando não disse.',
    '- chegada_prevista: quando ela deveria chegar ao destino final, como "AAAA-MM-DDTHH:MM" quando ela disse o dia, ou "HH:MM" quando disse só a hora; vazio quando não disse.' || chr(10)
      || '- chegada_real: quando ela chegou de fato ao destino final, do mesmo jeito; quando ela disser que chegou no dia seguinte ou depois, escreva o dia; vazio quando não disse.' || chr(10)
      || '- atraso_horas: com quantas horas de atraso ela chegou ao destino final, como número ("6" ou "4.5"), só quando ela disser quanto atrasou sem dizer os horários; vazio nos outros casos.' || chr(10)
      || '- viajou: depois de um cancelamento ou de uma mudança, "nao" quando ela disser que não chegou a viajar (desistiu, pediu o reembolso, não foi realocada) e "sim" quando viajou; vazio quando não disse.'),
  jsonb_set(jsonb_set(jsonb_set(jsonb_set(v.output_schema,
    '{required}', (v.output_schema -> 'required') || '["chegada_prevista", "chegada_real", "viajou"]'::jsonb),
    '{properties,chegada_prevista}', '{"type": "string", "maxLength": 16}'::jsonb),
    '{properties,chegada_real}', '{"type": "string", "maxLength": 16}'::jsonb),
    '{properties,viajou}', '{"type": "string", "enum": ["", "sim", "nao"]}'::jsonb),
  v.max_tokens, false,
  'Lê quando a pessoa deveria chegar ao destino final e quando chegou, e se viajou depois de um cancelamento (0239).'
from public.prompt_versions v
where v.task = 'atendimento.entrada' and v.is_active and not (v.output_schema -> 'properties') ? 'chegada_real';

update public.prompt_versions as v set is_active = false
where v.task = 'atendimento.entrada' and v.is_active and not (v.output_schema -> 'properties') ? 'chegada_real'
  and exists (
    select 1 from public.prompt_versions w
    where w.task = v.task and w.version > v.version and (w.output_schema -> 'properties') ? 'chegada_real'
  );
update public.prompt_versions set is_active = true
where task = 'atendimento.entrada'
  and version = (select max(w.version) from public.prompt_versions w where w.task = 'atendimento.entrada')
  and (output_schema -> 'properties') ? 'chegada_real';

-- The version each module that pins the task publishes: its latest published, with this version of the task and
-- nothing else changed. A draft the operator had prepared is discarded: prepared again, it holds what is in force now.
delete from public.module_versions v
where v.status = 'draft'
  and exists (select 1 from public.product_modules m where m.key = v.module and 'atendimento.entrada' = any (m.version_tasks));

insert into public.module_versions (module, version, status, manifest, note, published_at)
select latest.module,
       (select max(o.version) from public.module_versions o where o.module = latest.module) + 1,
       'published',
       jsonb_set(latest.manifest, '{prompts,atendimento.entrada}', to_jsonb(p.version)),
       'A entrada pelo WhatsApp pergunta primeiro o que decide o direito: lê a chegada prevista e a real, e não pede a companhia nem o número do voo (0239).',
       now()
from (
  select distinct on (v.module) v.module, v.manifest
  from public.module_versions v
  join public.product_modules m on m.key = v.module and m.retired_at is null and 'atendimento.entrada' = any (m.version_tasks)
  where v.status = 'published'
  order by v.module, v.version desc
) latest
cross join (select w.version from public.prompt_versions w where w.task = 'atendimento.entrada' and w.is_active) p
where (latest.manifest #>> '{prompts,atendimento.entrada}')::integer is distinct from p.version;

-- ---------- What the intake keeps: the arrival, whether the passenger travelled, the step after the yes ----------

/**
 * The facts of an intake as the database keeps them (replaces 0227's): also when the passenger should have arrived and
 * did (`chegada_prevista`, `chegada_real`: `AAAA-MM-DDTHH:MM` or `HH:MM`), whether they travelled after a cancellation
 * or a change (`viajou`), and the step after their "Quero seguir" (`seguir`), 0239. Internal.
 */
create or replace function public.intake_facts_clean(target_facts jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
  from (
    select key, to_jsonb(left(btrim(regexp_replace(value, '\s+', ' ', 'g')), 120)) as value
    from jsonb_each_text(case when jsonb_typeof(target_facts) = 'object' then target_facts else '{}'::jsonb end)
    where key in ('problema', 'companhia', 'voo', 'data', 'origem', 'destino', 'atraso_horas', 'chegada_prevista',
                  'chegada_real', 'viajou', 'aviso', 'nome', 'indicado_por', 'acompanhantes', 'etapa')
      and nullif(btrim(value), '') is not null
      and case key
        when 'problema' then value in ('cancellation', 'change', 'delay', 'missed_connection', 'overbooking',
                                       'baggage_lost', 'baggage_damaged', 'baggage_delayed', 'downgrade', 'other')
        when 'data' then value ~ '^\d{4}-\d{2}-\d{2}$'
        when 'atraso_horas' then value ~ '^\d{1,3}(\.\d)?$'
        when 'chegada_prevista' then btrim(value) ~ '^(\d{4}-\d{2}-\d{2}T)?\d{1,2}:\d{2}$'
        when 'chegada_real' then btrim(value) ~ '^(\d{4}-\d{2}-\d{2}T)?\d{1,2}:\d{2}$'
        when 'viajou' then value in ('sim', 'nao')
        when 'aviso' then value in ('at_airport', 'late', 'early')
        when 'origem' then upper(btrim(value)) ~ '^[A-Z]{3}$'
        when 'destino' then upper(btrim(value)) ~ '^[A-Z]{3}$'
        when 'nome' then char_length(btrim(value)) between 2 and 120 and value ~ '[[:alpha:]]'
        when 'indicado_por' then char_length(btrim(value)) between 2 and 120 and value ~ '[[:alpha:]]'
        when 'acompanhantes' then char_length(btrim(value)) between 2 and 120 and value ~ '[[:alpha:]]'
        when 'etapa' then value in ('resumo', 'corrigir', 'oferta', 'duvidas', 'recusou', 'seguir')
        else true
      end
  ) f;
$$;

revoke all on function public.intake_facts_clean(jsonb) from public, anon, authenticated;

-- ---------- The interview of the start is no longer owed ----------

-- Whether ONE opens the interview of a case's start (0095): no since 0239, a setting so it can be had again.
insert into public.platform_settings (key, value)
values ('interview', jsonb_build_object('start', false))
on conflict (key) do update set value = public.platform_settings.value || jsonb_build_object('start', false);

/**
 * Whether a case is owed the interview of its start (0181, redefined): only while the platform's setting has it
 * (`interview.start`), off since 0239. The client tells what happened in their own words after the signature, by
 * audio or text, and ONE asks what that misses one question at a time (0092, 0235); the interview a piece asks for
 * what it lacks is `interviews_to_start`'s own (0099). Internal.
 */
create or replace function public.interview_owed(target_case uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select coalesce((select (s.value ->> 'start')::boolean from public.platform_settings s where s.key = 'interview'), false)
      and c.status in ('intake', 'documents', 'signature')
      and c.incident in ('delay', 'cancellation', 'overbooking', 'missed_connection', 'downgrade', 'other')
      and not exists (select 1 from public.proceedings p where p.case_id = c.id)
      and not exists (select 1 from public.case_advances a where a.case_id = c.id and a.lawsuits_at is not null)
      and not exists (select 1 from public.case_interviews i where i.case_id = c.id)
      and public.case_account_state(c.id) <> 'ready'
      and public.case_interview_person(c.id) is not null
      and not public.case_waits_signature(c.id)
    from public.cases c where c.id = target_case
  ), false);
$$;

revoke all on function public.interview_owed(uuid) from public, anon, authenticated;

-- ---------- The client's account, asked in the chat ----------

/**
 * The client's words ONE owes a question for in the chat (replaces 0237's): who the holder of a bill is, then the
 * client's own account of what happened (`account`, 0239: a case of theirs being gathered with no account and no
 * interview, nothing waiting for their signature), then free justice and the civil court. Service role.
 */
create or replace function public.chat_questions_owed(target_limit integer default 20)
returns table (
  conversation_id uuid,
  org_id uuid,
  case_id uuid,
  kind text,
  party_id uuid,
  party_name text,
  own boolean,
  appeal boolean,
  wording text
)
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
  with talk as (
    select wc.id as conversation_id, wc.org_id, p.id as person_id, wc.last_inbound_at
    from public.wa_conversations wc
    join public.wa_numbers n on n.id = wc.number_id and n.status = 'active'
    join public.people p on p.org_id = wc.org_id and p.erased_at is null and p.phone is not null
      and wc.contact_wa_id = any (public.wa_phone_variants(p.phone))
    where wc.agent = 'one'
      and public.wa_window_open(wc.last_inbound_at)
      and coalesce(wc.chat_step ->> 'step', '') = ''
      and not public.conversation_account_waits(wc)
      and not exists (select 1 from public.wa_optouts o where o.org_id = wc.org_id and o.contact_wa_id = wc.contact_wa_id)
  ), cases_of as (
    select distinct t.conversation_id, t.org_id, t.person_id, t.last_inbound_at, c.id as case_id
    from talk t
    join public.case_parties cp on cp.person_id = t.person_id
    join public.cases c on c.id = cp.case_id and c.org_id = t.org_id and c.status not in ('closed', 'declined')
  ), owed as (
    select co.conversation_id, co.org_id, co.case_id, 'residence'::text as kind,
           (select x.id from public.case_parties x where x.case_id = d.case_id and x.person_id = d.person_id
            order by (x.role = 'claimant') desc, x.created_at, x.id limit 1) as party_id,
           true as own, false as appeal, d.holder_name as wording, -2 as rank, co.last_inbound_at
    from cases_of co
    join public.residence_declarations d on d.case_id = co.case_id and d.person_id = co.person_id
      and d.status = 'open' and d.relation is null
    where not exists (
      select 1 from public.case_papers paper
      where paper.case_id = d.case_id and paper.person_id = d.person_id and paper.kind = 'declaracao_residencia'
    )
    union all
    select co.conversation_id, co.org_id, co.case_id, 'account'::text,
           (select x.id from public.case_parties x where x.case_id = co.case_id and x.person_id = co.person_id
            order by (x.role = 'claimant') desc, x.created_at, x.id limit 1),
           true, false, null::text, -1, co.last_inbound_at
    from cases_of co
    join public.cases c on c.id = co.case_id
    where c.status in ('intake', 'documents', 'signature')
      and public.case_account_state(c.id) = 'missing'
      and not public.case_waits_signature(c.id)
      and not exists (select 1 from public.case_interviews i where i.case_id = c.id)
      and not exists (select 1 from public.proceedings pr where pr.case_id = c.id)
    union all
    select co.conversation_id, co.org_id, co.case_id, 'free_justice'::text, n.party_id,
           n.answerer_id = (select x.person_id from public.case_parties x where x.id = n.party_id),
           public.lawsuit_appeal_open(n.proceeding_id), null::text, 0,
           co.last_inbound_at
    from cases_of co
    cross join lateral public.free_justice_needs(co.case_id) n
    where n.answerer_id = co.person_id and n.answer_id is null
    union all
    select co.conversation_id, co.org_id, co.case_id, 'civil_court', n.party_id,
           n.answerer_id = (select x.person_id from public.case_parties x where x.id = n.party_id),
           false, public.civil_court_wording(n.party_id), 1, co.last_inbound_at
    from cases_of co
    cross join lateral public.civil_court_needs(co.case_id) n
    where n.answerer_id = co.person_id and n.planned and n.answer_id is null
      and public.civil_court_wording(n.party_id) is not null
  )
  select distinct on (o.conversation_id)
         o.conversation_id, o.org_id, o.case_id, o.kind, o.party_id, pp.full_name, o.own, o.appeal, o.wording
  from owed o
  join public.case_parties cp on cp.id = o.party_id
  join public.people pp on pp.id = cp.person_id
  order by o.conversation_id, o.rank, o.party_id
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;

revoke all on function public.chat_questions_owed(integer) from public, anon, authenticated;
grant execute on function public.chat_questions_owed(integer) to service_role;

/**
 * The client tells what happened in writing, in the chat (0239): what they wrote becomes their account of the case
 * ONE asked about, as one written on their link (`client_link_write_statement`), from the conversation, and ONE puts
 * it in order. The conversation's step ends. Answers `{ok, statement_id}`, or `{ok: false, code}`: `not_working`,
 * `not_asked`, `statement_length`. Service role, for the conversation the backend holds.
 */
create or replace function public.one_write_account(
  target_conversation uuid,
  target_claim integer,
  target_text text,
  target_message uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  party uuid;
  asked_case uuid;
  current_case public.cases%rowtype;
  written text := nullif(btrim(coalesce(target_text, '')), '');
  statement uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if coalesce(conversation.chat_step ->> 'step', '') <> 'account' then
    return jsonb_build_object('ok', false, 'code', 'not_asked');
  end if;
  party := nullif(conversation.chat_step ->> 'party', '')::uuid;
  asked_case := nullif(conversation.chat_step ->> 'case', '')::uuid;
  -- The party ONE asked is of the person of this conversation, in a case still being gathered.
  select c.* into current_case from public.cases c
  join public.case_parties cp on cp.case_id = c.id and cp.id = party
  join public.people p on p.id = cp.person_id and p.erased_at is null
  where c.id = asked_case and c.org_id = conversation.org_id and c.status not in ('closed', 'declined')
    and conversation.contact_wa_id = any (public.wa_phone_variants(p.phone));
  if current_case.id is null then
    update public.wa_conversations set chat_step = chat_step - 'step' - 'party' - 'case' where id = conversation.id;
    return jsonb_build_object('ok', false, 'code', 'not_asked');
  end if;
  if written is null or char_length(written) not between
       public.statements_setting('min_chars', 40) and public.statements_setting('max_chars', 20000) then
    return jsonb_build_object('ok', false, 'code', 'statement_length');
  end if;
  insert into public.case_statements (org_id, case_id, party_id, source, transcript, work)
  values (current_case.org_id, current_case.id, party, 'whatsapp', written, 'chronology')
  returning id into statement;
  perform public.record_case_event(current_case.org_id, current_case.id, 'client_statement_sent', 'client',
    jsonb_strip_nulls(jsonb_build_object('statement', statement, 'spoken', false, 'from', 'conversation',
                                         'message', target_message)));
  insert into public.wa_conversation_events (org_id, conversation_id, kind, actor_type, data)
  values (conversation.org_id, conversation.id, 'statement_joined', 'system',
          jsonb_build_object('case_id', current_case.id, 'seq', current_case.seq, 'statement_id', statement));
  perform public.wake_case_advance(current_case.id);
  return jsonb_build_object('ok', true, 'code', 'written', 'statement_id', statement);
end;
$$;

revoke all on function public.one_write_account(uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.one_write_account(uuid, integer, text, uuid) to service_role;

/**
 * The step of the account ends with it (0239): once an account of a case arrives (written in the chat, an audio, on
 * the link or by the firm), a conversation of the firm still waiting for it waits no more.
 */
create or replace function public.case_statements_end_chat_step()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.wa_conversations
  set chat_step = chat_step - 'step' - 'party' - 'case'
  where org_id = new.org_id and chat_step ->> 'step' = 'account' and chat_step ->> 'case' = new.case_id::text;
  return null;
end;
$$;

revoke all on function public.case_statements_end_chat_step() from public, anon, authenticated;

create trigger case_statements_end_chat_step
after insert on public.case_statements
for each row execute function public.case_statements_end_chat_step();
