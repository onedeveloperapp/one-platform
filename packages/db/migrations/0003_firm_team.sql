-- ============================================================
-- 0003_firm_team: founding a firm, its roster, invitations, registrations at
-- the bar, and every change of who belongs to a firm and with what powers.
--
-- Nothing here is a direct table write: the API roles hold SELECT only on
-- memberships, invitations and registrations. Each change goes through a
-- function that takes the firm, checks who is asking, takes one lock per firm
-- and records an audit event. A support visit changes none of it.
--
-- Changing who has access to a firm asks for the second factor
-- (require_aal2): a stolen password alone must not be able to invite an
-- outsider, promote an account or take the firm over. Founding a firm,
-- accepting an invitation and leaving do not: a new account has no factor yet,
-- and leaving only gives access up.
-- ============================================================

-- ---------- Registrations at the bar (OAB) ----------

/**
 * A lawyer's registrations: one principal, in the state of their professional
 * domicile, and any number of supplementary ones in other states. They belong
 * to the PERSON, not to a firm: the court communications of a lawyer are
 * captured by registration, and the count of cases per state that calls for a
 * supplementary registration is per lawyer.
 *
 * A registration belongs to one account. The platform does not check it
 * against the bar's registry yet: it is what the person declares, audited.
 */
create table public.oab_registrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  uf text not null,
  -- As the bar writes it: digits, and the letter some sections append. With no zeros before the
  -- digits: "012345" and "12345" are one registration, and are kept as one (the courts' gazette is
  -- read by this number, so two spellings of it would be two readers of one lawyer's publications).
  number text not null,
  kind text not null default 'principal',
  created_at timestamptz not null default now(),
  constraint oab_registrations_uf_check check (
    uf in (
      'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
      'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
    )
  ),
  constraint oab_registrations_number_check check (number ~ '^[1-9][0-9]{0,6}[A-Z]?$'),
  constraint oab_registrations_kind_check check (kind in ('principal', 'suplementar')),
  unique (uf, number)
);

create index oab_registrations_user_idx on public.oab_registrations (user_id);
create unique index oab_registrations_one_principal_idx on public.oab_registrations (user_id)
  where kind = 'principal';
-- One registration per state for a person: the principal or a supplementary one.
create unique index oab_registrations_one_per_state_idx on public.oab_registrations (user_id, uf);

alter table public.oab_registrations enable row level security;

create policy "oab_registrations_select_own" on public.oab_registrations
  for select to authenticated
  using (user_id = auth.uid());

create policy "oab_registrations_select_colleague" on public.oab_registrations
  for select to authenticated
  using (public.shares_firm_with(user_id));

create policy "oab_registrations_select_superadmin" on public.oab_registrations
  for select to authenticated
  using (public.is_superadmin());

-- Read-only for the API roles: written by add_oab_registration and
-- remove_oab_registration below.
grant select on table public.oab_registrations to authenticated;

-- ---------- Invitations ----------

/**
 * An invitation to join a firm, addressed to an e-mail, with the role and the
 * function the person will have. The link in the e-mail carries a random
 * token; only its SHA-256 is stored, so reading this table never yields a
 * usable link.
 *
 * Accepting takes an account whose CONFIRMED e-mail is the invited one. The
 * token only lets the invitation page say who is inviting before the person
 * signs in; it is not what grants the membership.
 */
create table public.firm_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email extensions.citext not null,
  role public.org_role not null default 'member',
  firm_function public.firm_function not null,
  token_hash text not null unique,
  invited_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint firm_invitations_role_check check (role <> 'owner'),
  constraint firm_invitations_email_check check (email::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and char_length(email::text) <= 254),
  constraint firm_invitations_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint firm_invitations_one_end check (accepted_at is null or revoked_at is null)
);

-- One open invitation per address and firm: inviting again revokes the open one.
create unique index firm_invitations_one_open_idx on public.firm_invitations (org_id, email)
  where accepted_at is null and revoked_at is null;
create index firm_invitations_email_idx on public.firm_invitations (email)
  where accepted_at is null and revoked_at is null;

alter table public.firm_invitations enable row level security;

create policy "firm_invitations_select_manager" on public.firm_invitations
  for select to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

create policy "firm_invitations_select_superadmin" on public.firm_invitations
  for select to authenticated
  using (public.is_superadmin());

-- Every column but the token hash. Written only by the functions below.
grant select (
  id, org_id, email, role, firm_function, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at
) on table public.firm_invitations to authenticated;

insert into public.platform_settings (key, value, is_public) values
  -- How long an invitation to join a firm can be accepted, and how many a
  -- firm may send in a day: an invitation is an e-mail to an address somebody
  -- typed, and nothing else keeps a firm from writing to strangers.
  ('team', '{"invite_valid_days": 7, "invites_per_day": 30}'::jsonb, false),
  -- Who must have a second factor: by role in the firm account and by
  -- function in the firm. To start, whoever manages who has access.
  ('security', '{"second_factor": {"roles": ["owner", "admin"], "functions": []}}'::jsonb, false)
on conflict (key) do nothing;

-- ---------- The second factor, by role ----------

/**
 * Whether the caller must have a second factor: the platform operator always,
 * and in a firm whoever holds a role or a function named in the `security`
 * setting. The app asks this to send the person to set one up before anything
 * else. It is guidance about the ACCOUNT: the functions that change who has
 * access ask for the factor itself (require_aal2), whatever this answers.
 */
create or replace function public.second_factor_required()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with config as (
    select coalesce(
      (select s.value -> 'second_factor' from public.platform_settings s where s.key = 'security'),
      '{"roles": ["owner", "admin"], "functions": []}'::jsonb
    ) as rule
  )
  select public.is_superadmin()
    or exists (
      select 1
      from public.memberships m
      cross join config
      where m.user_id = auth.uid()
        and (
          (jsonb_typeof(config.rule -> 'roles') = 'array' and (config.rule -> 'roles') ? m.role::text)
          or (jsonb_typeof(config.rule -> 'functions') = 'array' and (config.rule -> 'functions') ? m.firm_function::text)
        )
    );
$$;

revoke all on function public.second_factor_required() from public, anon;
grant execute on function public.second_factor_required() to authenticated;

-- ---------- Internal helpers ----------

-- One lock per firm for everything that changes its roster, so two requests
-- cannot both pass a check (the seat ceiling, the single owner) and both write.
create or replace function public.lock_firm_team(target_org uuid)
returns void
language sql
as $$
  select pg_advisory_xact_lock(hashtextextended('firm-team:' || target_org::text, 0));
$$;

revoke all on function public.lock_firm_team(uuid) from public, anon, authenticated;

/**
 * The seat ceiling of the firm's plan (`assentos_max` in the entitlements), or
 * NULL when the plan sets none. Read from org_entitlements, the one answer to
 * what a firm may use; the caller must already belong to the firm.
 */
create or replace function public.firm_seat_ceiling(target_org uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ceiling numeric;
begin
  ceiling := nullif(public.org_entitlements(target_org) -> 'limits' ->> 'assentos_max', '')::numeric;
  if ceiling is null or ceiling <= 0 then
    return null;
  end if;
  return ceiling::integer;
end;
$$;

revoke all on function public.firm_seat_ceiling(uuid) from public, anon, authenticated;

-- ---------- Founding a firm ----------

/**
 * Creates a firm and makes the caller its owner. An account founds a firm only
 * while it belongs to none: a person is in one firm at a time (0000).
 */
create or replace function public.create_firm(
  firm_name text,
  founder_function public.firm_function default 'socio'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  clean_name text := nullif(btrim(regexp_replace(coalesce(firm_name, ''), '\s+', ' ', 'g')), '');
  new_org uuid := gen_random_uuid();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if clean_name is null or char_length(clean_name) < 2 or char_length(clean_name) > 120 then
    raise exception 'invalid_firm_name' using errcode = '22023';
  end if;
  if founder_function is null then
    raise exception 'invalid_firm_function' using errcode = '22023';
  end if;

  -- Serialize on the person: two tabs must not found two firms.
  perform pg_advisory_xact_lock(hashtextextended('firm-founder:' || caller::text, 0));
  if exists (select 1 from public.memberships m where m.user_id = caller) then
    raise exception 'already_in_a_firm'
      using errcode = '23505', hint = 'A person belongs to one firm at a time.';
  end if;

  insert into public.organizations (id, name, slug, created_by)
  values (
    new_org,
    clean_name,
    coalesce(nullif(public.slugify(clean_name), ''), 'escritorio') || '-' || substr(new_org::text, 1, 8),
    caller
  );

  insert into public.memberships (org_id, user_id, role, firm_function)
  values (new_org, caller, 'owner', founder_function);

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    new_org, caller, 'firm.created', 'organization', new_org::text,
    jsonb_build_object('name', clean_name, 'firm_function', founder_function)
  );

  return new_org;
end;
$$;

comment on function public.create_firm(text, public.firm_function) is
  'Creates a firm with the caller as its owner. Refused while the caller belongs to a firm.';

revoke all on function public.create_firm(text, public.firm_function) from public, anon;
grant execute on function public.create_firm(text, public.firm_function) to authenticated;

-- ---------- The firm's own name ----------

/**
 * Renames the firm. Who manages the firm account (owner or admin) may; the
 * change is audited with the name before and after, which a direct write to
 * the table would not be.
 */
create or replace function public.rename_firm(target_org uuid, new_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  clean_name text := nullif(btrim(regexp_replace(coalesce(new_name, ''), '\s+', ' ', 'g')), '');
  previous text;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if clean_name is null or char_length(clean_name) < 2 or char_length(clean_name) > 120 then
    raise exception 'invalid_firm_name' using errcode = '22023';
  end if;

  select o.name into previous from public.organizations o where o.id = target_org for update;
  if previous = clean_name then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;

  update public.organizations set name = clean_name where id = target_org;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org, caller, 'firm.renamed', 'organization', target_org::text,
    jsonb_build_object('from', previous, 'to', clean_name)
  );

  return jsonb_build_object('ok', true, 'code', 'renamed', 'name', clean_name);
end;
$$;

revoke all on function public.rename_firm(uuid, text) from public, anon;
grant execute on function public.rename_firm(uuid, text) to authenticated;

-- ---------- The roster ----------

/**
 * Who is in the firm, as a colleague sees it: name, avatar, address, role,
 * function and registrations at the bar. This is how colleagues read each
 * other: the profiles table itself stays private to its owner.
 *
 * `has_second_factor` is answered to the owner and the admins only (they are
 * the ones who have to chase it), NULL to everybody else.
 */
create or replace function public.firm_team(target_org uuid)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  email text,
  role public.org_role,
  firm_function public.firm_function,
  joined_at timestamptz,
  oab jsonb,
  has_second_factor boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  manager boolean;
begin
  if not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  manager := public.is_superadmin()
    or public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]);

  return query
  select
    m.user_id,
    p.display_name,
    p.avatar_url,
    u.email::text,
    m.role,
    m.firm_function,
    m.created_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', r.id, 'uf', r.uf, 'number', r.number, 'kind', r.kind)
          order by (r.kind = 'principal') desc, r.uf
        )
        from public.oab_registrations r
        where r.user_id = m.user_id
      ),
      '[]'::jsonb
    ),
    case
      when manager then exists (
        select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified'
      )
    end
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.org_id = target_org
  order by
    case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
    lower(coalesce(p.display_name, '')),
    m.user_id;
end;
$$;

revoke all on function public.firm_team(uuid) from public, anon;
grant execute on function public.firm_team(uuid) to authenticated;

-- ---------- Inviting ----------

/**
 * Invites an address to the firm. Owner or admin, with the second factor.
 * `target_token_hash` is the SHA-256 (hex) of the token the backend put in the
 * e-mail link: the token itself never reaches the database.
 *
 * An open invitation to the same address is revoked and replaced, so the last
 * link sent is the one that works. Members plus open invitations may not pass
 * the seat ceiling of the plan, and a firm sends a limited number a day.
 * Every check comes before the first write: a refused invitation leaves the
 * one it would have replaced exactly as it was.
 */
create or replace function public.invite_to_firm(
  target_org uuid,
  target_email text,
  target_role public.org_role,
  target_function public.firm_function,
  target_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  clean_email text := lower(btrim(coalesce(target_email, '')));
  valid_days integer;
  daily_limit integer;
  ceiling integer;
  seats integer;
  new_id uuid;
  expires timestamptz;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();

  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(clean_email) > 254 then
    return jsonb_build_object('ok', false, 'code', 'invalid_email');
  end if;
  if target_role is null or target_role = 'owner' or target_function is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_role');
  end if;
  -- Only the owner hands out the admin role, by invitation as by promotion.
  if target_role = 'admin' and not public.has_org_role(target_org, array['owner']::public.org_role[]) then
    return jsonb_build_object('ok', false, 'code', 'only_owner_invites_admin');
  end if;
  if coalesce(target_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_token_hash' using errcode = '22023';
  end if;

  perform public.lock_firm_team(target_org);

  if exists (
    select 1
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.org_id = target_org and lower(u.email) = clean_email
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_member');
  end if;

  -- The seats this invitation would take: the people, plus the open
  -- invitations to OTHER addresses (one to this address is being replaced).
  ceiling := public.firm_seat_ceiling(target_org);
  if ceiling is not null then
    select
      (select count(*) from public.memberships m where m.org_id = target_org)
      + (select count(*) from public.firm_invitations i
         where i.org_id = target_org and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
           and i.email <> clean_email::extensions.citext)
    into seats;
    if seats + 1 > ceiling then
      return jsonb_build_object('ok', false, 'code', 'seat_limit', 'seats', ceiling);
    end if;
  end if;

  select
    least(greatest(coalesce((value ->> 'invite_valid_days')::integer, 7), 1), 30),
    greatest(coalesce((value ->> 'invites_per_day')::integer, 30), 1)
  into valid_days, daily_limit
  from public.platform_settings where key = 'team';
  expires := now() + make_interval(days => coalesce(valid_days, 7));

  -- Every invitation of the last day counts, the replaced ones included: each
  -- was an e-mail.
  if (select count(*) from public.firm_invitations i
      where i.org_id = target_org and i.created_at > now() - interval '24 hours') >= coalesce(daily_limit, 30) then
    return jsonb_build_object('ok', false, 'code', 'invite_rate_limited');
  end if;

  update public.firm_invitations
  set revoked_at = now()
  where org_id = target_org
    and email = clean_email::extensions.citext
    and accepted_at is null
    and revoked_at is null;

  insert into public.firm_invitations (org_id, email, role, firm_function, token_hash, invited_by, expires_at)
  values (target_org, clean_email, target_role, target_function, target_token_hash, caller, expires)
  returning id into new_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org, caller, 'firm.invitation.sent', 'firm_invitation', new_id::text,
    jsonb_build_object('email', clean_email, 'role', target_role, 'firm_function', target_function)
  );

  return jsonb_build_object('ok', true, 'code', 'invited', 'id', new_id, 'expires_at', expires);
end;
$$;

revoke all on function public.invite_to_firm(uuid, text, public.org_role, public.firm_function, text) from public, anon;
grant execute on function public.invite_to_firm(uuid, text, public.org_role, public.firm_function, text) to authenticated;

create or replace function public.revoke_firm_invitation(target_invitation uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  invitation public.firm_invitations%rowtype;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;

  select * into invitation from public.firm_invitations where id = target_invitation for update;
  if not found or not public.has_org_role(invitation.org_id, array['owner', 'admin']::public.org_role[]) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if invitation.accepted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_accepted');
  end if;
  if invitation.revoked_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_revoked');
  end if;

  update public.firm_invitations set revoked_at = now() where id = invitation.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    invitation.org_id, caller, 'firm.invitation.revoked', 'firm_invitation', invitation.id::text,
    jsonb_build_object('email', invitation.email::text)
  );

  return jsonb_build_object('ok', true, 'code', 'revoked');
end;
$$;

revoke all on function public.revoke_firm_invitation(uuid) from public, anon;
grant execute on function public.revoke_firm_invitation(uuid) to authenticated;

/**
 * What the invitation page shows to whoever opens the link, signed in or not:
 * the firm, who invited, the role and whether the invitation can still be
 * accepted. The invited address comes back masked: the page uses it to say
 * which account to sign in with, not to reveal an address to a link that
 * leaked.
 */
create or replace function public.firm_invitation_preview(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  invitation public.firm_invitations%rowtype;
  address text;
  local_part text;
begin
  if coalesce(target_token, '') = '' or char_length(target_token) > 200 then
    return jsonb_build_object('found', false);
  end if;

  select * into invitation
  from public.firm_invitations
  where token_hash = encode(sha256(convert_to(target_token, 'UTF8')), 'hex');
  if not found then
    return jsonb_build_object('found', false);
  end if;

  address := invitation.email::text;
  local_part := split_part(address, '@', 1);

  return jsonb_build_object(
    'found', true,
    'id', invitation.id,
    'firm', (select o.name from public.organizations o where o.id = invitation.org_id),
    'invited_by', (select p.display_name from public.profiles p where p.id = invitation.invited_by),
    'role', invitation.role,
    'firm_function', invitation.firm_function,
    'email_hint', left(local_part, 1) || repeat('*', greatest(char_length(local_part) - 1, 2)) || '@' || split_part(address, '@', 2),
    'expires_at', invitation.expires_at,
    'status', case
      when invitation.accepted_at is not null then 'accepted'
      when invitation.revoked_at is not null then 'revoked'
      when invitation.expires_at <= now() then 'expired'
      else 'open'
    end,
    -- Whether the account looking at it is the invited one.
    'for_this_account', auth.uid() is not null and lower(coalesce(auth.jwt() ->> 'email', '')) = lower(address)
  );
end;
$$;

revoke all on function public.firm_invitation_preview(text) from public;
grant execute on function public.firm_invitation_preview(text) to anon, authenticated;

/**
 * The open invitations addressed to the caller's own confirmed e-mail: what an
 * account that belongs to no firm is offered when it signs in.
 */
create or replace function public.my_firm_invitations()
returns table (
  id uuid,
  firm text,
  invited_by text,
  role public.org_role,
  firm_function public.firm_function,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, o.name, p.display_name, i.role, i.firm_function, i.expires_at
  from public.firm_invitations i
  join public.organizations o on o.id = i.org_id
  left join public.profiles p on p.id = i.invited_by
  join auth.users u on u.id = auth.uid()
  where u.email_confirmed_at is not null
    and i.email = lower(u.email)::extensions.citext
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  order by i.created_at desc;
$$;

revoke all on function public.my_firm_invitations() from public, anon;
grant execute on function public.my_firm_invitations() to authenticated;

/**
 * Accepts an invitation: the caller joins the firm with the role and the
 * function the invitation carries.
 *
 * What proves the caller is the invited person is their account's CONFIRMED
 * e-mail being the invited address. An invitation is accepted once, before it
 * expires, by an account that belongs to no firm, and never past the seat
 * ceiling of the plan.
 */
create or replace function public.accept_firm_invitation(target_invitation uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_email text;
  caller_confirmed timestamptz;
  invitation public.firm_invitations%rowtype;
  ceiling integer;
  seats integer;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;

  select lower(u.email), u.email_confirmed_at into caller_email, caller_confirmed
  from auth.users u where u.id = caller;

  select * into invitation from public.firm_invitations where id = target_invitation;
  -- The same answer for an invitation that does not exist and for one that is
  -- addressed to somebody else: an id tells nothing to who is not invited.
  if not found or caller_email is null or invitation.email::text <> caller_email then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if caller_confirmed is null then
    return jsonb_build_object('ok', false, 'code', 'email_not_confirmed');
  end if;

  perform public.lock_firm_team(invitation.org_id);
  select * into invitation from public.firm_invitations where id = target_invitation for update;

  if invitation.accepted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_accepted');
  end if;
  if invitation.revoked_at is not null then
    return jsonb_build_object('ok', false, 'code', 'revoked');
  end if;
  if invitation.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;
  if exists (select 1 from public.memberships m where m.user_id = caller) then
    return jsonb_build_object('ok', false, 'code', 'already_in_a_firm');
  end if;

  insert into public.memberships (org_id, user_id, role, firm_function)
  values (invitation.org_id, caller, invitation.role, invitation.firm_function);

  -- Counted with the caller already in, which is also what lets
  -- org_entitlements answer for them.
  ceiling := public.firm_seat_ceiling(invitation.org_id);
  if ceiling is not null then
    select count(*) into seats from public.memberships m where m.org_id = invitation.org_id;
    if seats > ceiling then
      raise exception 'seat_limit' using errcode = 'P0001', hint = 'The plan has no free seat.';
    end if;
  end if;

  update public.firm_invitations
  set accepted_at = now(), accepted_by = caller
  where id = invitation.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    invitation.org_id, caller, 'firm.invitation.accepted', 'firm_invitation', invitation.id::text,
    jsonb_build_object('role', invitation.role, 'firm_function', invitation.firm_function)
  );

  return jsonb_build_object('ok', true, 'code', 'joined', 'org_id', invitation.org_id);
end;
$$;

revoke all on function public.accept_firm_invitation(uuid) from public, anon;
grant execute on function public.accept_firm_invitation(uuid) to authenticated;

-- ---------- Changing a member ----------

/**
 * Changes what a person does in the firm. The owner changes anybody's
 * function; an admin changes their own and that of plain members.
 */
create or replace function public.set_member_function(
  target_org uuid,
  target_user uuid,
  new_function public.firm_function
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_role public.org_role;
  target public.memberships%rowtype;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if new_function is null then
    raise exception 'invalid_firm_function' using errcode = '22023';
  end if;

  perform public.lock_firm_team(target_org);

  select m.role into caller_role from public.memberships m where m.org_id = target_org and m.user_id = caller;
  if caller_role is null or caller_role = 'member' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();

  select * into target from public.memberships m where m.org_id = target_org and m.user_id = target_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_a_member');
  end if;
  if caller_role = 'admin' and target.user_id <> caller and target.role <> 'member' then
    return jsonb_build_object('ok', false, 'code', 'only_owner_changes_managers');
  end if;
  if target.firm_function = new_function then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;

  update public.memberships set firm_function = new_function where id = target.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org, caller, 'firm.member.function_changed', 'membership', target.id::text,
    jsonb_build_object('user_id', target_user, 'from', target.firm_function, 'to', new_function)
  );

  return jsonb_build_object('ok', true, 'code', 'changed');
end;
$$;

revoke all on function public.set_member_function(uuid, uuid, public.firm_function) from public, anon;
grant execute on function public.set_member_function(uuid, uuid, public.firm_function) to authenticated;

/**
 * Makes a member an admin, or an admin a plain member. Owner only: who manages
 * the firm account is the owner's decision. The owner's own role changes only
 * by transferring the firm.
 */
create or replace function public.set_member_role(
  target_org uuid,
  target_user uuid,
  new_role public.org_role
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target public.memberships%rowtype;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if new_role is null or new_role = 'owner' then
    raise exception 'invalid_role' using errcode = '22023', hint = 'Ownership moves through transfer_firm_ownership.';
  end if;

  perform public.lock_firm_team(target_org);

  if not public.has_org_role(target_org, array['owner']::public.org_role[]) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();

  select * into target from public.memberships m where m.org_id = target_org and m.user_id = target_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_a_member');
  end if;
  if target.role = 'owner' then
    return jsonb_build_object('ok', false, 'code', 'owner_role_is_transferred');
  end if;
  if target.role = new_role then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;

  update public.memberships set role = new_role where id = target.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org, caller, 'firm.member.role_changed', 'membership', target.id::text,
    jsonb_build_object('user_id', target_user, 'from', target.role, 'to', new_role)
  );

  return jsonb_build_object('ok', true, 'code', 'changed');
end;
$$;

revoke all on function public.set_member_role(uuid, uuid, public.org_role) from public, anon;
grant execute on function public.set_member_role(uuid, uuid, public.org_role) to authenticated;

/**
 * Removes a person from the firm. The owner removes anybody but themself; an
 * admin removes plain members. Nobody removes themself here (leave_firm), and
 * the owner leaves only after transferring the firm.
 */
create or replace function public.remove_firm_member(target_org uuid, target_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_role public.org_role;
  target public.memberships%rowtype;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;

  perform public.lock_firm_team(target_org);

  select m.role into caller_role from public.memberships m where m.org_id = target_org and m.user_id = caller;
  if caller_role is null or caller_role = 'member' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();

  select * into target from public.memberships m where m.org_id = target_org and m.user_id = target_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_a_member');
  end if;
  if target.user_id = caller then
    return jsonb_build_object('ok', false, 'code', 'use_leave_firm');
  end if;
  if target.role = 'owner' then
    return jsonb_build_object('ok', false, 'code', 'owner_cannot_be_removed');
  end if;
  if caller_role = 'admin' and target.role <> 'member' then
    return jsonb_build_object('ok', false, 'code', 'only_owner_changes_managers');
  end if;

  delete from public.memberships where id = target.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org, caller, 'firm.member.removed', 'membership', target.id::text,
    jsonb_build_object('user_id', target_user, 'role', target.role, 'firm_function', target.firm_function)
  );

  return jsonb_build_object('ok', true, 'code', 'removed');
end;
$$;

revoke all on function public.remove_firm_member(uuid, uuid) from public, anon;
grant execute on function public.remove_firm_member(uuid, uuid) to authenticated;

-- A person leaves the firm they belong to. The owner cannot: a firm always has
-- an owner, so they transfer it first.
create or replace function public.leave_firm(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  mine public.memberships%rowtype;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;

  perform public.lock_firm_team(target_org);

  select * into mine from public.memberships m where m.org_id = target_org and m.user_id = caller for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_a_member');
  end if;
  if mine.role = 'owner' then
    return jsonb_build_object('ok', false, 'code', 'owner_must_transfer_first');
  end if;

  delete from public.memberships where id = mine.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org, caller, 'firm.member.left', 'membership', mine.id::text,
    jsonb_build_object('user_id', caller, 'role', mine.role, 'firm_function', mine.firm_function)
  );

  return jsonb_build_object('ok', true, 'code', 'left');
end;
$$;

revoke all on function public.leave_firm(uuid) from public, anon;
grant execute on function public.leave_firm(uuid) to authenticated;

/**
 * Hands the firm to another member. Owner only, with the second factor. The
 * former owner stays as an admin: they leave, or are demoted, in a separate
 * and equally audited step.
 */
create or replace function public.transfer_firm_ownership(target_org uuid, new_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target public.memberships%rowtype;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;

  perform public.lock_firm_team(target_org);

  if not public.has_org_role(target_org, array['owner']::public.org_role[]) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();

  if new_owner = caller then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  select * into target from public.memberships m where m.org_id = target_org and m.user_id = new_owner for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_a_member');
  end if;

  -- Two statements, in this order: the firm may never hold two owners, not
  -- even between two rows of one statement.
  update public.memberships set role = 'admin' where org_id = target_org and user_id = caller;
  update public.memberships set role = 'owner' where id = target.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org, caller, 'firm.ownership.transferred', 'organization', target_org::text,
    jsonb_build_object('from', caller, 'to', new_owner)
  );

  return jsonb_build_object('ok', true, 'code', 'transferred');
end;
$$;

revoke all on function public.transfer_firm_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_firm_ownership(uuid, uuid) to authenticated;

-- ---------- The person's registrations at the bar ----------

create or replace function public.add_oab_registration(
  target_uf text,
  target_number text,
  target_kind text default 'principal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  clean_uf text := upper(btrim(coalesce(target_uf, '')));
  -- Without the zeros before it: a number is one registration however it is typed.
  clean_number text := ltrim(upper(regexp_replace(coalesce(target_number, ''), '[^0-9A-Za-z]', '', 'g')), '0');
  clean_kind text := coalesce(nullif(btrim(target_kind), ''), 'principal');
  new_id uuid;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if clean_number !~ '^[1-9][0-9]{0,6}[A-Z]?$' or clean_kind not in ('principal', 'suplementar')
     or clean_uf !~ '^[A-Z]{2}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_registration');
  end if;

  if exists (select 1 from public.oab_registrations r where r.user_id = caller and r.uf = clean_uf) then
    return jsonb_build_object('ok', false, 'code', 'state_already_registered');
  end if;
  if clean_kind = 'principal'
     and exists (select 1 from public.oab_registrations r where r.user_id = caller and r.kind = 'principal') then
    return jsonb_build_object('ok', false, 'code', 'principal_already_registered');
  end if;
  -- Somebody else's: said without saying whose.
  if exists (select 1 from public.oab_registrations r where r.uf = clean_uf and r.number = clean_number) then
    return jsonb_build_object('ok', false, 'code', 'registration_in_use');
  end if;

  begin
    insert into public.oab_registrations (user_id, uf, number, kind)
    values (caller, clean_uf, clean_number, clean_kind)
    returning id into new_id;
  exception
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'invalid_registration');
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'registration_in_use');
  end;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    public.current_org_id(), caller, 'member.oab.added', 'oab_registration', new_id::text,
    jsonb_build_object('uf', clean_uf, 'number', clean_number, 'kind', clean_kind)
  );

  return jsonb_build_object('ok', true, 'code', 'added', 'id', new_id);
end;
$$;

revoke all on function public.add_oab_registration(text, text, text) from public, anon;
grant execute on function public.add_oab_registration(text, text, text) to authenticated;

create or replace function public.remove_oab_registration(target_registration uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  registration public.oab_registrations%rowtype;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;

  delete from public.oab_registrations r
  where r.id = target_registration and r.user_id = caller
  returning * into registration;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    public.current_org_id(), caller, 'member.oab.removed', 'oab_registration', registration.id::text,
    jsonb_build_object('uf', registration.uf, 'number', registration.number, 'kind', registration.kind)
  );

  return jsonb_build_object('ok', true, 'code', 'removed');
end;
$$;

revoke all on function public.remove_oab_registration(uuid) from public, anon;
grant execute on function public.remove_oab_registration(uuid) to authenticated;
