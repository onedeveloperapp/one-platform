-- ============================================================
-- 0111_case_standing: who has each case and how long it is at its step, in
-- one pass over a firm's cases (phase 1 of the plan of the controladoria,
-- the outcome of the cases and the firm's finance, agreed by the owner on
-- 2026-11-07).
--
-- The top of a case says who has it (`caseNow` in lib/cases/now.ts), from
-- the rows its screen reads, one case at a time. A panel of a firm's whole
-- stock cannot read a case screen per case, and if it had a rule of its own
-- it would say another person than the case does. `case_standing` is the
-- same rule over every open case of a firm, a set at a time: each line the
-- top says becomes a mark of whose it is, and who has the case is decided
-- in the order the top decides it (the firm, ONE at work, the client, the
-- platform; else the court for a case in court, and ONE for any other). A
-- test of the app (`standing.db.test.ts`) reads each case through the very
-- reads of its screen and through this function, and compares them line by
-- line; another compares the table of who owns each wait (`WAIT_PLACE`)
-- with `wait_owner`.
--
-- It says too which step of its way the case is at (as the top of the case:
-- at the signature while a paper waits, at the filing once a package is
-- asked for) and since when: a stage by when the case entered it, the
-- hearing by the lawsuit's filing (a portfolio brought from a spreadsheet
-- is old by its filing, not by the day it was imported), the judgment by
-- the latest hearing held, the payment by the judgment, and closing it by
-- the first payment.
--
-- A case is stagnant when it is at a step for more days than the setting
-- says of that step (`platform_settings` `controladoria` `stagnant_days`;
-- the rule is `estoque-v1` of @flyee/rules/stock, compared with the
-- database by the same test). The numbers are a first proposal, and data.
--
-- `firm_cases` (0110) is redefined: each row of the page says who has the
-- case and why, its step, since when, how many days and whether it
-- stagnated (read for the page's cases alone), and six views list them
-- (`com-escritorio`, `com-cliente`, `com-one`, `no-tribunal`,
-- `com-plataforma`, `estagnados`: read for every case only when one of them
-- is asked). The function takes the same arguments, so the code already
-- published reads it as before. `firm_case_stock` answers the panel and the
-- counts of those views: the cases at each step, how many stagnated, the
-- median and the oldest days, and who has them, under the list's own filters.
-- Measured on 20,000 invented cases: who has every case is a second or so,
-- so a list's page and the home never pay it.
-- ============================================================

update public.platform_settings
set value = value || jsonb_build_object(
  'stagnant_days', coalesce(value -> 'stagnant_days', '{"intake": 7, "documents": 15, "signature": 15, "drafting": 15,
    "filing": 15, "hearing": 120, "judgment": 120, "payment": 90}'::jsonb))
where key = 'controladoria';

/**
 * Who a wait of ONE is for (`WAIT_PLACE` of lib/cases/advance.ts, kept together by a test): a code nobody has words
 * for is the firm's. Internal.
 */
create or replace function public.wait_owner(target_code text)
returns text
language sql
immutable
as $$
  select case
    when target_code in (
      'case_incomplete', 'civil_court_unanswered', 'power_of_attorney_unsigned', 'client_confirmation',
      'account_missing', 'account_incomplete'
    ) then 'client'
    when target_code in ('account_preparing', 'account_contested', 'unavailable', 'step_failed') then 'one'
    when target_code in ('ceiling_unknown', 'system_unknown', 'system_refused') then 'platform'
    else 'firm'
  end;
$$;

revoke all on function public.wait_owner(text) from public, anon, authenticated;

/**
 * Who has each open case of a firm, and why; which step of its way it is at, and since when. The same rule as the
 * top of the case (`caseNow`), a set at a time; a test compares the two case by case. What the top reads of a person
 * (the data, the documents) is read here for every case; what only a few cases have (a lawsuit in the civil court, a
 * package, a piece) is asked of the functions the screen itself asks, for those few. With `target_cases`, only those
 * cases are read (a page of the list). Internal: `firm_cases` and `firm_case_stock` answer it, each asking who is
 * reading.
 */
create or replace function public.case_standing(
  target_org uuid,
  target_module text default null,
  target_cases uuid[] default null
)
returns table (case_id uuid, holder text, why text, step text, step_since timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with knobs as materialized (
    select
      (now() at time zone 'America/Sao_Paulo')::date as today,
      greatest(public.case_advance_setting('stale_minutes', 15), 1) as stale,
      greatest(public.pending_setting('link_late_minutes', 30), 1) as link_late,
      greatest(public.hearings_setting('duration_minutes', 60), 1) as hearing_minutes,
      greatest(public.statements_setting('max_rounds', 3), 0) as max_rounds,
      greatest(public.publications_setting('max_attempts', 3), 1) as triage_attempts,
      greatest(public.publications_setting('triage_days', 7), 1) as triage_days,
      public.firm_autonomy_mode(target_org, 'publication_triage') = 'auto' as one_triages,
      coalesce(public.cases_setting('required_documents'), '[]'::jsonb) as required
  ), k as materialized (
    select c.id, c.status, c.created_at, c.status_changed_at
    from public.cases c
    where c.org_id = target_org and (target_module is null or c.module = target_module)
      and c.status not in ('closed', 'declined')
      and (target_cases is null or c.id = any (target_cases))

  -- ---------- What the case lacks of its people, papers and trip (`caseMissing`) ----------
  ), people_of as materialized (
    select cp.id as party_id, cp.case_id, cp.person_id, cp.role, cp.guardian_id, cp.created_at,
           (p.birth_date is not null and p.birth_date <= kn.today
             and p.birth_date > (kn.today - interval '18 years')::date) as minor,
           nullif(btrim(p.full_name), '') is null or p.cpf is null or btrim(p.cpf) = '' or p.birth_date is null as lacks_minor,
           nullif(btrim(p.full_name), '') is null or p.cpf is null or btrim(p.cpf) = '' or p.birth_date is null
             or nullif(btrim(p.nationality), '') is null or nullif(btrim(p.marital_status), '') is null
             or nullif(btrim(p.profession), '') is null or nullif(btrim(p.postal_code), '') is null
             or nullif(btrim(p.street), '') is null or nullif(btrim(p.address_number), '') is null
             or nullif(btrim(p.district), '') is null or nullif(btrim(p.city), '') is null
             or nullif(btrim(p.uf), '') is null as lacks_adult
    from public.case_parties cp
    join k on k.id = cp.case_id
    join public.people p on p.id = cp.person_id
    cross join knobs kn
    where cp.role in ('claimant', 'guardian')
  ), holder_of as materialized (
    -- Who answers for the case: the first adult claimant, or else a guardian, or else an adult (`caseHolder`).
    select distinct on (pf.case_id) pf.case_id, pf.party_id, pf.person_id
    from people_of pf
    order by pf.case_id,
      case
        when pf.role = 'claimant' and pf.guardian_id is null and not pf.minor then 1
        when pf.role = 'guardian' then 2
        when not pf.minor then 3
        else 4
      end,
      pf.created_at, pf.party_id
  ), rules as materialized (
    select r ->> 'per' as per,
           array(select jsonb_array_elements_text(coalesce(r -> 'or', '[]'::jsonb))) || (r ->> 'kind') as kinds
    from knobs kn, jsonb_array_elements(kn.required) r
  ), lacks as (
    select pf.case_id from people_of pf
    join holder_of h on h.case_id = pf.case_id
    where (pf.role = 'claimant' or pf.person_id = h.person_id)
      and (case when pf.minor then pf.lacks_minor else pf.lacks_adult end)
    union
    select h.case_id from holder_of h
    where not exists (select 1 from public.flight_segments s where s.case_id = h.case_id)
    union
    select h.case_id from holder_of h
    join rules r on r.per = 'case'
    where not exists (
      select 1 from public.case_documents d
      where d.case_id = h.case_id and d.kind = any (r.kinds) and d.status not in ('uploading', 'rejected')
    )
    union
    select h.case_id from holder_of h
    join rules r on r.per = 'holder'
    where not exists (
      select 1 from public.case_documents d
      join public.case_parties cp on cp.id = d.party_id
      where d.case_id = h.case_id and cp.person_id = h.person_id and d.kind = any (r.kinds)
        and d.status not in ('uploading', 'rejected')
    )
    union
    select pf.case_id from people_of pf
    join rules r on r.per = 'claimant'
    where pf.role = 'claimant' and not exists (
      select 1 from public.case_documents d
      where d.case_id = pf.case_id and d.party_id = pf.party_id and d.kind = any (r.kinds)
        and d.status not in ('uploading', 'rejected')
    )

  -- ---------- The documents ----------
  ), docs as (
    select d.case_id,
           bool_or(d.processing in ('pending', 'working')) as checking,
           bool_or(d.processing not in ('pending', 'working') and (
             d.kind <> 'petition'
             or exists (select 1 from public.approvals a where a.run_id = d.check_run_id and a.status = 'pending')
           )) as to_decide
    from public.case_documents d
    where d.org_id = target_org and d.status = 'received' and d.case_id in (select k.id from k)
    group by d.case_id

  -- ---------- The client's account (`case_account_state`, and what ONE is doing of it) ----------
  ), told as (
    select s.case_id,
           bool_or(s.status = 'uploading' or s.work is not null) as busy,
           bool_or(s.chronology_status = 'proposed') as proposed,
           bool_or(s.chronology_status in ('approved', 'confirmed')
             and (cardinality(s.missing_topics) = 0 or s.rounds >= kn.max_rounds)) as settled,
           bool_or(s.chronology_status in ('approved', 'confirmed')) as ordered,
           bool_or(s.chronology_status = 'contested') as contested,
           bool_or(s.status = 'received' and s.work in ('transcribe', 'chronology') and not (
             case
               when s.work_claimed_at is null
                 then s.work_error is not null or s.created_at < now() - interval '2 minutes'
               else s.work_claimed_at < now() - interval '15 minutes'
             end
           )) as working
    from public.case_statements s
    cross join knobs kn
    where s.org_id = target_org and s.case_id in (select k.id from k)
    group by s.case_id
  ), account as (
    select k.id as case_id,
           (i.status = 'open') is true as interview_open,
           case
             when i.case_id is not null then case when i.status = 'open' then 'incomplete' else 'ready' end
             when t.case_id is null then 'missing'
             when t.busy then 'preparing'
             when t.proposed then 'proposed'
             when t.settled then 'ready'
             when t.ordered then 'incomplete'
             when t.contested then 'contested'
             else 'failed'
           end as state,
           coalesce(t.working, false) as working
    from k
    left join public.case_interviews i on i.case_id = k.id
    left join told t on t.case_id = k.id

  -- ---------- The client's link ONE owes (`case_links_owed`) ----------
  ), reach as (
    -- Who is owed a link, read for the whole firm at once even for a page of the list: case by case it costs a
    -- millisecond a case, the whole firm's 20,000 some fifty.
    select r.case_id, r.reason, r.since from public.client_link_reach(target_org) r
    where r.case_id in (select k.id from k)
  ), links as (
    select r.case_id,
           bool_or(r.reason is null and r.since >= now() - make_interval(mins => kn.link_late)) as sending,
           bool_or(r.reason in ('no_conversation', 'window_closed')) as clients,
           bool_or((r.reason is null and r.since < now() - make_interval(mins => kn.link_late))
             or r.reason in ('by_person', 'no_phone', 'no_number', 'opted_out')) as firms
    from reach r
    cross join knobs kn
    group by r.case_id

  -- ---------- What the client signs ----------
  ), envelopes as (
    select e.case_id,
           bool_or(e.status in ('reserved', 'opening')) as opening,
           bool_or(e.status = 'pending') as pending,
           bool_or(e.status = 'received') as received,
           bool_or(e.status = 'uncertain') as uncertain,
           bool_or(e.status = 'failed') as failed,
           min(e.created_at) filter (where e.status in ('reserved', 'opening', 'pending', 'received', 'uncertain')) as waits_since
    from public.signature_envelopes e
    where e.org_id = target_org and e.case_id in (select k.id from k)
    group by e.case_id

  -- ---------- The word of each claimant on the civil court (`civil_court_needs`) ----------
  ), civil as (
    select pc.case_id,
           bool_or(n.accepted is false) as declined,
           bool_or(n.accepted is null) as unanswered
    from (
      select distinct p.case_id from public.proceedings p
      join k on k.id = p.case_id
      where p.org_id = target_org and p.status = 'planned' and p.kind = 'comum'
    ) pc
    cross join lateral public.civil_court_needs(pc.case_id) n
    where n.planned
    group by pc.case_id

  -- ---------- The lawsuits still planned: their system, who signs them, their piece and their package ----------
  ), lawsuits as (
    select p.case_id,
           count(*) as total,
           bool_or(p.status = 'planned' and (p.system is null or p.system_refused_at is not null)) as system_platform,
           bool_or(p.status = 'planned' and p.system is not null and p.system_refused_at is null
             and p.system_approved_at is null) as system_firm,
           min(p.filed_at) filter (where p.status in ('filed', 'closed')) as first_filed
    from public.proceedings p
    where p.org_id = target_org and p.case_id in (select k.id from k)
    group by p.case_id
  ), unnamed as (
    select distinct w.case_id
    from (
      select distinct p.case_id from public.proceedings p
      join public.case_papers paper on paper.case_id = p.case_id and paper.kind = 'procuracao'
      join k on k.id = p.case_id
      where p.org_id = target_org and p.status = 'planned'
    ) w
    cross join lateral public.case_power_signers_missing(w.case_id) m
  ), piece as (
    -- The piece of each planned lawsuit: its latest not given up.
    select distinct on (d.proceeding_id) d.id, d.case_id, d.status, d.work
    from public.case_drafts d
    join public.proceedings p on p.id = d.proceeding_id and p.status = 'planned'
    join k on k.id = d.case_id
    where d.org_id = target_org and d.status not in ('cancelled', 'rejected')
    order by d.proceeding_id, d.requested_at desc
  ), piece_read as (
    select pc.*, a.interview_open,
           pc.status = 'proposed' and pc.work is null and not a.interview_open and exists (
             select 1 from public.case_pieces_to_redo(pc.case_id) r where r.draft_id = pc.id
           ) as rewriting
    from piece pc
    join account a on a.case_id = pc.case_id
  ), pieces as (
    select pr.case_id,
           bool_or(pr.work in ('generate', 'revise', 'check', 'issue') or pr.status in ('generating', 'approved') or pr.rewriting) as one,
           bool_or(not (pr.work is not null and pr.work in ('generate', 'revise', 'check', 'issue'))
             and pr.status = 'proposed' and not pr.rewriting and pr.interview_open) as asking,
           bool_or(not (pr.work is not null and pr.work in ('generate', 'revise', 'check', 'issue'))
             and pr.status = 'proposed' and not pr.rewriting and not pr.interview_open) as review,
           bool_or(not (pr.work is not null and pr.work in ('generate', 'revise', 'check', 'issue'))
             and pr.status = 'failed') as failed
    from piece_read pr
    group by pr.case_id
  ), package as (
    -- The package in course of each planned lawsuit.
    select distinct on (f.proceeding_id) f.id
    from public.filing_packages f
    join public.proceedings p on p.id = f.proceeding_id and p.status = 'planned'
    join k on k.id = f.case_id
    where f.org_id = target_org and f.status not in ('cancelled', 'filed')
    order by f.proceeding_id, f.requested_at desc
  ), package_read as (
    select f.case_id, f.status, f.requested_at, f.signature_status, x.blocker, x.signs, x.channel, x.sent,
           x.sending_blocker,
           x.blocker is null and x.signs and f.signature_status in ('due', 'waiting', 'failed') as by_signature
    from package pk
    join public.filing_packages f on f.id = pk.id
    cross join lateral (
      select
        case when f.status = 'ready' then public.filing_blocker(f.proceeding_id) end as blocker,
        exists (
          select 1 from public.court_systems cs
          where cs.court = f.court and cs.proceeding_kind = f.kind and cs.system = f.system and cs.signed_files = 'p7s'
        ) as signs,
        public.filing_channel_of(f) as channel,
        (select s.status from public.filing_submissions s where s.package_id = f.id) as sent,
        case when f.status = 'ready' then public.filing_submission_blocker(f) end as sending_blocker
    ) x
  ), packages as (
    select pr.case_id,
           min(pr.requested_at) filter (where pr.status in ('requested', 'ready')) as since,
           -- What ONE is doing: building it, signing it, or filing it through the court's channel.
           bool_or(pr.status = 'requested'
             or (pr.status = 'ready' and pr.by_signature and pr.signature_status = 'due')
             or (pr.status = 'ready' and pr.blocker is null and not pr.by_signature
               and coalesce(pr.sent, '') not in ('refused', 'failed', 'unknown', 'filed')
               and pr.channel is not null and (pr.sent is not null or pr.sending_blocker is null))) as one,
           bool_or(pr.status = 'failed'
             or (pr.status = 'ready' and pr.by_signature and pr.signature_status = 'failed')
             or (pr.status = 'ready' and pr.blocker is null and not pr.by_signature and pr.sent in ('refused', 'failed'))) as failed,
           bool_or((pr.status = 'ready' and pr.blocker is not null and public.wait_owner(pr.blocker) = 'firm')
             or (pr.status = 'ready' and pr.by_signature and pr.signature_status = 'waiting')
             or (pr.status = 'ready' and pr.blocker is null and not pr.by_signature and (
               pr.sent in ('unknown', 'filed')
               or (coalesce(pr.sent, '') not in ('refused', 'failed', 'unknown', 'filed')
                 and not (pr.channel is not null and (pr.sent is not null or pr.sending_blocker is null)))
             ))) as firms,
           bool_or(pr.status = 'ready' and pr.blocker is not null and public.wait_owner(pr.blocker) = 'client') as clients,
           bool_or(pr.status = 'ready' and pr.blocker is not null and public.wait_owner(pr.blocker) = 'platform') as platform
    from package_read pr
    group by pr.case_id

  -- ---------- In court ----------
  ), terms as (
    select d.case_id,
           bool_or(public.deadline_urgent_on(d.status, d.due_on, d.computed_due_on, d.computed_revision, d.revision,
             d.confirmed_against) < kn.today) as overdue,
           bool_or(d.status = 'proposed') as to_confirm,
           bool_or(cardinality(public.deadline_review_reasons_of(d.status, d.publication_id, d.confirmed_at,
             d.confirmed_revision, d.revision, d.computed_revision, d.computed_due_on, d.confirmed_against, d.due_on,
             d.count_error, d.count_claimed_at, d.count_attempts)) > 0) as to_review
    from public.deadlines d
    cross join knobs kn
    where d.org_id = target_org and d.status in ('proposed', 'confirmed') and d.case_id in (select k.id from k)
    group by d.case_id
  ), hearing_facts as (
    select h.case_id,
           bool_or(h.status = 'scheduled' and h.starts_at + make_interval(mins => kn.hearing_minutes) <= now()) as silent,
           max(h.starts_at) filter (where h.status = 'held') as held_at
    from public.hearings h
    cross join knobs kn
    where h.org_id = target_org and h.case_id in (select k.id from k)
    group by h.case_id
  ), published as (
    select p.case_id,
           bool_or(p.category is null and x.triaging) as triaging,
           bool_or(p.category is null and not x.triaging) as untriaged,
           bool_or(p.ack_owed) as ack,
           bool_or(p.category = 'decisao' and p.judgment is null) as ask_judgment,
           bool_or(p.category = 'pagamento') as paid,
           min(p.available_on) filter (where p.category = 'decisao' and p.judgment is true) as decided_on,
           min(p.available_on) filter (where p.category = 'pagamento') as paid_on
    from public.publications p
    cross join knobs kn
    cross join lateral (
      select p.ai_category is null and not p.truncated and p.ai_attempts < kn.triage_attempts
        and p.captured_at > now() - make_interval(days => kn.triage_days) and kn.one_triages as triaging
    ) x
    where p.org_id = target_org and p.active and p.case_id in (select k.id from k)
    group by p.case_id
  ), readings as (
    select p.case_id,
           bool_or(r.status in ('due', 'working')) as working,
           bool_or(r.status in ('unread', 'failed')) as left_to_person
    from public.publication_readings r
    join public.publications p on p.id = r.publication_id
    where r.org_id = target_org and p.active and p.case_id in (select k.id from k)
    group by p.case_id
  ), complaints as (
    select distinct a.case_id
    from public.admin_complaints a
    cross join knobs kn
    where a.org_id = target_org and a.outcome = 'pending' and a.answer_due_on < kn.today
      and a.case_id in (select k.id from k)

  -- ---------- ONE's own look at the case, and what it recorded it waits for ----------
  ), advance as (
    select a.case_id,
           a.claimed_at is not null and a.claimed_at > now() - make_interval(mins => kn.stale) as running,
           a.woken_at is not null and (a.checked_at is null or a.woken_at > a.checked_at)
             and (a.after is null or a.after <= now()) as due,
           -- What the top says from the case's own facts is not said again as the wait ONE recorded.
           case when a.waiting not in (
             'case_incomplete', 'civil_court_unanswered', 'account_missing', 'account_preparing', 'account_proposed',
             'account_incomplete', 'account_contested', 'account_failed', 'documents_waiting', 'system_unapproved',
             'system_refused', 'system_unknown', 'power_of_attorney_unsigned'
           ) then a.waiting end as waiting
    from public.case_advances a
    cross join knobs kn
    where a.org_id = target_org and a.case_id in (select k.id from k)

  -- ---------- All of it, a line per case ----------
  ), marks as (
    select k.id, k.status, k.created_at, k.status_changed_at,
           ac.state as account, ac.working as told_working, coalesce(lw.total, 0) as lawsuits, lw.first_filed,
           coalesce(d.checking, false) as docs_checking, coalesce(d.to_decide, false) as docs_to_decide,
           lk.case_id is not null as lacks_something,
           coalesce(ln.sending, false) as link_sending, coalesce(ln.clients, false) as link_clients,
           coalesce(ln.firms, false) as link_firms,
           coalesce(e.opening, false) as envelope_opening, coalesce(e.pending, false) as envelope_pending,
           coalesce(e.received, false) as envelope_received, coalesce(e.uncertain, false) as envelope_uncertain,
           coalesce(e.failed, false) as envelope_failed, e.waits_since as signature_since,
           coalesce(cv.declined, false) as civil_declined, coalesce(cv.unanswered, false) as civil_unanswered,
           coalesce(lw.system_platform, false) as system_platform, coalesce(lw.system_firm, false) as system_firm,
           un.case_id is not null as signer_unnamed,
           coalesce(pc.one, false) as piece_one, coalesce(pc.asking, false) as piece_asking,
           coalesce(pc.review, false) as piece_review, coalesce(pc.failed, false) as piece_failed,
           coalesce(pk.one, false) as package_one, coalesce(pk.failed, false) as package_failed,
           coalesce(pk.firms, false) as package_firms, coalesce(pk.clients, false) as package_clients,
           coalesce(pk.platform, false) as package_platform, pk.since as filing_since,
           coalesce(t.overdue, false) as term_overdue, coalesce(t.to_confirm, false) as term_confirm,
           coalesce(t.to_review, false) as term_review,
           coalesce(hf.silent, false) as hearing_silent, hf.held_at,
           coalesce(pb.triaging, false) as pub_triaging, coalesce(pb.untriaged, false) as pub_untriaged,
           coalesce(pb.ack, false) as pub_ack, coalesce(pb.ask_judgment, false) as pub_ask,
           coalesce(pb.paid, false) as pub_paid, pb.decided_on, pb.paid_on,
           coalesce(rd.working, false) as reading_working, coalesce(rd.left_to_person, false) as reading_left,
           cm.case_id is not null as complaint_overdue,
           coalesce(ad.running, false) as one_looking, coalesce(ad.due, false) and k.status <> 'filed' as one_due,
           case when k.status <> 'filed' then ad.waiting end as waiting
    from k
    join account ac on ac.case_id = k.id
    left join lawsuits lw on lw.case_id = k.id
    left join docs d on d.case_id = k.id
    left join (select distinct l.case_id from lacks l) lk on lk.case_id = k.id
    left join links ln on ln.case_id = k.id
    left join envelopes e on e.case_id = k.id
    left join civil cv on cv.case_id = k.id
    left join unnamed un on un.case_id = k.id
    left join pieces pc on pc.case_id = k.id
    left join packages pk on pk.case_id = k.id
    left join terms t on t.case_id = k.id
    left join hearing_facts hf on hf.case_id = k.id
    left join published pb on pb.case_id = k.id
    left join readings rd on rd.case_id = k.id
    left join complaints cm on cm.case_id = k.id
    left join advance ad on ad.case_id = k.id
  ), decided as (
    select m.*,
      -- The firm's lines, its failures first, in the order the top lists them.
      case
        when m.account = 'failed' then 'account_failed'
        when m.envelope_failed then 'signature_failed'
        when m.piece_failed then 'piece_failed'
        when m.package_failed then 'filing_failed'
        when m.term_overdue then 'deadline_overdue'
        when m.waiting = 'stuck' then 'wait:stuck'
        when m.docs_to_decide then 'documents'
        when m.civil_declined then 'civil_declined'
        when m.account = 'proposed' then 'account_proposed'
        when m.link_firms then 'link'
        when m.envelope_received or m.envelope_uncertain then 'signature_check'
        when m.system_firm then 'system_unapproved'
        when m.signer_unnamed then 'power_unnamed'
        when m.piece_review then 'piece_review'
        when m.package_firms then 'filing'
        when m.term_confirm then 'deadline_confirm'
        when m.term_review then 'deadline_review'
        when m.hearing_silent then 'hearing_silent'
        when m.pub_untriaged then 'publication_triage'
        when m.pub_ack then 'publication_ack'
        when m.pub_ask then 'judgment_ask'
        when m.reading_left then 'reading_left'
        when m.status = 'filed' and m.pub_paid then 'payment'
        when m.complaint_overdue then 'complaint'
        when m.waiting is not null and public.wait_owner(m.waiting) = 'firm' then 'wait:' || m.waiting
      end as firm_why,
      -- What ONE is doing now.
      case
        when m.one_looking then 'one_looking'
        when m.one_due then 'one_due'
        when m.docs_checking then 'documents'
        when m.told_working or m.account in ('preparing', 'contested') then 'account'
        when m.link_sending then 'link'
        when m.envelope_opening then 'signature'
        when m.piece_one then 'piece'
        when m.package_one then 'filing'
        when m.pub_triaging then 'publication_triage'
        when m.reading_working then 'reading'
        when m.waiting is not null and public.wait_owner(m.waiting) = 'one' then 'wait:' || m.waiting
      end as one_why,
      -- What waits on the client.
      case
        when m.lacks_something then 'lacks'
        when m.civil_unanswered then 'civil_unanswered'
        when m.account in ('missing', 'incomplete') and m.lawsuits = 0 then 'account'
        when m.link_clients then 'link'
        when m.envelope_pending then 'signature'
        when m.piece_asking then 'piece_asking'
        when m.package_clients then 'filing'
        when m.waiting is not null and public.wait_owner(m.waiting) = 'client' then 'wait:' || m.waiting
      end as client_why,
      -- What waits on the platform of ONE.
      case
        when m.system_platform then 'system'
        when m.package_platform then 'filing'
        when m.waiting is not null and public.wait_owner(m.waiting) = 'platform' then 'wait:' || m.waiting
      end as platform_why,
      -- The step of its way: the stage, what its lawsuits show in court, and what its work shows before the court.
      case
        when m.status <> 'filed' and m.signature_since is not null and m.status in ('drafting', 'ready') then 'signature'
        when m.status = 'drafting' and m.filing_since is not null then 'filing'
        when m.status = 'ready' then 'filing'
        when m.status <> 'filed' then m.status
        when m.paid_on is not null then 'closed'
        when m.decided_on is not null then 'payment'
        when m.held_at is not null then 'judgment'
        else 'hearing'
      end as way
    from marks m
  )
  select d.id,
    case
      when d.firm_why is not null then 'firm'
      when d.one_why is not null then 'one'
      when d.client_why is not null then 'client'
      when d.platform_why is not null then 'platform'
      when d.status = 'filed' then 'court'
      else 'one'
    end,
    coalesce(d.firm_why, d.one_why, d.client_why, d.platform_why),
    d.way,
    case d.way
      when 'signature' then coalesce(d.signature_since, d.status_changed_at)
      when 'filing' then case when d.status = 'ready' then d.status_changed_at else d.filing_since end
      when 'hearing' then coalesce(d.first_filed::timestamp at time zone 'America/Sao_Paulo', d.status_changed_at)
      when 'judgment' then d.held_at
      when 'payment' then d.decided_on::timestamp at time zone 'America/Sao_Paulo'
      when 'closed' then d.paid_on::timestamp at time zone 'America/Sao_Paulo'
      else d.status_changed_at
    end
  from decided d;
$$;

revoke all on function public.case_standing(uuid, text, uuid[]) from public, anon, authenticated;

create or replace function public.firm_cases(
  target_org uuid,
  target_filter text default null,
  target_search text default null,
  target_limit integer default 25,
  target_offset integer default 0,
  target_module text default null,
  target_sort text default null,
  target_incident text default null,
  target_airline text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  -- The month so far, and the same days of the month before (its last day when it is shorter).
  month_start date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  prev_start date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) - interval '1 month')::date;
  prev_until date;
  month_from timestamptz;
  prev_from timestamptz;
  prev_moment timestamptz;
  -- The court's days, in Brasília: today, the last 7 and the last 30, and the start of each quiet mark.
  day_from timestamptz := today::timestamp at time zone 'America/Sao_Paulo';
  week_from timestamptz := (today - 6)::timestamp at time zone 'America/Sao_Paulo';
  thirty_from timestamptz := (today - 29)::timestamp at time zone 'America/Sao_Paulo';
  quiet_30_from timestamptz := (today - 30)::timestamp at time zone 'America/Sao_Paulo';
  quiet_45_from timestamptz := (today - 45)::timestamp at time zone 'America/Sao_Paulo';
  quiet_90_from timestamptz := (today - 90)::timestamp at time zone 'America/Sao_Paulo';
  wanted text := nullif(btrim(coalesce(target_filter, '')), '');
  sort_by text := coalesce(nullif(btrim(coalesce(target_sort, '')), ''), 'recent');
  kind_wanted text := nullif(btrim(coalesce(target_incident, '')), '');
  airline_wanted text := nullif(upper(btrim(coalesce(target_airline, ''))), '');
  typed text := left(btrim(coalesce(target_search, '')), 120);
  digits text := regexp_replace(typed, '\D', '', 'g');
  -- What was typed with a letter in it is a name: its words as `slugify` writes them (no accent, no case).
  name_words text[] := case when typed ~ '[[:alpha:]]' then
    array(select w from regexp_split_to_table(public.slugify(typed), '-') as w where w <> '') end;
  -- What was typed with no letter is a number: a case's own, a CPF, or how a lawsuit's number starts.
  seq_wanted integer := case when name_words is null and digits ~ '^[0-9]{1,6}$' then digits::integer end;
  cpf_wanted text := case when name_words is null and char_length(digits) = 11 then digits end;
  cnj_start text := case when name_words is null and char_length(digits) between 5 and 20 then digits end;
  searching boolean;
  -- A page of the screen holds 100 at most; an export the person began reads its pages larger
  -- (`firm_cases_export`, which sets this for its own call only: no API role reaches the setting).
  page_size integer := least(
    greatest(coalesce(target_limit, 25), 1),
    greatest(100, coalesce(nullif(current_setting('one.case_export_page', true), '')::integer, 100))
  );
  skip integer := greatest(coalesce(target_offset, 0), 0);
  answer jsonb;
  -- How many days at each step make a case stagnant (`estoque-v1`): the setting's, read once.
  limits jsonb := coalesce(
    (select s.value -> 'stagnant_days' from public.platform_settings s where s.key = 'controladoria'), '{}'::jsonb
  );
  -- The cases of a view of who has them, when that is the view asked for: who has each case is read for the
  -- whole firm only then (it reads every open case), and for the page's rows otherwise.
  standing_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if wanted is not null and wanted not in (
    'open', 'preparing', 'filed', 'ended',
    'documentos', 'cliente-terminou', 'cronologia', 'reclamacao', 'pecas', 'andamento', 'vara-civel', 'agencia',
    'novos-mes', 'ajuizados-mes', 'encerrados-mes', 'arquivados-mes',
    'mov-hoje', 'mov-7', 'mov-30', 'parado-30', 'parado-45', 'parado-90', 'nunca-capturados',
    'com-escritorio', 'com-cliente', 'com-one', 'no-tribunal', 'com-plataforma', 'estagnados'
  ) then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  if sort_by not in ('recent', 'oldest', 'newest', 'first') then
    raise exception 'invalid_sort' using errcode = '22023';
  end if;
  if (kind_wanted is not null and kind_wanted !~ '^[a-z][a-z0-9_-]{1,40}$')
    or (airline_wanted is not null and airline_wanted !~ '^[A-Z0-9]{2,3}$') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  searching := name_words is not null or digits <> '';
  prev_until := least(prev_start + (today - month_start), month_start - 1);
  month_from := month_start::timestamp at time zone 'America/Sao_Paulo';
  prev_from := prev_start::timestamp at time zone 'America/Sao_Paulo';
  -- The end of the same day of the month before.
  prev_moment := (prev_until + 1)::timestamp at time zone 'America/Sao_Paulo';
  if wanted in ('com-escritorio', 'com-cliente', 'com-one', 'no-tribunal', 'com-plataforma', 'estagnados') then
    select coalesce(array_agg(s.case_id), '{}'::uuid[]) into standing_ids
    from public.case_standing(target_org, target_module) s
    where case wanted
      when 'com-escritorio' then s.holder = 'firm'
      when 'com-cliente' then s.holder = 'client'
      when 'com-one' then s.holder = 'one'
      when 'no-tribunal' then s.holder = 'court'
      when 'com-plataforma' then s.holder = 'platform'
      else jsonb_typeof(limits -> s.step) = 'number'
        and greatest(today - (s.step_since at time zone 'America/Sao_Paulo')::date, 0) > (limits ->> s.step)::numeric
    end;
  end if;

  with found as (
    -- The cases a search names, a set at a time: a client's name, a CPF, a case's own number, how a lawsuit's
    -- number starts. Each set is the firm's.
    select cp.case_id as id from public.people p
    join public.case_parties cp on cp.person_id = p.id
    where name_words is not null and p.org_id = target_org
      and not exists (
        select 1 from unnest(name_words) as word where position(word in public.slugify(p.full_name)) = 0
      )
    union
    select cp.case_id from public.people p
    join public.case_parties cp on cp.person_id = p.id
    where cpf_wanted is not null and p.org_id = target_org and p.cpf = cpf_wanted
    union
    select c.id from public.cases c
    where seq_wanted is not null and c.org_id = target_org and c.seq = seq_wanted
    union
    select pr.case_id from public.proceedings pr
    where cnj_start is not null and pr.org_id = target_org and left(pr.cnj, char_length(cnj_start)) = cnj_start
  ), review as (
    select d.case_id, count(*)::integer as waiting
    from public.case_documents d
    where d.org_id = target_org and d.status = 'received'
    group by d.case_id
  ), finished as (
    select distinct l.case_id from public.client_links l
    where l.org_id = target_org and l.finished_at is not null and l.revoked_at is null
  ), contested as (
    select distinct s.case_id from public.case_statements s
    where s.org_id = target_org and s.chronology_status = 'contested'
  ), overdue as (
    select distinct a.case_id from public.admin_complaints a
    where a.org_id = target_org and a.outcome = 'pending' and a.answer_due_on < today
  ), pieces as (
    select distinct d.case_id from public.case_drafts d
    join public.proceedings p on p.id = d.proceeding_id
    where d.org_id = target_org and p.status = 'planned'
      and (
        (d.status = 'proposed' and d.work is distinct from 'revise' and not exists (
          select 1 from public.approvals a where a.run_id = d.run_id and a.status = 'pending'
        ))
        or d.status = 'failed'
        or (d.status = 'approved' and d.work is null)
      )
  ), moved as (
    select distinct t.case_id from public.proceeding_tracking t
    where t.org_id = target_org and ((t.status <> 'off' and t.unseen_count > 0) or t.status = 'failed')
  ), refused as (
    -- A claimant said no to the civil court for a lawsuit planned there (0025).
    select distinct a.case_id from public.civil_court_answers a
    where a.org_id = target_org and a.replaced_at is null and not a.accepted
      and a.person_id is not distinct from public.civil_court_answerer(a.party_id)
      and exists (
        select 1 from public.proceeding_parties pp
        join public.proceedings p on p.id = pp.proceeding_id
        where pp.party_id = a.party_id and p.status = 'planned' and p.kind = 'comum'
      )
  ), filed_now as (
    -- A lawsuit of the case filed this month, and in the same days of the month before.
    select distinct pr.case_id from public.proceedings pr
    where pr.org_id = target_org and pr.status in ('filed', 'closed')
      and pr.filed_at between month_start and today
  ), filed_prev as (
    select distinct pr.case_id from public.proceedings pr
    where pr.org_id = target_org and pr.status in ('filed', 'closed')
      and pr.filed_at between prev_start and prev_until
  ), court as (
    -- What the court did in each case: when a lawsuit of it in court last moved; when the most recent of the
    -- lawsuits ONE read last did something (its last movement, else its filing); and whether a lawsuit of it in
    -- court was never read by any source.
    select pr.case_id,
           max(t.last_movement_at) as moved_at,
           max(coalesce(t.last_movement_at, pr.filed_at::timestamp at time zone 'America/Sao_Paulo'))
             filter (where t.read_at is not null) as active_at,
           bool_or(t.id is null or (t.read_at is null and t.status <> 'off')) as never_read
    from public.proceedings pr
    left join public.proceeding_tracking t on t.proceeding_id = pr.id and t.org_id = pr.org_id
    where pr.org_id = target_org and pr.status = 'filed'
    group by pr.case_id
  ), flagged as (
    select c.id, c.seq, c.module, c.incident, c.airline_iata, c.flight_date, c.status, c.updated_at, c.partnership_id,
           c.created_at, c.closed_at,
           coalesce(r.waiting, 0) as to_review,
           -- What waits in a case counts while the case is where it can still be done (as the home counts it).
           (f.case_id is not null and c.status in ('intake', 'documents', 'signature')) as client_finished,
           (ct.case_id is not null and c.status not in ('closed', 'declined')) as chronology_contested,
           (o.case_id is not null and c.status not in ('closed', 'declined')) as complaint_overdue,
           (pc.case_id is not null and c.status not in ('closed', 'declined')) as piece_waiting,
           (m.case_id is not null and c.status not in ('closed', 'declined')) as court_moved,
           (rf.case_id is not null and c.status not in ('closed', 'declined')) as civil_refused,
           -- A case an agency's passenger opened with their yes (0071), while it goes on.
           (c.partnership_id is not null and c.status not in ('closed', 'declined')) as from_agency,
           -- What happened in the month, in the days of Brasília.
           (c.created_at >= month_from) as new_month,
           (fn.case_id is not null) as filed_month,
           (c.status in ('closed', 'declined') and c.closed_at >= month_from) as ended_month,
           (fp.case_id is not null) as filed_before,
           -- The court: what moved today, in the last 7 and 30 days; a case in court quiet for more than 30,
           -- 45 and 90 days (only lawsuits ONE read count); one with a lawsuit no source ever read.
           co.moved_at as court_moved_at,
           (co.moved_at >= day_from) as moved_today,
           (co.moved_at >= week_from) as moved_week,
           (co.moved_at >= thirty_from) as moved_thirty,
           (c.status = 'filed' and co.active_at < quiet_30_from) as quiet_30,
           (c.status = 'filed' and co.active_at < quiet_45_from) as quiet_45,
           (c.status = 'filed' and co.active_at < quiet_90_from) as quiet_90,
           (c.status = 'filed' and coalesce(co.never_read, false)) as never_read,
           -- Archived: a case that went to court and ended, this month and in the same days of the month before.
           (c.status = 'closed' and c.closed_at >= month_from and exists (
             select 1 from public.proceedings pr where pr.case_id = c.id and pr.status in ('filed', 'closed')
           )) as archived_month,
           (c.status = 'closed' and c.closed_at >= prev_from and c.closed_at < prev_moment and exists (
             select 1 from public.proceedings pr where pr.case_id = c.id and pr.status in ('filed', 'closed')
           )) as archived_before
    from public.cases c
    left join review r on r.case_id = c.id
    left join finished f on f.case_id = c.id
    left join contested ct on ct.case_id = c.id
    left join overdue o on o.case_id = c.id
    left join pieces pc on pc.case_id = c.id
    left join moved m on m.case_id = c.id
    left join refused rf on rf.case_id = c.id
    left join filed_now fn on fn.case_id = c.id
    left join filed_prev fp on fp.case_id = c.id
    left join court co on co.case_id = c.id
    where c.org_id = target_org
      and (target_module is null or c.module = target_module)
      and (kind_wanted is null or c.incident = kind_wanted)
      and (airline_wanted is null or c.airline_iata = airline_wanted)
  ), matched as (
    select fl.* from flagged fl
    where (
      case
        when wanted is null then searching or fl.status not in ('closed', 'declined')
        when wanted = 'open' then fl.status in ('intake', 'documents', 'signature')
        when wanted = 'preparing' then fl.status in ('drafting', 'ready')
        when wanted = 'filed' then fl.status = 'filed'
        when wanted = 'ended' then fl.status in ('closed', 'declined')
        when wanted = 'documentos' then fl.to_review > 0
        when wanted = 'cliente-terminou' then fl.client_finished
        when wanted = 'cronologia' then fl.chronology_contested
        when wanted = 'reclamacao' then fl.complaint_overdue
        when wanted = 'pecas' then fl.piece_waiting
        when wanted = 'vara-civel' then fl.civil_refused
        when wanted = 'agencia' then fl.from_agency
        when wanted = 'novos-mes' then fl.new_month
        when wanted = 'ajuizados-mes' then fl.filed_month
        when wanted = 'encerrados-mes' then fl.ended_month
        when wanted = 'arquivados-mes' then fl.archived_month
        when wanted = 'mov-hoje' then fl.moved_today
        when wanted = 'mov-7' then fl.moved_week
        when wanted = 'mov-30' then fl.moved_thirty
        when wanted = 'parado-30' then fl.quiet_30
        when wanted = 'parado-45' then fl.quiet_45
        when wanted = 'parado-90' then fl.quiet_90
        when wanted = 'nunca-capturados' then fl.never_read
        when wanted in ('com-escritorio', 'com-cliente', 'com-one', 'no-tribunal', 'com-plataforma', 'estagnados') then fl.id = any (standing_ids)
        else fl.court_moved
      end
    ) and (not searching or fl.id in (select f.id from found f))
  ), ordered as (
    -- The order the person chose; within it, the latest change first, then the newest case.
    select mt.*, row_number() over (
      order by
        case when sort_by = 'oldest' then mt.updated_at end asc nulls last,
        case when sort_by = 'newest' then mt.seq end desc nulls last,
        case when sort_by = 'first' then mt.seq end asc nulls last,
        mt.updated_at desc, mt.seq desc
    ) as pos
    from matched mt
  ), page as (
    select * from ordered order by pos limit page_size offset skip
  ), standing as materialized (
    -- Who has each case of the page, its step, since when and for how many days (`case_standing`, the rule of the
    -- top of the case), read for these cases alone.
    select s.case_id, s.holder, s.why, s.step, s.step_since,
           greatest(today - (s.step_since at time zone 'America/Sao_Paulo')::date, 0) as step_days
    from public.case_standing(
      target_org, target_module, coalesce((select array_agg(pg.id) from page pg), '{}'::uuid[])
    ) s
  )
  select jsonb_build_object(
    'counts', (
      select jsonb_build_object(
        'all', count(*),
        'going', count(*) filter (where status not in ('closed', 'declined')),
        'open', count(*) filter (where status in ('intake', 'documents', 'signature')),
        'preparing', count(*) filter (where status in ('drafting', 'ready')),
        'filed', count(*) filter (where status = 'filed'),
        'ended', count(*) filter (where status in ('closed', 'declined')),
        'documentos', count(*) filter (where to_review > 0),
        'cliente-terminou', count(*) filter (where client_finished),
        'cronologia', count(*) filter (where chronology_contested),
        'reclamacao', count(*) filter (where complaint_overdue),
        'pecas', count(*) filter (where piece_waiting),
        'andamento', count(*) filter (where court_moved),
        'vara-civel', count(*) filter (where civil_refused),
        'agencia', count(*) filter (where from_agency),
        'novos-mes', count(*) filter (where new_month),
        'ajuizados-mes', count(*) filter (where filed_month),
        'encerrados-mes', count(*) filter (where ended_month),
        'arquivados-mes', count(*) filter (where archived_month),
        'mov-hoje', count(*) filter (where moved_today),
        'mov-7', count(*) filter (where moved_week),
        'mov-30', count(*) filter (where moved_thirty),
        'parado-30', count(*) filter (where quiet_30),
        'parado-45', count(*) filter (where quiet_45),
        'parado-90', count(*) filter (where quiet_90),
        'nunca-capturados', count(*) filter (where never_read))
      from flagged
    ),
    -- The numbers of the cards, each beside what it was in the same days of the month before.
    'numbers', (
      select jsonb_build_object(
        'going', count(*) filter (where status not in ('closed', 'declined')),
        'going_before', count(*) filter (
          where created_at < prev_moment and (closed_at is null or closed_at >= prev_moment)
        ),
        'new', count(*) filter (where new_month),
        'new_before', count(*) filter (where created_at >= prev_from and created_at < prev_moment),
        'filed', count(*) filter (where filed_month),
        'filed_before', count(*) filter (where filed_before),
        'ended', count(*) filter (where ended_month),
        'ended_before', count(*) filter (
          where status in ('closed', 'declined') and closed_at >= prev_from and closed_at < prev_moment
        ),
        'archived', count(*) filter (where archived_month),
        'archived_before', count(*) filter (where archived_before),
        'since', month_start,
        'until', today,
        'before_since', prev_start,
        'before_until', prev_until)
      from flagged
    ),
    'total', (select count(*) from matched),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pg.id,
        'seq', pg.seq,
        -- The case is named by its first adult claimant; with only minors, by who answers for them.
        'client', coalesce((
          select p.full_name from public.case_parties cp
          join public.people p on p.id = cp.person_id
          where cp.case_id = pg.id
          order by (cp.role = 'claimant' and cp.guardian_id is null) desc, (cp.role = 'guardian') desc,
                   cp.created_at, cp.id
          limit 1
        ), ''),
        -- The module the case is of (0068), which a list of every module names on each row.
        'module', pg.module,
        'incident', pg.incident,
        'airline_iata', pg.airline_iata,
        'flight_date', pg.flight_date,
        'status', pg.status,
        'updated_at', pg.updated_at,
        'created_at', pg.created_at,
        'to_review', pg.to_review,
        'client_finished', pg.client_finished,
        'chronology_contested', pg.chronology_contested,
        'complaint_overdue', pg.complaint_overdue,
        'piece_waiting', pg.piece_waiting,
        'court_moved', pg.court_moved,
        'civil_refused', pg.civil_refused,
        -- When a lawsuit of the case last moved in court, and the numbers of its lawsuits in court.
        'moved_at', pg.court_moved_at,
        -- Who has the case and why, its step, since when and for how many days, and whether it stagnated (0111).
        'holder', st.holder,
        'why', st.why,
        'step', st.step,
        'step_since', st.step_since,
        'step_days', st.step_days,
        'stagnant', coalesce(case when jsonb_typeof(limits -> st.step) = 'number'
          then st.step_days > (limits ->> st.step)::numeric end, false),
        -- What its lawsuits show in court (a hearing held, a decision that is the judgment, a payment): the step of
        -- its way the list and the spreadsheet show, read with the row and never once per case.
        'court', case when pg.status = 'filed' then jsonb_build_object(
          'held', exists (
            select 1 from public.hearings h where h.case_id = pg.id and h.org_id = target_org and h.status = 'held'
          ),
          'decided', exists (
            select 1 from public.publications p
            where p.case_id = pg.id and p.org_id = target_org and p.active and p.category = 'decisao' and p.judgment is true
          ),
          'paid', exists (
            select 1 from public.publications p
            where p.case_id = pg.id and p.org_id = target_org and p.active and p.category = 'pagamento'
          )
        ) end,
        'cnjs', coalesce((
          select jsonb_agg(pr.cnj order by pr.filed_at nulls last, pr.cnj) from public.proceedings pr
          where pr.case_id = pg.id and pr.status in ('filed', 'closed')
        ), '[]'::jsonb),
        -- The agency the case came from, by the name the firm reads in its partnerships (0069).
        'agency', (
          select pa.name from public.partner_links l
          join public.partners pa on pa.id = l.partner_id
          where l.id = pg.partnership_id and l.org_id = target_org
        )
      ) order by pg.pos)
      from page pg
      left join standing st on st.case_id = pg.id
    ), '[]'::jsonb)
  ) into answer;
  return answer;
end;
$$;

revoke all on function public.firm_cases(uuid, text, text, integer, integer, text, text, text, text) from public, anon;
grant execute on function public.firm_cases(uuid, text, text, integer, integer, text, text, text, text) to authenticated;

-- ---------- The stock of the controladoria ----------

/**
 * The firm's stock as the controladoria reads it: for each step of the way, how many cases are at it, how many
 * stagnated, and the median and the most days a case is at it; and who has the cases (the firm, the client, ONE, the
 * court, the platform). Of every module, or of one, and under the list's own filters (the kind of problem, the
 * airline), so the counts of the views of who has the cases are the list's. For anybody of the firm: what each person
 * may do is decided where they do it.
 */
create or replace function public.firm_case_stock(
  target_org uuid,
  target_module text default null,
  target_incident text default null,
  target_airline text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  limits jsonb := coalesce(
    (select s.value -> 'stagnant_days' from public.platform_settings s where s.key = 'controladoria'), '{}'::jsonb
  );
  kind_wanted text := nullif(btrim(coalesce(target_incident, '')), '');
  airline_wanted text := nullif(upper(btrim(coalesce(target_airline, ''))), '');
  answer jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  with standing as materialized (
    select s.step, s.holder,
           greatest(today - (s.step_since at time zone 'America/Sao_Paulo')::date, 0) as days
    from public.case_standing(target_org, target_module) s
    join public.cases c on c.id = s.case_id
    where (kind_wanted is null or c.incident = kind_wanted)
      and (airline_wanted is null or c.airline_iata = airline_wanted)
  ), marked as (
    select st.*,
           coalesce(case when jsonb_typeof(limits -> st.step) = 'number'
             then st.days > (limits ->> st.step)::numeric end, false) as stagnant
    from standing st
  )
  select jsonb_build_object(
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'step', g.step, 'cases', g.cases, 'stagnant', g.stagnant, 'median_days', g.median_days,
        'oldest_days', g.oldest_days, 'limit', g.step_limit
      ) order by g.step)
      from (
        select m.step, count(*)::integer as cases, count(*) filter (where m.stagnant)::integer as stagnant,
               (percentile_disc(0.5) within group (order by m.days))::integer as median_days,
               max(m.days)::integer as oldest_days,
               case when jsonb_typeof(limits -> m.step) = 'number' then (limits ->> m.step)::integer end as step_limit
        from marked m
        group by m.step
      ) g
    ), '[]'::jsonb),
    'holders', jsonb_build_object(
      'firm', (select count(*) from marked where holder = 'firm'),
      'client', (select count(*) from marked where holder = 'client'),
      'one', (select count(*) from marked where holder = 'one'),
      'court', (select count(*) from marked where holder = 'court'),
      'platform', (select count(*) from marked where holder = 'platform')
    ),
    'stagnant', (select count(*) from marked where stagnant),
    'total', (select count(*) from marked),
    'limits', limits
  ) into answer;
  return answer;
end;
$$;

revoke all on function public.firm_case_stock(uuid, text, text, text) from public, anon;
grant execute on function public.firm_case_stock(uuid, text, text, text) to authenticated;
