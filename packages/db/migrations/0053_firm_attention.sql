-- 0053_firm_attention: what holds a case until somebody of the firm acts, said where the firm looks first.
--
-- The center of what waits (0044) and, since 2026-10-26, the home itself list every item a case waits on the firm
-- for. Two of them were in no list: a signed file a client sent back, which a person confirms (gov.br, 0023), or
-- an envelope whose outcome nobody can tell, which a person looks at; and a filing package whose signature in the
-- cloud failed (0042). `firm_pending` now says them too.

/**
 * What waits for somebody of the firm (replaces the one of 0048, adding what
 * waits on a signature): `signatures_to_confirm` lists, the oldest first,
 * each envelope that waits for a person of the firm, a signed file a client
 * sent back (`received`) or an outcome nobody can tell (`uncertain`), with
 * its case, who signs and since when, and `signatures_to_confirm_total`
 * counts them; `package_signatures_failed` counts the packages ready to file
 * whose signature in the cloud failed. The rest as in 0048.
 */
create or replace function public.firm_pending(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  document_hours integer := greatest(public.pending_setting('documents_stale_hours', 24), 1);
  waits_days integer := greatest(public.pending_setting('one_waits_stale_days', 2), 1);
  list_size integer := least(greatest(public.pending_setting('list_size', 20), 1), 100);
  late integer := greatest(public.pending_setting('link_late_minutes', 30), 1);
  called_late integer := greatest(public.pending_setting('called_late_minutes', 30), 1);
  links jsonb;
  links_total integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  with owed as (
    select r.case_id, r.seq, r.person_id, r.full_name, r.since,
           coalesce(r.reason, 'late') as reason
    from public.client_link_reach(target_org, null) r
    where r.reason is not null or r.since < now() - make_interval(mins => late)
  )
  select
    coalesce((
      select jsonb_agg(x.item order by x.since, x.seq)
      from (
        select o.since, o.seq, jsonb_build_object(
          'case_id', o.case_id,
          'seq', o.seq,
          'person_id', o.person_id,
          'client', o.full_name,
          'reason', o.reason,
          'since', o.since
        ) as item
        from owed o
        order by o.since, o.seq
        limit list_size
      ) x
    ), '[]'::jsonb),
    (select count(*)::integer from owed)
  into links, links_total;

  return jsonb_build_object(
    'one_waits', coalesce((
      select jsonb_agg(w.item order by w.since nulls last, w.seq)
      from (
        select
          a.waiting_since as since,
          c.seq,
          jsonb_build_object(
            'case_id', c.id,
            'seq', c.seq,
            -- The case is named as its list names it (0033): its first adult claimant, or who answers for a minor.
            'client', coalesce((
              select p.full_name from public.case_parties cp
              join public.people p on p.id = cp.person_id
              where cp.case_id = c.id
              order by (cp.role = 'claimant' and cp.guardian_id is null) desc, (cp.role = 'guardian') desc,
                       cp.created_at, cp.id
              limit 1
            ), ''),
            'waiting', a.waiting,
            'since', a.waiting_since
          ) as item
        from public.case_advances a
        join public.cases c on c.id = a.case_id
        where a.org_id = target_org and a.waiting is not null and a.waiting not in ('unavailable', 'held')
          and c.status not in ('closed', 'declined')
        order by a.waiting_since nulls last, c.seq
        limit list_size
      ) w
    ), '[]'::jsonb),
    'one_waits_total', (
      select count(*) from public.case_advances a
      join public.cases c on c.id = a.case_id
      where a.org_id = target_org and a.waiting is not null and a.waiting not in ('unavailable', 'held')
        and c.status not in ('closed', 'declined')
    ),
    'one_waits_stale', (
      select count(*) from public.case_advances a
      join public.cases c on c.id = a.case_id
      where a.org_id = target_org and a.waiting is not null and a.waiting not in ('unavailable', 'held')
        and c.status not in ('closed', 'declined')
        and a.waiting_since < now() - make_interval(days => waits_days)
    ),
    'links_owed', links,
    'links_owed_total', links_total,
    'conversations_called', coalesce((
      select jsonb_agg(v.item order by v.called_at, v.id)
      from (
        select c.called_at, c.id, jsonb_build_object(
          'conversation_id', c.id,
          'contact', coalesce(c.saved_name, c.contact_name, ''),
          'reason', c.called_reason,
          'since', c.called_at,
          'late', c.called_at < now() - make_interval(mins => called_late)
        ) as item
        from public.wa_conversations c
        where c.org_id = target_org and c.called_at is not null and c.agent = 'person'
        order by c.called_at, c.id
        limit list_size
      ) v
    ), '[]'::jsonb),
    'conversations_called_total', (
      select count(*) from public.wa_conversations c
      where c.org_id = target_org and c.called_at is not null and c.agent = 'person'
    ),
    'deadlines_overdue', coalesce((
      select jsonb_agg(x.item order by x.urgent_on, x.title)
      from (
        select
          u.urgent_on,
          d.title,
          jsonb_build_object(
            'deadline_id', d.id,
            'case_id', d.case_id,
            'seq', (select c.seq from public.cases c where c.id = d.case_id),
            'title', d.title,
            'cnj', d.cnj,
            'due_on', u.urgent_on
          ) as item
        from public.deadlines d
        cross join lateral (
          select public.deadline_urgent_on(d.status, d.due_on, d.computed_due_on, d.computed_revision, d.revision,
            d.confirmed_against) as urgent_on
        ) u
        where d.org_id = target_org and d.status in ('proposed', 'confirmed') and u.urgent_on < today
        order by u.urgent_on, d.title
        limit list_size
      ) x
    ), '[]'::jsonb),
    'deadlines_today', (
      select count(*) from public.deadlines d
      where d.org_id = target_org and d.status in ('proposed', 'confirmed')
        and public.deadline_urgent_on(d.status, d.due_on, d.computed_due_on, d.computed_revision, d.revision,
          d.confirmed_against) = today
    ),
    'hearings_today', (
      select count(*) from public.hearings h
      where h.org_id = target_org and h.status = 'scheduled'
        and (h.starts_at at time zone h.time_zone)::date = (now() at time zone h.time_zone)::date
    ),
    'documents_stale', (
      select count(*) from public.case_documents d
      where d.org_id = target_org and d.status = 'received'
        and d.created_at < now() - make_interval(hours => document_hours)
    ),
    'documents_stale_hours', document_hours,
    'one_waits_stale_days', waits_days,
    'signatures_to_confirm', coalesce((
      select jsonb_agg(s.item order by s.since, s.seq)
      from (
        select x.since, x.seq, jsonb_build_object(
          'envelope_id', x.id,
          'case_id', x.case_id,
          'seq', x.seq,
          'client', x.client,
          'method', x.method,
          'status', x.status,
          'since', x.since
        ) as item
        from (
          select e.id, e.case_id, c.seq, e.method, e.status,
            coalesce(e.signers -> 0 ->> 'name', '') as client,
            -- A signed file the client sent back waits from when it arrived; an outcome nobody can tell, from the
            -- envelope's own moment.
            coalesce((
              select max(d.created_at) from public.case_documents d
              where d.envelope_id = e.id and d.source = 'client' and d.status = 'received'
            ), e.created_at) as since
          from public.signature_envelopes e
          join public.cases c on c.id = e.case_id
          where e.org_id = target_org and e.status in ('received', 'uncertain')
            and c.status not in ('closed', 'declined')
        ) x
        order by x.since, x.seq
        limit list_size
      ) s
    ), '[]'::jsonb),
    'signatures_to_confirm_total', (
      select count(*) from public.signature_envelopes e
      join public.cases c on c.id = e.case_id
      where e.org_id = target_org and e.status in ('received', 'uncertain')
        and c.status not in ('closed', 'declined')
    ),
    'package_signatures_failed', (
      select count(*) from public.filing_packages p
      where p.org_id = target_org and p.status = 'ready' and p.signature_status = 'failed'
    )
  );
end;
$$;

revoke all on function public.firm_pending(uuid) from public, anon;
grant execute on function public.firm_pending(uuid) to authenticated;
