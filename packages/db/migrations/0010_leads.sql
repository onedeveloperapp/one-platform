-- ============================================================
-- 0010_leads: people without an account: the waitlist and the newsletter.
--
-- The e-mail address is the identity, and it is only trusted after the person
-- clicks the confirmation link (double opt-in): a form post proves nothing
-- about who owns an address. Until then the row is `unconfirmed` and receives
-- nothing but that one confirmation message.
--
-- Rules that hold everywhere below:
--   * a repeated sign-up NEVER rewrites the name or anything else stored for an
--     existing address, and the answer to the visitor is the same whether the
--     address was new or already known (no e-mail oracle);
--   * consent is a snapshot pinned on the row: term id, version and the text
--     that was on screen;
--   * an opt-out is lifted only by confirming again from the inbox;
--   * erasure removes the row AND its change history.
--
-- The second half is what the operator writes to the confirmed list: a send,
-- its deliveries, and the claim that keeps a retry from writing twice.
-- ============================================================

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null unique,
  name text,
  phone text,
  locale text not null default 'pt-BR' check (locale = any (public.supported_locales())),
  source text not null default 'waitlist' check (source in ('waitlist', 'newsletter', 'contact')),
  -- First touch: the entry door, the campaign wave, a coupon, the UTM set.
  origem text,
  onda text,
  cupom text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer text,
  landing_path text,
  -- The consent that was given, exactly as shown.
  consent_term_id uuid references public.consent_terms (id),
  consent_term_version integer,
  consent_text text,
  consent_accepted_at timestamptz,
  -- Double opt-in. Only the hash of the token is stored.
  confirm_token_hash text unique,
  confirm_sent_at timestamptz,
  confirmed_at timestamptz,
  email_unsubscribe_token uuid not null unique default gen_random_uuid(),
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_email_check check (
    char_length(email::text) <= 254 and email::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  constraint leads_name_check check (name is null or char_length(btrim(name)) between 1 and 120),
  constraint leads_phone_check check (phone is null or phone ~ '^[1-9][0-9]{7,14}$'),
  constraint leads_token_hash_check check (confirm_token_hash is null or confirm_token_hash ~ '^[0-9a-f]{64}$'),
  constraint leads_lengths check (
    coalesce(length(origem), 0) <= 64
    and coalesce(length(onda), 0) <= 64
    and coalesce(length(cupom), 0) <= 64
    and coalesce(length(utm_source), 0) <= 64
    and coalesce(length(utm_medium), 0) <= 64
    and coalesce(length(utm_campaign), 0) <= 64
    and coalesce(length(utm_content), 0) <= 64
    and coalesce(length(utm_term), 0) <= 64
    and coalesce(length(referrer), 0) <= 255
    and coalesce(length(landing_path), 0) <= 255
  ),
  constraint leads_consent_whole check (
    (consent_term_id is null and consent_term_version is null and consent_text is null and consent_accepted_at is null)
    or (consent_term_id is not null and consent_term_version is not null and consent_text is not null and consent_accepted_at is not null)
  )
);

comment on table public.leads is
  'Contacts without an account (waitlist, newsletter). Superadmin-only. Consent pinned on the row; erasure through purge_lead / purge_expired_leads, which also remove the change history.';

create index leads_created_idx on public.leads (created_at desc);
create index leads_origem_idx on public.leads (origem, created_at desc);
create index leads_confirmed_idx on public.leads (confirmed_at) where confirmed_at is not null and opted_out_at is null;

alter table public.leads enable row level security;

create policy "leads_select_superadmin" on public.leads
  for select to authenticated
  using (public.is_superadmin());

create policy "leads_update_superadmin" on public.leads
  for update to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- The console reads the list and records an opt-out. Rows are created by
-- submit_lead and removed by the purge functions only.
grant select on table public.leads to authenticated;
grant update (opted_out_at) on table public.leads to authenticated;

create trigger leads_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

select public.enable_row_versioning('public.leads');

-- The per-network window. Pseudonymous (a salted hash), short-lived (purged
-- after a day), and deliberately NOT a column on the person.
create table public.lead_submissions (
  id bigint generated always as identity primary key,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index lead_submissions_window_idx on public.lead_submissions (ip_hash, created_at desc);

alter table public.lead_submissions enable row level security;

-- ---------- Sign-up ----------

/**
 * A waitlist or newsletter sign-up. Service role only: the caller is the
 * server action behind the form, after its honeypot.
 *
 * `payload`: email (required), consent (must be true), name, phone, locale,
 * source, and the first-touch fields (origem, onda, cupom, utm_*, referrer,
 * landing_path).
 *
 * Returns `send_confirmation`: whether the caller should e-mail the link built
 * from the token whose hash it passed. It is false for an address that is
 * already confirmed and subscribed, which is the only case with nothing to
 * confirm; the visitor is told the same thing either way.
 */
create or replace function public.submit_lead(
  payload jsonb,
  target_ip_hash text,
  target_confirm_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  data jsonb := coalesce(payload, '{}'::jsonb);
  clean_email text := lower(btrim(coalesce(data ->> 'email', '')));
  clean_name text := nullif(left(btrim(coalesce(data ->> 'name', '')), 120), '');
  clean_phone text := nullif(regexp_replace(coalesce(data ->> 'phone', ''), '[^0-9]', '', 'g'), '');
  clean_locale text := case
    when data ->> 'locale' = any (public.supported_locales()) then data ->> 'locale'
    else (public.supported_locales())[1]
  end;
  clean_source text := case
    when data ->> 'source' in ('waitlist', 'newsletter', 'contact') then data ->> 'source'
    else 'waitlist'
  end;
  window_limit integer;
  recent integer;
  term public.consent_terms%rowtype;
  existing public.leads%rowtype;
  new_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if char_length(clean_email) > 254
     or clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_email');
  end if;
  if target_confirm_token_hash is null or target_confirm_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  if target_ip_hash is not null and target_ip_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  if coalesce((data ->> 'consent')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'consent_required');
  end if;
  if clean_phone is not null and clean_phone !~ '^[1-9][0-9]{7,14}$' then
    clean_phone := null;
  end if;

  -- Per-network window, counted before anything is written about the person.
  if target_ip_hash is not null then
    select greatest(coalesce((value ->> 'per_network_hour')::integer, 10), 1) into window_limit
    from public.platform_settings where key = 'leads';
    window_limit := coalesce(window_limit, 10);

    select count(*) into recent
    from public.lead_submissions s
    where s.ip_hash = target_ip_hash and s.created_at > now() - interval '1 hour';
    if recent >= window_limit then
      return jsonb_build_object('ok', false, 'code', 'rate_limited');
    end if;
    insert into public.lead_submissions (ip_hash) values (target_ip_hash);
  end if;

  select t.* into term
  from public.consent_terms t
  where t.slug = 'newsletter' and t.is_active
  order by case when t.locale = clean_locale then 0 else 1 end, t.locale
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'consent_term_missing');
  end if;

  select * into existing from public.leads where email = clean_email::extensions.citext for update;

  if found then
    -- Already confirmed and subscribed: nothing to do, nothing to send, and
    -- nothing stored is touched.
    if existing.confirmed_at is not null and existing.opted_out_at is null then
      return jsonb_build_object('ok', true, 'code', 'already_confirmed', 'send_confirmation', false);
    end if;

    -- Unconfirmed, or opted out and asking again: issue a fresh link. The
    -- opt-out itself stays until the link is clicked.
    update public.leads set
      confirm_token_hash = target_confirm_token_hash,
      confirm_sent_at = now()
    where id = existing.id;
    return jsonb_build_object(
      'ok', true, 'code', 'pending', 'send_confirmation', true,
      'leadId', existing.id, 'locale', existing.locale
    );
  end if;

  insert into public.leads (
    email, name, phone, locale, source,
    origem, onda, cupom, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer, landing_path,
    consent_term_id, consent_term_version, consent_text, consent_accepted_at,
    confirm_token_hash, confirm_sent_at
  ) values (
    clean_email, clean_name, clean_phone, clean_locale, clean_source,
    -- The entry door is a short slug a link named, never a sentence.
    nullif(left(regexp_replace(lower(coalesce(data ->> 'origem', '')), '[^a-z0-9_-]+', '', 'g'), 32), ''),
    nullif(left(btrim(coalesce(data ->> 'onda', '')), 64), ''),
    nullif(left(upper(btrim(coalesce(data ->> 'cupom', ''))), 64), ''),
    nullif(left(btrim(coalesce(data ->> 'utm_source', '')), 64), ''),
    nullif(left(btrim(coalesce(data ->> 'utm_medium', '')), 64), ''),
    nullif(left(btrim(coalesce(data ->> 'utm_campaign', '')), 64), ''),
    nullif(left(btrim(coalesce(data ->> 'utm_content', '')), 64), ''),
    nullif(left(btrim(coalesce(data ->> 'utm_term', '')), 64), ''),
    nullif(left(btrim(coalesce(data ->> 'referrer', '')), 255), ''),
    nullif(left(btrim(coalesce(data ->> 'landing_path', '')), 255), ''),
    term.id, term.version, term.body_md, now(),
    target_confirm_token_hash, now()
  )
  returning id into new_id;

  return jsonb_build_object(
    'ok', true, 'code', 'created', 'send_confirmation', true, 'leadId', new_id, 'locale', clean_locale
  );
end;
$$;

revoke all on function public.submit_lead(jsonb, text, text) from public, anon, authenticated;

/**
 * The confirmation link was opened. Valid for seven days after it was sent.
 * Confirming also lifts an opt-out: asking again from the inbox is the proof
 * that the owner of the address wants it. The first confirmation is the
 * `waitlist.joined` event.
 */
create or replace function public.confirm_lead(target_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lead public.leads%rowtype;
  first_time boolean;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select * into lead from public.leads
  where confirm_token_hash = target_token_hash
  for update;
  if not found or lead.confirm_sent_at is null or lead.confirm_sent_at < now() - interval '7 days' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  first_time := lead.confirmed_at is null;

  update public.leads set
    confirmed_at = coalesce(confirmed_at, now()),
    opted_out_at = null,
    confirm_token_hash = null
  where id = lead.id;

  if first_time then
    perform public.product_event_insert(
      null, null, 'waitlist.joined',
      jsonb_strip_nulls(jsonb_build_object('origem', lead.origem, 'platform', 'server')), null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', case when first_time then 'confirmed' else 'resubscribed' end,
    'locale', lead.locale
  );
end;
$$;

revoke all on function public.confirm_lead(text) from public, anon, authenticated;

-- The one-click link in every message. Answers the same for a known and an
-- unknown token.
create or replace function public.unsubscribe_lead(target_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    return false;
  end if;
  update public.leads set opted_out_at = coalesce(opted_out_at, now())
  where email_unsubscribe_token = target_token;
  return true;
end;
$$;

revoke all on function public.unsubscribe_lead(uuid) from public, anon, authenticated;

-- ---------- Erasure ----------

create or replace function public.purge_leads_internal(target_leads uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer := 0;
begin
  if target_leads is null or cardinality(target_leads) = 0 then
    return 0;
  end if;

  delete from public.leads where id = any (target_leads);
  get diagnostics removed = row_count;

  -- The versioning trigger just snapshotted every deleted row. An erasure that
  -- leaves the history behind erased nothing.
  delete from public.record_versions
  where table_name = 'leads' and record_id = any (target_leads);

  return removed;
end;
$$;

revoke all on function public.purge_leads_internal(uuid[]) from public, anon, authenticated;

create or replace function public.purge_lead(target_lead uuid, target_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  if not public.is_superadmin() or public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  removed := public.purge_leads_internal(array[target_lead]);
  if removed = 0 then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- The id and the operator's reason only: the name and the address are
  -- exactly what was just erased.
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    null, auth.uid(), 'admin.leads.purged', 'lead', target_lead::text,
    case when nullif(btrim(target_reason), '') is null then '{}'::jsonb
         else jsonb_build_object('reason', left(btrim(target_reason), 500)) end
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.purge_lead(uuid, text) from public, anon;
grant execute on function public.purge_lead(uuid, text) to authenticated;

/**
 * Daily retention: an address that never confirmed is gone after 7 days, an
 * opted-out one after 6 months, and the per-network window after a day.
 */
create or replace function public.purge_expired_leads()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  doomed uuid[];
  removed integer;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select coalesce(array_agg(l.id), '{}') into doomed
  from public.leads l
  where (l.confirmed_at is null and l.created_at < now() - interval '7 days'
         and coalesce(l.confirm_sent_at, l.created_at) < now() - interval '7 days')
     or (l.opted_out_at is not null and l.opted_out_at < now() - interval '6 months');

  removed := public.purge_leads_internal(doomed);

  delete from public.lead_submissions where created_at < now() - interval '1 day';

  if removed > 0 then
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (null, null, 'leads.retention_purged', 'lead', null, jsonb_build_object('count', removed));
  end if;

  return jsonb_build_object('ok', true, 'removed', removed);
end;
$$;

revoke all on function public.purge_expired_leads() from public, anon, authenticated;

-- ---------- Messages to the confirmed list ----------

-- What the operator writes to the waitlist (the opening notice, the news).
-- A send is a row here; who received it is newsletter_deliveries, which is
-- also what keeps a retry from writing to the same person twice.
create table public.newsletter_sends (
  id uuid primary key default gen_random_uuid(),
  -- Per language: {"pt-BR": "..."}. A language left out is not sent.
  subject jsonb not null check (public.i18n_ok(subject)),
  body_md jsonb not null check (public.i18n_ok(body_md)),
  -- Narrows the audience to one origin of the list; null writes to all of it.
  source text check (source is null or source in ('waitlist', 'newsletter', 'contact')),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  delivered integer not null default 0 check (delivered >= 0),
  last_error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint newsletter_sends_languages check (subject <> '{}'::jsonb and body_md <> '{}'::jsonb)
);

create table public.newsletter_deliveries (
  send_id uuid not null references public.newsletter_sends (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (send_id, lead_id)
);

create index newsletter_deliveries_lead_idx on public.newsletter_deliveries (lead_id);

alter table public.newsletter_sends enable row level security;
alter table public.newsletter_deliveries enable row level security;

create policy "newsletter_sends_select_superadmin" on public.newsletter_sends
  for select to authenticated
  using (public.is_superadmin());

-- Written only by the functions below (the console and the job).
grant select on table public.newsletter_sends to authenticated;

-- Who a send would reach: confirmed, not opted out, in a language the message
-- was written in, from the chosen origin.
create or replace function public.newsletter_audience(target_languages text[], target_source text default null)
returns table (locale text, readers integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return query
  select l.locale, count(*)::integer
  from public.leads l
  where l.confirmed_at is not null
    and l.opted_out_at is null
    and l.locale = any (coalesce(target_languages, array[]::text[]))
    and (target_source is null or l.source = target_source)
  group by l.locale
  order by l.locale;
end;
$$;

revoke all on function public.newsletter_audience(text[], text) from public, anon;
grant execute on function public.newsletter_audience(text[], text) to authenticated;

create or replace function public.create_newsletter_send(
  target_subject jsonb,
  target_body_md jsonb,
  target_source text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  entry text;
  created uuid;
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;

  -- A language is sent only when both its subject and its text are written.
  for entry in select jsonb_object_keys(coalesce(target_subject, '{}'::jsonb)) loop
    if btrim(coalesce(target_subject ->> entry, '')) = '' or btrim(coalesce(target_body_md ->> entry, '')) = '' then
      raise exception 'incomplete_language' using errcode = '22023';
    end if;
    if char_length(target_subject ->> entry) > 150 or char_length(target_body_md ->> entry) > 20000 then
      raise exception 'too_long' using errcode = '22001';
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(coalesce(target_body_md, '{}'::jsonb))) <>
     (select count(*) from jsonb_object_keys(coalesce(target_subject, '{}'::jsonb))) then
    raise exception 'incomplete_language' using errcode = '22023';
  end if;

  insert into public.newsletter_sends (subject, body_md, source, created_by)
  values (target_subject, target_body_md, target_source, auth.uid())
  returning id into created;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    null, auth.uid(), 'newsletter.created', 'newsletter_send', created::text,
    jsonb_build_object('languages', (select jsonb_agg(k) from jsonb_object_keys(target_subject) k), 'source', target_source)
  );

  return created;
end;
$$;

revoke all on function public.create_newsletter_send(jsonb, jsonb, text) from public, anon;
grant execute on function public.create_newsletter_send(jsonb, jsonb, text) to authenticated;

-- The next readers of a send, claimed: the delivery row is written before the
-- message leaves, so a second worker (or a retry) never picks them again.
create or replace function public.claim_newsletter_batch(target_send uuid, target_limit integer default 100)
returns table (
  lead_id uuid,
  email text,
  locale text,
  unsubscribe_token uuid,
  subject text,
  body_md text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  send public.newsletter_sends%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into send from public.newsletter_sends s where s.id = target_send for update;
  if not found or send.status in ('sent', 'failed') then
    return;
  end if;
  if send.status = 'queued' then
    update public.newsletter_sends s set status = 'sending', started_at = now() where s.id = target_send;
  end if;

  return query
  with due as (
    select l.id
    from public.leads l
    where l.confirmed_at is not null
      and l.opted_out_at is null
      and send.subject ? l.locale
      and (send.source is null or l.source = send.source)
      and not exists (
        select 1 from public.newsletter_deliveries d where d.send_id = target_send and d.lead_id = l.id
      )
    order by l.created_at
    limit least(greatest(target_limit, 1), 100)
    for update of l skip locked
  ),
  claimed as (
    insert into public.newsletter_deliveries (send_id, lead_id)
    select target_send, due.id from due
    on conflict do nothing
    returning newsletter_deliveries.lead_id
  )
  select l.id, l.email::text, l.locale, l.email_unsubscribe_token,
         send.subject ->> l.locale, send.body_md ->> l.locale
  from claimed c
  join public.leads l on l.id = c.lead_id;
end;
$$;

revoke all on function public.claim_newsletter_batch(uuid, integer) from public, anon, authenticated;

-- Closes a batch: counts what was delivered, or gives the readers back when
-- the provider refused the whole request (the batch is all or nothing).
create or replace function public.settle_newsletter_batch(
  target_send uuid,
  target_leads uuid[],
  target_delivered boolean,
  target_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if target_delivered then
    update public.newsletter_sends s
    set delivered = s.delivered + coalesce(array_length(target_leads, 1), 0)
    where s.id = target_send;
  else
    delete from public.newsletter_deliveries d
    where d.send_id = target_send and d.lead_id = any (coalesce(target_leads, array[]::uuid[]));
    update public.newsletter_sends s
    set status = 'failed', last_error = left(coalesce(target_error, 'send_failed'), 300), finished_at = now()
    where s.id = target_send;
  end if;
end;
$$;

revoke all on function public.settle_newsletter_batch(uuid, uuid[], boolean, text) from public, anon, authenticated;

create or replace function public.finish_newsletter_send(target_send uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.newsletter_sends s
  set status = 'sent', finished_at = now()
  where s.id = target_send and s.status = 'sending';
end;
$$;

revoke all on function public.finish_newsletter_send(uuid) from public, anon, authenticated;

-- Erasing a lead takes its delivery rows with it (the cascade above); the
-- send keeps its count, which names nobody.
