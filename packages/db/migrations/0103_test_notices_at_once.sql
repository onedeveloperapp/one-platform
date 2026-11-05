-- ============================================================
-- 0103_test_notices_at_once: in a test case, what the test court causes
-- reaches the client at once (the owner's decision of 2026-11-05).
--
-- The test court (0061, 0062) marks a conciliation hearing about ten minutes
-- ahead, so the test does not wait for it. A notice of a hearing waits the
-- setting's fifteen minutes after a person (or ONE) last wrote it, so a
-- mistake corrected at once never reaches the client, and the reminder of
-- the day goes up to an hour before the hearing: the client of a test case
-- was never told of the hearing the test court marked, and the test showed
-- nothing reaching the test chat.
--
-- `notice_candidates` (0055) is redefined: in a test case (`cases.is_test`)
-- the reminders of a hearing, the word that it changed, the word on the
-- lawsuit, the warning against the scam and the word that the lawsuit was
-- filed wait no minutes after what they tell, and the reminder of the day
-- and a change go until the hearing itself. Everything else is as before,
-- and a real case is told as before; a refused paper and the word that
-- everything arrived still wait their minutes in a test case too (a person
-- may undo a refusal; ONE says the second in the conversation first).
-- ============================================================

/**
 * What is due to whom, as 0055 says it: in a test case, what the test court
 * causes (a hearing, its change, the word on the lawsuit, a payment, the
 * filing) waits no minutes after it was written, and the reminder of the day
 * and a change go until the hearing itself, so the client of the test chat
 * is told of a hearing the test court marked minutes ahead.
 */
create or replace function public.notice_candidates(target_org uuid, target_case uuid default null)
returns table (
  kind text,
  occurrence text,
  priority integer,
  case_id uuid,
  person_id uuid,
  phone text,
  proceeding_id uuid,
  hearing_id uuid,
  publication_id uuid,
  document_id uuid,
  about_at timestamptz,
  opens timestamptz,
  closes timestamptz,
  zone text,
  early boolean,
  since timestamptz,
  params text[],
  notice_id uuid,
  attempts integer,
  blocker text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  steps jsonb := coalesce(public.notices_setting_json('hearing_steps'), '[]'::jsonb);
  day_lead interval := make_interval(mins => greatest(public.notices_setting('day_lead_minutes', 60), 0));
  update_days integer := greatest(public.notices_setting('update_days', 15), 1);
  pay_days integer := greatest(public.notices_setting('payment_alert_days', 5), 1);
  document_days integer := greatest(public.notices_setting('document_days', 7), 1);
  received_days integer := greatest(public.notices_setting('received_days', 3), 1);
  filed_days integer := greatest(public.notices_setting('filed_days', 7), 1);
  tries integer := greatest(public.notices_setting('max_attempts', 5), 1);
  retry_wait integer := greatest(public.notices_setting('retry_minutes', 30), 1);
  settle interval := make_interval(mins => greatest(public.notices_setting('settle_minutes', 15), 0));
  firm text := (select o.name from public.organizations o where o.id = target_org);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  return query
  with due as (
    -- The reminders of each hearing to come, by step.
    select 'hearing_reminder'::text as kind,
           'h:' || h.id || ':' || to_char(h.starts_at at time zone 'UTC', 'YYYYMMDDHH24MI') || ':' || st.step as occurrence,
           2 as priority, h.case_id, r.person_id, h.proceeding_id, h.id as hearing_id, null::uuid as publication_id,
           null::uuid as document_id, h.starts_at as about_at, st.opens, st.closes, h.time_zone as zone,
           -- The reminder of the day of a hearing of the morning may go from the earlier hour.
           st.days = 0 and public.notice_early(h.starts_at, h.time_zone) as early, null::timestamptz as since,
           array[
             initcap(lower(split_part(btrim(p.full_name), ' ', 1))), firm, public.notice_hearing_words(h.kind),
             public.cnj_formatted(pr.cnj),
             public.notice_moment(h.starts_at, h.time_zone,
               case st.days when 0 then 'hoje, ' when 1 then 'amanhã, ' else '' end),
             public.notice_how_words(h.mode, h.place, h.link)
           ] as params
    from public.hearings h
    join public.proceedings pr on pr.id = h.proceeding_id
    join public.cases c on c.id = h.case_id and c.status not in ('closed', 'declined')
    cross join lateral (
      select s.step, s.days, s.opens,
             coalesce(lead(s.opens) over (order by s.days desc), h.starts_at - case when c.is_test then interval '0' else day_lead end) as closes
      from (
        select item ->> 'step' as step, (item ->> 'days')::integer as days,
               ((((h.starts_at at time zone h.time_zone)::date - (item ->> 'days')::integer)::timestamp) at time zone h.time_zone) as opens
        from jsonb_array_elements(steps) item
        where item ->> 'step' ~ '^[a-z]{2,12}$' and item ->> 'days' ~ '^[0-9]{1,3}$'
      ) s
    ) st
    cross join lateral public.notice_recipients(h.proceeding_id) r
    join public.people p on p.id = r.person_id
    where h.org_id = target_org and h.status = 'scheduled' and h.starts_at > now()
      and (target_case is null or h.case_id = target_case)
      and h.changed_at <= now() - case when c.is_test then interval '0' else settle end
      and now() >= st.opens and now() < st.closes
      -- The court took back the publication the hearing came from, and nobody said they saw it: no reminder yet.
      and not public.hearing_publication_cancelled(h.id, h.publication_id)

    union all

    -- What changed of a hearing somebody of the lawsuit was told of (they, or the phone they share): what they
    -- believe is the latest notice of it that went, or may have gone.
    select 'hearing_change',
           'h:' || h.id || ':' ||
             case
               when h.status = 'cancelled' then 'cancelled'
               when told.cancelled then 'back:' || to_char(h.starts_at at time zone 'UTC', 'YYYYMMDDHH24MI')
               else 'moved:' || to_char(h.starts_at at time zone 'UTC', 'YYYYMMDDHH24MI')
             end || ':' || told.notice,
           1, h.case_id, r.person_id, h.proceeding_id, h.id, null::uuid, null::uuid,
           h.starts_at, now() - interval '1 minute',
           case when h.status = 'cancelled' then h.starts_at else h.starts_at - case when c.is_test then interval '0' else day_lead end end,
           h.time_zone,
           -- About a hearing of the morning of this very day: it may go from the earlier hour.
           public.notice_early(h.starts_at, h.time_zone) or public.notice_early(told.about_at, h.time_zone),
           h.changed_at,
           array[
             initcap(lower(split_part(btrim(p.full_name), ' ', 1))), firm, public.notice_hearing_words(h.kind),
             public.cnj_formatted(pr.cnj),
             case
               when h.status = 'cancelled' then 'ela foi cancelada. Se uma nova data for marcada, você receberá um novo aviso'
               when told.cancelled then 'ela foi marcada novamente para ' || public.notice_moment(h.starts_at, h.time_zone)
               else 'ela foi remarcada para ' || public.notice_moment(h.starts_at, h.time_zone)
             end
           ]
    from public.hearings h
    join public.proceedings pr on pr.id = h.proceeding_id
    join public.cases c on c.id = h.case_id and c.status not in ('closed', 'declined')
    cross join lateral public.notice_recipients(h.proceeding_id) r
    join public.people p on p.id = r.person_id
    cross join lateral (
      select n.id as notice, n.about_at,
             (n.kind = 'hearing_change' and n.occurrence like '%:cancelled:%') as cancelled
      from public.client_notices n
      join public.wa_messages m on m.id = n.message_id
      where n.org_id = target_org and n.hearing_id = h.id
        and n.kind in ('hearing_reminder', 'hearing_change', 'lawsuit_update')
        and (n.person_id = r.person_id or n.phone = any (public.wa_phone_variants(p.phone)))
        -- What went or may have gone: a try that failed told nothing, and is tried again as itself.
        and (m.status is distinct from 'failed' or m.error_code = 'unconfirmed')
      order by n.reserved_at desc
      limit 1
    ) told
    where h.org_id = target_org
      and (target_case is null or h.case_id = target_case)
      and h.changed_at <= now() - case when c.is_test then interval '0' else settle end
      and (
        (h.status = 'scheduled' and h.starts_at > now() + case when c.is_test then interval '0' else day_lead end)
        or (h.status = 'cancelled' and exists (
          select 1 from public.client_notices n where n.org_id = target_org and n.hearing_id = h.id and n.about_at > now()
        ))
      )
      and (
        (h.status = 'scheduled' and (told.cancelled or told.about_at <> h.starts_at))
        -- Cancelled while what they were told of is still to come: they would go to it.
        or (h.status = 'cancelled' and not told.cancelled and told.about_at > now())
      )

    union all

    -- The word on each lawsuit the court has, every few days from its filing, naming its next hearing. It waits
    -- while a hearing of the lawsuit was written a moment ago, so it never names one about to be corrected.
    select 'lawsuit_update', 'u:' || pr.id || ':' || per.n, 4, pr.case_id, r.person_id, pr.id, next.id, null::uuid,
           null::uuid, next.starts_at, per.opens, per.opens + make_interval(days => update_days),
           coalesce(court.time_zone, 'America/Sao_Paulo'), false, null::timestamptz,
           array[
             initcap(lower(split_part(btrim(p.full_name), ' ', 1))), firm, public.cnj_formatted(pr.cnj),
             case when moved.at is not null
               then 'a última movimentação registrada pelo tribunal foi em '
                    || to_char(moved.at at time zone coalesce(court.time_zone, 'America/Sao_Paulo'), 'DD/MM/YYYY')
               else 'o processo segue em andamento no tribunal' end
             || coalesce(', e a próxima ' || public.notice_hearing_words(next.kind) || ' está marcada para '
                  || public.notice_moment(next.starts_at, next.time_zone), '')
           ]
    from public.proceedings pr
    join public.cases c on c.id = pr.case_id and c.status not in ('closed', 'declined')
    left join public.courts court on court.acronym = pr.court
    cross join lateral (
      select ((today - pr.filed_at) / update_days) as n,
             (((pr.filed_at + ((today - pr.filed_at) / update_days) * update_days)::timestamp)
               at time zone 'America/Sao_Paulo') as opens
    ) per
    cross join lateral public.notice_recipients(pr.id) r
    join public.people p on p.id = r.person_id
    left join lateral (
      select max(mv.occurred_at) as at from public.movements mv where mv.proceeding_id = pr.id
    ) moved on true
    left join lateral (
      select h.id, h.kind, h.starts_at, h.time_zone from public.hearings h
      where h.proceeding_id = pr.id and h.status = 'scheduled' and h.starts_at > now()
        -- The court took back the publication it came from, and nobody said they saw it: not told yet.
        and not public.hearing_publication_cancelled(h.id, h.publication_id)
      order by h.starts_at limit 1
    ) next on true
    where pr.org_id = target_org and pr.status = 'filed' and pr.filed_at is not null and pr.cnj is not null
      and per.n >= 1
      and (target_case is null or pr.case_id = target_case)
      and not exists (
        select 1 from public.hearings h where h.proceeding_id = pr.id and h.changed_at > now() - case when c.is_test then interval '0' else settle end
      )

    union all

    -- The warning against the scam, the days after a publication of the lawsuit was triaged as a payment.
    select 'payment_alert', 'p:' || pub.id, 3, pr.case_id, r.person_id, pr.id, null::uuid, pub.id, null::uuid,
           null::timestamptz, pub.triaged_at, pub.triaged_at + make_interval(days => pay_days),
           coalesce(court.time_zone, 'America/Sao_Paulo'), false, null::timestamptz,
           array[initcap(lower(split_part(btrim(p.full_name), ' ', 1))), firm, public.cnj_formatted(pr.cnj)]
    from public.publications pub
    join public.proceedings pr on pr.id = pub.proceeding_id
    join public.cases c on c.id = pr.case_id and c.status not in ('closed', 'declined')
    left join public.courts court on court.acronym = pr.court
    cross join lateral public.notice_recipients(pr.id) r
    join public.people p on p.id = r.person_id
    where pub.org_id = target_org and pub.active and pub.category = 'pagamento' and pub.triaged_by is not null
      and pub.triaged_at <= now() - case when c.is_test then interval '0' else settle end
      and now() < pub.triaged_at + make_interval(days => pay_days)
      and (target_case is null or pr.case_id = target_case)

    union all

    -- A document of the client's the firm refused, still owed, of a case that still takes papers on the client's
    -- link: asked for again with the reason, once per refusal, in the hours of the day of the person's own state.
    select 'document_refused', 'd:' || d.id || ':' || to_char(d.decided_at at time zone 'UTC', 'YYYYMMDDHH24MISS'),
           3, d.case_id, r.person_id, null::uuid, null::uuid, null::uuid, d.id,
           null::timestamptz, d.decided_at, d.decided_at + make_interval(days => document_days),
           z.zone, false, d.decided_at,
           array[
             initcap(lower(split_part(btrim(p.full_name), ' ', 1))), firm,
             -- Which paper: of somebody else than who is asked (a child's), whose; the day it was sent; and, for a
             -- client of another case still going at the firm, the trip it is of.
             public.notice_document_words(d.kind) || coalesce((
               select ' de ' || initcap(lower(split_part(btrim(owner.full_name), ' ', 1)))
               from public.case_parties cp join public.people owner on owner.id = cp.person_id
               where cp.id = d.party_id and cp.person_id <> r.person_id
             ), '')
             || case when d.kind = 'evidence' then ', enviada em ' else ', enviado em ' end
             || to_char(d.created_at at time zone z.zone, 'DD/MM/YYYY')
             || case when exists (
                  select 1 from public.case_parties op join public.cases oc on oc.id = op.case_id
                  where op.person_id = r.person_id and oc.id <> d.case_id and oc.status not in ('closed', 'declined')
                ) then coalesce(', do caso da viagem de ' || to_char(c.flight_date, 'DD/MM/YYYY'), '') else '' end,
             -- The reason as written, in the plain words a message to a client keeps: no dash, no exclamation.
             rtrim(btrim(regexp_replace(regexp_replace(d.rejected_reason, '!+', '.', 'g'), '\s*[—–]+\s*', ', ', 'g')),
                   ' .;:,')
           ]
    from public.case_documents d
    join public.cases c on c.id = d.case_id and c.status in ('intake', 'documents', 'signature')
    cross join lateral (select public.document_recipient(d.id) as person_id) r
    join public.people p on p.id = r.person_id
    -- The day of the person's own state.
    cross join lateral (
      select coalesce((select ct.time_zone from public.courts ct where ct.uf = upper(p.uf)), 'America/Sao_Paulo') as zone
    ) z
    where d.org_id = target_org and d.status = 'rejected' and d.decided_at is not null
      and d.kind in ('identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'other')
      -- A person's own paper left with no party (the person was taken out of the case) asks nobody else for it.
      and (d.party_id is not null or d.kind not in ('identity', 'address_proof'))
      and d.decided_at <= now() - settle
      and now() < d.decided_at + make_interval(days => document_days)
      and (target_case is null or d.case_id = target_case)
      -- An older refusal of the same paper is answered by a newer one sent after it (refused in its turn, that one is
      -- asked for itself); a file refused on its bytes answers nothing, and papers of a kind a client sends several of
      -- (receipts) that came before the refusal are other papers.
      and not exists (
        select 1 from public.case_documents n
        where n.case_id = d.case_id and n.kind = d.kind and n.party_id is not distinct from d.party_id
          and n.id <> d.id and n.created_at > d.decided_at
          and (n.status <> 'rejected' or n.decided_at is not null)
      )
      and public.case_document_owed(d.id)

    union all

    -- A client said, on their own link, that they sent everything: the firm got it, and what comes next. ONE says it
    -- in the conversation at once where it can (`advance_say_received`, recorded as this very notice); the template
    -- is for when it could not, and waits the setting's minutes for it.
    select 'case_received', 'r:' || l.case_id, 4, l.case_id, l.person_id, null::uuid, null::uuid, null::uuid,
           null::uuid, null::timestamptz, l.finished_at, l.finished_at + make_interval(days => received_days),
           z.zone, false, null::timestamptz,
           array[
             initcap(lower(split_part(btrim(p.full_name), ' ', 1))), firm,
             public.notice_next_words(l.case_id, l.person_id)
           ]
    from public.client_links l
    join public.cases c on c.id = l.case_id and c.status in ('intake', 'documents', 'signature', 'drafting', 'ready')
    join public.people p on p.id = l.person_id
    -- The day of the person's own state.
    cross join lateral (
      select coalesce((select ct.time_zone from public.courts ct where ct.uf = upper(p.uf)), 'America/Sao_Paulo') as zone
    ) z
    where l.org_id = target_org and l.finished_at is not null and l.revoked_at is null
      and l.finished_at <= now() - settle
      and now() < l.finished_at + make_interval(days => received_days)
      and (target_case is null or l.case_id = target_case)
      and exists (select 1 from public.case_parties cp where cp.case_id = l.case_id and cp.person_id = l.person_id)
      and not (p.birth_date is not null and p.birth_date > (today - interval '18 years')::date)

    union all

    -- A lawsuit recorded filed, the days after, when it was filed of late: its number and where it runs. Never one
    -- filed long before (what a spreadsheet brings of the firm's portfolio).
    select 'lawsuit_filed', 'f:' || pr.id, 3, pr.case_id, r.person_id, pr.id, null::uuid, null::uuid, null::uuid,
           null::timestamptz, pr.filed_marked_at, pr.filed_marked_at + make_interval(days => filed_days),
           coalesce(court.time_zone, 'America/Sao_Paulo'), false, null::timestamptz,
           array[
             initcap(lower(split_part(btrim(p.full_name), ' ', 1))), firm, public.cnj_formatted(pr.cnj),
             public.notice_court_words(pr.kind, pr.comarca, pr.forum_city, pr.court)
           ]
    from public.proceedings pr
    join public.cases c on c.id = pr.case_id and c.status not in ('closed', 'declined')
    left join public.courts court on court.acronym = pr.court
    cross join lateral public.notice_recipients(pr.id) r
    join public.people p on p.id = r.person_id
    where pr.org_id = target_org and pr.status = 'filed' and pr.cnj is not null and pr.filed_marked_at is not null
      and pr.filed_at is not null and pr.filed_at >= today - filed_days
      and pr.filed_marked_at <= now() - case when c.is_test then interval '0' else settle end
      and now() < pr.filed_marked_at + make_interval(days => filed_days)
      and (target_case is null or pr.case_id = target_case)
  )
  select d.kind, d.occurrence, d.priority, d.case_id, d.person_id, person.phone, d.proceeding_id, d.hearing_id,
         d.publication_id, d.document_id, d.about_at, d.opens, d.closes, d.zone, d.early, d.since,
         array(select public.notice_value(value) from unnest(d.params) as value),
         prior.id, prior.attempts,
         coalesce(route.blocker, public.notice_person_blocker(target_org, d.person_id))
  from due d
  join public.people person on person.id = d.person_id
  cross join lateral public.notice_kind_route(target_org, d.kind) route
  left join lateral (
    select n.id, n.attempts, n.reserved_at, m.status as message_status, m.error_code
    from public.client_notices n
    join public.wa_messages m on m.id = n.message_id
    where n.org_id = target_org and n.person_id = d.person_id and n.kind = d.kind and n.occurrence = d.occurrence
  ) prior on true
  where (
      prior.id is null
      or (
        prior.message_status = 'failed' and public.notice_retryable(prior.error_code) and prior.attempts < tries
        -- Each try waits twice as long as the one before: a cause that lasts hours does not spend them all.
        and prior.reserved_at <= now() - make_interval(mins => (retry_wait * power(2, prior.attempts - 1))::integer)
      )
    )
    and not public.notice_already_told(target_org, d.kind, d.occurrence, d.person_id, person.phone, d.hearing_id,
      d.proceeding_id, d.about_at, d.opens, d.since);
end;
$$;

revoke all on function public.notice_candidates(uuid, uuid) from public, anon, authenticated;
