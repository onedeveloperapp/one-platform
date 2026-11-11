-- ============================================================
-- The new order (0181), item 3.2 of the case journey plan. The power of
-- attorney and the contract went out once the client said "Terminei" (0054)
-- or the case moved on (0057), so a client signed last. Now they go once the
-- person's identity and proof of address were accepted, which is what the
-- papers ask (`case_papers_due`, redefined from 0125): the client signs
-- early, and the signature is the closing (0146), which comes earlier too.
-- Whatever else ONE asks of the client waits for that signature, where ONE
-- sends the papers (`case_waits_signature`): the interview (`interview_owed`,
-- redefined from 0095) and the dispensable documents (`case_dispensables`,
-- redefined from 0177: `later` until then, and their days counted from the
-- signature). A firm that keeps the papers to a person, or a case with no
-- link to sign by, asks as before.
-- ============================================================

/** Whether a person's identity and proof of address were accepted in a case: what the papers ask. Internal. */
create or replace function public.paper_documents_accepted(target_case uuid, target_person uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.case_documents d join public.case_parties cp on cp.id = d.party_id
    where d.case_id = target_case and cp.person_id = target_person and d.kind = 'identity' and d.status = 'accepted'
  ) and exists (
    select 1 from public.case_documents d join public.case_parties cp on cp.id = d.party_id
    where d.case_id = target_case and cp.person_id = target_person and d.kind = 'address_proof' and d.status = 'accepted'
  );
$$;

revoke all on function public.paper_documents_accepted(uuid, uuid) from public, anon, authenticated;

/**
 * The papers a case owes now (replaces 0125's): the power of attorney and the contract also once the person's
 * identity and proof of address were accepted (0181), before the client says they finished.
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
  cross join (values ('procuracao', 1), ('declaracao_residencia', 2), ('declaracao_hipossuficiencia', 3), ('contrato', 4))
    as k (kind, position)
  where c.id = target_case
    and c.status in ('intake', 'documents', 'signature', 'drafting', 'ready')
    and (l.finished_at is not null or c.status in ('drafting', 'ready')
         or (k.kind in ('procuracao', 'contrato') and public.paper_documents_accepted(c.id, l.person_id)))
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
    -- A declaration only of a bill in somebody else's name the firm accepted, once the person said who the holder
    -- is and nothing about the address waits for a person.
    and (k.kind <> 'declaracao_residencia' or exists (
      select 1 from public.residence_declarations d
      where d.case_id = c.id and d.person_id = l.person_id and d.status = 'open'
        and public.residence_declaration_blocker(c.id, l.person_id) = 'residence_declaration_unsigned'
    ))
    -- A declaration of hardship once everybody this person answers for in the civil court answered, and somebody
    -- of them asks (0125).
    and (k.kind <> 'declaracao_hipossuficiencia' or (
      exists (select 1 from public.free_justice_needs(c.id) n where n.answerer_id = l.person_id and n.asks)
      and not exists (select 1 from public.free_justice_needs(c.id) n where n.answerer_id = l.person_id and n.answer_id is null)
    ))
  group by l.person_id, k.kind, k.position, c.org_id
  order by l.person_id, k.position;
$$;

revoke all on function public.case_papers_due(uuid) from public, anon, authenticated;

/** When the case was first signed (its power of attorney or contract, 0146), or null. Internal. */
create or replace function public.case_signed_at(target_case uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select cl.signed_at from public.cases c
  cross join lateral public.case_closings(c.org_id, array[c.id]) cl
  where c.id = target_case;
$$;

revoke all on function public.case_signed_at(uuid) from public, anon, authenticated;

/**
 * Whether what ONE asks after the signature still waits for it (0181): ONE sends the case's papers (the firm lets it,
 * a power of attorney to send exists), the case is still gathered, an adult of it has a link to sign by, and nothing
 * of it was signed yet. Internal.
 */
create or replace function public.case_waits_signature(target_case uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select c.status in ('intake', 'documents', 'signature')
      and public.firm_autonomy_mode(c.org_id, 'send_signature_papers') = 'auto'
      and public.paper_template_for(c.org_id, 'procuracao') is not null
      and exists (
        select 1 from public.client_links l
        join public.case_parties cp on cp.case_id = l.case_id and cp.person_id = l.person_id
        where l.case_id = c.id and l.revoked_at is null and l.expires_at > now()
      )
      and public.case_signed_at(c.id) is null
    from public.cases c where c.id = target_case
  ), false);
$$;

revoke all on function public.case_waits_signature(uuid) from public, anon, authenticated;

/**
 * What the backend reads to tell a passenger the order of their steps before their case exists: whether the firm
 * lets ONE send the papers, so they sign before the questions (0181). Service role.
 */
create or replace function public.firm_signs_first(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('ok', true, 'signs_first',
    public.firm_autonomy_mode(target_org, 'send_signature_papers') = 'auto'
    and public.paper_template_for(target_org, 'procuracao') is not null);
$$;

revoke all on function public.firm_signs_first(uuid) from public, anon, authenticated;
grant execute on function public.firm_signs_first(uuid) to service_role;

/** A case is owed its interview as before (0095), and only once it was signed where ONE sends the papers (0181). */
create or replace function public.interview_owed(target_case uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select c.status in ('intake', 'documents', 'signature')
      and c.incident in ('delay', 'cancellation', 'overbooking', 'missed_connection', 'downgrade', 'other')
      and not exists (select 1 from public.proceedings p where p.case_id = c.id)
      and not exists (select 1 from public.case_advances a where a.case_id = c.id and a.lawsuits_at is not null)
      and not exists (select 1 from public.case_interviews i where i.case_id = c.id)
      and public.case_account_state(c.id) <> 'ready'
      and public.case_interview_person(c.id) is not null
      and not public.case_waits_signature(c.id)
    from public.cases c where c.id = target_case
  ), false);
$$;

revoke all on function public.interview_owed(uuid) from public, anon, authenticated;

/**
 * Where each dispensable document of a case stands (replaces 0177's): `later` while the case waits for its signature
 * (0181), and its days counted from the signature once there is one.
 */
create or replace function public.case_dispensables(target_case uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', d.value ->> 'kind',
    'label', d.value ->> 'label',
    'state', case
      when exists (select 1 from public.case_documents x
                   where x.case_id = c.id and x.kind = d.value ->> 'kind' and x.status <> 'rejected') then 'sent'
      when exists (select 1 from public.case_document_answers a where a.case_id = c.id and a.kind = d.value ->> 'kind')
        then 'not_have'
      when public.case_waits_signature(c.id) then 'later'
      when coalesce(public.case_signed_at(c.id), c.created_at) < now() - make_interval(days => greatest(coalesce(
             (public.cases_setting('dispensable_days') #>> '{}')::integer, 7), 1)) then 'expired'
      else 'asked'
    end
  ) order by d.ordinality), '[]'::jsonb)
  from public.cases c
  cross join lateral jsonb_array_elements(coalesce(public.problem_documents(c.incident) -> 'dispensable', '[]'::jsonb))
    with ordinality as d (value, ordinality)
  where c.id = target_case;
$$;

revoke all on function public.case_dispensables(uuid) from public, anon, authenticated;
