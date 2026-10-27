-- ============================================================
-- 0057_papers_as_case_moves_on: the papers a client signs, and ONE's word that what they sent arrived, also when
-- the case moves on before the client says they finished.
--
-- The rehearsal of the end-to-end test (2026-10-26) found it: a passenger sent their data and the three papers,
-- ONE accepted each, and 25 seconds after the last one ONE created the lawsuit and moved the case to drafting,
-- which closes the link to changes. The passenger's "Terminei" was gone before they pressed it, and the power of
-- attorney, which 0054 issues only once the client said they finished, was never issued: the case went on to its
-- piece and its package with no power of attorney, and the passenger heard nothing.
--
-- A case that left the gathering (`drafting`, `ready`: ONE or a person created its lawsuits, which happens only
-- once nothing it needs is missing) now owes its papers too, to each adult of it whose link is still open, and
-- ONE's word in the conversation that it has all it needs, with the next steps (the app writes it with an opening
-- of its own: the client did not say they finished). The firm's template of that word stays for a client who
-- said they finished: its text says so. Nothing else of 0054 and 0055 changes.
-- ============================================================

/**
 * The papers a case owes now, where its firm lets ONE send them: for each
 * adult of the case whose own link of the case is still open (who signs on
 * it) and who said on it that they finished, or whose case left the
 * gathering, each document the firm has a model of (`paper_template_for`),
 * not issued for them before, while the case has not reached the court. The
 * power of attorney first.
 */
create or replace function public.case_papers_due(target_case uuid)
returns table (person_id uuid, kind text, template_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select l.person_id, k.kind, public.paper_template_for(c.org_id, k.kind)
  from public.cases c
  join public.client_links l on l.case_id = c.id
  cross join (values ('procuracao', 1), ('contrato', 2)) as k (kind, position)
  where c.id = target_case
    and c.status in ('intake', 'documents', 'signature', 'drafting', 'ready')
    and (l.finished_at is not null or c.status in ('drafting', 'ready'))
    and l.revoked_at is null and l.expires_at > now()
    and public.firm_autonomy_mode(c.org_id, 'send_signature_papers') = 'auto'
    and public.paper_template_for(c.org_id, k.kind) is not null
    -- Somebody of the case, and an adult: who answers for a minor signs for them.
    and exists (select 1 from public.case_parties cp where cp.case_id = c.id and cp.person_id = l.person_id)
    and not exists (
      select 1 from public.people p
      where p.id = l.person_id and p.birth_date is not null
        and p.birth_date > (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
    )
    and not exists (
      select 1 from public.case_papers paper
      where paper.case_id = c.id and paper.person_id = l.person_id and paper.kind = k.kind
    )
  group by l.person_id, k.kind, k.position, c.org_id
  order by l.person_id, k.position;
$$;

revoke all on function public.case_papers_due(uuid) from public, anon, authenticated;

/**
 * Who of a case ONE may tell now, in their conversation, that what they sent
 * arrived: an adult of the case whose link says they finished within the
 * setting's days, or whose case left the gathering within them while their
 * link is open; in a conversation ONE holds, inside its 24 hours, where the
 * firm lets ONE answer its clients, never to who asked to stop, and once per
 * case. As 0055, with the case that moved on.
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
    and l.revoked_at is null
    and (
      l.finished_at > now() - make_interval(days => greatest(public.notices_setting('received_days', 3), 1))
      or (l.finished_at is null and l.expires_at > now() and c.status in ('drafting', 'ready')
          and c.status_changed_at > now() - make_interval(days => greatest(public.notices_setting('received_days', 3), 1)))
    )
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

/**
 * Who of a case ONE tells now that what they sent arrived, with what the
 * message names (their name, the firm's), whether a power of attorney waits
 * for their signature, and whether they said they finished (the message then
 * answers their word; otherwise it says the case has what it needs). For the
 * worker that holds the claim; service role only.
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
      select jsonb_agg(jsonb_build_object(
        'person_id', r.person_id, 'full_name', r.full_name, 'paper_waiting', r.paper_waiting,
        'finished', exists (
          select 1 from public.client_links l
          where l.case_id = current_case.id and l.person_id = r.person_id and l.finished_at is not null
        )) order by r.person_id)
      from public.case_received_owed(current_case.id) r
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.advance_received_people(uuid, integer) from public, anon, authenticated;
