-- ============================================================
-- The closing and the referral (0183), item 4.7 of the case journey plan.
-- Once the client confirmed on their link that their money arrived (0135),
-- ONE thanks them in the firm's name in the conversation it holds, inside
-- the 24 hours, and asks them to pass the firm's contact to whoever else had
-- a problem with a flight, offering nothing in exchange (the OAB's Código de
-- Ética forbids paying or rewarding a referral): once per case
-- (`cases.referral_asked_at`, `referral_asks_owed`, `one_ask_referral`). Who
-- then writes to the firm's WhatsApp saying who referred them is kept as a
-- lead with the origin referral and that name, at the first word
-- (`people.referred_by`; the intake's task reads it, a second version of
-- `atendimento.entrada`, `intake_facts_clean` and `record_conversation_intake`
-- redefined from 0176), the case it opens is of the origin referral, and the
-- firm's numbers count referrals (`people_facts`, redefined from 0138).
-- ============================================================

alter table public.people add column referred_by text;
alter table public.people add column referred_at timestamptz;
alter table public.people add constraint people_referred_check
  check (referred_by is null or (char_length(referred_by) between 2 and 120 and referred_by !~ '[[:cntrl:]]'));
alter table public.cases add column referral_asked_at timestamptz;

/** What the intake keeps of what a person told (replaces 0176's): also who referred them (0183). */
create or replace function public.intake_facts_clean(target_facts jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
  from (
    select key, to_jsonb(left(btrim(regexp_replace(value, '\s+', ' ', 'g')), 120)) as value
    from jsonb_each_text(case when jsonb_typeof(target_facts) = 'object' then target_facts else '{}'::jsonb end)
    where key in ('problema', 'companhia', 'voo', 'data', 'origem', 'destino', 'atraso_horas', 'aviso', 'nome', 'indicado_por')
      and nullif(btrim(value), '') is not null
      and case key
        when 'problema' then value in ('cancellation', 'change', 'delay', 'missed_connection', 'overbooking',
                                       'baggage_lost', 'baggage_damaged', 'baggage_delayed', 'downgrade', 'other')
        when 'data' then value ~ '^\d{4}-\d{2}-\d{2}$'
        when 'atraso_horas' then value ~ '^\d{1,3}(\.\d)?$'
        when 'aviso' then value in ('at_airport', 'late', 'early')
        when 'origem' then upper(btrim(value)) ~ '^[A-Z]{3}$'
        when 'destino' then upper(btrim(value)) ~ '^[A-Z]{3}$'
        when 'nome' then char_length(btrim(value)) between 3 and 120 and value ~ '[[:alpha:]]'
        when 'indicado_por' then char_length(btrim(value)) between 2 and 120 and value ~ '[[:alpha:]]'
        else true
      end
  ) f;
$$;

revoke all on function public.intake_facts_clean(jsonb) from public, anon, authenticated;

/**
 * Keeps what the task read of an intake (replaces 0176's): and who says they were referred is a person of the firm
 * at once, a lead with the origin referral and the name they gave (0183), the firm's own person at that WhatsApp
 * keeping what the firm wrote. Service role, for the conversation the backend holds.
 */
create or replace function public.record_conversation_intake(target_conversation uuid, target_claim integer, target_facts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  merged jsonb;
  person uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if conversation.intake_case_id is not null then
    return jsonb_build_object('ok', false, 'code', 'already_opened', 'facts', conversation.intake);
  end if;
  merged := (conversation.intake - 'result') || public.intake_facts_clean(target_facts);
  if conversation.intake ? 'result' then
    merged := merged || jsonb_build_object('result', conversation.intake -> 'result');
  end if;
  update public.wa_conversations set intake = merged, intake_at = now() where id = conversation.id
  returning * into conversation;
  if merged ? 'indicado_por' then
    person := public.intake_person(conversation);
    if person is not null then
      update public.people
      set referred_by = coalesce(referred_by, merged ->> 'indicado_por'), referred_at = coalesce(referred_at, now())
      where id = person;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'code', 'kept', 'facts', merged);
end;
$$;

revoke all on function public.record_conversation_intake(uuid, integer, jsonb) from public, anon, authenticated;

/** The case an intake opens is of the origin referral when the person said who referred them (0183). */
create or replace function public.wa_conversations_referral_case()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.intake_case_id is not null and old.intake_case_id is null and new.intake ? 'indicado_por' then
    update public.cases set origin = 'referral'
    where id = new.intake_case_id and (origin is null or origin = 'organic');
  end if;
  return null;
end;
$$;

revoke all on function public.wa_conversations_referral_case() from public, anon, authenticated;

create trigger wa_conversations_referral_case after update of intake_case_id on public.wa_conversations
  for each row execute function public.wa_conversations_referral_case();

-- A second version of `atendimento.entrada`: who referred the person, when they say it.
insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'atendimento.entrada',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'atendimento.entrada'),
  v.provider, v.model, v.effort,
  replace(v.system_prompt,
    '- nome: o nome completo de quem viajou, como ela escreveu; vazio quando não disse.',
    '- nome: o nome completo de quem viajou, como ela escreveu; vazio quando não disse.' || chr(10)
      || '- indicado_por: o nome de quem indicou o escritório, quando ela diz que foi indicada por alguém ("a Maria me indicou", "fui indicado pelo João"); vazio quando não disse.'),
  jsonb_set(
    jsonb_set(v.output_schema, '{required}', (v.output_schema -> 'required') || '["indicado_por"]'::jsonb),
    '{properties,indicado_por}', '{"type": "string", "maxLength": 120}'::jsonb),
  v.max_tokens, false,
  'Lê também quem indicou o escritório, quando a pessoa diz.'
from public.prompt_versions v
where v.task = 'atendimento.entrada' and v.is_active and not (v.output_schema -> 'properties') ? 'indicado_por';

update public.prompt_versions as v set is_active = false
where v.task = 'atendimento.entrada' and v.is_active and not (v.output_schema -> 'properties') ? 'indicado_por'
  and exists (
    select 1 from public.prompt_versions w
    where w.task = v.task and w.version > v.version and (w.output_schema -> 'properties') ? 'indicado_por'
  );
update public.prompt_versions set is_active = true
where task = 'atendimento.entrada'
  and version = (select max(w.version) from public.prompt_versions w where w.task = 'atendimento.entrada')
  and (output_schema -> 'properties') ? 'indicado_por';

/** What the numbers of the firm's people read (replaces 0138's): who said they were referred counts as a referral. */
create or replace function public.people_facts(target_org uuid)
returns table (
  person_id uuid, full_name text, email text, phone text, age integer, adult boolean, active boolean, has_case boolean,
  origins text[], airlines text[], incidents text[], outcomes text[], profession text, city text, uf text,
  marketing_off boolean, erased boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with cases_of as (
    select cp.person_id, c.id as case_id, c.status, c.origin, c.airline_iata, c.incident
    from public.case_parties cp join public.cases c on c.id = cp.case_id
    -- The test cases count while the firm has no real case (0138), as the controladoria counts them.
    where c.org_id = target_org and (not c.is_test or not public.firm_has_real_case(target_org))
  ),
  outcomes_of as (
    select co.person_id, array_agg(distinct coalesce(f.result, f.kind)) as list
    from cases_of co join public.lawsuit_facts f on f.case_id = co.case_id
    where f.kind in ('sentenca', 'acordo') and f.corrected_at is null
    group by co.person_id
  )
  select p.id, p.full_name, p.email, p.phone,
    case when p.birth_date is not null
      then extract(year from age((now() at time zone 'America/Sao_Paulo')::date, p.birth_date))::integer end,
    not public.person_minor(p.id),
    coalesce(bool_or(co.status not in ('closed', 'declined')), false),
    count(co.case_id) > 0,
    coalesce(array_agg(distinct co.origin) filter (where co.origin is not null), '{}')
      -- Who said they were referred and has no case of that origin yet counts as a referral too (0183).
      || case when p.referred_by is not null and not coalesce('referral' = any (array_agg(co.origin)), false)
              then array['referral'] else '{}'::text[] end,
    coalesce(array_agg(distinct co.airline_iata) filter (where co.airline_iata is not null), '{}'),
    coalesce(array_agg(distinct co.incident) filter (where co.incident is not null), '{}'),
    coalesce((select o.list from outcomes_of o where o.person_id = p.id), '{}'),
    nullif(btrim(coalesce(p.profession, '')), ''), nullif(btrim(coalesce(p.city, '')), ''), p.uf,
    p.marketing_off_at is not null, p.erased_at is not null
  from public.people p
  left join cases_of co on co.person_id = p.id
  where p.org_id = target_org
  group by p.id;
$$;

revoke all on function public.people_facts(uuid) from public, anon, authenticated;

/**
 * The thanks and the referral ONE owes (service role): a case whose client confirmed on their link that their money
 * arrived, asked once, in the conversation ONE holds, inside the 24 hours, where the firm lets ONE answer its clients
 * and never to who asked to stop.
 */
create or replace function public.referral_asks_owed(target_limit integer default 20)
returns table (case_id uuid, conversation_id uuid, first_name text)
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
  select c.id, talk.id, initcap(lower(split_part(btrim(pe.full_name), ' ', 1)))
  from public.cases c
  cross join lateral (
    select s.person_id from public.money_shares s
    where s.case_id = c.id and s.client_confirmed_at is not null
    order by s.client_confirmed_at desc limit 1
  ) who
  join public.people pe on pe.id = who.person_id
  cross join lateral (
    select wc.id, wc.agent, wc.last_inbound_at from public.wa_conversations wc
    join public.wa_numbers n on n.id = wc.number_id and n.status = 'active'
    join public.connections cn on cn.id = n.connection_id and cn.status = 'connected'
    where wc.org_id = c.org_id and pe.phone is not null and wc.contact_wa_id = any (public.wa_phone_variants(pe.phone))
    order by wc.last_inbound_at desc nulls last, wc.last_message_at desc nulls last, wc.id
    limit 1
  ) talk
  where c.referral_asked_at is null
    and public.firm_autonomy_mode(c.org_id, 'reply_client') <> 'approval'
    and talk.agent = 'one'
    and public.wa_window_open(talk.last_inbound_at)
    and not exists (
      select 1 from public.wa_optouts x
      where x.org_id = c.org_id and x.contact_wa_id = any (public.wa_phone_variants(pe.phone))
    )
  order by c.id
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;

revoke all on function public.referral_asks_owed(integer) from public, anon, authenticated;
grant execute on function public.referral_asks_owed(integer) to service_role;

/** ONE writes the thanks and the referral ask to the outbox, once per case, while it is owed. Service role. */
create or replace function public.one_ask_referral(target_case uuid, target_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owed record;
  conversation public.wa_conversations%rowtype;
  current_case public.cases%rowtype;
  message uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into owed from public.referral_asks_owed(100) r where r.case_id = target_case;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  select * into current_case from public.cases where id = target_case for update;
  if current_case.referral_asked_at is not null then
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  select * into conversation from public.wa_conversations wc where wc.id = owed.conversation_id for update;
  begin
    message := public.one_message(conversation, target_body, null, null);
  exception when sqlstate 'P0001' then
    return jsonb_build_object('ok', false, 'code', sqlerrm);
  end;
  update public.cases set referral_asked_at = now() where id = current_case.id;
  perform public.record_case_event(current_case.org_id, current_case.id, 'referral_asked', 'system', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message);
end;
$$;

revoke all on function public.one_ask_referral(uuid, text) from public, anon, authenticated;
grant execute on function public.one_ask_referral(uuid, text) to service_role;
