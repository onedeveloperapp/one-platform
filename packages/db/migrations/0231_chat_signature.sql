-- ============================================================
-- The chat's script, its third part (0231): the link to sign comes in the
-- chat. Once the papers of a case (the power of attorney, the contract,
-- 0054) are open to sign at ZapSign, ONE writes their links to the person
-- who signs, in the conversation the firm holds with that person's number
-- inside the 24 hours, never to who asked to stop and not while a person of
-- the firm carries the conversation: the person signs on the provider's
-- page with no stop at the client's link. A paper signed by gov.br is said
-- to be on the client's link, where the PDF waits. Each paper is told once
-- (`case_papers.told_in_chat_at`, marked in the same transaction as the
-- message, so a message that cannot be written marks nothing); outside the
-- 24 hours nothing is written, and the link keeps the papers as before.
-- ============================================================

alter table public.case_papers add column told_in_chat_at timestamptz;

/**
 * The papers ONE owes a word of in the chat (0231), by person and case: their envelope open to sign (ZapSign with the
 * person's own address to sign, or gov.br on the link), not told yet, of a case still gathered, the person with a
 * conversation ONE carries with the firm inside the 24 hours. Service role.
 */
create or replace function public.signature_links_owed(target_limit integer default 20)
returns table (org_id uuid, conversation_id uuid, case_id uuid, person_id uuid, full_name text, papers jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  with owed as (
    select cp.org_id, cp.case_id, cp.person_id, cp.id as paper_id, cp.kind, e.method,
           (select s ->> 'sign_url' from jsonb_array_elements(e.signers) s
            where (s ->> 'person_id')::uuid = cp.person_id limit 1) as sign_url,
           cp.created_at
    from public.case_papers cp
    join public.signature_envelopes e on e.id = cp.envelope_id and e.status = 'pending'
    join public.cases c on c.id = cp.case_id and c.status in ('intake', 'documents', 'signature')
    where cp.told_in_chat_at is null and cp.created_at > now() - interval '7 days'
  ), ready as (
    select o.* from owed o where o.method = 'govbr' or (o.method = 'zapsign' and o.sign_url is not null)
  ), talk as (
    select distinct on (r.org_id, r.case_id, r.person_id)
           r.org_id, r.case_id, r.person_id, wc.id as conversation_id, p.full_name
    from ready r
    join public.people p on p.id = r.person_id and p.phone is not null and p.erased_at is null
    join public.wa_conversations wc on wc.org_id = r.org_id and wc.contact_wa_id = any (public.wa_phone_variants(p.phone))
    join public.wa_numbers n on n.id = wc.number_id and n.status = 'active'
    where wc.agent = 'one'
      and public.wa_window_open(wc.last_inbound_at)
      and not exists (select 1 from public.wa_optouts x where x.org_id = wc.org_id and x.contact_wa_id = wc.contact_wa_id)
    order by r.org_id, r.case_id, r.person_id, wc.last_inbound_at desc
  )
  select t.org_id, t.conversation_id, t.case_id, t.person_id, t.full_name,
         (select jsonb_agg(jsonb_build_object('paper_id', r.paper_id, 'kind', r.kind, 'method', r.method, 'sign_url', r.sign_url)
                           order by case r.kind when 'procuracao' then 0 else 1 end, r.created_at)
          from ready r where r.case_id = t.case_id and r.person_id = t.person_id)
  from talk t
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;

revoke all on function public.signature_links_owed(integer) from public, anon, authenticated;
grant execute on function public.signature_links_owed(integer) to service_role;

/**
 * ONE writes the links to sign in the conversation (0231): only the papers still owed a word (checked again under the
 * conversation's lock), each marked told in the same transaction as the message. Service role.
 */
create or replace function public.one_tell_signature_links(
  target_conversation uuid,
  target_papers uuid[],
  target_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  owed_row record;
  message uuid;
  told integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into owed_row from public.signature_links_owed(100) o where o.conversation_id = target_conversation limit 1;
  if owed_row.conversation_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  select * into conversation from public.wa_conversations where id = target_conversation for update;
  update public.case_papers set told_in_chat_at = now()
  where id = any (target_papers) and told_in_chat_at is null and case_id = owed_row.case_id
    and person_id = owed_row.person_id;
  get diagnostics told = row_count;
  if told = 0 then
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  -- A message that cannot be written (the window closed, the person asked to stop) undoes the marks with it.
  message := public.one_message(conversation, target_body, null, null);
  perform public.record_case_event(owed_row.org_id, owed_row.case_id, 'signature_told', 'system',
    jsonb_build_object('papers', told, 'from', 'conversation'));
  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message, 'told', told);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'code', sqlerrm);
end;
$$;

revoke all on function public.one_tell_signature_links(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.one_tell_signature_links(uuid, uuid[], text) to service_role;
