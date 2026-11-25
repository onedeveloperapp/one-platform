-- ============================================================
-- 0297_account_complemented: the firm complements the client's account, and an account is read with the case's others
-- (the owner, 2026-11-25).
--
-- "No registro manual de caso, na etapa de relato, quando for identificado pendência que o relato não esclareceu,
-- adicione na notificação opção para complementar relato." Then, on the test case 19: "foi solicitado relato sobre
-- assistência dada pela companhia, mas isso já foi relatado no primeiro texto. Por que solicitou novamente?" The client
-- complements an account on their link (0090): their words join that account (`client_added`) and ONE orders it again
-- with everything. The firm had no such way, so it wrote what the client told it as new accounts; and ONE ordered each
-- account by itself, never seeing the others, so the second ("soube quando estava no aeroporto...") asked again about
-- the airline's assistance the first had told.
--
--   * `complete_case_statement`: a person of the firm complements an account with what the client told it, as the
--     client's answer on the link does, within the same rounds.
--   * `case_statement_to_process` gives the order of the facts the case's other accounts (`other_accounts`), and the
--     instructions' new version leaves out of what is missing what another account told.
--   * The tests after it: "também está pedindo que o cliente relate novamente no link que ele recebe, mesmo o advogado
--     já tendo inserido todo o relato". Each of the three accounts kept its own gaps, so the link asked what another
--     account had told. What is missing of a person's account is what none of their decided accounts tells
--     (`reconcile_account_gaps`): a point one of them lacks and another tells is missing no more, and an account with
--     nothing missing asks nothing. It runs whenever an order of the facts is decided, and once here for the cases there
--     are (the test case 19 is left with nothing missing).
-- ============================================================

-- ---------- 1. The firm complements an account ----------

/**
 * A person of the firm complements an account with what the client told the firm (0297), as the client's answer on
 * their link does (0090): joined to that account, and ONE orders it again with everything, within the setting's rounds.
 * Answers `{ok}`, or `{ok: false, code}`: `not_found`, `nothing_to_answer`, `too_many`, `statement_length`.
 */
create or replace function public.complete_case_statement(target_statement uuid, target_text text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  statement public.case_statements%rowtype;
  current_case public.cases%rowtype;
  written text := nullif(btrim(regexp_replace(coalesce(target_text, ''), '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]+', ' ', 'g')), '');
  max_rounds integer := greatest(public.statements_setting('max_rounds', 3), 0);
begin
  select * into statement from public.case_statements s where s.id = target_statement;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(statement.case_id);
  select * into statement from public.case_statements s where s.id = target_statement for update;
  if statement.chronology_status not in ('approved', 'confirmed') or statement.work is not null
     or cardinality(statement.missing_topics) = 0 then
    return jsonb_build_object('ok', false, 'code', 'nothing_to_answer');
  end if;
  if statement.rounds >= max_rounds then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;
  if written is null or char_length(written) < 2
     or char_length(written) > greatest(public.statements_setting('complement_max_chars', 4000), 2) then
    return jsonb_build_object('ok', false, 'code', 'statement_length', 'field', 'text');
  end if;
  update public.case_statements set
    client_added = left(coalesce(client_added || E'\n\n', '') || written, 20000),
    client_added_at = now(),
    rounds = rounds + 1,
    chronology_status = 'none', chronology_run_id = null,
    work = 'chronology', work_claimed_at = null, work_after = null, work_attempts = 0, work_error = null
  where id = statement.id;
  perform public.record_case_event(current_case.org_id, current_case.id, 'statement_completed', 'person',
    jsonb_build_object('statement', statement.id));
  return jsonb_build_object('ok', true, 'code', 'sent', 'statement_id', statement.id);
end;
$$;

revoke all on function public.complete_case_statement(uuid, text) from public, anon;
grant execute on function public.complete_case_statement(uuid, text) to authenticated;

-- ---------- 2. An account read with the case's others ----------

drop function public.case_statement_to_process(uuid, integer);

/**
 * What the work on a statement needs (0091, redefined): as before, and the case's other accounts, oldest first, with
 * what was added to each (0297). Service role only.
 */
create function public.case_statement_to_process(target_statement uuid, target_claim integer)
returns table (
  statement_id uuid,
  org_id uuid,
  case_id uuid,
  work text,
  claim integer,
  storage_path text,
  detected_mime text,
  sha256 text,
  bytes bigint,
  max_bytes bigint,
  transcript text,
  previous_chronology text,
  client_note text,
  incident text,
  flight_date date,
  airline text,
  returned_proposal text,
  firm_note text,
  client_added text,
  trip jsonb,
  readings jsonb,
  other_accounts jsonb
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
  select s.id, s.org_id, s.case_id, s.work, s.work_seq, f.storage_path, f.detected_mime, f.sha256, f.bytes,
    public.statements_setting('max_transcribe_bytes', 14680064)::bigint, s.transcript,
    case when s.client_note is not null or s.client_added is not null then s.chronology end, s.client_note,
    k.incident, k.flight_date, (select a.name from public.airlines a where a.iata = k.airline_iata),
    case when s.returned_note is not null then (
      select left(nullif(btrim(coalesce(r.output ->> 'cronologia', '')), ''), 20000)
      from public.ai_runs r where r.id = s.returned_run_id and r.org_id = s.org_id
    ) end,
    s.returned_note,
    s.client_added,
    coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'voo', g.flight_number,
        'origem', g.origin_iata,
        'destino', g.destination_iata,
        'partida_prevista', to_char(g.scheduled_departure_local, 'DD/MM/YYYY HH24:MI'),
        'chegada_prevista', to_char(g.scheduled_arrival_local, 'DD/MM/YYYY HH24:MI'),
        'partida_real', to_char(g.actual_departure_local, 'DD/MM/YYYY HH24:MI'),
        'chegada_real', to_char(g.actual_arrival_local, 'DD/MM/YYYY HH24:MI'),
        'trecho_afetado', g.affected,
        'registro_oficial', (
          select jsonb_strip_nulls(jsonb_build_object(
            'situacao', c.record ->> 'state',
            'partida_real_horario_de_brasilia', c.record ->> 'actualDeparture',
            'chegada_real_horario_de_brasilia', case
              when coalesce(c.record ->> 'arrivalElsewhere', 'false') = 'true' then null
              else c.record ->> 'actualArrival' end,
            'motivo_informado_pela_companhia', nullif(btrim(coalesce(c.record ->> 'justification', '')), '')
          ))
          from public.flight_checks c
          where c.segment_id = g.id and c.source = 'vra' and c.status = 'found'
        )
      )) order by g.position, g.scheduled_departure_local nulls last, g.id)
      from public.flight_segments g
      where g.case_id = k.id
    ), '[]'::jsonb),
    public.case_document_readings(k.id),
    -- The case's other accounts, oldest first, with what was added to each (0297): what one of them told is no gap
    -- of this one.
    coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'recebido_em', to_char(o.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
        'relato', left(o.transcript, 8000),
        'respostas', left(o.client_added, 4000)
      )) order by o.created_at, o.id)
      from public.case_statements o
      where o.case_id = s.case_id and o.id <> s.id and nullif(btrim(coalesce(o.transcript, '')), '') is not null
        and o.status <> 'uploading'
    ), '[]'::jsonb)
  from public.case_statements s
  join public.cases k on k.id = s.case_id
  left join public.files f on f.id = s.audio_file_id and f.status = 'stored'
  where s.id = target_statement and s.work is not null and s.work_claimed_at is not null
    and s.work_seq = target_claim;
end;
$$;

revoke all on function public.case_statement_to_process(uuid, integer) from public, anon, authenticated;

-- ---------- 3. What is missing of a person's account ----------

/**
 * What is missing of a person's account in a case is what none of their decided accounts tells (0297): a point one
 * order of the facts says is missing and another decided one of the same person tells (it is not among its missing
 * points) is missing no more; an account left with nothing missing asks nothing. Answers how many accounts changed.
 * Internal.
 */
create or replace function public.reconcile_account_gaps(target_case uuid, target_party uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  with decided as (
    select s.id, s.missing_topics
    from public.case_statements s
    where s.case_id = target_case and s.party_id is not distinct from target_party
      and s.chronology_status in ('approved', 'confirmed')
  ), still as (
    select d.id, coalesce(array(
      select t.topic
      from unnest(d.missing_topics) with ordinality as t(topic, position)
      where not exists (select 1 from decided o where o.id <> d.id and not (t.topic = any (o.missing_topics)))
      order by t.position
    ), '{}'::text[]) as topics
    from decided d
  )
  update public.case_statements s
  set missing_topics = still.topics,
      questions = case when cardinality(still.topics) = 0 then '{}'::text[] else s.questions end
  from still
  where s.id = still.id and s.missing_topics is distinct from still.topics;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.reconcile_account_gaps(uuid, uuid) from public, anon, authenticated;

/** An order of the facts decided: what is missing of that person's account is reconciled with their other accounts (0297). */
create or replace function public.case_statements_reconcile_gaps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.chronology_status in ('approved', 'confirmed')
     and (tg_op = 'INSERT' or old.chronology_status is distinct from new.chronology_status) then
    perform public.reconcile_account_gaps(new.case_id, new.party_id);
  end if;
  return null;
end;
$$;

revoke all on function public.case_statements_reconcile_gaps() from public, anon, authenticated;

create trigger case_statements_reconcile_gaps after insert or update of chronology_status on public.case_statements
  for each row execute function public.case_statements_reconcile_gaps();

-- Once, for the cases there are: each person with more than one decided account.
select public.reconcile_account_gaps(g.case_id, g.party_id)
from (
  select s.case_id, s.party_id
  from public.case_statements s
  where s.chronology_status in ('approved', 'confirmed')
  group by s.case_id, s.party_id
  having count(*) > 1
) g;

-- ---------- 4. The order of the facts reads the case's other accounts ----------

-- The order of the facts leaves out of what is missing what another account of the case told.
insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  v.task,
  (select max(w.version) + 1 from public.prompt_versions w where w.task = v.task),
  v.provider, v.model, v.effort,
  v.system_prompt || chr(10) || chr(10) ||
    $rule$Quando vierem outros relatos do mesmo caso (outros relatos do caso, já recebidos), leia-os como parte do que o cliente já contou: o que um deles já diz não falta neste relato, e não entra em faltou nem vira pergunta. A cronologia continua a deste relato, com os fatos que ele conta; um fato que só outro relato conta não entra nela.$rule$,
  v.output_schema, v.max_tokens, false,
  'Lê os outros relatos do mesmo caso: o que um deles já conta não falta neste nem é perguntado de novo (0297).'
from public.prompt_versions v
where v.task = 'caso.relato.cronologia' and v.is_active
  and strpos(v.system_prompt, 'outros relatos do caso, já recebidos') = 0;

update public.prompt_versions as v set is_active = false
where v.task = 'caso.relato.cronologia' and v.is_active
  and strpos(v.system_prompt, 'outros relatos do caso, já recebidos') = 0
  and exists (
    select 1 from public.prompt_versions w
    where w.task = v.task and w.version > v.version and strpos(w.system_prompt, 'outros relatos do caso, já recebidos') > 0
  );
update public.prompt_versions as v set is_active = true
where v.task = 'caso.relato.cronologia'
  and v.version = (select max(w.version) from public.prompt_versions w where w.task = v.task)
  and strpos(v.system_prompt, 'outros relatos do caso, já recebidos') > 0;
