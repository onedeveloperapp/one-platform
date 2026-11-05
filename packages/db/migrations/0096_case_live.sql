-- ============================================================
-- 0096_case_live: what a screen needs to say what happens in a case while
-- it is open (the owner's audit of the case screen, 2026-11-05).
--
-- 1. A pulse of a case (`case_pulse`): a mark that changes whenever anything
--    the case screen shows changes (what ONE did, what the client sent, a
--    person's write), and whether ONE is looking at the case now or owes it
--    a look. The screen reads it every few seconds and reads the case again
--    only when the mark changed: ONE's work shows while the person is on the
--    screen, and nothing is read whole for nothing. The claim of a look is
--    the backend's own (0039): the pulse says only whether there is one.
-- 2. A pulse of the firm (`firm_pulse`), for the home: a mark of what the
--    home shows to the person who asks (what waits, the counts of the day,
--    where the cases are along their way, the latest cases moved).
-- 3. A decision is the judgment only when it is (`publications.judgment`):
--    the court publishes many decisions before its judgment (an injunction,
--    an order on costs), and a case whose triage said "decisão" was shown as
--    judged. The app reads the publication's own words when a person triages
--    it as a decision and records what they say clearly (`rule`); when they
--    say nothing clear, it asks the person, who answers (`person`). Only a
--    publication said to be the judgment marks the case's judgment
--    (`firm_case_journey`, replacing the one of 0082). The decisions triaged
--    before are read by the type the DJEN gave them (a "Sentença" or an
--    "Acórdão" is the judgment); the rest wait for a person's word.
-- ============================================================

-- ---------- 3. A decision is the judgment only when it is ----------

alter table public.publications add column judgment boolean;
alter table public.publications add column judgment_source text;
alter table public.publications add column judgment_by uuid references public.profiles (id) on delete set null;
alter table public.publications add column judgment_at timestamptz;
alter table public.publications add constraint publications_judgment_source_check
  check (judgment_source is null or judgment_source in ('rule', 'person'));
alter table public.publications add constraint publications_judgment_check
  check (judgment is null or category = 'decisao');

grant select (judgment, judgment_source, judgment_by, judgment_at) on table public.publications to authenticated;

/**
 * A publication that stops being a decision is no judgment any longer, whoever said it was: a triage changed
 * to another word takes the word on the judgment with it.
 */
create or replace function public.publications_judgment_follows_category()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.category is distinct from 'decisao' and (new.judgment is not null or new.judgment_source is not null) then
    new.judgment := null;
    new.judgment_source := null;
    new.judgment_by := null;
    new.judgment_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.publications_judgment_follows_category() from public, anon, authenticated;

create trigger publications_judgment_follows_category before update of category on public.publications
  for each row execute function public.publications_judgment_follows_category();

-- The decisions triaged before: the type the DJEN gave the communication says it when it is a judgment.
update public.publications
set judgment = true, judgment_source = 'rule', judgment_at = now()
where category = 'decisao' and judgment is null
  and lower(coalesce(document_type, '')) ~ '(senten[cç]a|ac[oó]rd[aã]o)';

/**
 * Whether a publication triaged as a decision is the lawsuit's judgment. `rule` is the app's reading of the
 * publication's own words, written right after a person triaged it as a decision, and never over a word already
 * said; `person` is the answer of who triages publications (who signs, or who runs the firm's deadlines), which
 * may correct the rule's. Never a support visit; on the record, and told in the case's timeline.
 */
create or replace function public.set_publication_judgment(
  target_publication uuid,
  target_judgment boolean,
  target_source text default 'person'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  publication public.publications%rowtype;
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if target_judgment is null or target_source is null or target_source not in ('rule', 'person') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  select * into publication from public.publications where id = target_publication for update;
  if not found or not public.is_org_member(publication.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(publication.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not publication.active then
    return jsonb_build_object('ok', false, 'code', 'cancelled');
  end if;
  if publication.category is distinct from 'decisao' then
    return jsonb_build_object('ok', false, 'code', 'not_decision');
  end if;
  -- The rule reads the words once, and never over what somebody already said.
  if target_source = 'rule' and publication.judgment_source is not null then
    return jsonb_build_object('ok', true, 'code', 'kept', 'judgment', publication.judgment);
  end if;
  if publication.judgment is not distinct from target_judgment and publication.judgment_source = target_source then
    return jsonb_build_object('ok', true, 'code', 'kept', 'judgment', publication.judgment);
  end if;

  update public.publications
  set judgment = target_judgment, judgment_source = target_source, judgment_by = caller, judgment_at = now()
  where id = publication.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (publication.org_id, caller, 'publication.judgment', 'publication', publication.id::text,
    jsonb_build_object('judgment', target_judgment, 'source', target_source, 'previous', publication.judgment));
  if publication.case_id is not null then
    perform public.record_case_event(publication.org_id, publication.case_id, 'publication_judged', 'person',
      jsonb_build_object('publication', publication.id, 'judgment', target_judgment, 'source', target_source,
        'day', publication.available_on));
  end if;
  return jsonb_build_object('ok', true, 'code', 'saved', 'judgment', target_judgment);
end;
$$;

revoke all on function public.set_publication_judgment(uuid, boolean, text) from public, anon;
grant execute on function public.set_publication_judgment(uuid, boolean, text) to authenticated;

/**
 * Where a firm's cases are along their way (replaces the one of 0082): a case in court is judged only by a
 * publication said to be the judgment, never by any decision.
 */
create or replace function public.firm_case_journey(target_org uuid, target_module text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'status', g.status, 'held', g.held, 'decided', g.decided, 'paid', g.paid, 'cases', g.cases
    ) order by g.status, g.held, g.decided, g.paid)
    from (
      select f.status, f.held, f.decided, f.paid, count(*)::integer as cases
      from (
        select c.status,
          c.status = 'filed' and exists (
            select 1 from public.hearings h where h.case_id = c.id and h.org_id = c.org_id and h.status = 'held'
          ) as held,
          c.status = 'filed' and exists (
            select 1 from public.publications p
            where p.case_id = c.id and p.org_id = c.org_id and p.active and p.category = 'decisao'
              and p.judgment is true
          ) as decided,
          c.status = 'filed' and exists (
            select 1 from public.publications p
            where p.case_id = c.id and p.org_id = c.org_id and p.active and p.category = 'pagamento'
          ) as paid
        from public.cases c
        where c.org_id = target_org and (target_module is null or c.module = target_module)
      ) f
      group by f.status, f.held, f.decided, f.paid
    ) g
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.firm_case_journey(uuid, text) from public, anon;
grant execute on function public.firm_case_journey(uuid, text) to authenticated;

-- ---------- 1. The pulse of a case ----------

/**
 * The mark of a case as its screen shows it, and whether ONE is at it: `stamp` changes whenever a row the case
 * screen reads changes (the case, its people and parties, its trip and the checks of each leg, its documents, what
 * the client told and was asked, its links and acceptances, its signatures and papers, the word on the civil
 * court, its lawsuits with their parties, lawyers, course, pieces, packages, deadlines and hearings, its notices,
 * its complaints, its dossiers, its publications and what ONE read of them, its timeline, and what ONE waits for).
 * `advance.running` says ONE is looking at the case now (a claim of the backend not yet stale), `advance.due` that
 * something it reads changed and it looks again at its next round, `advance.waiting_since` since when it waits for
 * what it waits for. A member of the case's firm; a support visit reads it too (it writes nothing).
 */
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
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_notices t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.admin_complaints t where t.case_id = target_case),
    -- Of a publication, only what a member reads of it: never the AI's word in the shadow.
    (select md5(coalesce(string_agg(concat_ws(',', t.id, t.category, t.triaged_at, t.active, t.cancel_seen_at,
        t.review_due, t.judgment, t.judgment_source), ';' order by t.id), ''))
       from public.publications t where t.case_id = target_case),
    (select md5(coalesce(string_agg(concat_ws(',', r.publication_id, r.kind, r.status, r.reason, r.updated_at), ';'
        order by r.publication_id, r.kind), ''))
       from public.publication_readings r
       where r.publication_id in (select p.id from public.publications p where p.case_id = target_case))
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

-- ---------- 2. The pulse of the firm, for the home ----------

-- The latest event of a firm's cases, read on every pulse of its home.
create index case_events_org_idx on public.case_events (org_id, at desc);

/**
 * The mark of what the home shows the person who asks: what waits for somebody of the firm (`firm_today`,
 * `firm_pending`, each as it reads for this person), where the cases are along their way (`firm_case_journey`)
 * and the latest moved (the cases and the latest event of their timelines). Each function says, as it always
 * does, who may read it.
 */
create or replace function public.firm_pulse(target_org uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object('stamp', md5(concat_ws('|',
    public.firm_today(target_org)::text,
    public.firm_pending(target_org)::text,
    public.firm_case_journey(target_org, null)::text,
    (select concat(count(*), '/', max(c.updated_at)) from public.cases c where c.org_id = target_org),
    (select max(e.at)::text from public.case_events e where e.org_id = target_org)
  )));
$$;

revoke all on function public.firm_pulse(uuid) from public, anon;
grant execute on function public.firm_pulse(uuid) to authenticated;
