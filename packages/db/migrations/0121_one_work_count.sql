-- ============================================================
-- 0121 · O trabalho do ONE: a contagem
--
-- The second half of phase 2 of the plan of the controladoria (0120 holds the
-- catalog of the kinds of ONE's work and the firm's estimates; it reached the
-- development project before its count was written, so the count is here).
--
-- The kind of the papers a client signs is every paper ONE sends to sign (a
-- power of attorney or a fee contract), so its key says so (`papel_cliente`,
-- which `procuracao` was). The count reads the records ONE already keeps
-- (`one_work_acts`, internal) and answers each month of Brasília, of every
-- module or of one, what ONE did alone, what a person approved after reading
-- what ONE prepared and the test cases apart, with the minutes by the firm's
-- estimates; the firm's own minutes and the cost of an hour only to who
-- decides for it (`firm_one_work`).
-- ============================================================

-- ---------- The kind of the papers a client signs ----------

insert into public.one_work_kinds (key, family, position, minutes, decision)
select 'papel_cliente', k.family, k.position, k.minutes, k.decision
from public.one_work_kinds k where k.key = 'procuracao'
on conflict (key) do nothing;
update public.firm_one_work_minutes set kind = 'papel_cliente' where kind = 'procuracao';
delete from public.one_work_kinds where key = 'procuracao';

-- ---------- The count ----------

/**
 * Every act of ONE's work in a firm between two moments, each once: its kind, when it happened, the case it is of
 * (none for a conversation, a publication of no case, a deadline of a lawsuit the firm has no case of, a model of the
 * library), whether a person approved what ONE prepared after reading it (`assisted`), and whether it is a test
 * (`test`, for an act of no case; a case says it itself). Only what stands: never a failure, never what a person
 * undid or turned down, never the audit trail's mirror of an act, never a flight alert nor an agency's reading.
 * Internal: `firm_one_work` reads it.
 */
create or replace function public.one_work_acts(target_org uuid, target_from timestamptz, target_to timestamptz)
returns table (kind text, at timestamptz, case_id uuid, assisted boolean, test boolean)
language sql
stable
security definer
set search_path = public
as $$
  -- The conversation: a case ONE opened at the passenger's yes.
  select 'caso_aberto_conversa', e.at, e.case_id, false, null::boolean
  from public.case_events e
  where e.org_id = target_org and e.kind = 'created' and e.actor_type = 'system'
    and e.data ->> 'from' = 'conversation' and e.at >= target_from and e.at < target_to
  union all
  -- ONE's answer that went out in a conversation, written by its model; approved by a person, apart.
  select 'resposta_conversa', m.created_at, null, exists (
           select 1 from public.approvals a
           where a.run_id = m.ai_run_id and a.status = 'approved' and a.decided_by is not null
         ), n.provider = 'test'
  from public.wa_messages m
  join public.ai_runs r on r.id = m.ai_run_id and r.task = 'atendimento.conversa'
  join public.wa_numbers n on n.id = m.number_id
  where m.org_id = target_org and m.direction = 'out' and m.status in ('sent', 'delivered', 'read')
    and m.created_at >= target_from and m.created_at < target_to
  union all
  -- The client's link ONE made and sent, which no person ended or replaced.
  select 'link_cliente', l.created_at, l.case_id, false, null
  from public.client_links l
  where l.org_id = target_org and l.created_by is null and l.revoked_by is null
    and l.created_at >= target_from and l.created_at < target_to
    and exists (
      select 1 from public.case_events e
      where e.case_id = l.case_id and e.kind = 'client_link_created' and e.actor_type = 'system'
        and e.data ->> 'link' = l.id::text
    )
  union all
  -- A file the passenger sent in the conversation, joined to their case by ONE, still there.
  select 'arquivo_conversa', e.at, e.case_id, false, null
  from public.case_events e
  where e.org_id = target_org and e.kind = 'document_added' and e.actor_type = 'system'
    and e.data ->> 'source' = 'whatsapp' and e.at >= target_from and e.at < target_to
    and exists (select 1 from public.case_documents d where d.id::text = e.data ->> 'document')
  union all
  -- An answer of the interview the passenger gave in the conversation and ONE read, which no person rewrote.
  select 'resposta_entrevista', a.answered_at, a.case_id, false, null
  from public.case_interview_answers a
  where a.org_id = target_org and a.source = 'chat' and a.status in ('answered', 'unknown')
    and a.answered_at >= target_from and a.answered_at < target_to
  union all
  -- A document checked by ONE: decided by its check alone, or by a person who approved the check (apart).
  select 'documento_conferido', d.decided_at, d.case_id, d.decided_by is not null, null
  from public.case_documents d
  where d.org_id = target_org and d.status in ('accepted', 'rejected') and d.check_run_id is not null
    and d.decided_at >= target_from and d.decided_at < target_to
    and (d.decided_by is null or exists (
      select 1 from public.approvals a
      where a.run_id = d.check_run_id and a.status = 'approved' and a.decided_by is not null
    ))
  union all
  -- A person's data written from a document, while what was written stands or was confirmed.
  select 'dados_lidos', e.at, e.case_id, e.actor_type = 'person', null
  from public.case_events e
  join public.people p on p.id::text = e.data ->> 'person'
  where e.org_id = target_org and e.kind = 'person_read' and e.at >= target_from and e.at < target_to
    and (
      p.read_fields ?| array(select jsonb_array_elements_text(coalesce(e.data -> 'fields', '[]'::jsonb)))
      or exists (
        select 1 from public.case_events c
        where c.case_id = e.case_id and c.kind = 'person_read_confirmed' and c.at >= e.at
          and c.data ->> 'person' = e.data ->> 'person'
      )
    )
  union all
  -- A photo made a PDF of the size the courts take.
  select 'foto_pdf', f.created_at, d.case_id, false, null
  from public.case_documents d
  join public.files f on f.id = d.normalized_file_id and f.status = 'stored'
  where d.org_id = target_org and f.created_at >= target_from and f.created_at < target_to
  union all
  -- An audio heard and written down, which no person wrote over; approved by a person, apart.
  select 'audio_transcrito', r.finished_at, s.case_id, exists (
           select 1 from public.approvals a
           where a.run_id = s.transcript_run_id and a.status = 'approved' and a.decided_by is not null
         ), null
  from public.case_statements s
  join public.ai_runs r on r.id = s.transcript_run_id
  where s.org_id = target_org and s.audio_file_id is not null and s.transcript is not null
    and r.finished_at >= target_from and r.finished_at < target_to
  union all
  -- The order of the facts that went to the client: by ONE alone, or by a person who approved it (apart).
  select 'ordem_dos_fatos', coalesce(a.decided_at, r.finished_at), s.case_id, a.id is not null, null
  from public.case_statements s
  join public.ai_runs r on r.id = s.chronology_run_id
  left join public.approvals a
    on a.run_id = s.chronology_run_id and a.status = 'approved' and a.decided_by is not null
  where s.org_id = target_org and s.chronology_status in ('approved', 'confirmed', 'contested')
    and coalesce(a.decided_at, r.finished_at) >= target_from and coalesce(a.decided_at, r.finished_at) < target_to
  union all
  -- The lawsuits ONE created.
  select 'acoes_criadas', p.created_at, p.case_id, false, null
  from public.proceedings p
  where p.org_id = target_org and p.created_by_one and p.created_at >= target_from and p.created_at < target_to
  union all
  -- The court's system ONE named for a lawsuit and a person of the firm approved.
  select 'sistema_tribunal', p.system_approved_at, p.case_id, true, null
  from public.proceedings p
  where p.org_id = target_org and p.system_by_one and p.system is not null and p.system_refused_at is null
    and p.system_approved_by is not null
    and p.system_approved_at >= target_from and p.system_approved_at < target_to
  union all
  -- A leg checked against ANAC's record of the flights.
  select 'voo_conferido', f.checked_at, f.case_id, false, null
  from public.flight_checks f
  where f.org_id = target_org and f.source = 'vra' and f.status in ('found', 'not_found')
    and f.checked_at >= target_from and f.checked_at < target_to
  union all
  -- The weather of the affected leg read for the Tema 1.417 (its latest reading).
  select 'clima_lido', (c.weather_read ->> 'at')::timestamptz, c.id, false, null
  from public.cases c
  where c.org_id = target_org and c.weather_read ? 'at'
    and (c.weather_read ->> 'at')::timestamptz >= target_from and (c.weather_read ->> 'at')::timestamptz < target_to
  union all
  -- The decision to file or hold on the Tema 1.417, taken by ONE and kept.
  select 'tema_1417', c.suspension_decided_at, c.id, false, null
  from public.cases c
  where c.org_id = target_org and c.suspension_decided_auto and c.suspension_decision in ('file', 'hold')
    and c.suspension_decided_at >= target_from and c.suspension_decided_at < target_to
  union all
  -- The first text of a piece written by ONE, not turned down nor given up; approved by a lawyer, apart.
  select 'texto_peca', v.created_at, d.case_id, d.approved_by is not null, null
  from public.case_draft_versions v
  join public.case_drafts d on d.id = v.draft_id
  where v.org_id = target_org and v.version = 1 and v.author = 'ai' and d.status in ('proposed', 'approved', 'issued')
    and v.created_at >= target_from and v.created_at < target_to
  union all
  -- A piece ONE approved itself, and nobody took the approval back.
  select 'peca_aprovada', d.approved_at, d.case_id, false, null
  from public.case_drafts d
  where d.org_id = target_org and d.approved_auto and d.status in ('approved', 'issued')
    and d.approved_at >= target_from and d.approved_at < target_to
  union all
  -- A paper for the client to sign (a power of attorney, a contract) ONE wrote and sent, its signature not ended.
  select 'papel_cliente', p.created_at, p.case_id, false, null
  from public.case_papers p
  left join public.signature_envelopes s on s.id = p.envelope_id
  where p.org_id = target_org and p.created_at >= target_from and p.created_at < target_to
    and (s.id is null or s.status not in ('cancelled', 'failed'))
  union all
  -- A dossier of the case written and issued.
  select 'dossie', d.issued_at, d.case_id, false, null
  from public.dossiers d
  where d.org_id = target_org and d.status = 'issued' and d.issued_at >= target_from and d.issued_at < target_to
  union all
  -- A filing package built, not given up.
  select 'pacote_protocolo', f.built_at, f.case_id, false, null
  from public.filing_packages f
  where f.org_id = target_org and f.status in ('ready', 'filed') and f.built_at >= target_from and f.built_at < target_to
  union all
  -- The files of a package signed with a lawyer's authorization.
  select 'arquivos_assinados', f.signed_at, f.case_id, false, null
  from public.filing_packages f
  where f.org_id = target_org and f.status in ('ready', 'filed') and f.signature_status = 'signed'
    and f.signed_at >= target_from and f.signed_at < target_to
  union all
  -- A lawsuit filed by ONE in the court's own channel.
  select 'acao_protocolada', s.filed_at, s.case_id, false, null
  from public.filing_submissions s
  where s.org_id = target_org and s.status = 'filed' and s.filed_at >= target_from and s.filed_at < target_to
  union all
  -- A communication of the DJEN read for the firm.
  select 'publicacao_capturada', p.captured_at, p.case_id, false, null
  from public.publications p
  where p.org_id = target_org and p.captured_at >= target_from and p.captured_at < target_to
  union all
  -- A publication triaged by ONE whose triage stands; checked by a person and kept, apart.
  select 'publicacao_triada', p.triaged_at, p.case_id, p.triaged_by is not null or p.reviewed_by is not null, null
  from public.publications p
  where p.org_id = target_org and p.ai_applied and p.category is not null
    and (p.triaged_by is null or p.category = p.ai_category)
    and p.triaged_at >= target_from and p.triaged_at < target_to
  union all
  -- A deadline ONE read from a publication and proposed, not dismissed.
  select 'prazo_lido', d.created_at, d.case_id, false, null
  from public.deadlines d
  where d.org_id = target_org and d.proposed_auto and d.status <> 'dismissed'
    and d.created_at >= target_from and d.created_at < target_to
  union all
  -- A hearing ONE read from a publication and registered, not cancelled.
  select 'audiencia_lida', h.created_at, h.case_id, false, null
  from public.hearings h
  where h.org_id = target_org and h.created_auto and h.status <> 'cancelled'
    and h.created_at >= target_from and h.created_at < target_to
  union all
  -- A movement of a lawsuit the court made and ONE read, never the history its first reading brought.
  select 'andamento_lido', x.learned_at, x.case_id, false, null
  from (
    select m.case_id, m.learned_at, min(m.learned_at) over (partition by m.proceeding_id, m.source) as first_at
    from public.movements m
    where m.org_id = target_org and m.proceeding_id in (
      select n.proceeding_id from public.movements n
      where n.org_id = target_org and n.learned_at >= target_from and n.learned_at < target_to
    )
  ) x
  where x.learned_at > x.first_at and x.learned_at >= target_from and x.learned_at < target_to
  union all
  -- A deadline counted by the rule over the court's calendar, as it stands.
  select 'prazo_contado', d.computed_at, d.case_id, false, null
  from public.deadlines d
  where d.org_id = target_org and d.computed_due_on is not null and d.computed_revision = d.revision
    and d.status <> 'dismissed' and d.computed_at >= target_from and d.computed_at < target_to
  union all
  -- A deadline ONE confirmed on the day it counted, as it stands.
  select 'prazo_confirmado', d.confirmed_at, d.case_id, false, null
  from public.deadlines d
  where d.org_id = target_org and d.confirmed_auto and d.status in ('confirmed', 'done')
    and d.confirmed_at >= target_from and d.confirmed_at < target_to
  union all
  -- A hearing written to the firm's calendar, as it stands.
  select 'audiencia_agenda', h.synced_at, h.case_id, false, null
  from public.hearings h
  where h.org_id = target_org and h.synced_revision = h.revision and h.synced_calendar is not null
    and h.status <> 'cancelled' and h.synced_at >= target_from and h.synced_at < target_to
  union all
  -- What the client was told on WhatsApp, each notice that went out (never the alert of a flight).
  select case
           when n.kind in ('hearing_reminder', 'hearing_change') then 'aviso_audiencia'
           when n.kind in ('lawsuit_update', 'lawsuit_filed', 'case_received') then 'aviso_andamento'
           when n.kind = 'payment_alert' then 'aviso_golpe'
           else 'pedido_documento'
         end,
         m.created_at, n.case_id, false, null
  from public.client_notices n
  join public.wa_messages m on m.id = n.message_id
  where n.org_id = target_org and m.status in ('sent', 'delivered', 'read')
    and n.kind in ('hearing_reminder', 'hearing_change', 'lawsuit_update', 'lawsuit_filed', 'case_received',
                   'payment_alert', 'document_refused', 'case_questions')
    and m.created_at >= target_from and m.created_at < target_to
  union all
  -- A model of the library ONE made from the firm's own document, while the model is there: saved by ONE, or by a
  -- person from what ONE prepared (apart). The record of its saving is the only one the act leaves.
  select 'modelo_documento', a.created_at, null, a.action = 'library.import_saved', false
  from public.audit_events a
  where a.org_id = target_org and a.action in ('library.import_saved_by_one', 'library.import_saved')
    and a.created_at >= target_from and a.created_at < target_to
    and exists (
      select 1 from public.draft_templates t where t.org_id = target_org and t.id::text = a.metadata ->> 'template_id'
    );
$$;

revoke all on function public.one_work_acts(uuid, timestamptz, timestamptz) from public, anon, authenticated;

/**
 * What ONE did for the firm in each month of Brasília from `target_from` to `target_to` (any day of the first and of
 * the last month, two years at most), of one module (an act of no case counts only with every module): each kind's
 * acts done by ONE alone, the ones a person approved after reading what ONE prepared, the test cases' apart, and the
 * minutes a person would have taken by the firm's estimates (ONE's where the firm set none). The firm's own minutes
 * and the cost of an hour only to who decides for it, never in a support visit; the rest to anybody of the firm.
 * Never per person.
 */
create or replace function public.firm_one_work(
  target_org uuid,
  target_from date,
  target_to date,
  target_module text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  first_month date := date_trunc('month', target_from)::date;
  last_month date := date_trunc('month', coalesce(target_to, target_from))::date;
  from_at timestamptz;
  to_at timestamptz;
  decides boolean;
  cost integer;
  counted jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_from is null or last_month < first_month or last_month > (first_month + interval '23 months')::date then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  from_at := first_month::timestamp at time zone 'America/Sao_Paulo';
  to_at := (last_month + interval '1 month')::timestamp at time zone 'America/Sao_Paulo';
  decides := public.decides_for_firm(target_org) and not public.is_impersonated();
  if decides then
    select c.hour_cents into cost from public.firm_one_work_cost c where c.org_id = target_org;
  end if;

  with acts as (
    select a.kind, to_char(a.at at time zone 'America/Sao_Paulo', 'YYYY-MM') as month, a.assisted,
           coalesce(c.is_test, a.test, false) as test
    from public.one_work_acts(target_org, from_at, to_at) a
    left join public.cases c on c.id = a.case_id
    where target_module is null or c.module = target_module
  ), totals as (
    select x.month, x.kind,
           count(*) filter (where not x.test and not x.assisted)::integer as alone,
           count(*) filter (where not x.test and x.assisted)::integer as assisted,
           count(*) filter (where x.test)::integer as test
    from acts x
    group by x.month, x.kind
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'month', n.month, 'kind', n.kind, 'alone', n.alone, 'assisted', n.assisted, 'test', n.test,
           'minutes', (n.alone + n.assisted) * coalesce(f.minutes, k.minutes),
           'test_minutes', n.test * coalesce(f.minutes, k.minutes)
         ) order by n.month, k.position), '[]'::jsonb)
  into counted
  from totals n
  join public.one_work_kinds k on k.key = n.kind
  left join public.firm_one_work_minutes f on f.org_id = target_org and f.kind = n.kind;

  -- What is said only to who decides for the firm is left out, never sent as nothing, to anybody else.
  return jsonb_strip_nulls(jsonb_build_object(
    'from', to_char(first_month, 'YYYY-MM'),
    'to', to_char(last_month, 'YYYY-MM'),
    'rows', counted,
    'decides', decides,
    'kinds', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'key', k.key, 'family', k.family, 'decision', k.decision, 'default_minutes', k.minutes,
               -- The firm's own minutes, only to who decides for it.
               'minutes', case when decides then coalesce(f.minutes, k.minutes) end,
               'own', case when decides then f.minutes is not null end
             )) order by k.position)
      from public.one_work_kinds k
      left join public.firm_one_work_minutes f on f.org_id = target_org and f.kind = k.key
    ),
    'hour_cents', case when decides then cost end
  ));
end;
$$;

revoke all on function public.firm_one_work(uuid, date, date, text) from public, anon;
grant execute on function public.firm_one_work(uuid, date, date, text) to authenticated;
