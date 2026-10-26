-- 0055_client_progress: the passenger is told what comes next once they said they finished, and when their
-- lawsuit was filed (the test of 2026-10-26: after "Terminei" the passenger saw nothing happen, and nothing told
-- them later that the lawsuit had gone to court).
--
-- Two more kinds of notice, each a template of the firm's own account like the others (0038):
--
--   case_received  a client said, on their own link, that they sent everything: the firm got it, and what comes
--                  next (the power of attorney to sign on their link, when ONE sent one and it waits for them; or
--                  the firm checking the papers and preparing the lawsuit), with the promise of the next word;
--   lawsuit_filed  a lawsuit recorded filed (`proceedings.filed_marked_at`: by a person, a receipt, a
--                  spreadsheet) in the days after the day it was filed, never one filed long before (what a
--                  spreadsheet brings of the firm's portfolio): its number and where it runs.
--
-- Where ONE holds the client's conversation and their 24 hours are open, ONE says the first of them at once, in
-- its own words (`advance_say_received`, the worker that carries the case on, right after the papers it sends):
-- the notice it records then is the one the template would have been, so the template never goes after it. The
-- template is for when ONE could not (the conversation is a person's, the 24 hours closed, no conversation), and
-- waits the setting's minutes for it. The test chat approves and turns on every kind (the test number sends
-- nothing out of ONE), so a tester follows the whole course; the words a client agrees to name the new purposes.

-- ---------- The setting ----------

update public.platform_settings
set value = value || jsonb_build_object(
  -- The word that the papers arrived may go in the days after the client said they finished; the word that the
  -- lawsuit was filed, in the days after it was recorded filed, for a lawsuit filed within as many days.
  'received_days', 3,
  'filed_days', 7
)
where key = 'notices' and not (value ? 'received_days');

-- ---------- The kinds ----------

alter table public.notice_kinds drop constraint notice_kinds_kind_check;
alter table public.notice_kinds add constraint notice_kinds_kind_check check (kind in (
  'hearing_reminder', 'hearing_change', 'lawsuit_update', 'payment_alert', 'document_refused', 'flight_problem',
  'case_received', 'lawsuit_filed'
));
alter table public.notice_kinds drop constraint notice_kinds_params_check;
alter table public.notice_kinds add constraint notice_kinds_params_check check (
  cardinality(params) between 1 and 9 and cardinality(examples) = cardinality(params)
  and params <@ array['first_name', 'firm', 'hearing', 'lawsuit', 'moment', 'how', 'change', 'status', 'document', 'reason',
                      'flight', 'what', 'assistance', 'next', 'court']
);

insert into public.notice_kinds (kind, position, template_base, body, footer, params, examples) values
  ('case_received', 7, 'one_documentos_recebidos',
   'Olá, {{1}}. O escritório {{2}} recebeu o seu aviso de que terminou de enviar os documentos do seu caso. {{3}} Se tiver qualquer dúvida, responda a esta mensagem.',
   'Para não receber estes avisos, responda SAIR.',
   array['first_name', 'firm', 'next'],
   array['Maria', 'Souza Advogados',
         'O próximo passo é assinar a procuração, que está no seu link. Depois, o escritório prepara a ação e avisa por aqui quando ela for protocolada.']),
  ('lawsuit_filed', 8, 'one_acao_protocolada',
   'Olá, {{1}}. O escritório {{2}} informa que a sua ação foi protocolada: processo nº {{3}}, {{4}}. Você acompanha o andamento pelo link do seu caso, e o escritório avisa por aqui as próximas etapas. Se tiver qualquer dúvida, responda a esta mensagem.',
   'Para não receber estes avisos, responda SAIR.',
   array['first_name', 'firm', 'lawsuit', 'court'],
   array['Maria', 'Souza Advogados', '5000401-61.2099.8.09.0051', 'no Juizado Especial Cível de Goiânia, no TJGO'])
on conflict (kind) do nothing;

-- ---------- When a lawsuit was recorded filed ----------

alter table public.proceedings add column filed_marked_at timestamptz;

comment on column public.proceedings.filed_marked_at is
  'When the lawsuit was recorded filed (by a person, a receipt or a spreadsheet): from then its client may be told, if it was filed of late.';

/**
 * A lawsuit recorded filed is marked at that moment, however it was (a new
 * one is written planned and then saved as what it is, 0022): from then its
 * client may be told, when the day it was filed is of late.
 */
create or replace function public.proceedings_filed_marked()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'filed' and (tg_op = 'INSERT' or old.status is distinct from 'filed') then
    new.filed_marked_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.proceedings_filed_marked() from public, anon, authenticated;

create trigger proceedings_filed_marked before insert or update of status on public.proceedings
  for each row execute function public.proceedings_filed_marked();

-- ---------- The words of what comes next ----------

/** A power of attorney ONE sent a person of a case still waits for their signature (0054). */
create or replace function public.notice_paper_waiting(target_case uuid, target_person uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.case_papers paper
    join public.signature_envelopes e on e.id = paper.envelope_id
    where paper.case_id = target_case and paper.person_id = target_person and paper.kind = 'procuracao'
      and e.status in ('reserved', 'opening', 'pending')
  );
$$;

revoke all on function public.notice_paper_waiting(uuid, uuid) from public, anon, authenticated;

/** What comes next for a client who said they finished, as the template says it. */
create or replace function public.notice_next_words(target_case uuid, target_person uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.notice_paper_waiting(target_case, target_person)
      then 'O próximo passo é assinar a procuração, que está no seu link. Depois, o escritório prepara a ação e avisa por aqui quando ela for protocolada.'
    else 'Agora o escritório confere os documentos e prepara a ação, e avisa por aqui quando ela for protocolada.'
  end;
$$;

revoke all on function public.notice_next_words(uuid, uuid) from public, anon, authenticated;

/** Where a lawsuit runs, as a notice says it: "no Juizado Especial Cível de Goiânia, no TJGO". */
create or replace function public.notice_court_words(kind text, comarca text, city text, court text)
returns text
language sql
immutable
as $$
  select case kind when 'juizado' then 'no Juizado Especial Cível' else 'na vara cível' end
    || coalesce(' de ' || nullif(btrim(coalesce(comarca, city)), ''), '')
    || coalesce(', no ' || nullif(btrim(court), ''), '');
$$;

revoke all on function public.notice_court_words(text, text, text, text) from public, anon, authenticated;

-- ---------- What was told already, and what is due ----------

/**
 * Whether what a notice would tell was told already (replaces the one of
 * 0038, adding the two new kinds): the word that the papers arrived, once per
 * case (a phone two people share is told once); the word that a lawsuit was
 * filed, once per lawsuit. The rest as in 0038.
 */
create or replace function public.notice_already_told(
  target_org uuid,
  target_kind text,
  target_occurrence text,
  target_person uuid,
  target_phone text,
  target_hearing uuid,
  target_proceeding uuid,
  target_about timestamptz,
  target_opens timestamptz,
  target_since timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.client_notices n
    join public.wa_messages m on m.id = n.message_id
    where n.org_id = target_org
      and (n.person_id = target_person or n.phone = any (public.wa_phone_variants(target_phone)))
      and not (n.person_id = target_person and n.kind = target_kind and n.occurrence = target_occurrence)
      and public.notice_told(m.status, m.error_code, n.attempts, n.reserved_at)
      and case target_kind
        when 'hearing_reminder' then n.hearing_id = target_hearing and n.about_at = target_about
             and n.kind in ('hearing_reminder', 'hearing_change') and n.reserved_at >= target_opens
        when 'hearing_change' then n.kind = 'hearing_change' and n.hearing_id = target_hearing
             and n.reserved_at >= target_since
        when 'lawsuit_update' then n.proceeding_id = target_proceeding
             and n.reserved_at > now() - make_interval(days => greatest(public.notices_setting('update_quiet_days', 7), 0))
        when 'payment_alert' then n.kind = 'payment_alert' and n.proceeding_id = target_proceeding
             and n.reserved_at > now() - make_interval(days => greatest(public.notices_setting('payment_alert_quiet_days', 30), 0))
        when 'document_refused' then n.kind = 'document_refused' and n.occurrence = target_occurrence
        when 'case_received' then n.kind = 'case_received' and n.occurrence = target_occurrence
        when 'lawsuit_filed' then n.kind = 'lawsuit_filed' and n.proceeding_id = target_proceeding
        else false
      end
  );
$$;

revoke all on function public.notice_already_told(uuid, text, text, uuid, text, uuid, uuid, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;

/**
 * Every notice of a firm that is due now, or of one case (replaces the one
 * of 0038, adding two kinds; the rest as in 0038):
 *
 *   case_received  each adult of a case not yet in court whose own link says
 *                  they finished, in the setting's days after, once per case
 *                  (a phone two people share is told once): what comes next,
 *                  the power of attorney to sign when one ONE sent waits for
 *                  them. ONE says it in the conversation where it can; the
 *                  template waits the setting's minutes for it;
 *   lawsuit_filed  each lawsuit recorded filed, to its claimants (who
 *                  answers for a minor), in the setting's days after, when
 *                  the day it was filed is within as many days (never one
 *                  filed long before, as a spreadsheet brings): its number
 *                  and where it runs.
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
             coalesce(lead(s.opens) over (order by s.days desc), h.starts_at - day_lead) as closes
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
      and h.changed_at <= now() - settle
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
           case when h.status = 'cancelled' then h.starts_at else h.starts_at - day_lead end,
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
      and h.changed_at <= now() - settle
      and (
        (h.status = 'scheduled' and h.starts_at > now() + day_lead)
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
        select 1 from public.hearings h where h.proceeding_id = pr.id and h.changed_at > now() - settle
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
      and pub.triaged_at <= now() - settle
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
      and pr.filed_marked_at <= now() - settle
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

-- ---------- ONE says it in the conversation, at once ----------

/**
 * Who of a case ONE tells now, in their conversation, that the papers they
 * sent arrived and what comes next: each adult of the case whose own link
 * says they finished (still open, in the setting's days), while the case is
 * not yet in court, where the firm lets ONE answer its clients
 * (`reply_client` is not a person's alone), in the conversation they last
 * wrote in to an active number whose connection holds, which ONE holds
 * (`agent`), inside their 24 hours, never to who asked to stop, and never
 * when they (or the phone they share) were told it already, by ONE or by the
 * template. With whether a power of attorney ONE sent waits for their
 * signature, which is what comes next then.
 */
create or replace function public.case_received_owed(target_case uuid)
returns table (person_id uuid, full_name text, phone text, conversation_id uuid, paper_waiting boolean)
language sql
stable
security definer
set search_path = public
as $$
  select l.person_id, p.full_name, p.phone, talk.id, public.notice_paper_waiting(c.id, l.person_id)
  from public.cases c
  join public.client_links l on l.case_id = c.id
  join public.people p on p.id = l.person_id
  cross join lateral (
    select wc.id, wc.agent, wc.last_inbound_at from public.wa_conversations wc
    join public.wa_numbers n on n.id = wc.number_id and n.status = 'active'
    join public.connections cn on cn.id = n.connection_id and cn.status = 'connected'
    where wc.org_id = c.org_id and p.phone is not null and wc.contact_wa_id = any (public.wa_phone_variants(p.phone))
    order by wc.last_inbound_at desc nulls last, wc.last_message_at desc nulls last, wc.id
    limit 1
  ) talk
  where c.id = target_case
    and c.status in ('intake', 'documents', 'signature', 'drafting', 'ready')
    and l.finished_at is not null and l.revoked_at is null
    and l.finished_at > now() - make_interval(days => greatest(public.notices_setting('received_days', 3), 1))
    and exists (select 1 from public.case_parties cp where cp.case_id = c.id and cp.person_id = l.person_id)
    and not (p.birth_date is not null
             and p.birth_date > ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date)
    and public.firm_autonomy_mode(c.org_id, 'reply_client') <> 'approval'
    and talk.agent = 'one'
    and public.wa_window_open(talk.last_inbound_at)
    and not exists (
      select 1 from public.wa_optouts x
      where x.org_id = c.org_id and x.contact_wa_id = any (public.wa_phone_variants(p.phone))
    )
    and not exists (
      select 1 from public.client_notices n
      where n.org_id = c.org_id and n.kind = 'case_received' and n.occurrence = 'r:' || c.id
        and (n.person_id = l.person_id or n.phone = any (public.wa_phone_variants(p.phone)))
    );
$$;

revoke all on function public.case_received_owed(uuid) from public, anon, authenticated;

/** A case where ONE can tell somebody now that what they sent arrived. */
create or replace function public.case_advance_received_due(target_case uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.case_received_owed(target_case));
$$;

revoke all on function public.case_advance_received_due(uuid) from public, anon, authenticated;

/**
 * Who of a case ONE tells now that what they sent arrived, with what the
 * message names (their name, the firm's) and whether a power of attorney
 * waits for their signature. For the worker that holds the claim; service
 * role only.
 */
create or replace function public.advance_received_people(target_case uuid, target_claim integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.case_advance_held(target_case, target_claim) then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  return jsonb_build_object(
    'ok', true,
    'firm', (select o.name from public.organizations o where o.id = current_case.org_id),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('person_id', r.person_id, 'full_name', r.full_name,
                                          'paper_waiting', r.paper_waiting) order by r.person_id)
      from public.case_received_owed(current_case.id) r
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.advance_received_people(uuid, integer) from public, anon, authenticated;

/**
 * ONE tells a person of a case, in their conversation, that what they sent
 * arrived and what comes next, in the words the app wrote: under the lock
 * the notices of the firm take turns under, it checks again that the person
 * is owed it and ONE can say it now, writes the message to the outbox as
 * ONE's, and records it as the notice `case_received` of that case, so the
 * template never goes after it. What the client wrote last still waits for
 * the firm's answer. Answers the message to send, or why nothing was. For
 * the worker that holds the claim; service role only.
 */
create or replace function public.advance_say_received(
  target_case uuid,
  target_claim integer,
  target_person uuid,
  target_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  owed record;
  conversation public.wa_conversations%rowtype;
  body text := nullif(btrim(coalesce(target_body, '')), '');
  message uuid;
  firm text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.case_advance_held(target_case, target_claim) then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if body is null or char_length(body) > 4096 then
    return jsonb_build_object('ok', false, 'code', 'invalid_body');
  end if;
  select * into current_case from public.cases where id = target_case;
  -- The notices of the firm take turns: the template's sweep never reserves this one meanwhile.
  perform pg_advisory_xact_lock(hashtextextended('client_notices:' || current_case.org_id::text, 0));

  select * into owed from public.case_received_owed(target_case) r where r.person_id = target_person;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  -- The conversation, held and read again: a message the person sent meanwhile only keeps it open.
  select * into conversation from public.wa_conversations wc where wc.id = owed.conversation_id for update;
  if not found or conversation.agent <> 'one' or not public.wa_window_open(conversation.last_inbound_at) then
    return jsonb_build_object('ok', false, 'code', 'window_closed');
  end if;

  insert into public.wa_messages (org_id, conversation_id, number_id, direction, origin, kind, body, status)
  values (conversation.org_id, conversation.id, conversation.number_id, 'out', 'cloud', 'text', body, 'queued')
  returning id into message;

  -- What the client wrote last still waits for the firm: ONE's message answers nothing of it.
  update public.wa_conversations set
    last_message_at = now(),
    last_message_preview = public.wa_preview('text', body),
    last_message_direction = 'out'
  where id = conversation.id
    and not (last_message_direction = 'in' and last_inbound_at is not null and last_inbound_at >= last_message_at);

  select o.name into firm from public.organizations o where o.id = current_case.org_id;
  insert into public.client_notices (org_id, case_id, person_id, phone, kind, occurrence, params, message_id, reserved_at)
  values (current_case.org_id, current_case.id, target_person, owed.phone, 'case_received', 'r:' || current_case.id,
          jsonb_build_array(initcap(lower(split_part(btrim(owed.full_name), ' ', 1))), firm,
                            public.notice_next_words(current_case.id, target_person)),
          message, clock_timestamp());

  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message);
end;
$$;

revoke all on function public.advance_say_received(uuid, integer, uuid, text) from public, anon, authenticated;

-- ---------- The sweep takes a case owed that word ----------

/**
 * Claims the cases ONE may carry on now (replaces the one of 0054, adding a
 * client ONE can tell that what they sent arrived: `received_due`). The rest
 * as in 0054.
 */
create or replace function public.claim_case_advances(target_limit integer default 10, target_case uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stale integer := greatest(public.case_advance_setting('stale_minutes', 15), 1);
  wait integer := greatest(public.case_advance_setting('wait_minutes', 360), 1);
  scan integer := least(greatest(public.case_advance_setting('scan', 200), 1), 2000);
  wanted integer := greatest(least(coalesce(target_limit, 10), 50), 1);
  claimed jsonb := '[]'::jsonb;
  parked integer := 0;
  candidate uuid;
  link boolean;
  lawsuits boolean;
  package boolean;
  papers boolean;
  received boolean;
  claims_now integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  for candidate in
    select a.case_id from public.case_advances a
    where (target_case is null or a.case_id = target_case)
      and (target_case is not null or coalesce(a.after, a.created_at) <= now())
      and (a.claimed_at is null or a.claimed_at < now() - make_interval(mins => stale))
    order by coalesce(a.after, a.created_at), a.case_id
    limit case when target_case is null then scan else 1 end
  loop
    -- Locked one at a time, and read again under the lock: another worker may have taken it meanwhile.
    perform 1 from public.case_advances a
    where a.case_id = candidate
      and (target_case is not null or coalesce(a.after, a.created_at) <= now())
      and (a.claimed_at is null or a.claimed_at < now() - make_interval(mins => stale))
    for update skip locked;
    if not found then
      continue;
    end if;
    link := public.case_advance_link_due(candidate);
    lawsuits := public.case_advance_lawsuits_due(candidate);
    package := public.case_advance_package_due(candidate);
    papers := public.case_advance_papers_due(candidate);
    received := public.case_advance_received_due(candidate);
    if link or lawsuits or package or papers or received or public.case_advance_steps_due(candidate) then
      update public.case_advances a set claimed_at = clock_timestamp(), claims = a.claims + 1
      where a.case_id = candidate
      returning a.claims into claims_now;
      claimed := claimed || jsonb_build_array(jsonb_build_object(
        'case_id', candidate, 'claim', claims_now, 'link_due', link, 'lawsuits_due', lawsuits, 'package_due', package,
        'papers_due', papers, 'received_due', received));
      exit when jsonb_array_length(claimed) >= wanted;
    else
      -- A case set aside for good (it ended, or is with the court) stays so.
      update public.case_advances a
      set after = greatest(coalesce(a.after, '-infinity'::timestamptz), now() + make_interval(mins => wait)),
          waiting = null, checked_at = now(), claimed_at = null, attempts = 0
      where a.case_id = candidate;
      parked := parked + 1;
    end if;
  end loop;
  return jsonb_build_object('claimed', claimed, 'parked', parked);
end;
$$;

revoke all on function public.claim_case_advances(integer, uuid) from public, anon, authenticated;

-- ---------- The test chat: every kind, approved and on ----------

/**
 * The templates of every kind of notice on the test chat's account, approved
 * as the test chat approves everything, and each kind switched on for the
 * firm (replaces the one of 0047, which did ONE's first word alone): nothing
 * of it reaches the vendor, and a tester follows the whole course of a case.
 * A firm that has a kind on another account keeps it.
 */
create or replace function public.test_chat_templates(target_org uuid, target_number uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  waba text := (select n.waba_id from public.wa_numbers n where n.id = target_number and n.org_id = target_org);
  notice public.notice_kinds%rowtype;
  template uuid;
begin
  for notice in select * from public.notice_kinds k order by k.position loop
    insert into public.wa_templates (org_id, waba_id, name, language, category, status, body, footer_text, param_count)
    values (target_org, waba, notice.template_base || '_1', 'pt_BR', 'utility', 'approved', notice.body, notice.footer,
            cardinality(notice.params))
    on conflict (org_id, waba_id, name, language) do update
      set status = 'approved', category = 'utility', body = excluded.body, footer_text = excluded.footer_text,
          param_count = excluded.param_count, synced_at = now()
    returning id into template;

    insert into public.firm_notice_kinds (org_id, kind, template_id, body, enabled, submitted_at, changed_at)
    values (target_org, notice.kind, template, notice.body, true, now(), now())
    on conflict (org_id, kind) do update
      set template_id = excluded.template_id, body = excluded.body, enabled = true, changed_at = now()
    where public.firm_notice_kinds.template_id is null
       or exists (
         select 1 from public.wa_templates t
         join public.wa_numbers n on n.org_id = t.org_id and n.waba_id = t.waba_id
         where t.id = public.firm_notice_kinds.template_id and n.provider = 'test'
       );
  end loop;
end;
$$;

revoke all on function public.test_chat_templates(uuid, uuid) from public, anon, authenticated;

-- The test chats on now get every kind.
do $$
declare
  chat record;
begin
  for chat in select c.org_id, c.number_id from public.test_chats c where c.status = 'active' loop
    perform public.test_chat_templates(chat.org_id, chat.number_id);
  end loop;
end;
$$;

-- ---------- The words a client agrees to ----------

/** What a person agrees to, word for word, for a number (replaces the one of 0038, naming the new purposes). */
create or replace function public.notice_optin_wording(target_source text, target_firm text, target_phone text)
returns text
language sql
immutable
as $$
  select case target_source
    when 'client' then 'Quero receber pelo WhatsApp, no número ' || public.phone_formatted(target_phone)
      || ', os avisos do meu processo enviados pelo escritório ' || target_firm
      || ': a confirmação do que enviei, o protocolo da ação, lembretes e mudanças de audiência, atualizações do andamento, alertas de segurança e pedidos para reenviar um documento recusado. Posso deixar de receber quando quiser, por este link ou respondendo SAIR.'
    else 'A pessoa concordou em receber pelo WhatsApp, no número ' || public.phone_formatted(target_phone)
      || ', os avisos do processo enviados pelo escritório ' || target_firm
      || ': a confirmação do que enviou, o protocolo da ação, lembretes e mudanças de audiência, atualizações do andamento, alertas de segurança e pedidos para reenviar um documento recusado.'
  end;
$$;

revoke all on function public.notice_optin_wording(text, text, text) from public, anon, authenticated;
