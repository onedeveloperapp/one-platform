-- ============================================================
-- The data ONE asks in the chat, said as it is (0280). The owner, on a
-- test case (2026-11-23): the top of the case said "Dados de ...:
-- Nacionalidade, Estado civil, Profissão. O cliente completa pelo link."
-- under "O que trava o caso" while nobody had asked the client anything,
-- and ONE asks those in the WhatsApp, not the link (the chat's check of
-- data, 0232). What ONE asks the passenger there is ONE's work until it
-- asked, the client's to answer in the chat once it did, and ONE's work to
-- come while the client answers what comes first (their documents, another
-- question): `case_chat_data` says which, `case_data_in_chat` reads it for
-- the case screen, `case_standing` (redefined from 0274) counts the data as
-- the client's only once asked and says ONE asks it (`data`), and
-- `case_pulse` (redefined from 0219) follows it, so the screen changes when
-- ONE asks. And a paper the client sent back signed is said once, by its
-- envelope, never also among the documents the firm checks.
-- ============================================================

/**
 * The passenger whose data ONE asks in the chat (0232), and where that stands (0280): `asked` while the conversation's
 * step waits for an answer of the check; `to_ask` while ONE can start it now (the identity and the proof of address
 * accepted, no other question waiting); `later` while it waits for what the client answers first. No row when ONE does
 * not ask it there: a case no longer gathered, its data checked, a minor, no conversation ONE carries inside the 24
 * hours, or who asked to stop. Internal.
 */
create or replace function public.case_chat_data(target_case uuid)
returns table (person_id uuid, state text)
language sql
stable
security definer
set search_path = public
as $$
  with steps (list) as (
    select array['dados', 'campo', 'valor', 'cep', 'numero', 'nacionalidade', 'nacionalidade_outra', 'estado_civil',
                 'profissao']
  ), talks as (
    select wc.id, wc.org_id, wc.contact_wa_id, wc.agent, wc.last_inbound_at, n.status as number_status,
           coalesce(wc.chat_step ->> 'step', '') as step,
           public.conversation_person_data(wc) as data,
           public.conversation_account_waits(wc) as account_waits
    from public.cases k
    -- The conversations of the case's people, found by their phones as the client's link finds them (0046); which
    -- passenger and which case each one gathers is then the chat's own rule (`conversation_person_data`).
    join public.wa_conversations wc on wc.org_id = k.org_id and wc.contact_wa_id in (
      select v from public.case_parties cp
      join public.people p on p.id = cp.person_id
      cross join lateral unnest(public.wa_phone_variants(p.phone) || p.phone) v
      where cp.case_id = k.id and p.phone is not null
    )
    join public.wa_numbers n on n.id = wc.number_id
    where k.id = target_case and k.status in ('intake', 'documents', 'signature')
  )
  select (t.data ->> 'person_id')::uuid,
         case
           when t.step = any (s.list) then 'asked'
           when t.step = '' and coalesce((t.data ->> 'documents_in')::boolean, false) and not t.account_waits then 'to_ask'
           else 'later'
         end
  from talks t
  cross join steps s
  where t.data is not null and (t.data ->> 'case_id')::uuid = target_case
    and not coalesce((t.data ->> 'checked')::boolean, false)
    and not coalesce((t.data ->> 'minor')::boolean, false)
    and (
      t.step = any (s.list)
      or (t.agent = 'one' and t.number_status = 'active' and public.wa_window_open(t.last_inbound_at)
          and not exists (
            select 1 from public.wa_optouts o where o.org_id = t.org_id and o.contact_wa_id = t.contact_wa_id
          ))
    )
  order by (t.step = any (s.list)) desc, t.last_inbound_at desc nulls last, t.id
  limit 1;
$$;

revoke all on function public.case_chat_data(uuid) from public, anon, authenticated;

/** Where the data ONE asks the passenger in the chat stands (0280), for the case screen: null when it does not ask it there. Anybody of the firm. */
create or replace function public.case_data_in_chat(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  return (
    select jsonb_build_object('person_id', d.person_id, 'state', d.state)
    from public.case_chat_data(current_case.id) d
  );
end;
$$;

revoke all on function public.case_data_in_chat(uuid) from public, anon;
grant execute on function public.case_data_in_chat(uuid) to authenticated;

/** Who has each case and why (replaces 0274's): as there, and the data ONE asks in the chat is the client's only once asked (0280). */
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
    select c.id, c.status, c.created_at, c.status_changed_at, c.incident, c.module, c.area_script_id
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
           -- An adult's, apart from what ONE asks the passenger in the chat (0232), which is said apart (0280).
           nullif(btrim(p.full_name), '') is null or p.cpf is null or btrim(p.cpf) = '' or p.birth_date is null
             or nullif(btrim(p.postal_code), '') is null
             or nullif(btrim(p.street), '') is null or nullif(btrim(p.address_number), '') is null
             or nullif(btrim(p.district), '') is null or nullif(btrim(p.city), '') is null
             or nullif(btrim(p.uf), '') is null as lacks_core,
           nullif(btrim(p.nationality), '') is null or nullif(btrim(p.marital_status), '') is null
             or nullif(btrim(p.profession), '') is null as lacks_chat
    from public.case_parties cp
    join k on k.id = cp.case_id
    join public.people p on p.id = cp.person_id
    cross join knobs kn
    where cp.role in ('claimant', 'guardian')
  ), chat_data as materialized (
    -- What ONE asks the passenger in the chat (0232) is ONE's until it asked, and the client's to answer once it did
    -- (0280, `case_chat_data`, as the top of the case says it): read only for a case whose adult lacks nothing else.
    select c.case_id, d.person_id, d.state
    from (select distinct pf.case_id from people_of pf where not pf.minor and pf.lacks_chat and not pf.lacks_core) c
    cross join lateral public.case_chat_data(c.case_id) d
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
    -- Each case's own: the setting's list for a module's case, its kind's for a case of an area of the firm (0274).
    select k.id as case_id, r ->> 'per' as per, r ->> 'need' as need,
           array(select jsonb_array_elements_text(coalesce(r -> 'or', '[]'::jsonb))) || (r ->> 'kind') as kinds
    from k cross join knobs kn
    cross join lateral jsonb_array_elements(
      case when k.area_script_id is null then kn.required else public.case_required_documents(k.id) end) r
  ), lacks as (
    select pf.case_id from people_of pf
    join holder_of h on h.case_id = pf.case_id
    where (pf.role = 'claimant' or pf.person_id = h.person_id)
      and (case
        when pf.minor then pf.lacks_minor
        else pf.lacks_core or (pf.lacks_chat and not exists (
          select 1 from chat_data cd
          where cd.case_id = pf.case_id and cd.person_id = pf.person_id and cd.state <> 'asked'
        ))
      end)
    union
    select h.case_id from holder_of h
    join k on k.id = h.case_id
    -- A case of an area of the firm has no trip (0274).
    where k.module is not null and not exists (select 1 from public.flight_segments s where s.case_id = h.case_id)
    union
    select h.case_id from holder_of h
    join rules r on r.case_id = h.case_id and r.per = 'case'
    where not exists (
      select 1 from public.case_documents d
      where d.case_id = h.case_id and d.kind = any (r.kinds) and d.status not in ('uploading', 'rejected')
        and (r.need is null or d.need = r.need)
    )
    union
    select h.case_id from holder_of h
    join rules r on r.case_id = h.case_id and r.per = 'holder'
    where not exists (
      select 1 from public.case_documents d
      join public.case_parties cp on cp.id = d.party_id
      where d.case_id = h.case_id and cp.person_id = h.person_id and d.kind = any (r.kinds)
        and d.status not in ('uploading', 'rejected') and (r.need is null or d.need = r.need)
    )
    union
    select pf.case_id from people_of pf
    join rules r on r.case_id = pf.case_id and r.per = 'claimant'
    where pf.role = 'claimant' and not exists (
      select 1 from public.case_documents d
      where d.case_id = pf.case_id and d.party_id = pf.party_id and d.kind = any (r.kinds)
        and d.status not in ('uploading', 'rejected') and (r.need is null or d.need = r.need)
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
      -- A paper the client sent back signed is said by its envelope, once (0280).
      and not exists (
        select 1 from public.signature_envelopes e where e.id = d.envelope_id and e.status = 'received'
      )
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
           coalesce(t.working, false) as working,
           -- ONE asks the account in the chat once something is signed (0181, 0239): a case of a kind it interviews,
           -- with no interview, no account, no lawsuit and nothing signed waits for the signature before it, ONE's
           -- work to come and never the client's (0252, as the top of the case, `accountAfterSignature`).
           (i.case_id is null and t.case_id is null
            and k.incident = any (array['delay', 'cancellation', 'overbooking', 'missed_connection', 'downgrade', 'other'])
            and not exists (select 1 from public.proceedings p where p.case_id = k.id)
            and not exists (
              select 1 from public.signature_envelopes e
              where e.case_id = k.id and jsonb_array_length(e.signers) > 0
                and not exists (
                  select 1 from jsonb_array_elements(e.signers) s where nullif(s ->> 'signed_at', '') is null
                )
            )) as after_signature
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
           ac.state as account, ac.working as told_working, ac.after_signature as account_after_signature, coalesce(lw.total, 0) as lawsuits, lw.first_filed,
           coalesce(d.checking, false) as docs_checking, coalesce(d.to_decide, false) as docs_to_decide,
           lk.case_id is not null as lacks_something, cq.case_id is not null as data_to_ask,
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
    left join (
      -- ONE asks it now: the passenger lacks only what the chat asks, and the check can start (0280).
      select distinct cd.case_id from chat_data cd
      join people_of pf on pf.case_id = cd.case_id and pf.person_id = cd.person_id
      where cd.state = 'to_ask' and not pf.minor and pf.lacks_chat and not pf.lacks_core
    ) cq on cq.case_id = k.id
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
        when m.data_to_ask then 'data'
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
        when m.account in ('missing', 'incomplete') and m.lawsuits = 0
             and not (m.account = 'missing' and m.account_after_signature) then 'account'
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

/** What the case screen follows to read itself again (replaces 0219's): where the data ONE asks in the chat stands too (0280). */
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
