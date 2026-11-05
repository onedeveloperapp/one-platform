-- ============================================================
-- 0097_piece_redone_with_account: the purchase is asked nowhere, and ONE
-- writes a piece again when the client's account came after it (the owner's
-- decision of 2026-11-05).
--
-- A case opened before the interview (0095) had its lawsuit created and its
-- piece written the same night with no account, eight [COMPLETAR] in it; the
-- firm registered the account the next day, and the order of the facts of
-- 0090 asked the client four questions on the link, the purchase among them,
-- while the card said ONE created the lawsuits only after the answers (they
-- existed already) and the piece already written never read the account.
--
--   1. The purchase leaves the points of an account (`statements.
--      account_topics`), the instructions of `caso.relato.cronologia` (a new
--      version with no `compra`) and the accounts that still asked it, its
--      question with it: the owner took it out of the interview (0095), and
--      the piece speaks of a purchase only where a document says it.
--   2. ONE writes a piece again when the account changed after it
--      (`advance_redo_pieces`, in the look of the case that carries it on):
--      a piece the AI wrote that still has a [COMPLETAR], nobody of the firm
--      edited, sent back or had rewritten, of a lawsuit still planned, as the
--      firm lets ONE start pieces (`start_piece`); the piece before is given
--      up (what waited of it leaves the queue) and a new first text is asked
--      from the same model, which reads the account (`draft_redone` in the
--      timeline). An account changes when its order of the facts is approved
--      or confirmed, or an interview is done or closed (`case_account_
--      changed_at`); each change may write the piece once more, never the
--      same change twice.
-- ============================================================

-- ---------- 1. The purchase is no point of an account ----------

update public.platform_settings
set value = jsonb_set(value, '{account_topics}', (value -> 'account_topics') - 'compra')
where key = 'statements' and jsonb_typeof(value -> 'account_topics') = 'array' and (value -> 'account_topics') ? 'compra';

insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'caso.relato.cronologia',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'caso.relato.cronologia'),
  v.provider, v.model, v.effort,
  replace(replace(
    regexp_replace(v.system_prompt, '[ \t]*compra: quando e onde a passagem foi comprada[^\r\n]*\r?\n', ''),
    '(por exemplo: "Quanto você pagou pela passagem e onde comprou?")',
    '(por exemplo: "Em que dia e a que horas você chegou ao destino?")'),
    'Quando nada falta, faltam é vazio.',
    'Quando nada falta, faltam é vazio. A compra da passagem (onde, quando, o localizador e quanto custou) não é um destes pontos: nunca pergunte por ela, que a peça só usa quando um documento a diz.'),
  jsonb_set(v.output_schema, '{properties,faltam,items,enum}', (v.output_schema #> '{properties,faltam,items,enum}') - 'compra'),
  v.max_tokens, false,
  'Não pergunta a compra da passagem: a peça só fala dela quando um documento a diz.'
from public.prompt_versions v
where v.task = 'caso.relato.cronologia' and v.is_active
  and (v.output_schema #> '{properties,faltam,items,enum}') ? 'compra';

-- In force: one version per task, so the one in force leaves before the new one comes in.
update public.prompt_versions as v set is_active = false
where v.task = 'caso.relato.cronologia' and v.is_active
  and (v.output_schema #> '{properties,faltam,items,enum}') ? 'compra'
  and exists (
    select 1 from public.prompt_versions w
    where w.task = v.task and w.version > v.version and w.output_schema -> 'properties' ? 'faltam'
      and not ((w.output_schema #> '{properties,faltam,items,enum}') ? 'compra')
  );
update public.prompt_versions set is_active = true
where task = 'caso.relato.cronologia'
  and version = (
    select max(w.version) from public.prompt_versions w
    where w.task = 'caso.relato.cronologia' and w.output_schema -> 'properties' ? 'faltam'
      and not ((w.output_schema #> '{properties,faltam,items,enum}') ? 'compra')
  )
  and not exists (select 1 from public.prompt_versions w where w.task = 'caso.relato.cronologia' and w.is_active);

-- The accounts that still asked it: the point goes, and its question with it (one question per point, in the same
-- order, 0090); with nothing left to ask, no question.
update public.case_statements s
set questions = case
      when cardinality(array_remove(s.missing_topics, 'compra')) = 0 then '{}'::text[]
      when cardinality(s.questions) = cardinality(s.missing_topics)
        then s.questions[1:array_position(s.missing_topics, 'compra') - 1]
             || s.questions[array_position(s.missing_topics, 'compra') + 1:cardinality(s.questions)]
      else s.questions
    end,
    missing_topics = array_remove(s.missing_topics, 'compra')
where 'compra' = any (s.missing_topics);

-- ---------- 2. ONE writes a piece again when the account came after it ----------

/**
 * When a case's account last changed: its order of the facts approved or
 * confirmed, its interview done or closed, or the firm going on without what
 * was missing. Null when it never had one. Internal.
 */
create or replace function public.case_account_changed_at(target_case uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(e.at) from public.case_events e
  where e.case_id = target_case
    and e.kind in ('chronology_approved', 'client_chronology_confirmed', 'interview_done', 'interview_closed',
                   'account_gaps_closed');
$$;

revoke all on function public.case_account_changed_at(uuid) from public, anon, authenticated;

/**
 * ONE writes again, in the look of the case it holds, each piece the account
 * came after: the AI's first text, still with a [COMPLETAR], that nobody of
 * the firm edited, sent back or had rewritten, of a lawsuit still planned,
 * whose latest version is older than the account's last change, as the firm
 * lets ONE start pieces. The piece before is given up (what waited of it
 * leaves the queue) and a new first text is asked from the same model (else
 * the firm's model of the kind), told in the timeline; one that cannot be
 * asked leaves the piece as it was. Answers the new pieces to follow.
 * Service role, with the case's claim.
 */
create or replace function public.advance_redo_pieces(target_case uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  changed timestamptz;
  draft record;
  template uuid;
  answer jsonb;
  drafts jsonb := '[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform set_config('one.system_case', target_case::text, true);
  current_case := public.case_for_writer(target_case);
  if not public.case_advance_held(target_case, target_claim) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  changed := public.case_account_changed_at(target_case);
  if changed is null
     or current_case.status in ('filed', 'closed', 'declined')
     or public.firm_autonomy_mode(current_case.org_id, 'start_piece') <> 'auto'
     or public.case_account_state(target_case) not in ('ready', 'incomplete') then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', true, 'code', 'none', 'drafts', drafts);
  end if;
  for draft in
    select d.id, d.proceeding_id, d.template_id, p.kind
    from public.case_drafts d
    join public.proceedings p on p.id = d.proceeding_id and p.status = 'planned'
    join public.case_draft_versions v on v.draft_id = d.id and v.version = d.version
    where d.case_id = target_case and d.status = 'proposed' and d.work is null and d.mode = 'ai'
      and d.revision_note is null and d.revisions = 0
      and strpos(v.body, '[COMPLETAR') > 0
      and v.created_at < changed
      and not exists (
        select 1 from public.case_draft_versions w
        where w.draft_id = d.id and (w.author = 'person' or w.note is not null)
      )
    order by d.requested_at, d.id
  loop
    template := coalesce(
      (select t.id from public.draft_templates t
       where t.id = draft.template_id and (t.org_id = current_case.org_id or t.org_id is null)),
      public.draft_template_for(current_case.org_id, draft.kind));
    continue when template is null;
    begin
      perform public.withdraw_draft_approvals(draft.id,
        'O ONE refez a peça com o relato do cliente, que chegou depois do primeiro texto.');
      update public.case_drafts set status = 'cancelled', work = null, work_claimed_at = null
      where id = draft.id and status = 'proposed' and work is null;
      answer := public.request_case_draft(draft.proceeding_id, template, 'ai');
      if not coalesce((answer ->> 'ok')::boolean, false) then
        raise exception 'redo_refused' using errcode = 'P0001';
      end if;
      drafts := drafts || jsonb_build_array(answer ->> 'draft_id');
      perform public.record_case_event(current_case.org_id, target_case, 'draft_redone', 'system',
        jsonb_build_object('draft', draft.id, 'new_draft', answer ->> 'draft_id', 'proceeding', draft.proceeding_id));
    exception when sqlstate 'P0001' then
      -- Nothing of this one stays: the piece keeps its text for a lawyer.
      null;
    end;
  end loop;
  perform set_config('one.system_case', '', true);
  return jsonb_build_object('ok', true, 'code', case when jsonb_array_length(drafts) > 0 then 'redone' else 'none' end,
                            'drafts', drafts);
end;
$$;

revoke all on function public.advance_redo_pieces(uuid, integer) from public, anon, authenticated;
