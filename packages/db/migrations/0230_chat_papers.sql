-- ============================================================
-- The chat's script, its second part (0230): ONE asks each document in
-- turn in the chat. After the files of a turn join the case (0050), ONE
-- says what came of each and asks the next one still owed, by whose it is:
-- the passenger's identity, a fellow claimant's or a child's by name, the
-- proof of address, the ticket or the boarding pass, a bag's report. With
-- nothing essential left, the dispensable ones the case asks now (0177,
-- after the signature where the client signs first, 0181) are asked once in
-- one message, and "Não tenho" is kept as the client's word, as on the link
-- (`case_document_answers`, said by the client). The case is the one a file
-- of that conversation joins: the one the passenger's yes opened, else
-- their latest being gathered (`conversation_gathered_case`, the rule of
-- 0050 said once).
-- ============================================================

/** The case a conversation gathers: the passenger's being gathered, the one their trip opened first. Internal. */
create or replace function public.conversation_gathered_case(conversation public.wa_conversations)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select k.id from public.cases k
  where k.org_id = conversation.org_id and k.status in ('intake', 'documents', 'signature')
    and exists (
      select 1 from public.case_parties cp join public.people p on p.id = cp.person_id
      where cp.case_id = k.id
        and p.phone = any (public.wa_phone_variants(conversation.contact_wa_id) || conversation.contact_wa_id)
    )
  order by exists (
      select 1 from public.tracked_trips t
      where t.case_id = k.id and t.org_id = k.org_id
        and t.phone = any (public.wa_phone_variants(conversation.contact_wa_id) || conversation.contact_wa_id)
    ) desc, k.created_at desc, k.id
  limit 1;
$$;

revoke all on function public.conversation_gathered_case(public.wa_conversations) from public, anon, authenticated;

/**
 * What the case a conversation gathers still owes of its documents (0230), for ONE to ask the next one in the chat:
 * each essential of the case's version (`case_required_documents`) by whose it is (each claimant's, the passenger's,
 * the case's), with the name to ask it by, whether that person is the passenger or a child, and whether the last one
 * sent was refused; the dispensables and where each stands; whether the case waits for its signature. Service role,
 * for the conversation the backend holds.
 */
create or replace function public.conversation_papers_owed(target_conversation uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  current_case uuid;
  passenger public.case_parties%rowtype;
  phones text[];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  current_case := public.conversation_gathered_case(conversation);
  if current_case is null then
    return jsonb_build_object('ok', true, 'code', 'no_case');
  end if;
  phones := public.wa_phone_variants(conversation.contact_wa_id) || conversation.contact_wa_id;
  select cp.* into passenger from public.case_parties cp join public.people p on p.id = cp.person_id
  where cp.case_id = current_case and p.phone = any (phones)
  order by (cp.role = 'claimant') desc, cp.created_at, cp.id
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'code', 'case',
    'case_id', current_case,
    'waits_signature', public.case_waits_signature(current_case),
    'owed', coalesce((
      with needs as (
        select n.ordinality as position, n.value ->> 'kind' as kind, coalesce(n.value ->> 'per', 'case') as per,
               array[n.value ->> 'kind']
                 || coalesce(array(select jsonb_array_elements_text(
                      case when jsonb_typeof(n.value -> 'or') = 'array' then n.value -> 'or' else '[]'::jsonb end)), '{}') as kinds
        from jsonb_array_elements(public.case_required_documents(current_case)) with ordinality as n (value, ordinality)
        where jsonb_typeof(n.value) = 'object' and n.value ? 'kind'
      ), slots as (
        -- Each claimant for a paper of each claimant; the passenger for theirs; the case once.
        select nd.position, nd.kind, nd.per, nd.kinds, cp.id as party_id, cp.person_id, cp.created_at as party_at
        from needs nd
        join public.case_parties cp on cp.case_id = current_case
          and ((nd.per = 'claimant' and cp.role = 'claimant') or (nd.per = 'holder' and cp.id = passenger.id))
        union all
        select nd.position, nd.kind, nd.per, nd.kinds, null, null, null
        from needs nd where nd.per not in ('claimant', 'holder')
      )
      select jsonb_agg(jsonb_build_object(
        'kind', s.kind,
        'per', s.per,
        'name', p.full_name,
        'own', s.person_id is not distinct from passenger.person_id or s.per = 'case',
        'minor', p.birth_date is not null and p.birth_date > (current_date - interval '18 years')::date,
        'rejected', exists (
          select 1 from public.case_documents d
          where d.case_id = current_case and d.kind = any (s.kinds) and d.status = 'rejected'
            and (s.party_id is null or d.party_id = s.party_id)
        )
      ) order by s.position, (s.person_id is not distinct from passenger.person_id) desc, s.party_at)
      from slots s
      left join public.people p on p.id = s.person_id
      where not exists (
        select 1 from public.case_documents d
        where d.case_id = current_case and d.kind = any (s.kinds) and d.status <> 'rejected'
          and case s.per
                when 'case' then true
                when 'holder' then d.party_id in (
                  select x.id from public.case_parties x where x.case_id = current_case and x.person_id = s.person_id)
                else d.party_id = s.party_id
              end
      )
    ), '[]'::jsonb),
    'dispensables', public.case_dispensables(current_case)
  );
end;
$$;

revoke all on function public.conversation_papers_owed(uuid, integer) from public, anon, authenticated;

/**
 * The client says in the chat they do not have the dispensable documents ONE asked (0230), as on their link (0177):
 * each one still asked of the case the conversation gathers is kept as not had, said by the client. Service role, for
 * the conversation the backend holds.
 */
create or replace function public.one_dispensables_not_had(target_conversation uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  current_case public.cases%rowtype;
  kept integer := 0;
  item jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into current_case from public.cases where id = public.conversation_gathered_case(conversation);
  if current_case.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_case');
  end if;
  for item in select d from jsonb_array_elements(public.case_dispensables(current_case.id)) d where d ->> 'state' = 'asked' loop
    insert into public.case_document_answers (org_id, case_id, kind, said_by)
    values (current_case.org_id, current_case.id, item ->> 'kind', 'client')
    on conflict (case_id, kind) do nothing;
    if found then
      kept := kept + 1;
      perform public.record_case_event(current_case.org_id, current_case.id, 'document_not_had', 'client',
        jsonb_build_object('kind', item ->> 'kind', 'from', 'conversation'));
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'code', 'recorded', 'kept', kept);
end;
$$;

revoke all on function public.one_dispensables_not_had(uuid, integer) from public, anon, authenticated;
