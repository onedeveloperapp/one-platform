-- ============================================================
-- 0298 · The mark of a case covers everything its screen shows
--
-- The case screen follows the database by a mark (`case_pulse`, 0096):
-- it asks the mark every second or two while something happens and reads
-- itself again when the mark differs from the one it was drawn with. The
-- audit of the case's sync (2026-11-25) found the screen reading nine
-- tables, and one state, that never moved the mark: a change of them
-- reached the screen only when something else of the case changed.
--
--   filing_submissions        ONE's own filing, step by step: the top said
--                             "o ONE envia ao tribunal" long after it had
--                             ended, or never said it began.
--   the triage of a publication nobody triaged (`publication_triage_states`):
--                             ONE giving up on a publication (its tries
--                             spent) changed nothing the mark held, so an
--                             open screen would go on saying "O ONE está
--                             triando", and hold itself for it.
--   publication_actions, proceeding_history_reads, hearing_briefs,
--   judgment_paths, lawsuit_amounts, case_tasks, case_fee_splits,
--   notice_stops              what their cards show.
--
-- The mark still holds of a publication only what a member reads of it
-- (the state of the triage as `publication_triage_states` answers it to a
-- member, never the AI's own word), and of a guide of a hearing only that
-- it was made and sent. The answer and its rights are as before.
-- ============================================================

create index if not exists filing_submissions_case_idx on public.filing_submissions (case_id);
create index if not exists hearing_briefs_case_idx on public.hearing_briefs (case_id);
create index if not exists case_fee_splits_every_case_idx on public.case_fee_splits (case_id);

/** What the case screen follows to read itself again (replaces 0280's): everything its cards show (0298). */
create or replace function public.case_pulse(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  advance public.case_advances%rowtype;
  stale integer := greatest(public.case_advance_setting('stale_minutes', 15), 1);
  stamp text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  select * into advance from public.case_advances where case_id = target_case;

  select md5(concat_ws('|',
    current_case::text,
    (select concat(count(*), '/', max(e.at)) from public.case_events e where e.case_id = target_case),
    (select concat(a.waiting, '/', a.checked_at, '/', a.waiting_since, '/', a.claimed_at, '/', a.woken_at, '/', a.after)
       from public.case_advances a where a.case_id = target_case),
    -- Where the data ONE asks the passenger in the chat stands (0280): asked, to ask, or later.
    (select coalesce(string_agg(concat_ws(',', d.person_id, d.state), ';'), '') from public.case_chat_data(target_case) d),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_parties t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.people t
       where t.id in (select cp.person_id from public.case_parties cp where cp.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.flight_segments t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.flight_checks t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_documents t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_statements t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_interviews t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_interview_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_links t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_consents t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.signature_envelopes t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_papers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.civil_court_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.residence_declarations t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.free_justice_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.piece_fact_checks t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_document_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.proceedings t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.proceeding_parties t
       where t.proceeding_id in (select p.id from public.proceedings p where p.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.proceeding_lawyers t
       where t.proceeding_id in (select p.id from public.proceedings p where p.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.proceeding_tracking t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_drafts t where t.case_id = target_case),
    (select concat(count(*), '/', max(v.created_at)) from public.case_draft_versions v
       where v.draft_id in (select d.id from public.case_drafts d where d.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.filing_packages t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.dossiers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.deadlines t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.hearings t where t.case_id = target_case),
    -- The sessions of judgment and the limit the backend counts of each (0219).
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.judgment_sessions t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_notices t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.admin_complaints t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.lawsuit_facts t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_costs t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ','), '')) from public.case_fees t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.money_shares t where t.case_id = target_case),
    -- Of a publication, only what a member reads of it: never the AI's word in the shadow.
    (select md5(coalesce(string_agg(concat_ws(',', t.id, t.category, t.triaged_at, t.active, t.cancel_seen_at,
        t.review_due, t.judgment, t.judgment_source, t.ack_owed, t.acked_at), ';' order by t.id), ''))
       from public.publications t where t.case_id = target_case),
    (select md5(coalesce(string_agg(concat_ws(',', r.publication_id, r.kind, r.status, r.reason, r.updated_at), ';'
        order by r.publication_id, r.kind), ''))
       from public.publication_readings r
       where r.publication_id in (select p.id from public.publications p where p.case_id = target_case)),
    -- What follows the screen reads too, and no change of it moved the mark until 0298.
    -- ONE's own filing of a package (0101), step by step: the top says "o ONE envia ao tribunal" from it.
    (select md5(coalesce(string_agg(concat_ws(',', t.id, t.status, t.claimed_at, t.attempts, t.retry_after, t.sent_at,
        t.filed_at, t.protocol, t.error), ';' order by t.id), ''))
       from public.filing_submissions t where t.case_id = target_case),
    -- Whether ONE still triages each publication nobody triaged (0104), as a member reads it: never the AI's word.
    (select coalesce(string_agg(concat_ws(',', s.publication_id, s.state), ';' order by s.publication_id), '')
       from public.publication_triage_states(
         array(select p.id from public.publications p where p.case_id = target_case and p.category is null)) s),
    -- What ONE read a publication asks of the firm and of the client (0186), and where that reading stands.
    (select md5(coalesce(string_agg(concat_ws(',', t.publication_id, t.status, t.claimed_at, t.attempts, t.action,
        t.done_at, md5(coalesce(t.firm_summary, '')), md5(coalesce(t.client_summary, '')), md5(t.pending::text)), ';'
        order by t.publication_id), ''))
       from public.publication_actions t where t.case_id = target_case),
    -- ONE's reading of the history of a lawsuit filed before the case was in ONE (0286).
    (select md5(coalesce(string_agg(concat_ws(',', t.id, t.status, t.claimed_at, t.attempts, t.read_at, t.kept,
        t.error), ';' order by t.id), ''))
       from public.proceeding_history_reads t where t.case_id = target_case),
    -- The guide of each hearing (0187): that it was made and sent, never its words.
    (select md5(coalesce(string_agg(concat_ws(',', t.hearing_id, t.made_at, t.emailed_at), ';' order by t.hearing_id), ''))
       from public.hearing_briefs t where t.case_id = target_case),
    -- The way after a judgment (0185) and what a condemnation comes to (0184).
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.judgment_paths t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.lawsuit_amounts t where t.case_id = target_case),
    -- The tasks of a case of an area of the firm (0274).
    (select md5(coalesce(string_agg(concat_ws(',', t.id, t.position, t.done_at, t.done_by), ';' order by t.id), ''))
       from public.case_tasks t where t.case_id = target_case),
    -- Who the fees are split with (0159).
    (select md5(coalesce(string_agg(concat_ws(',', t.id, t.percent, t.ended_at), ';' order by t.id), ''))
       from public.case_fee_splits t where t.case_id = target_case),
    -- The notices stopped for the people of the case (0088).
    (select md5(coalesce(string_agg(concat_ws(',', t.id, t.source, t.ended_at), ';' order by t.id), ''))
       from public.notice_stops t
       where t.person_id in (select cp.person_id from public.case_parties cp where cp.case_id = target_case))
  )) into stamp;

  return jsonb_build_object(
    'stamp', stamp,
    'advance', jsonb_build_object(
      'running', coalesce(advance.claimed_at is not null and advance.claimed_at > now() - make_interval(mins => stale), false),
      'due', coalesce(advance.woken_at is not null
        and (advance.checked_at is null or advance.woken_at > advance.checked_at)
        and (advance.after is null or advance.after <= now()), false),
      'waiting_since', advance.waiting_since,
      'checked_at', advance.checked_at
    )
  );
end;
$$;

revoke all on function public.case_pulse(uuid) from public, anon;
grant execute on function public.case_pulse(uuid) to authenticated;
