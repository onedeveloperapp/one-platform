-- ============================================================
-- 0091_piece_reads_documents: the piece is written from what ONE already
-- knows of the case, and so is the order of the client's account.
--
-- The owner approved, on 2026-11-04, the second stage of the plan of
-- 0090: what ONE can take from another source, it takes, so the client only
-- answers what no document holds, and the lawyer only decides.
--
--   the check of a document (`caso.documento.conferencia`, fourth version)
--   reads, of a ticket, a boarding pass or the e-mail of a purchase, the
--   purchase (its day, where it was bought, what was paid, the locator), and
--   of a receipt, the expense it proves (what was paid, how much, when);
--   `case_document_readings` gives what the documents the firm accepted say
--   of them, as the check was applied (by ONE, or approved by a person: one a
--   person decided without the AI says nothing);
--   the facts of the piece (`case_draft_to_work`) carry them, and, for each
--   leg, what ANAC's record says of its flight; the instructions of
--   `caso.peca.minuta` (second version) say what each is, and to write
--   [COMPLETAR] only for what neither they nor the account answer;
--   the order of the client's account (`case_statement_to_process`) reads
--   them too, so ONE never asks the client what a document already says.
-- ============================================================

/**
 * What the documents the firm accepted say of the purchase and of each
 * expense, as their check was applied: by ONE (no answer in the queue) or
 * approved by a person (as they left it, or else as the model read it). A
 * document a person decided without the AI, or whose check was turned down,
 * says nothing. Each item names its document by its kind and the day it was
 * sent. What a reading says in words passes through `case_text_for_ai`.
 */
create or replace function public.case_document_readings(target_case uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with applied as (
    select d.id, d.kind, d.created_at,
           case when a.id is null then r.output
                else coalesce(a.final_output, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
                  'compra', case when a.final_output ? 'compra' then null else r.output -> 'compra' end,
                  'gasto', case when a.final_output ? 'gasto' then null else r.output -> 'gasto' end))
           end as said
    from public.case_documents d
    join public.ai_runs r on r.id = d.check_run_id and r.org_id = d.org_id and r.status = 'succeeded'
    left join public.approvals a on a.run_id = r.id
    where d.case_id = target_case and d.status = 'accepted'
      and (a.id is null or a.status = 'approved')
  ),
  purchases as (
    select a.id, a.kind, a.created_at,
           nullif(btrim(coalesce(a.said -> 'compra' ->> 'data', '')), '') as day,
           nullif(btrim(coalesce(a.said -> 'compra' ->> 'canal', '')), '') as channel,
           nullif(btrim(coalesce(a.said -> 'compra' ->> 'valor', '')), '') as paid,
           nullif(btrim(coalesce(a.said -> 'compra' ->> 'reserva', '')), '') as locator
    from applied a
    where jsonb_typeof(a.said -> 'compra') = 'object'
  ),
  expenses as (
    select a.id, a.kind, a.created_at,
           nullif(btrim(coalesce(a.said -> 'gasto' ->> 'descricao', '')), '') as what,
           nullif(btrim(coalesce(a.said -> 'gasto' ->> 'valor', '')), '') as paid,
           nullif(btrim(coalesce(a.said -> 'gasto' ->> 'data', '')), '') as day
    from applied a
    where jsonb_typeof(a.said -> 'gasto') = 'object'
  )
  select jsonb_build_object(
    'compras', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'data_da_compra', case when p.day ~ '^\d{4}-\d{2}-\d{2}$' then p.day end,
        'canal', left(public.case_text_for_ai(target_case, p.channel), 200),
        'valor_pago', left(p.paid, 60),
        'localizador', case when p.locator ~ '^[A-Za-z0-9]{5,8}$' then upper(p.locator) end,
        'documento', public.notice_document_words(p.kind),
        'enviado_em', to_char(p.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
      )) order by p.created_at, p.id)
      from purchases p
      where coalesce(p.day, p.channel, p.paid, p.locator) is not null
    ), '[]'::jsonb),
    'gastos', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'descricao', left(public.case_text_for_ai(target_case, e.what), 300),
        'valor', left(e.paid, 60),
        'data', case when e.day ~ '^\d{4}-\d{2}-\d{2}$' then e.day end,
        'documento', public.notice_document_words(e.kind),
        'enviado_em', to_char(e.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
      )) order by e.created_at, e.id)
      from expenses e
      where e.what is not null or e.paid is not null
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.case_document_readings(uuid) from public, anon, authenticated;

-- ---------- The fourth version of the check of a document ----------

insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'caso.documento.conferencia',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'caso.documento.conferencia'),
  v.provider, v.model, v.effort,
  replace(v.system_prompt,
    'reserva (o localizador). Para os outros documentos, uma lista vazia.',
    'reserva (o localizador). Para os outros documentos, uma lista vazia.
- compra: só para bilhete, cartão de embarque, recibo ou e-mail da compra da passagem: data (AAAA-MM-DD, o dia em que a passagem foi comprada, nunca o do voo), canal (onde foi comprada, como está escrito: o site ou o aplicativo da companhia, o nome de uma agência), valor (o total pago pela passagem, como está escrito, com a moeda, por exemplo R$ 980,00) e reserva (o localizador). O que não estiver no arquivo fica vazio; para os outros documentos, todos vazios.
- gasto: só para recibo, nota fiscal ou comprovante de um gasto (alimentação, hospedagem, transporte, outra passagem): descricao (o que foi pago, em poucas palavras), valor (o total pago, como está escrito, com a moeda) e data (AAAA-MM-DD). Para os outros documentos, todos vazios.'),
  jsonb_set(
    jsonb_set(
      jsonb_set(v.output_schema, '{required}', (v.output_schema -> 'required') || '["compra", "gasto"]'::jsonb),
      '{properties,compra}',
      '{
        "type": "object",
        "additionalProperties": false,
        "required": ["data", "canal", "valor", "reserva"],
        "properties": {
          "data": {"type": "string", "description": "AAAA-MM-DD, o dia da compra, ou vazio."},
          "canal": {"type": "string"},
          "valor": {"type": "string", "description": "Como está escrito, com a moeda, ou vazio."},
          "reserva": {"type": "string"}
        }
      }'::jsonb),
    '{properties,gasto}',
    '{
      "type": "object",
      "additionalProperties": false,
      "required": ["descricao", "valor", "data"],
      "properties": {
        "descricao": {"type": "string"},
        "valor": {"type": "string", "description": "Como está escrito, com a moeda, ou vazio."},
        "data": {"type": "string", "description": "AAAA-MM-DD, ou vazio."}
      }
    }'::jsonb),
  v.max_tokens, false,
  'Lê também a compra da passagem (dia, canal, valor, localizador) e o gasto que um recibo comprova, para a peça.'
from public.prompt_versions v
where v.task = 'caso.documento.conferencia' and v.is_active
  and strpos(v.system_prompt, 'reserva (o localizador). Para os outros documentos, uma lista vazia.') > 0
  and not (v.output_schema -> 'properties' ? 'compra');

-- In force: one version per task, so the one in force leaves before the new one comes in.
update public.prompt_versions as v set is_active = false
where v.task = 'caso.documento.conferencia' and v.is_active
  and not (v.output_schema -> 'properties' ? 'compra')
  and exists (
    select 1 from public.prompt_versions w
    where w.task = v.task and w.version > v.version and w.output_schema -> 'properties' ? 'compra'
  );
update public.prompt_versions set is_active = true
where task = 'caso.documento.conferencia'
  and version = (
    select max(w.version) from public.prompt_versions w
    where w.task = 'caso.documento.conferencia' and w.output_schema -> 'properties' ? 'compra'
  )
  and not exists (select 1 from public.prompt_versions w where w.task = 'caso.documento.conferencia' and w.is_active);

-- ---------- The second version of the instructions of the piece ----------

insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'caso.peca.minuta',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'caso.peca.minuta'),
  v.provider, v.model, v.effort,
  replace(v.system_prompt,
    'Em "relatos" está o que o cliente contou, na ordem dos fatos; "confirmado_pelo_cliente" diz se o próprio cliente já conferiu essa ordem.',
    'Em "relatos" está o que o cliente contou, na ordem dos fatos; "confirmado_pelo_cliente" diz se o próprio cliente já conferiu essa ordem. Em cada trecho, "registro_oficial" é o que a companhia informou à ANAC sobre o voo (a situação, os horários reais no horário de Brasília e, quando houver, o motivo); "compras" traz o que o bilhete, o cartão de embarque ou o e-mail da compra dizem da compra (dia, canal, valor pago, localizador); "gastos" traz cada gasto que um comprovante aceito pelo escritório mostra. São fatos do caso, cada um com o documento de onde veio: use-os, mencione o documento quando servir de prova, e escreva [COMPLETAR: o que falta] só para o que nem eles nem os relatos respondem.'),
  v.output_schema, v.max_tokens, false,
  'Lê o registro oficial do voo, a compra lida no bilhete e os gastos dos recibos aceitos.'
from public.prompt_versions v
where v.task = 'caso.peca.minuta' and v.is_active
  and strpos(v.system_prompt, 'Em "relatos" está o que o cliente contou, na ordem dos fatos; "confirmado_pelo_cliente" diz se o próprio cliente já conferiu essa ordem.') > 0
  and strpos(v.system_prompt, '"registro_oficial"') = 0;

update public.prompt_versions as v set is_active = false
where v.task = 'caso.peca.minuta' and v.is_active
  and strpos(v.system_prompt, '"registro_oficial"') = 0
  and exists (
    select 1 from public.prompt_versions w
    where w.task = v.task and w.version > v.version and strpos(w.system_prompt, '"registro_oficial"') > 0
  );
update public.prompt_versions set is_active = true
where task = 'caso.peca.minuta'
  and version = (
    select max(w.version) from public.prompt_versions w
    where w.task = 'caso.peca.minuta' and strpos(w.system_prompt, '"registro_oficial"') > 0
  )
  and not exists (select 1 from public.prompt_versions w where w.task = 'caso.peca.minuta' and w.is_active);

-- ---------- What the piece reads ----------

/**
 * What a worker is handed of a draft it holds the claim of (0029), the
 * library being the firm's and the platform's (0045); the facts carry, for
 * each leg, what ANAC's record says of its flight, and what the documents
 * the firm accepted say of the purchase and of each expense (0091).
 */
create or replace function public.case_draft_to_work(target_draft uuid, target_claim integer)
returns table (
  draft_id uuid, org_id uuid, case_id uuid, claim integer, work text, version integer, body text,
  template text, facts jsonb, library jsonb, run_key text, firm text, title text, requested_by uuid, note text,
  same jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  keyed jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into draft from public.case_drafts d
  where d.id = target_draft and d.work is not null and d.work_claimed_at is not null and d.work_claims = target_claim;
  if not found then
    return;
  end if;
  select * into lawsuit from public.proceedings where id = draft.proceeding_id;
  select * into current_case from public.cases where id = draft.case_id;

  draft_id := draft.id;
  org_id := draft.org_id;
  case_id := draft.case_id;
  claim := draft.work_claims;
  work := draft.work;
  version := draft.version;
  -- Who asked (the piece, or its rewriting), while they are still of the firm: a run is asked by a person
  -- of the firm or by nobody.
  requested_by := (
    select m.user_id from public.memberships m
    where m.org_id = draft.org_id
      and m.user_id = case when draft.work = 'revise' then draft.revision_by else draft.requested_by end
  );
  firm := (select o.name from public.organizations o where o.id = draft.org_id);
  title := draft.template_name || ', caso ' || current_case.seq
    || case lawsuit.kind when 'juizado' then ', juizado especial' else ', vara cível' end;
  body := case draft.work
    when 'issue' then draft.approved_body
    when 'check' then (select v.body from public.case_draft_versions v where v.draft_id = draft.id and v.version = draft.version)
  end;
  if draft.work = 'revise' then
    -- The list of the marks is written under the claim, with the draft held: a request given up and asked
    -- again meanwhile is another claim, and never reads under this one's list.
    select * into draft from public.case_drafts d
    where d.id = target_draft and d.work = 'revise' and d.work_claimed_at is not null and d.work_claims = target_claim
    for update;
    if not found then
      return;
    end if;
    -- A second look at the same work (its worker was cut) reads under the marks of the first.
    keyed := public.case_text_keyed(current_case.id,
      (select v.body from public.case_draft_versions v where v.draft_id = draft.id and v.version = draft.version),
      coalesce(draft.revision_keys, '{}'::jsonb));
    body := keyed ->> 'text';
    keyed := public.case_text_keyed(current_case.id, draft.revision_note, keyed -> 'keys');
    note := keyed ->> 'text';
    same := public.case_marks_same_name(current_case.id, keyed -> 'keys');
    update public.case_drafts d set revision_keys = keyed -> 'keys' where d.id = draft.id;
  end if;
  if draft.work in ('generate', 'revise') then
    if draft.work = 'generate' then
      -- The model of the firm goes as an account does: with what identifies a person taken out of it.
      template := public.case_text_for_ai(current_case.id, draft.template_body);
    end if;
    -- The runs that will never be this draft's text: the ones that failed, and the ones whose answer was no
    -- piece. Each rewriting asked for is a work of its own, with runs of its own.
    run_key := 'draft:' || draft.id::text
      || case when draft.work = 'revise' then ':r' || draft.revisions::text else '' end
      || ':' || (draft.unusable_runs + (
      select count(*) from public.ai_runs r
      where r.org_id = draft.org_id and r.task = 'caso.peca.minuta'
        and r.subject_type = 'case_draft' and r.subject_id = draft.id::text and r.status in ('failed', 'blocked')
    ))::text;
    facts := jsonb_build_object(
      'tipo_de_processo', case lawsuit.kind when 'juizado' then 'juizado especial cível' else 'vara cível, procedimento comum' end,
      'ocorrencia', current_case.incident,
      'companhia', (select a.name from public.airlines a where a.iata = current_case.airline_iata),
      'data_do_voo', current_case.flight_date,
      'causa_informada_pela_companhia', current_case.airline_stated_cause,
      'quantas_partes', (select count(*) from public.proceeding_parties pp where pp.proceeding_id = lawsuit.id),
      -- A minor as the piece itself tells one: not eighteen yet today; with no day of birth on record, one
      -- somebody answers for (`case_draft_filled`).
      'ha_menor_entre_as_partes', exists (
        select 1 from public.proceeding_parties pp
        join public.case_parties cp on cp.id = pp.party_id
        join public.people pe on pe.id = cp.person_id
        where pp.proceeding_id = lawsuit.id
          and case when pe.birth_date is null then cp.guardian_id is not null
                   else pe.birth_date > (now() at time zone 'America/Sao_Paulo')::date - interval '18 years' end
      ),
      'foro', jsonb_build_object('comarca', lawsuit.comarca, 'base', lawsuit.forum_basis,
        'motivo', public.case_text_for_ai(current_case.id, lawsuit.forum_reason)),
      'trechos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'voo', s.flight_number, 'origem', s.origin_iata, 'destino', s.destination_iata,
          'partida_prevista', s.scheduled_departure_local, 'chegada_prevista', s.scheduled_arrival_local,
          'partida_real', s.actual_departure_local, 'chegada_real', s.actual_arrival_local,
          'trecho_afetado', s.affected,
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
            where c.segment_id = s.id and c.source = 'vra' and c.status = 'found'
          )
        ) order by s.position)
        from public.flight_segments s where s.case_id = current_case.id
      ), '[]'::jsonb),
      -- What the client told, in the order of the facts the firm approved, and whether the client confirmed it.
      'relatos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'confirmado_pelo_cliente', st.chronology_status = 'confirmed',
          'cronologia', public.case_text_for_ai(current_case.id, st.chronology)
        ) order by st.created_at)
        from public.case_statements st
        where st.case_id = current_case.id and st.chronology is not null and st.chronology_status in ('approved', 'confirmed')
      ), '[]'::jsonb),
      'reclamacoes_antes_da_acao', coalesce((
        select jsonb_agg(jsonb_build_object(
          'canal', ac.channel, 'protocolo', ac.protocol, 'feita_em', ac.filed_on, 'respondida_em', ac.answered_on,
          'resultado', ac.outcome
        ) order by ac.created_at)
        from public.admin_complaints ac where ac.case_id = current_case.id
      ), '[]'::jsonb),
      -- What the documents the firm accepted say of the purchase and of each expense (0091).
      'compras', coalesce(public.case_document_readings(current_case.id) -> 'compras', '[]'::jsonb),
      'gastos', coalesce(public.case_document_readings(current_case.id) -> 'gastos', '[]'::jsonb)
    );
    -- Every source with its key: the worker puts the ones the model itself cites first and fits the rest
    -- to what one request carries (`draftLibrary`). Only the start of what may be transcribed goes.
    library := coalesce((
      select jsonb_agg(jsonb_build_object(
        'chave', s.key, 'como_citar', s.citation, 'titulo', s.title, 'trecho', left(s.quote, 1200)
      ) order by s.verified_at desc, s.id)
      from (
        -- The firm's sources and the platform's (0045); where both have a key, the firm's.
        select * from (
          select distinct on (ls.key) ls.* from public.legal_sources ls
          where (ls.org_id = draft.org_id or ls.org_id is null) and ls.status = 'verified'
          order by ls.key, (ls.org_id is null), ls.verified_at desc
        ) both_libraries
        order by both_libraries.verified_at desc, both_libraries.id limit 1000
      ) s
    ), '[]'::jsonb);
  end if;
  return next;
end;
$$;

revoke all on function public.case_draft_to_work(uuid, integer) from public, anon, authenticated;

-- ---------- What the order of the facts reads ----------

-- The order of the client's account reads what the documents say too, so ONE never asks what one already says.
drop function public.case_statement_to_process(uuid, integer);

/**
 * What the work on a statement needs, for the worker that holds the claim
 * `target_claim` (replaces the one of 0026): nothing for anybody else. The
 * chronology there was comes with what the client said is wrong in it or
 * answered to what was missing; the trip comes as the case registers it,
 * each leg with what ANAC's record says of its flight once it was read,
 * and what the documents the firm accepted say of the purchase and of each
 * expense (0091). Service role only.
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
  readings jsonb
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
    public.case_document_readings(k.id)
  from public.case_statements s
  join public.cases k on k.id = s.case_id
  left join public.files f on f.id = s.audio_file_id and f.status = 'stored'
  where s.id = target_statement and s.work is not null and s.work_claimed_at is not null
    and s.work_seq = target_claim;
end;
$$;

revoke all on function public.case_statement_to_process(uuid, integer) from public, anon, authenticated;
