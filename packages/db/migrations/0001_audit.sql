-- ============================================================
-- 0001_audit: audit trail, row versioning, consent terms, access log and the
-- audited profile writes.
--
-- Consent belongs to the PERSON: an account accepts the terms before it founds
-- or joins a firm, so an acceptance carries the firm only when there is one.
-- ============================================================

-- ---------- Audit events (append-only) ----------

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  -- NULL for platform-level acts (an operator promoting another operator) and
  -- for what a person does before belonging to a firm.
  org_id uuid references public.organizations (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  -- What KIND of actor wrote the event. `actor_id` alone cannot say it: a
  -- support visit carries the visited person's id, a job has no id at all.
  --   person   a signed-in person, in their own session
  --   support  a platform operator inside a person's session (a support visit)
  --   system   the backend with no session: a job, a webhook, a migration
  --   ai       the backend acting on what a model answered
  --   client   a client of the firm, through a link by token, with no account
  -- Stamped by a trigger (below): a session can never claim another kind.
  actor_type text not null default 'system',
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_actor_type_check
    check (actor_type in ('person', 'support', 'system', 'ai', 'client'))
);

create index audit_events_org_idx on public.audit_events (org_id, created_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);
create index audit_events_action_idx on public.audit_events (action, created_at desc);

alter table public.audit_events enable row level security;

-- Append-only: there is no update or delete policy, and no grant for either.
create policy "audit_events_insert_member" on public.audit_events
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and (public.is_superadmin() or (org_id is not null and public.is_org_member(org_id)))
  );

create policy "audit_events_select_admin" on public.audit_events
  for select to authenticated
  using (
    public.is_superadmin()
    or (org_id is not null and public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
  );

grant select, insert on table public.audit_events to authenticated;

/**
 * Stamps the kind of actor on every audit event.
 *
 * A request that carries a person's JWT is that person, or a support visit
 * inside their session: the kind is DERIVED from the session and whatever
 * the writer sent is overwritten, so nobody signs an event as the system.
 * With no JWT (the service role, a job, a webhook, a migration) the writer
 * is the backend, which may say it acted for a model (`ai`) or for a client
 * behind a link (`client`); anything else is `system`.
 *
 * is_impersonated() is defined in 0009; plpgsql resolves it when this runs.
 */
create or replace function public.stamp_audit_actor_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.actor_type := case when public.is_impersonated() then 'support' else 'person' end;
  elsif new.actor_type is null or new.actor_type not in ('ai', 'client') then
    new.actor_type := 'system';
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_audit_actor_type() from public, anon;

create trigger audit_events_actor_type
  before insert on public.audit_events
  for each row execute function public.stamp_audit_actor_type();

-- ---------- Row versioning ----------

create table public.record_versions (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  org_id uuid,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  data jsonb not null,
  changed_by uuid,
  created_at timestamptz not null default now()
);

create index record_versions_record_idx on public.record_versions (table_name, record_id, created_at);
create index record_versions_org_idx on public.record_versions (org_id) where org_id is not null;

alter table public.record_versions enable row level security;

create policy "record_versions_select_admin" on public.record_versions
  for select to authenticated
  using (
    public.is_superadmin()
    or (org_id is not null and public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
  );

grant select on table public.record_versions to authenticated;

-- org_id deliberately has no foreign key: a snapshot must survive the row it
-- describes. The consequence is that deleting a firm does NOT cascade here, so
-- admin_delete_account (0013) purges these rows explicitly.
create or replace function public.audit_record_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot jsonb;
begin
  if tg_op = 'DELETE' then
    snapshot := to_jsonb(old);
  else
    snapshot := to_jsonb(new);
  end if;

  insert into public.record_versions (table_name, record_id, org_id, operation, data, changed_by)
  values (
    tg_table_name,
    (snapshot ->> 'id')::uuid,
    case when snapshot ? 'org_id' then (snapshot ->> 'org_id')::uuid else null end,
    tg_op,
    snapshot,
    auth.uid()
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_record_version() from public, anon;

-- Mechanism only: each migration marks its own sensitive tables (consent and
-- money), e.g. select public.enable_row_versioning('public.entitlement_grants');
-- The table needs a uuid `id` column.
create or replace function public.enable_row_versioning(target regclass)
returns void
language plpgsql
as $$
begin
  execute format('drop trigger if exists audit_row_versions on %s', target);
  execute format(
    'create trigger audit_row_versions after insert or update or delete on %s
       for each row execute function public.audit_record_version()',
    target
  );
end;
$$;

revoke all on function public.enable_row_versioning(regclass) from public, anon;

-- ---------- Consent terms ----------

/**
 * A term is one legal text in one language at one version: terms of use,
 * privacy policy, cookie policy, the newsletter consent. The public legal
 * pages render these rows, so the text a person accepted IS the text the site
 * shows.
 *
 * No text is seeded by the migrations: ONE's legal texts are written by the
 * company that operates it and published with publish_consent_term(). Until
 * then the legal pages say they have nothing to show and nothing can be
 * accepted, which is the honest state.
 *
 * A published text is immutable. A revision is a NEW version
 * (publish_consent_term), which deactivates the previous one for that slug and
 * locale; acceptances of the old version stay as history.
 */
create table public.consent_terms (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  locale text not null default 'pt-BR',
  version integer not null default 1,
  title text not null,
  body_md text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint consent_terms_locale_check check (locale = any (public.supported_locales())),
  constraint consent_terms_slug_check check (slug ~ '^[a-z][a-z0-9-]{1,39}$'),
  constraint consent_terms_version_check check (version >= 1),
  unique (slug, locale, version)
);

create unique index consent_terms_one_active_idx on public.consent_terms (slug, locale) where is_active;

alter table public.consent_terms enable row level security;

-- Active texts are public: the legal pages are read without a session.
create policy "consent_terms_select_active" on public.consent_terms
  for select to anon, authenticated
  using (is_active);

create policy "consent_terms_select_superadmin" on public.consent_terms
  for select to authenticated
  using (public.is_superadmin());

grant select on table public.consent_terms to anon, authenticated;

create or replace function public.guard_consent_term_text()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.slug is distinct from old.slug
     or new.locale is distinct from old.locale
     or new.version is distinct from old.version
     or new.title is distinct from old.title
     or new.body_md is distinct from old.body_md
     or new.created_at is distinct from old.created_at then
    raise exception 'consent_term_immutable'
      using errcode = 'check_violation',
            hint = 'Publish a new version instead of editing a published text.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_consent_term_text() from public, anon;

create trigger consent_terms_text_guard
  before update on public.consent_terms
  for each row execute function public.guard_consent_term_text();

/**
 * The texts in force, one row per slug, in the requested language. A slug with
 * no text in that language falls back to another language it was published
 * in, so a page never renders empty because a translation is late.
 */
create or replace function public.current_consent_terms(p_locale text default 'pt-BR')
returns table (
  id uuid,
  slug text,
  locale text,
  version integer,
  title text,
  body_md text,
  created_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select distinct on (t.slug)
    t.id, t.slug, t.locale, t.version, t.title, t.body_md, t.created_at
  from public.consent_terms t
  where t.is_active
  order by
    t.slug,
    case when t.locale = p_locale then 0 else 1 end,
    t.locale;
$$;

revoke all on function public.current_consent_terms(text) from public;
grant execute on function public.current_consent_terms(text) to anon, authenticated;

/**
 * Publishes a revision: version = previous + 1, the previous text for that
 * slug and locale stops being the one in force. Superadmin only, never from a
 * support visit, audited.
 */
create or replace function public.publish_consent_term(
  p_slug text,
  p_locale text,
  p_title text,
  p_body_md text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  next_version integer;
  new_id uuid;
begin
  if not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null or nullif(btrim(p_body_md), '') is null
     or not (p_locale = any (public.supported_locales())) then
    raise exception 'invalid_term' using errcode = '22023';
  end if;

  select coalesce(max(t.version), 0) + 1 into next_version
  from public.consent_terms t
  where t.slug = p_slug and t.locale = p_locale;

  update public.consent_terms set is_active = false
  where slug = p_slug and locale = p_locale and is_active;

  insert into public.consent_terms (slug, locale, version, title, body_md, is_active)
  values (p_slug, p_locale, next_version, btrim(p_title), p_body_md, true)
  returning id into new_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    null, auth.uid(), 'admin.consent_term.published', 'consent_term', new_id::text,
    jsonb_build_object('slug', p_slug, 'locale', p_locale, 'version', next_version)
  );

  return new_id;
end;
$$;

revoke all on function public.publish_consent_term(text, text, text, text) from public, anon;
grant execute on function public.publish_consent_term(text, text, text, text) to authenticated;

-- ---------- Consent acceptances ----------

create table public.consent_acceptances (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.consent_terms (id),
  -- The firm the person belonged to when they accepted, when there was one.
  org_id uuid references public.organizations (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Where it was accepted (sign-up, a purchase). Never free text typed by the
  -- person.
  metadata jsonb not null default '{}'::jsonb,
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index consent_acceptances_one_current_idx
  on public.consent_acceptances (term_id, user_id)
  where revoked_at is null;
create index consent_acceptances_user_idx on public.consent_acceptances (user_id, accepted_at desc);
create index consent_acceptances_org_idx on public.consent_acceptances (org_id);

alter table public.consent_acceptances enable row level security;

create policy "consent_acceptances_select_own" on public.consent_acceptances
  for select to authenticated
  using (user_id = auth.uid());

create policy "consent_acceptances_select_superadmin" on public.consent_acceptances
  for select to authenticated
  using (public.is_superadmin());

-- Read-only for the API roles. There is deliberately no INSERT policy or
-- grant: a person able to write here could record an acceptance of any term,
-- at any date. accept_terms() below is the only writer.
grant select on table public.consent_acceptances to authenticated;

create or replace function public.guard_consent_acceptance_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- The only change a consent row may ever receive is being revoked, once.
  -- (The firm reference may go to NULL when the firm is deleted: the foreign
  -- key does that, and the acceptance stays.)
  if new.term_id is distinct from old.term_id
     or (new.org_id is distinct from old.org_id and new.org_id is not null)
     or new.user_id is distinct from old.user_id
     or new.metadata is distinct from old.metadata
     or new.accepted_at is distinct from old.accepted_at
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
     or (old.revoked_at is null and new.revoked_at is null and new.org_id is not distinct from old.org_id) then
    raise exception 'consent_history_immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_consent_acceptance_history() from public, anon;

create trigger consent_acceptances_history_guard
  before update on public.consent_acceptances
  for each row execute function public.guard_consent_acceptance_history();

select public.enable_row_versioning('public.consent_acceptances');

/**
 * Records that the caller accepts the texts in force for each slug.
 *
 * Idempotent per VERSION: accepting the same text twice writes nothing the
 * second time, and accepting after a revision writes a new row for the new
 * version (the old acceptance stays as history).
 *
 * Refused during a support visit: an operator inside a person's session must
 * never be able to consent on that person's behalf.
 */
create or replace function public.accept_terms(
  p_slugs text[],
  p_locale text default 'pt-BR',
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_org uuid := public.current_org_id();
  wanted text;
  term public.consent_terms%rowtype;
  existing timestamptz;
  result jsonb := '[]'::jsonb;
  -- Only a short allowlist of context keys is stored: this row is evidence,
  -- not a place for arbitrary client data.
  context jsonb := coalesce(
    (select jsonb_object_agg(entry.key, entry.value)
     from jsonb_each(coalesce(p_context, '{}'::jsonb)) as entry
     where entry.key in ('source', 'client_id', 'plan')
       and jsonb_typeof(entry.value) = 'string'
       and char_length(entry.value #>> '{}') <= 80),
    '{}'::jsonb
  );
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'support_session_cannot_consent' using errcode = '42501';
  end if;
  if p_slugs is null or cardinality(p_slugs) = 0 or cardinality(p_slugs) > 10 then
    raise exception 'invalid_terms' using errcode = '22023';
  end if;

  foreach wanted in array p_slugs loop
    select t.* into term
    from public.consent_terms t
    where t.slug = wanted and t.is_active
    order by case when t.locale = p_locale then 0 else 1 end, t.locale
    limit 1;

    if not found then
      raise exception 'unknown_term' using errcode = '22023', detail = wanted;
    end if;

    select a.accepted_at into existing
    from public.consent_acceptances a
    where a.term_id = term.id and a.user_id = caller and a.revoked_at is null;

    if existing is null then
      insert into public.consent_acceptances (term_id, org_id, user_id, metadata)
      values (term.id, caller_org, caller, context)
      on conflict do nothing;
    end if;

    result := result || jsonb_build_object(
      'slug', term.slug,
      'locale', term.locale,
      'version', term.version,
      'already', existing is not null
    );
  end loop;

  return result;
end;
$$;

revoke all on function public.accept_terms(text[], text, jsonb) from public, anon;
grant execute on function public.accept_terms(text[], text, jsonb) to authenticated;

-- ---------- Access log (sign-ins) ----------

create table public.access_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  ip text,
  user_agent text,
  aal text,
  session_id uuid,
  impersonated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on column public.access_events.impersonated_by is
  'Set when this session was opened by platform support impersonating the person: shown as a support access, never as the person''s own sign-in.';

create index access_events_user_idx on public.access_events (user_id, created_at desc);
create index access_events_created_idx on public.access_events (created_at desc);
create index access_events_session_idx on public.access_events (session_id);

alter table public.access_events enable row level security;

create policy "access_events_select_own" on public.access_events
  for select to authenticated
  using (user_id = auth.uid());

create policy "access_events_select_superadmin" on public.access_events
  for select to authenticated
  using (public.is_superadmin());

grant select on table public.access_events to authenticated;

-- Reads the session row as jsonb so a change in the auth schema's columns
-- never breaks sign-in, and swallows every error for the same reason: a
-- missing log line is a gap, a failed sign-in is an outage.
create or replace function public.log_access_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb := to_jsonb(new);
begin
  insert into public.access_events (user_id, ip, user_agent, aal, session_id)
  values (
    (payload ->> 'user_id')::uuid,
    nullif(payload ->> 'ip', ''),
    nullif(payload ->> 'user_agent', ''),
    coalesce(payload ->> 'aal', 'aal1'),
    (payload ->> 'id')::uuid
  );
  return new;
exception when others then
  return new;
end;
$$;

revoke all on function public.log_access_event() from public, anon;

drop trigger if exists on_auth_session_created on auth.sessions;
create trigger on_auth_session_created
  after insert on auth.sessions
  for each row execute function public.log_access_event();

-- ---------- Granting the platform role ----------

create or replace function public.set_user_superadmin(target_user uuid, value boolean, target_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  previous boolean;
  target_name text;
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized';
  end if;

  -- A support visit runs inside somebody else's session. Handing out the
  -- platform role from there would attribute the grant to the person being
  -- visited, which is precisely what the trail must not say.
  if public.is_impersonated() then
    raise exception 'not_authorized';
  end if;

  if target_user = auth.uid() then
    raise exception 'self_change_forbidden'
      using hint = 'Another superadmin has to do it.';
  end if;

  select p.is_superadmin, p.display_name
    into previous, target_name
  from public.profiles p
  where p.id = target_user
  for update;

  if not found then
    raise exception 'user_not_found';
  end if;

  if previous = value then
    return jsonb_build_object('ok', true, 'changed', false, 'isSuperadmin', value);
  end if;

  update public.profiles set is_superadmin = value where id = target_user;

  -- Platform-level act: no org_id. Who promoted whom is the line an auditor
  -- comes here to read.
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    null,
    auth.uid(),
    case when value then 'admin.user.superadmin_granted' else 'admin.user.superadmin_revoked' end,
    'user',
    target_user::text,
    jsonb_strip_nulls(jsonb_build_object(
      'display_name', target_name,
      'note', nullif(btrim(target_note), '')
    ))
  );

  return jsonb_build_object('ok', true, 'changed', true, 'isSuperadmin', value);
end;
$$;

comment on function public.set_user_superadmin(uuid, boolean, text) is
  'Grants or revokes profiles.is_superadmin for another user. Superadmin-only, never on yourself, always audited.';

revoke all on function public.set_user_superadmin(uuid, boolean, text) from public, anon;
grant execute on function public.set_user_superadmin(uuid, boolean, text) to authenticated;

-- ---------- The person's own profile ----------

/**
 * The name and the timezone, validated and audited by field name. A NULL
 * argument leaves that field as it is. (The name and the avatar are also plain
 * column writes, 0000 grants; the timezone only changes here, because the
 * dates of every notice written to the person follow it.)
 */
create or replace function public.update_member_profile(
  p_display_name text default null,
  p_timezone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  before public.profiles%rowtype;
  after public.profiles%rowtype;
  changed text[] := '{}';
  clean_name text := nullif(btrim(p_display_name), '');
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if clean_name is not null and char_length(clean_name) > 120 then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;

  select * into before from public.profiles where id = caller for update;
  if not found then
    raise exception 'profile_not_found';
  end if;

  update public.profiles set
    display_name = coalesce(clean_name, display_name),
    timezone = coalesce(nullif(btrim(p_timezone), ''), timezone)
  where id = caller
  returning * into after;

  if after.display_name is distinct from before.display_name then changed := array_append(changed, 'display_name'); end if;
  if after.timezone is distinct from before.timezone then changed := array_append(changed, 'timezone'); end if;

  if cardinality(changed) > 0 then
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      public.current_org_id(), caller, 'member.profile_updated', 'profile', caller::text,
      jsonb_build_object(
        'fields', to_jsonb(changed),
        'timezone', after.timezone,
        'support_session', public.is_impersonated()
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'changed', to_jsonb(changed),
    'timezone', after.timezone
  );
end;
$$;

revoke all on function public.update_member_profile(text, text) from public, anon;
grant execute on function public.update_member_profile(text, text) to authenticated;

-- ---------- Marketing e-mail opt-out ----------

create or replace function public.set_marketing_email_opt_out(p_opt_out boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  update public.profiles set marketing_email_opt_out = coalesce(p_opt_out, false) where id = auth.uid();
  return coalesce(p_opt_out, false);
end;
$$;

revoke all on function public.set_marketing_email_opt_out(boolean) from public, anon;
grant execute on function public.set_marketing_email_opt_out(boolean) to authenticated;

-- The one-click link of a news e-mail. The token is the only credential, so
-- only the backend may call this, and it answers the same for a known and an
-- unknown token.
create or replace function public.unsubscribe_profile(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set marketing_email_opt_out = true where email_unsubscribe_token = p_token;
  return true;
end;
$$;

revoke all on function public.unsubscribe_profile(uuid) from public, anon, authenticated;
