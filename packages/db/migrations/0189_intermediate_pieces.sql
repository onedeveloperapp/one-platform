-- ============================================================
-- The intermediate pieces (0189), items 4.2 and 4.3 of the case journey
-- plan. ONE's piece was the initial alone, one per lawsuit: a lawsuit the
-- court has now has pieces of its own, each of its kind (a manifestation,
-- the joining of a document, the réplica, contrarrazões, embargos, the
-- appeal, the cumprimento, the levantamento, the complementação of a
-- deposit), written through the very drafts of 0029 (the AI's first text,
-- the editor, the gate of the library, the approval as the text a lawyer
-- read), from the platform's model of the kind (`piece_kinds.model`,
-- provisional, for the curator), never made the case's petition.
--
-- What asks for one: a person, on the case; or ONE where the firm lets it
-- start pieces (`start_piece`, 0039): what a publication asks (0186: the
-- action the AI read), and what a condemnation's computation says comes
-- next (0184: the levantamento, the complementação, the cumprimento). Each
-- comes to the lawyer with ONE's recommendation to file it or not, and why,
-- read from what asked it; the lawyer decides (`decide_intermediate_piece`,
-- with the second factor), and ONE follows: a piece held is given up with
-- the next steps as the lawyer wrote them; one to file goes through the
-- court's own channel with the lawsuit's number (the MNI, as 0101 files an
-- initial), where the court gives it to ONE and takes the files unsigned,
-- or for a test case through the test court; otherwise the lawyer files it
-- in the court's system and says so (`record_piece_filed`). A court's
-- channel says whether it asks a fixed address (`fixed_ip`): where it does
-- and the platform has none yet, ONE files nothing there.
--
-- The réplica (4.3) waits for the defence: the firm sends the airline's
-- contestação as a document of the case (kind `defense`), which the AI
-- reads beside the publication, answering each point; until it arrives the
-- piece says it waits for it.
-- ============================================================

-- ---------- The kinds of piece, as data ----------

create table public.piece_kinds (
  slug text primary key,
  name text not null,
  position integer not null,
  -- The actions a publication asks (0186) that this piece answers.
  from_actions text[] not null default '{}',
  -- The step a condemnation's computation says comes next (0184) that this piece is.
  from_amount_step text,
  -- The acts of the list (0034) whose deadline the piece answers, by kind of lawsuit.
  act_juizado text references public.deadline_acts (slug) on delete set null,
  act_comum text references public.deadline_acts (slug) on delete set null,
  -- What the AI is told the piece is, and the platform's model it starts from (provisional, for the curator).
  instructions text not null,
  model text not null,
  constraint piece_kinds_slug_check check (slug ~ '^[a-z][a-z_]{2,40}$' and slug <> 'inicial'),
  constraint piece_kinds_step_check check (from_amount_step is null or from_amount_step in ('levantamento', 'complementacao', 'cumprimento')),
  constraint piece_kinds_model_check check (char_length(model) between 20 and 20000)
);

alter table public.piece_kinds enable row level security;
create policy "piece_kinds_select_all" on public.piece_kinds for select to authenticated using (true);
grant select on table public.piece_kinds to authenticated;

insert into public.piece_kinds (slug, name, position, from_actions, from_amount_step, act_juizado, act_comum, instructions, model) values
  ('manifestacao', 'Manifestação', 10, array['manifestacao', 'prazo'], null, 'manifestacao', 'manifestacao',
   'Uma manifestação nos autos, respondendo ao que a publicação pede, em poucos parágrafos.',
   $m$[[JUIZO]]

Processo nº [COMPLETAR: número do processo]

[[NOMES_DAS_PARTES]], já qualificados nos autos da ação que movem contra [[RE]], vêm, por seus advogados, manifestar-se nos seguintes termos.

[COMPLETAR: a resposta ao que a publicação pede, ponto por ponto]

Nestes termos, pedem deferimento.

[[ADVOGADOS]]$m$),
  ('juntada_documento', 'Petição de juntada de documento', 20, array['juntar_documento'], null, 'manifestacao_documentos', 'manifestacao_documentos',
   'Uma petição curta que junta aos autos o documento que a publicação pede, dizendo qual é e para que serve.',
   $m$[[JUIZO]]

Processo nº [COMPLETAR: número do processo]

[[NOMES_DAS_PARTES]], já qualificados nos autos da ação que movem contra [[RE]], vêm, por seus advogados, requerer a juntada do documento anexo.

[COMPLETAR: qual é o documento e o que ele comprova, em atenção ao que a publicação pediu]

Nestes termos, pedem deferimento.

[[ADVOGADOS]]$m$),
  ('replica', 'Réplica', 30, array['replica'], null, 'replica', 'replica',
   'A réplica à contestação da companhia: responda a cada ponto da contestação anexa, na ordem em que ela os traz, com os fatos do caso e as fontes da biblioteca.',
   $m$[[JUIZO]]

Processo nº [COMPLETAR: número do processo]

[[NOMES_DAS_PARTES]], já qualificados nos autos da ação que movem contra [[RE]], vêm, por seus advogados, apresentar

RÉPLICA À CONTESTAÇÃO

[COMPLETAR: a resposta a cada ponto da contestação, na ordem em que ela os traz]

Diante do exposto, reiteram os pedidos da petição inicial.

Nestes termos, pedem deferimento.

[[ADVOGADOS]]$m$),
  ('contrarrazoes', 'Contrarrazões', 40, array['contrarrazoes'], null, 'contrarrazoes_recurso_inominado', 'contrarrazoes_apelacao',
   'As contrarrazões ao recurso da companhia: defenda a sentença ponto por ponto do recurso, com os fatos do caso e as fontes da biblioteca.',
   $m$[[JUIZO]]

Processo nº [COMPLETAR: número do processo]

[[NOMES_DAS_PARTES]], já qualificados nos autos da ação que movem contra [[RE]], vêm, por seus advogados, apresentar

CONTRARRAZÕES AO RECURSO

[COMPLETAR: a defesa da sentença, respondendo a cada ponto do recurso]

Diante do exposto, pedem que o recurso não seja provido e que a sentença seja mantida.

Nestes termos, pedem deferimento.

[[ADVOGADOS]]$m$),
  ('embargos', 'Embargos de declaração', 50, array['embargos'], null, 'embargos_declaracao', 'embargos_declaracao',
   'Embargos de declaração: aponte só a omissão, a contradição, a obscuridade ou o erro material da decisão, dizendo onde está e como deve ser sanado.',
   $m$[[JUIZO]]

Processo nº [COMPLETAR: número do processo]

[[NOMES_DAS_PARTES]], já qualificados nos autos da ação que movem contra [[RE]], vêm, por seus advogados, opor

EMBARGOS DE DECLARAÇÃO

[COMPLETAR: a omissão, a contradição, a obscuridade ou o erro material da decisão, e como deve ser sanado]

Diante do exposto, pedem que os embargos sejam acolhidos.

Nestes termos, pedem deferimento.

[[ADVOGADOS]]$m$),
  ('recurso', 'Recurso', 60, array['recurso'], null, 'recurso_inominado', 'apelacao',
   'O recurso contra a sentença (recurso inominado no juizado, apelação na vara cível): os pontos em que a sentença deve ser reformada, com os fatos do caso e as fontes da biblioteca.',
   $m$[[JUIZO]]

Processo nº [COMPLETAR: número do processo]

[[NOMES_DAS_PARTES]], já qualificados nos autos da ação que movem contra [[RE]], vêm, por seus advogados, interpor

RECURSO

[COMPLETAR: os pontos em que a sentença deve ser reformada e por quê]

Diante do exposto, pedem que o recurso seja recebido e provido.

Nestes termos, pedem deferimento.

[[ADVOGADOS]]$m$),
  ('cumprimento', 'Cumprimento de sentença', 70, array['cumprimento'], 'cumprimento', null, null,
   'O pedido de cumprimento de sentença: a companhia não pagou no prazo; peça a intimação para pagar o valor do cálculo anexo, com a multa e os honorários da lei, e a penhora se não pagar.',
   $m$[[JUIZO]]

Processo nº [COMPLETAR: número do processo]

[[NOMES_DAS_PARTES]], já qualificados nos autos da ação que movem contra [[RE]], vêm, por seus advogados, requerer o

CUMPRIMENTO DE SENTENÇA

[COMPLETAR: o trânsito em julgado, o valor da condenação atualizado como no cálculo, e o pedido de intimação para pagar]

Nestes termos, pedem deferimento.

[[ADVOGADOS]]$m$),
  ('levantamento', 'Pedido de levantamento', 80, array['levantamento'], 'levantamento', null, null,
   'O pedido de levantamento do depósito feito pela companhia: peça a expedição do alvará ou a transferência do valor depositado.',
   $m$[[JUIZO]]

Processo nº [COMPLETAR: número do processo]

[[NOMES_DAS_PARTES]], já qualificados nos autos da ação que movem contra [[RE]], vêm, por seus advogados, requerer o levantamento do valor depositado.

[COMPLETAR: o depósito feito, o seu valor, e o pedido de expedição do alvará ou de transferência]

Nestes termos, pedem deferimento.

[[ADVOGADOS]]$m$),
  ('complementacao', 'Pedido de complementação do depósito', 90, array[]::text[], 'complementacao', null, null,
   'O pedido de complementação: o depósito da companhia ficou abaixo do valor atualizado da condenação; peça o levantamento do que foi depositado e a intimação para depositar a diferença do cálculo anexo.',
   $m$[[JUIZO]]

Processo nº [COMPLETAR: número do processo]

[[NOMES_DAS_PARTES]], já qualificados nos autos da ação que movem contra [[RE]], vêm, por seus advogados, requerer o levantamento do valor depositado e a complementação do depósito.

[COMPLETAR: o valor depositado, o valor atualizado da condenação como no cálculo, a diferença, e os pedidos]

Nestes termos, pedem deferimento.

[[ADVOGADOS]]$m$)
on conflict (slug) do nothing;

-- ---------- What a document of a case may be ----------

alter table public.case_documents drop constraint case_documents_kind_check;
alter table public.case_documents add constraint case_documents_kind_check check (kind in (
  'identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'power_of_attorney',
  'residence_declaration', 'free_justice_declaration', 'income_proof', 'contract', 'petition', 'baggage_report',
  'defense', 'intermediate_petition', 'other'
));

-- The types a court's system names for each kind of file take the two new kinds too (0177's check, redefined).
create or replace function public.filing_types_ok(types jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(types) = 'object'
    and coalesce((
      select bool_and(
        key in ('petition', 'power_of_attorney', 'identity', 'address_proof', 'residence_declaration',
                'free_justice_declaration', 'income_proof', 'ticket', 'boarding_pass', 'baggage_report', 'receipt',
                'evidence', 'contract', 'defense', 'intermediate_petition', 'other')
        and jsonb_typeof(value) = 'string'
        and char_length(value #>> '{}') between 2 and 80
        and value #>> '{}' = btrim(value #>> '{}')
      )
      from jsonb_each(types)
    ), true);
$$;

revoke all on function public.filing_types_ok(jsonb) from public, anon, authenticated;

-- ---------- The pieces of a lawsuit the court has ----------

alter table public.case_drafts
  add column piece_kind text not null default 'inicial',
  add column publication_id uuid references public.publications (id) on delete set null,
  -- What asked for it, once: `publication:<id>`, `amount:<step>`, or a person (none).
  add column source_key text,
  add column recommendation text,
  add column recommendation_reason text,
  -- What it waits for before the AI writes it: the airline's defence, for a réplica.
  add column waits_for text,
  add column decision text,
  add column decision_reason text,
  add column decided_by uuid references public.profiles (id) on delete set null,
  add column decided_at timestamptz,
  -- Its filing: by ONE through the court's channel, or by a lawyer in the court's system.
  add column filing_status text,
  add column filing_claims integer not null default 0,
  add column filing_claimed_at timestamptz,
  add column filing_attempts integer not null default 0,
  add column filing_after timestamptz,
  add column filing_error text,
  add column filing_message text,
  add column filed_at timestamptz,
  add column filed_by uuid references public.profiles (id) on delete set null,
  add column filed_how text,
  add column filed_protocol text,
  add column receipt_file_id uuid references public.files (id) on delete set null,
  add constraint case_drafts_piece_kind_check check (piece_kind = 'inicial' or piece_kind ~ '^[a-z][a-z_]{2,40}$'),
  add constraint case_drafts_recommendation_check check (
    recommendation is null or (piece_kind <> 'inicial' and recommendation in ('file', 'hold'))
  ),
  add constraint case_drafts_waits_check check (waits_for is null or (piece_kind = 'replica' and waits_for = 'defense')),
  add constraint case_drafts_decision_check check (
    (decision is null) = (decided_at is null) and (decision is null or (piece_kind <> 'inicial' and decision in ('file', 'hold')))
    and (decision_reason is null or char_length(decision_reason) between 3 and 1000)
  ),
  add constraint case_drafts_filing_check check (
    filing_status is null or (piece_kind <> 'inicial' and filing_status in ('owed', 'sent', 'filed', 'refused', 'failed', 'unknown'))
  ),
  add constraint case_drafts_filed_check check (
    (filed_at is null) = (filed_how is null) and (filed_how is null or filed_how in ('one', 'lawyer'))
    and (filed_protocol is null or char_length(filed_protocol) between 1 and 120)
  ),
  add constraint case_drafts_filing_text_check check (
    (filing_error is null or filing_error ~ '^[a-z][a-z0-9_]{1,59}$')
    and (filing_message is null or char_length(filing_message) <= 1000)
    and (recommendation_reason is null or char_length(recommendation_reason) <= 1000)
  );

-- What a member reads of a piece of a lawsuit (0029 grants its columns one by one).
grant select (
  piece_kind, publication_id, source_key, recommendation, recommendation_reason, waits_for, decision, decision_reason,
  decided_by, decided_at, filing_status, filing_claims, filing_claimed_at, filing_attempts, filing_after, filing_error,
  filing_message, filed_at, filed_by, filed_how, filed_protocol, receipt_file_id
) on table public.case_drafts to authenticated;

-- One draft in course per lawsuit and kind of piece (the initial's rule of 0029, for each kind).
drop index public.case_drafts_in_course_idx;
create unique index case_drafts_in_course_idx on public.case_drafts (proceeding_id, piece_kind)
  where status in ('generating', 'proposed', 'approved');
-- What asked for a piece asks for it once.
create unique index case_drafts_source_idx on public.case_drafts (proceeding_id, piece_kind, source_key)
  where source_key is not null;
create index case_drafts_filing_idx on public.case_drafts (filing_after nulls first, decided_at)
  where filing_status = 'owed';

-- A court's channel says whether it asks a fixed address the calls come from.
alter table public.court_filing_channels add column fixed_ip boolean not null default false;

update public.platform_settings
set value = value || jsonb_build_object('pieces_days', 30, 'piece_filing_attempts', 3, 'egress_fixed_ip', false)
where key = 'filing_submit' and not value ? 'pieces_days';

/**
 * The recommendation ONE gives a piece from what asked for it (0189): a publication's action the AI read (0186), or a
 * condemnation's next step (0184). `file` with why, or `hold` with the next steps; a person's own request, `file`.
 */
create or replace function public.piece_recommendation(target_kind text, target_publication uuid, target_step text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  kind public.piece_kinds%rowtype;
  action public.publication_actions%rowtype;
begin
  select * into kind from public.piece_kinds where slug = target_kind;
  if target_publication is not null then
    select * into action from public.publication_actions where publication_id = target_publication;
    if found and action.status = 'done' then
      if action.action = any (kind.from_actions) then
        return jsonb_build_object('recommendation', 'file', 'reason', coalesce(action.reason, action.firm_summary));
      end if;
      if action.action = 'nada' then
        return jsonb_build_object('recommendation', 'hold',
          'reason', coalesce(action.reason, 'A publicação não pede nada do escritório.'));
      end if;
      return jsonb_build_object('recommendation', 'hold',
        'reason', 'O ONE leu nesta publicação outro pedido: ' || coalesce(action.firm_summary, action.action) || '.');
    end if;
  end if;
  if target_step is not null and target_step = kind.from_amount_step then
    return jsonb_build_object('recommendation', 'file', 'reason', case target_step
      when 'levantamento' then 'O depósito da companhia cobre o valor atualizado da condenação.'
      when 'complementacao' then 'O depósito da companhia ficou abaixo do valor atualizado da condenação.'
      else 'A companhia não pagou no prazo depois do trânsito em julgado.' end);
  end if;
  return jsonb_build_object('recommendation', 'file', 'reason', null);
end;
$$;

revoke all on function public.piece_recommendation(text, uuid, text) from public, anon, authenticated;

/**
 * A piece of a lawsuit the court has (0189): asked by a person of the firm who works on the case, or by ONE for the
 * case its own function names. One in course per lawsuit and kind (one being written or failed is replaced, as an
 * initial is); what asked for it asks once. A réplica waits for the defence until the firm sends it.
 */
create or replace function public.request_intermediate_piece(
  target_proceeding uuid,
  target_kind text,
  target_publication uuid default null,
  target_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  kind public.piece_kinds%rowtype;
  publication public.publications%rowtype;
  step text;
  advice jsonb;
  waits text;
  replaced uuid;
  draft uuid;
  source text := nullif(btrim(coalesce(target_source, '')), '');
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'proceeding_not_found');
  end if;
  current_case := public.case_for_writer(lawsuit.case_id);
  select * into lawsuit from public.proceedings where id = target_proceeding for update;
  if lawsuit.status <> 'filed' or lawsuit.cnj is null then
    return jsonb_build_object('ok', false, 'code', 'not_filed');
  end if;
  if current_case.status in ('closed', 'declined') then
    return jsonb_build_object('ok', false, 'code', 'case_closed');
  end if;
  select * into kind from public.piece_kinds where slug = target_kind;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'kind');
  end if;
  if target_publication is not null then
    select * into publication from public.publications
    where id = target_publication and org_id = current_case.org_id and proceeding_id = lawsuit.id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'publication_not_found');
    end if;
  end if;
  if source is not null and source !~ '^(publication|amount):[a-z0-9_-]{3,80}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'source');
  end if;
  if source is not null and exists (
    select 1 from public.case_drafts d
    where d.proceeding_id = lawsuit.id and d.piece_kind = kind.slug and d.source_key = source
  ) then
    return jsonb_build_object('ok', true, 'code', 'already');
  end if;
  if exists (select 1 from public.case_drafts d
             where d.proceeding_id = lawsuit.id and d.piece_kind = kind.slug and d.status in ('proposed', 'approved')) then
    return jsonb_build_object('ok', false, 'code', 'draft_in_course');
  end if;
  for replaced in
    select d.id from public.case_drafts d
    where d.proceeding_id = lawsuit.id and d.piece_kind = kind.slug and d.status in ('generating', 'failed')
  loop
    perform public.withdraw_draft_approvals(replaced, 'A peça foi substituída por outra.');
    update public.case_drafts set status = 'cancelled', work = null, work_claimed_at = null, waits_for = null
    where id = replaced and status in ('generating', 'failed');
  end loop;

  step := case when source like 'amount:%' then split_part(source, ':', 2) end;
  advice := public.piece_recommendation(kind.slug, target_publication, step);
  waits := case when kind.slug = 'replica' and not exists (
    select 1 from public.case_documents cd where cd.case_id = current_case.id and cd.kind = 'defense' and cd.status <> 'rejected'
  ) then 'defense' end;

  insert into public.case_drafts (
    org_id, case_id, proceeding_id, template_id, template_name, template_body, mode, status, work, version, requested_by,
    requested_auto, piece_kind, publication_id, source_key, recommendation, recommendation_reason, waits_for
  ) values (
    current_case.org_id, current_case.id, lawsuit.id, null, kind.name, kind.model, 'ai', 'generating',
    case when waits is null then 'generate' end, 0, auth.uid(), public.case_system_writer(current_case.id),
    kind.slug, target_publication, source, advice ->> 'recommendation', left(advice ->> 'reason', 1000), waits
  )
  returning id into draft;
  perform public.record_case_event(current_case.org_id, current_case.id, 'piece_requested', public.case_actor(current_case.id),
    jsonb_build_object('draft', draft, 'proceeding', lawsuit.id, 'kind', kind.slug));
  return jsonb_build_object('ok', true, 'code', 'requested', 'draft_id', draft, 'waits_for', waits);
end;
$$;

revoke all on function public.request_intermediate_piece(uuid, text, uuid, text) from public, anon;
grant execute on function public.request_intermediate_piece(uuid, text, uuid, text) to authenticated, service_role;

/**
 * The firm sends the airline's defence (0189): a file a person of the firm uploaded joins the case as its defence,
 * accepted (it is the firm's own copy of what the court shows), and the réplica that waited for it is written.
 */
create or replace function public.attach_case_defense(target_case uuid, target_file uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  document uuid;
begin
  if not exists (
    select 1 from public.files f
    where f.id = target_file and f.org_id = current_case.org_id and f.status = 'stored' and f.purpose = 'upload'
  ) then
    return jsonb_build_object('ok', false, 'code', 'file_not_found');
  end if;
  if exists (select 1 from public.case_documents d where d.file_id = target_file) then
    return jsonb_build_object('ok', false, 'code', 'already_attached');
  end if;
  insert into public.case_documents (org_id, case_id, file_id, kind, source, status, decided_by, decided_at)
  values (current_case.org_id, current_case.id, target_file, 'defense', 'firm', 'accepted', auth.uid(), now())
  returning id into document;
  perform public.record_case_event(current_case.org_id, current_case.id, 'document_added', 'person',
    jsonb_build_object('document', document, 'kind', 'defense', 'source', 'firm'));
  return jsonb_build_object('ok', true, 'code', 'attached', 'document_id', document);
end;
$$;

revoke all on function public.attach_case_defense(uuid, uuid) from public, anon;
grant execute on function public.attach_case_defense(uuid, uuid) to authenticated;

/** The defence the firm sent (not refused) lets the réplica that waited for it be written (0189). */
create or replace function public.case_documents_wake_replica()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'defense' and new.status <> 'rejected' then
    update public.case_drafts
    set waits_for = null, work = 'generate', work_after = null
    where case_id = new.case_id and piece_kind = 'replica' and waits_for = 'defense' and status = 'generating';
  end if;
  return new;
end;
$$;

revoke all on function public.case_documents_wake_replica() from public, anon, authenticated;

create trigger case_documents_wake_replica after insert or update of status, kind on public.case_documents
  for each row execute function public.case_documents_wake_replica();

/**
 * What the AI is handed of an intermediate piece besides the case's facts (0189, service role, for the draft the
 * backend holds): the kind and what it is, the lawsuit, the publication that asked for it (the court's text), the
 * judgment and the computation of the amount due, and the defence's file for a réplica.
 */
create or replace function public.intermediate_piece_facts(target_draft uuid, target_claim integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  lawsuit public.proceedings%rowtype;
  kind public.piece_kinds%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into draft from public.case_drafts
  where id = target_draft and work_claimed_at is not null and work_claims = target_claim;
  if not found or draft.piece_kind = 'inicial' then
    return null;
  end if;
  select * into lawsuit from public.proceedings where id = draft.proceeding_id;
  select * into kind from public.piece_kinds where slug = draft.piece_kind;
  return jsonb_build_object(
    'tipo', kind.slug, 'nome', kind.name, 'instrucoes', kind.instructions,
    'processo', lawsuit.cnj, 'tribunal', lawsuit.court, 'unidade', lawsuit.unit, 'tipo_de_processo', lawsuit.kind,
    'publicacao', (select jsonb_build_object('dia', p.available_on, 'tipo', p.kind, 'texto', left(p.body, 20000))
                   from public.publications p where p.id = draft.publication_id),
    'fatos_do_processo', coalesce((
      select jsonb_agg(jsonb_build_object('fato', f.kind, 'resultado', f.result, 'valor_em_centavos', f.cents,
                                          'dia', f.happened_on, 'palavras', f.words) order by f.happened_on)
      from public.lawsuit_facts f where f.proceeding_id = lawsuit.id and f.corrected_at is null
    ), '[]'::jsonb),
    'valores', (select to_jsonb(a) - 'org_id' - 'case_id' from public.lawsuit_amounts a where a.proceeding_id = lawsuit.id),
    'contestacao', (
      select jsonb_build_object('file_id', f.id, 'storage_path', f.storage_path)
      from public.case_documents cd join public.files f on f.id = cd.file_id
      where cd.case_id = draft.case_id and cd.kind = 'defense' and cd.status <> 'rejected'
      order by cd.created_at desc limit 1
    )
  );
end;
$$;

revoke all on function public.intermediate_piece_facts(uuid, integer) from public, anon, authenticated;
grant execute on function public.intermediate_piece_facts(uuid, integer) to service_role;

/**
 * The approved text of an intermediate piece kept as its document (0189, service role, for the draft's claim): a
 * document of the case of its own kind, never the case's petition; then owed its filing where the lawyer decided it.
 */
create or replace function public.record_piece_issued(target_draft uuid, target_claim integer, target_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  file public.files%rowtype;
  kept jsonb;
  document uuid;
  payload jsonb := coalesce(target_payload, '{}'::jsonb);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into draft from public.case_drafts where id = target_draft for update;
  if not found or draft.piece_kind = 'inicial' or draft.work is distinct from 'issue' or draft.status <> 'approved'
     or draft.work_claimed_at is null or draft.work_claims is distinct from target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if coalesce(payload ->> 'file_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(payload ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(payload ->> 'bytes', '') !~ '^[0-9]{1,12}$'
     or coalesce(payload ->> 'pages', '1') !~ '^[0-9]{1,6}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  select * into file from public.files f
  where f.id = (payload ->> 'file_id')::uuid and f.org_id = draft.org_id and f.purpose = 'petition' for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'file_not_found');
  end if;
  kept := public.confirm_file(file.id, payload ->> 'sha256', (payload ->> 'bytes')::bigint, 'application/pdf',
    (payload ->> 'pages')::integer);
  if not coalesce((kept ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', 'file_refused');
  end if;
  insert into public.case_documents (org_id, case_id, file_id, kind, source, status, decided_by, decided_at)
  values (draft.org_id, draft.case_id, file.id, 'intermediate_petition', 'firm', 'accepted', draft.approved_by, now())
  returning id into document;
  update public.case_drafts
  set status = 'issued', document_id = document,
      work = null, work_claimed_at = null, work_attempts = 0, work_after = null, work_error = null,
      filing_status = case when decision = 'file' then 'owed' else filing_status end
  where id = draft.id;
  perform public.record_case_event(draft.org_id, draft.case_id, 'piece_issued', 'system',
    jsonb_build_object('draft', draft.id, 'document', document, 'kind', draft.piece_kind));
  return jsonb_build_object('ok', true, 'code', 'issued', 'document_id', document);
end;
$$;

revoke all on function public.record_piece_issued(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.record_piece_issued(uuid, integer, jsonb) to service_role;

/**
 * A lawyer decides an intermediate piece with ONE's recommendation in front of them (0189): file it, or hold it with
 * the next steps. A partner or a lawyer, with the second factor, never a support visit, on the record. A piece held
 * is given up; one to file is owed its filing once its text is a document.
 */
create or replace function public.decide_intermediate_piece(target_draft uuid, target_decision text, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into draft from public.case_drafts where id = target_draft;
  if not found or draft.piece_kind = 'inicial' or not public.is_org_member(draft.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  perform public.case_for_writer(draft.case_id);
  if not public.has_firm_function(draft.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not public.is_aal2() then
    return jsonb_build_object('ok', false, 'code', 'second_factor');
  end if;
  if target_decision not in ('file', 'hold') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'decision');
  end if;
  if target_decision = 'hold' and (reason is null or char_length(reason) < 3) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'reason');
  end if;
  if reason is not null and char_length(reason) > 1000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'reason');
  end if;
  select * into draft from public.case_drafts where id = target_draft for update;
  if draft.status in ('rejected', 'cancelled', 'failed') or draft.filed_at is not null
     or draft.filing_status in ('sent', 'filed', 'unknown') then
    return jsonb_build_object('ok', false, 'code', 'not_open');
  end if;
  if target_decision = 'hold' and draft.status <> 'issued' then
    perform public.withdraw_draft_approvals(draft.id, 'O advogado decidiu não protocolar esta peça.');
  end if;
  update public.case_drafts set
    decision = target_decision, decision_reason = reason, decided_by = auth.uid(), decided_at = now(),
    status = case when target_decision = 'hold' and status <> 'issued' then 'cancelled' else status end,
    work = case when target_decision = 'hold' and status <> 'issued' then null else work end,
    work_claimed_at = case when target_decision = 'hold' and status <> 'issued' then null else work_claimed_at end,
    waits_for = case when target_decision = 'hold' then null else waits_for end,
    filing_status = case when target_decision = 'file' and status = 'issued' then 'owed'
                         when target_decision = 'hold' then null else filing_status end,
    filing_after = null, filing_attempts = 0, filing_error = null
  where id = draft.id;
  perform public.record_case_event(draft.org_id, draft.case_id, 'piece_decided', 'person',
    jsonb_build_object('draft', draft.id, 'kind', draft.piece_kind, 'decision', target_decision));
  return jsonb_build_object('ok', true, 'code', 'decided', 'decision', target_decision);
end;
$$;

revoke all on function public.decide_intermediate_piece(uuid, text, text) from public, anon;
grant execute on function public.decide_intermediate_piece(uuid, text, text) to authenticated;

/**
 * What keeps ONE from filing an intermediate piece itself (0189), or null: the court's channel, its fixed address,
 * its code of the document, and a court that takes files signed. A test case is filed in the test court.
 */
create or replace function public.piece_filing_blocker(target_draft uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  lawsuit public.proceedings%rowtype;
  channel public.court_filing_channels%rowtype;
begin
  select * into draft from public.case_drafts where id = target_draft;
  if not found or draft.piece_kind = 'inicial' then
    return 'not_found';
  end if;
  if draft.status <> 'issued' or draft.document_id is null then
    return 'not_issued';
  end if;
  if draft.decision is distinct from 'file' then
    return 'not_decided';
  end if;
  if exists (select 1 from public.cases c where c.id = draft.case_id and c.is_test) then
    return null;
  end if;
  select * into lawsuit from public.proceedings where id = draft.proceeding_id;
  select * into channel from public.court_filing_channels ch
  where ch.court = lawsuit.court and ch.system = lawsuit.system;
  if not found or not channel.enabled then
    return 'no_channel';
  end if;
  if channel.fixed_ip and not coalesce((
    select (s.value ->> 'egress_fixed_ip')::boolean from public.platform_settings s where s.key = 'filing_submit'
  ), false) then
    return 'fixed_ip';
  end if;
  if coalesce(channel.codes #>> '{document_types,intermediate_petition}', '') !~ '^[0-9]+$' then
    return 'code_missing';
  end if;
  if exists (select 1 from public.court_systems cs
             where cs.court = lawsuit.court and cs.system = lawsuit.system and cs.signed_files is not null) then
    return 'signature_needed';
  end if;
  return null;
end;
$$;

revoke all on function public.piece_filing_blocker(uuid) from public, anon, authenticated;

/** The pieces ONE owes the court now (service role), each under a numbered claim. */
create or replace function public.claim_piece_filings(target_limit integer default 5)
returns table (draft_id uuid, claim integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  -- A claim that never came back (a worker cut) is given back after ten minutes.
  update public.case_drafts set filing_claimed_at = null
  where filing_status = 'owed' and filing_claimed_at < now() - interval '10 minutes';
  return query
  with chosen as (
    select d.id from public.case_drafts d
    where d.filing_status = 'owed' and d.filing_claimed_at is null
      and (d.filing_after is null or d.filing_after <= now())
      and public.piece_filing_blocker(d.id) is null
    order by d.filing_after nulls first, d.decided_at
    limit greatest(least(coalesce(target_limit, 5), 20), 1)
    for update skip locked
  )
  update public.case_drafts d
  set filing_claimed_at = now(), filing_claims = d.filing_claims + 1, filing_attempts = d.filing_attempts + 1
  from chosen where d.id = chosen.id
  returning d.id, d.filing_claims;
end;
$$;

revoke all on function public.claim_piece_filings(integer) from public, anon, authenticated;
grant execute on function public.claim_piece_filings(integer) to service_role;

/** What the backend sends of a claimed piece (service role): the lawsuit's number, the file and the court's codes. */
create or replace function public.piece_filing_to_send(target_draft uuid, target_claim integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  lawsuit public.proceedings%rowtype;
  test boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into draft from public.case_drafts
  where id = target_draft and filing_status = 'owed' and filing_claimed_at is not null and filing_claims = target_claim;
  if not found then
    return null;
  end if;
  select * into lawsuit from public.proceedings where id = draft.proceeding_id;
  test := exists (select 1 from public.cases c where c.id = draft.case_id and c.is_test);
  return jsonb_build_object(
    'org_id', draft.org_id, 'case_id', draft.case_id, 'cnj', lawsuit.cnj, 'court', lawsuit.court, 'test', test,
    'kind_name', (select k.name from public.piece_kinds k where k.slug = draft.piece_kind),
    'endpoint', (select ch.endpoint from public.court_filing_channels ch where ch.court = lawsuit.court and ch.system = lawsuit.system),
    'type_code', case when test then '57' else (
      select ch.codes #>> '{document_types,intermediate_petition}' from public.court_filing_channels ch
      where ch.court = lawsuit.court and ch.system = lawsuit.system) end,
    'storage_path', (select f.storage_path from public.case_documents cd join public.files f on f.id = cd.file_id
                     where cd.id = draft.document_id)
  );
end;
$$;

revoke all on function public.piece_filing_to_send(uuid, integer) from public, anon, authenticated;
grant execute on function public.piece_filing_to_send(uuid, integer) to service_role;

/**
 * What sending a piece came to (service role, for its claim): filed with the court's protocol (and its receipt kept,
 * a file of `filing_receipt` the backend stored), refused with the court's words, unavailable (tried again later,
 * then failed), or unknown (it may be filed: never sent again by itself).
 */
create or replace function public.record_piece_filing(
  target_draft uuid,
  target_claim integer,
  target_outcome text,
  target_protocol text default null,
  target_message text default null,
  target_receipt uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  tries integer := greatest(coalesce((
    select (s.value ->> 'piece_filing_attempts')::integer from public.platform_settings s where s.key = 'filing_submit'), 3), 1);
  outcome text := target_outcome;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into draft from public.case_drafts where id = target_draft for update;
  if not found or draft.filing_status is distinct from 'owed' or draft.filing_claimed_at is null
     or draft.filing_claims is distinct from target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if outcome not in ('filed', 'refused', 'unavailable', 'unknown') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;
  if outcome = 'unavailable' and draft.filing_attempts >= tries then
    outcome := 'failed';
  end if;
  update public.case_drafts set
    filing_status = case outcome when 'unavailable' then 'owed' else outcome end,
    filing_claimed_at = null,
    filing_after = case when outcome = 'unavailable' then now() + make_interval(mins => 30 * draft.filing_attempts) end,
    filing_error = case when outcome in ('unavailable', 'failed', 'unknown', 'refused') then outcome end,
    filing_message = left(nullif(btrim(coalesce(target_message, '')), ''), 1000),
    filed_at = case when outcome = 'filed' then now() else filed_at end,
    filed_how = case when outcome = 'filed' then 'one' else filed_how end,
    filed_protocol = case when outcome = 'filed' then left(nullif(btrim(coalesce(target_protocol, '')), ''), 120) else filed_protocol end,
    receipt_file_id = case when outcome = 'filed' then (
      select f.id from public.files f where f.id = target_receipt and f.org_id = draft.org_id and f.purpose = 'filing_receipt'
    ) else receipt_file_id end
  where id = draft.id;
  if outcome in ('filed', 'refused', 'failed', 'unknown') then
    perform public.record_case_event(draft.org_id, draft.case_id,
      case outcome when 'filed' then 'piece_filed' else 'piece_filing_failed' end, 'system',
      jsonb_build_object('draft', draft.id, 'kind', draft.piece_kind, 'outcome', outcome));
  end if;
  return jsonb_build_object('ok', true, 'code', outcome);
end;
$$;

revoke all on function public.record_piece_filing(uuid, integer, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_piece_filing(uuid, integer, text, text, text, uuid) to service_role;

/**
 * A lawyer says they filed the piece in the court's system themself (0189): the contingency where ONE has no channel,
 * or a filing ONE sent came back. A partner or a lawyer, never a support visit; a piece ONE may have filed (`unknown`)
 * is said filed by the lawyer only after looking in the court's system, which this is.
 */
create or replace function public.record_piece_filed(target_draft uuid, target_protocol text, target_filed_on date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into draft from public.case_drafts where id = target_draft;
  if not found or draft.piece_kind = 'inicial' or not public.is_org_member(draft.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  perform public.case_for_writer(draft.case_id);
  if not public.has_firm_function(draft.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if target_filed_on is null or target_filed_on > (now() at time zone 'America/Sao_Paulo')::date
     or target_filed_on < (now() at time zone 'America/Sao_Paulo')::date - 60 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'filed_on');
  end if;
  select * into draft from public.case_drafts where id = target_draft for update;
  if draft.status <> 'issued' or draft.filed_at is not null or draft.filing_status = 'sent'
     or (draft.filing_status = 'owed' and draft.filing_claimed_at is not null) then
    return jsonb_build_object('ok', false, 'code', 'not_open');
  end if;
  update public.case_drafts set
    filed_at = (target_filed_on + time '12:00') at time zone 'America/Sao_Paulo',
    filed_how = 'lawyer', filed_by = auth.uid(),
    filed_protocol = left(nullif(btrim(coalesce(target_protocol, '')), ''), 120),
    filing_status = 'filed', filing_claimed_at = null,
    decision = coalesce(decision, 'file'), decided_by = coalesce(decided_by, auth.uid()), decided_at = coalesce(decided_at, now())
  where id = draft.id;
  perform public.record_case_event(draft.org_id, draft.case_id, 'piece_filed', 'person',
    jsonb_build_object('draft', draft.id, 'kind', draft.piece_kind, 'by', 'lawyer'));
  return jsonb_build_object('ok', true, 'code', 'filed');
end;
$$;

revoke all on function public.record_piece_filed(uuid, text, date) from public, anon;
grant execute on function public.record_piece_filed(uuid, text, date) to authenticated;

/**
 * What ONE asks for by itself (service role): the pieces owed in firms that let ONE start pieces (`start_piece`),
 * of a lawsuit the court has, of a case going: what a publication asks (its action read in the setting's days), and
 * what a condemnation's next step is. An appeal or embargos only once a lawyer decided that path (0185).
 */
create or replace function public.intermediate_pieces_owed(target_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  days integer := greatest(coalesce((
    select (s.value ->> 'pieces_days')::integer from public.platform_settings s where s.key = 'filing_submit'), 30), 1);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(owed) from (
      select jsonb_build_object('proceeding_id', p.id, 'case_id', c.id, 'kind', k.slug, 'publication_id', pa.publication_id,
                                'source', 'publication:' || pa.publication_id::text) as owed
      from public.publication_actions pa
      join public.publications pu on pu.id = pa.publication_id and pu.active
      join public.proceedings p on p.id = pu.proceeding_id and p.status = 'filed' and p.cnj is not null
      join public.cases c on c.id = p.case_id and c.status not in ('closed', 'declined')
      join public.piece_kinds k on pa.action = any (k.from_actions)
      where pa.status = 'done' and pa.done_at > now() - make_interval(days => days)
        and public.firm_autonomy_mode(c.org_id, 'start_piece') = 'auto'
        and (k.slug not in ('recurso', 'embargos') or exists (
          select 1 from public.judgment_paths jp
          where jp.proceeding_id = p.id
            and jp.decision = case k.slug when 'embargos' then 'embargos_declaracao'
                                          else (case p.kind when 'comum' then 'apelacao' else 'recurso_inominado' end) end))
        and not exists (select 1 from public.case_drafts d
                        where d.proceeding_id = p.id and d.piece_kind = k.slug
                          and d.source_key = 'publication:' || pa.publication_id::text)
      union all
      select jsonb_build_object('proceeding_id', p.id, 'case_id', c.id, 'kind', k.slug, 'publication_id', null,
                                'source', 'amount:' || a.next_step)
      from public.lawsuit_amounts a
      join public.proceedings p on p.id = a.proceeding_id and p.status = 'filed' and p.cnj is not null
      join public.cases c on c.id = p.case_id and c.status not in ('closed', 'declined')
      join public.piece_kinds k on k.from_amount_step = a.next_step
      where public.firm_autonomy_mode(c.org_id, 'start_piece') = 'auto'
        and not exists (select 1 from public.case_drafts d
                        where d.proceeding_id = p.id and d.piece_kind = k.slug and d.source_key = 'amount:' || a.next_step)
      limit greatest(least(coalesce(target_limit, 20), 50), 1)
    ) rows
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.intermediate_pieces_owed(integer) from public, anon, authenticated;
grant execute on function public.intermediate_pieces_owed(integer) to service_role;

/** ONE asks for a piece owed (service role), as ONE for the case its own function names. */
create or replace function public.request_intermediate_piece_by_one(target_proceeding uuid, target_kind text,
  target_publication uuid, target_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  answer jsonb;
  lawsuit_case uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select case_id into lawsuit_case from public.proceedings where id = target_proceeding;
  if lawsuit_case is null then
    return jsonb_build_object('ok', false, 'code', 'proceeding_not_found');
  end if;
  perform set_config('one.system_case', lawsuit_case::text, true);
  answer := public.request_intermediate_piece(target_proceeding, target_kind, target_publication, target_source);
  perform set_config('one.system_case', '', true);
  return answer;
end;
$$;

revoke all on function public.request_intermediate_piece_by_one(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.request_intermediate_piece_by_one(uuid, text, uuid, text) to service_role;

-- An eighth version of `caso.peca.minuta`: the intermediate pieces of a lawsuit the court has.
insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'caso.peca.minuta',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'caso.peca.minuta'),
  v.provider, v.model, v.effort,
  v.system_prompt || E'

Peças intermediárias: quando a primeira linha do pedido disser "Peça intermediária", o processo já está no tribunal e você escreve essa peça, não a petição inicial. Siga o modelo da peça e o que "peca_intermediaria" diz dela ("instrucoes"). Escreva o número do processo ("processo") onde o modelo pede. A publicação que pede a peça ("publicacao") é o texto do tribunal: responda ao que ela pede. Numa réplica, a contestação da companhia vem anexa: responda a cada ponto dela, na ordem em que ela os traz. Num pedido de cumprimento, levantamento ou complementação, os valores vêm em "valores" (o principal, a correção, os juros, o total, o depósito e a diferença, em centavos): use exatamente esses números. Não invente fato, decisão, número ou valor. Cite só as fontes da biblioteca entregues. Nas notas, diga o que o advogado deve conferir antes de protocolar.',
  v.output_schema, v.max_tokens, false,
  'As peças intermediárias de um processo que o tribunal já tem.'
from public.prompt_versions v
where v.task = 'caso.peca.minuta' and v.is_active
  and strpos(v.system_prompt, 'Peças intermediárias') = 0;

update public.prompt_versions as v set is_active = false
where v.task = 'caso.peca.minuta' and v.is_active
  and strpos(v.system_prompt, 'Peças intermediárias') = 0
  and exists (
    select 1 from public.prompt_versions w
    where w.task = v.task and w.version > v.version and strpos(w.system_prompt, 'Peças intermediárias') > 0
  );
update public.prompt_versions set is_active = true
where task = 'caso.peca.minuta'
  and version = (select max(w.version) from public.prompt_versions w where w.task = 'caso.peca.minuta')
  and strpos(system_prompt, 'Peças intermediárias') > 0;

/** What the case screen says of each intermediate piece's filing (0189): what keeps ONE from filing it, or null. */
create or replace function public.case_piece_filings(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  firm uuid := (select c.org_id from public.cases c where c.id = target_case);
begin
  if firm is null or not public.is_org_member(firm) then
    return '{}'::jsonb;
  end if;
  return coalesce((
    select jsonb_object_agg(d.id, public.piece_filing_blocker(d.id))
    from public.case_drafts d
    where d.case_id = target_case and d.piece_kind <> 'inicial' and d.status = 'issued'
  ), '{}'::jsonb);
end;
$$;

revoke all on function public.case_piece_filings(uuid) from public, anon;
grant execute on function public.case_piece_filings(uuid) to authenticated;

-- A file the receipt of a piece names is never forgotten under it (`discard_file`, from the body of 0175, the latest
-- that redefined it): every column that points at a file is one it looks at.
create or replace function public.discard_file(target_file uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  file public.files%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into file from public.files where id = target_file for update;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'not_found');
  end if;
  if exists (select 1 from public.issued_documents d where d.file_id = file.id)
     or exists (select 1 from public.case_documents d where d.file_id = file.id or d.normalized_file_id = file.id)
     or exists (select 1 from public.case_statements s where s.audio_file_id = file.id)
     or exists (select 1 from public.wa_messages m where m.media_file_id = file.id)
     or exists (select 1 from public.filing_package_items i where i.file_id = file.id or i.signed_file_id = file.id)
     or exists (select 1 from public.filing_receipts r where r.file_id = file.id)
     or exists (select 1 from public.filing_submissions s where s.receipt_file_id = file.id)
     or exists (select 1 from public.template_imports i where i.file_id = file.id)
     or exists (select 1 from public.pax_documents d where d.file_id = file.id)
     -- The receipt of a cost of a case (0131).
     or exists (select 1 from public.case_costs c where c.file_id = file.id)
     -- The document of a bill or an entry of the books (0140).
     or exists (select 1 from public.finance_bills b where b.file_id = file.id)
     or exists (select 1 from public.finance_entries e where e.file_id = file.id)
     -- A document of a trip of a person the firm registered, before any case (0170).
     or exists (select 1 from public.tracked_trip_documents d where d.file_id = file.id)
     -- The invoice the firm issued, kept with its record (0165).
     or exists (select 1 from public.finance_invoices i where i.file_id = file.id)
     -- The receipt the court gave of an intermediate piece ONE filed (0189).
     or exists (select 1 from public.case_drafts d where d.receipt_file_id = file.id) then
    return jsonb_build_object('ok', false, 'code', 'in_use');
  end if;

  delete from public.files where id = file.id;
  -- A file a partner held is none of the firm's trail (`confirm_file`, 0070).
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (case when file.partner_id is null then file.org_id end, null, 'file.discarded', 'file', file.id::text,
          jsonb_strip_nulls(jsonb_build_object('purpose', file.purpose, 'status', file.status, 'partner', file.partner_id)));
  return jsonb_build_object('ok', true, 'code', 'discarded');
end;
$$;

revoke all on function public.discard_file(uuid) from public, anon, authenticated;
