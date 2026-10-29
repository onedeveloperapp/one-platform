-- ============================================================
-- 0069_partners: an account that is no firm's, the partner of a module.
--
-- The owner decided on 2026-10-29 that the travel agency a firm partners
-- with has an area of its own in ONE, where it adds the passengers the
-- partnership covers. A partner is in the core, since a module to come may
-- have partners of its own; what a partner does is its module's (0070).
--
--   partners             an agency, by its name.
--   partner_members      who works in it, with a role in its account (owner,
--                        admin, member). A person is in one firm or in one
--                        partner, never both, and in at most one of each
--                        (0000): a trigger on each side refuses the other.
--   partner_links        the partnership: a partner, a firm and a module,
--                        active or ended. A partner has one active link per
--                        module (the plan of 2026-10-29: one firm at a time).
--   partner_invitations  how a person gets in. A firm invites an agency (who
--                        manages the firm, with the second factor, for a
--                        module the firm uses): the first person founds the
--                        partner and the link, or links a partner they
--                        already manage that has no active link of that
--                        module. Who manages a partner invites colleagues.
--                        Accepting takes an account whose CONFIRMED e-mail
--                        is the invited one, as a firm's invitation does
--                        (0003); the token's SHA-256 is all that is kept.
--
-- These are tables of their own, never `memberships`: no function or policy
-- of a firm reaches a partner's people, and a partner's people reach nothing
-- of a firm. A partner's own functions ask for the second factor
-- (`second_factor_required` now names who is in a partner), refuse a support
-- visit, and are audited: what concerns the partnership on the firm's record,
-- what concerns the partner's team on the platform's (no firm reads it).
-- ============================================================

-- ---------- Tables ----------

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  -- agency: a travel agency, the passenger module's partner.
  kind text not null default 'agency',
  name text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partners_kind_check check (kind in ('agency')),
  constraint partners_name_check check (char_length(btrim(name)) between 2 and 120 and name !~ '[[:cntrl:]]')
);

create trigger partners_updated_at before update on public.partners
  for each row execute function public.set_updated_at();

create table public.partner_members (
  partner_id uuid not null references public.partners (id) on delete cascade,
  -- A person is in one partner at a time.
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (partner_id, user_id),
  constraint partner_members_role_check check (role in ('owner', 'admin', 'member'))
);

create unique index partner_members_one_owner_idx on public.partner_members (partner_id) where role = 'owner';

create table public.partner_links (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  module_key text not null references public.product_modules (key) on delete restrict,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  -- Who of the firm invited the partner.
  started_by uuid references public.profiles (id) on delete set null,
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  end_reason text,
  unique (id, org_id),
  constraint partner_links_status_check check (status in ('active', 'ended')),
  constraint partner_links_ended_check check ((status = 'ended') = (ended_at is not null)),
  constraint partner_links_reason_check check (end_reason is null or (char_length(end_reason) <= 500 and end_reason !~ '[[:cntrl:]]'))
);

create unique index partner_links_one_active_idx on public.partner_links (partner_id, module_key) where status = 'active';
create index partner_links_org_idx on public.partner_links (org_id, status);

create table public.partner_invitations (
  id uuid primary key default gen_random_uuid(),
  -- An invitation of a firm to an agency: the firm, the module and the name the firm gave the agency.
  org_id uuid references public.organizations (id) on delete cascade,
  module_key text references public.product_modules (key) on delete restrict,
  partner_name text,
  -- An invitation of a partner to a colleague.
  partner_id uuid references public.partners (id) on delete cascade,
  email extensions.citext not null,
  role text not null,
  token_hash text not null unique,
  invited_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint partner_invitations_kind_check check (
    (org_id is not null and module_key is not null and partner_name is not null and partner_id is null and role = 'owner')
    or (org_id is null and module_key is null and partner_name is null and partner_id is not null and role in ('admin', 'member'))
  ),
  constraint partner_invitations_name_check check (
    partner_name is null or (char_length(btrim(partner_name)) between 2 and 120 and partner_name !~ '[[:cntrl:]]')
  ),
  constraint partner_invitations_email_check check (
    email::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and char_length(email::text) <= 254
  ),
  constraint partner_invitations_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint partner_invitations_one_end check (accepted_at is null or revoked_at is null)
);

-- One open invitation per address and inviter: inviting again revokes the open one.
create unique index partner_invitations_one_open_firm_idx on public.partner_invitations (org_id, email)
  where org_id is not null and accepted_at is null and revoked_at is null;
create unique index partner_invitations_one_open_team_idx on public.partner_invitations (partner_id, email)
  where partner_id is not null and accepted_at is null and revoked_at is null;
create index partner_invitations_email_idx on public.partner_invitations (email)
  where accepted_at is null and revoked_at is null;

-- ---------- Helpers ----------

create or replace function public.is_partner_member(target_partner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.partner_members pm where pm.partner_id = target_partner and pm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_partner_member(uuid) from public, anon;
grant execute on function public.is_partner_member(uuid) to authenticated;

create or replace function public.has_partner_role(target_partner uuid, target_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.partner_members pm
    where pm.partner_id = target_partner and pm.user_id = auth.uid() and pm.role = any (target_roles)
  );
$$;

revoke all on function public.has_partner_role(uuid, text[]) from public, anon;
grant execute on function public.has_partner_role(uuid, text[]) to authenticated;

-- One lock per partner for everything that changes its people.
create or replace function public.lock_partner_team(target_partner uuid)
returns void
language sql
as $$
  select pg_advisory_xact_lock(hashtextextended('partner-team:' || target_partner::text, 0));
$$;

revoke all on function public.lock_partner_team(uuid) from public, anon, authenticated;

/** A person in a partner joins no firm, and a person in a firm joins no partner. */
create or replace function public.memberships_not_in_a_partner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.partner_members pm where pm.user_id = new.user_id) then
    raise exception 'in_a_partner' using errcode = '23505', hint = 'A person in a partner joins no firm.';
  end if;
  return new;
end;
$$;

revoke all on function public.memberships_not_in_a_partner() from public, anon, authenticated;

create trigger memberships_not_in_a_partner before insert or update of user_id on public.memberships
  for each row execute function public.memberships_not_in_a_partner();

create or replace function public.partner_members_not_in_a_firm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.memberships m where m.user_id = new.user_id) then
    raise exception 'already_in_a_firm' using errcode = '23505', hint = 'A person in a firm joins no partner.';
  end if;
  return new;
end;
$$;

revoke all on function public.partner_members_not_in_a_firm() from public, anon, authenticated;

create trigger partner_members_not_in_a_firm before insert or update of user_id on public.partner_members
  for each row execute function public.partner_members_not_in_a_firm();

-- ---------- Row-level security ----------

alter table public.partners enable row level security;
alter table public.partner_members enable row level security;
alter table public.partner_links enable row level security;
alter table public.partner_invitations enable row level security;

create policy "partners_select_member" on public.partners
  for select to authenticated
  using (public.is_partner_member(id) or public.is_superadmin());

create policy "partner_members_select_member" on public.partner_members
  for select to authenticated
  using (public.is_partner_member(partner_id) or public.is_superadmin());

-- The partner reads its partnerships; the firm reads that it has them (the partner's name comes through
-- `firm_partners`).
create policy "partner_links_select_party" on public.partner_links
  for select to authenticated
  using (public.is_partner_member(partner_id) or public.is_org_member(org_id) or public.is_superadmin());

-- Who manages the inviter reads its invitations; never the token's hash.
create policy "partner_invitations_select_manager" on public.partner_invitations
  for select to authenticated
  using (
    (org_id is not null and public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
    or (partner_id is not null and public.has_partner_role(partner_id, array['owner', 'admin']))
    or public.is_superadmin()
  );

grant select on table public.partners to authenticated;
grant select on table public.partner_members to authenticated;
grant select on table public.partner_links to authenticated;
grant select (
  id, org_id, module_key, partner_name, partner_id, email, role, invited_by, expires_at, accepted_at, accepted_by,
  revoked_at, created_at
) on table public.partner_invitations to authenticated;

create trigger guard_impersonation_partners after insert or update or delete on public.partners
  for each statement execute function public.guard_impersonation_readonly();
create trigger guard_impersonation_partner_members after insert or update or delete on public.partner_members
  for each statement execute function public.guard_impersonation_readonly();
create trigger guard_impersonation_partner_links after insert or update or delete on public.partner_links
  for each statement execute function public.guard_impersonation_readonly();
create trigger guard_impersonation_partner_invitations after insert or update or delete on public.partner_invitations
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- The second factor ----------

/**
 * Whether the caller must have a second factor (0003, redefined): the platform operator always, in a firm whoever
 * holds a role or a function the `security` setting names, and now everybody in a partner, who handles the
 * documents of people who are nobody's clients yet.
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
    or exists (select 1 from public.partner_members pm where pm.user_id = auth.uid())
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

-- ---------- A firm invites an agency ----------

/** How long an invitation lasts and how many an inviter sends in a day: the setting of a firm's team (0003). */
create or replace function public.partner_invite_limits()
returns table (valid_days integer, per_day integer)
language sql
stable
set search_path = public
as $$
  select
    least(greatest(coalesce((value ->> 'invite_valid_days')::integer, 7), 1), 30),
    greatest(coalesce((value ->> 'invites_per_day')::integer, 30), 1)
  from (select coalesce((select s.value from public.platform_settings s where s.key = 'team'), '{}'::jsonb) as value) setting;
$$;

revoke all on function public.partner_invite_limits() from public, anon, authenticated;

/**
 * Who manages the firm invites a travel agency to be its partner in a module the firm uses, by the e-mail of the
 * agency's first person and the agency's name. The link of the e-mail carries a random token; only its SHA-256 is
 * kept. Inviting the same address again revokes the open invitation. With the second factor, never in a support
 * visit; a firm sends a limited number a day.
 */
create or replace function public.firm_invite_partner(
  target_org uuid,
  target_module text,
  target_partner_name text,
  target_email text,
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
  clean_name text := nullif(btrim(regexp_replace(coalesce(target_partner_name, ''), '\s+', ' ', 'g')), '');
  limits record;
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
  if coalesce(target_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_token_hash' using errcode = '22023';
  end if;
  if not public.firm_uses_module(target_org, target_module) then
    return jsonb_build_object('ok', false, 'code', 'module_not_enabled');
  end if;
  if clean_name is null or char_length(clean_name) < 2 or char_length(clean_name) > 120 or clean_name ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'code', 'invalid_partner_name');
  end if;
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(clean_email) > 254 then
    return jsonb_build_object('ok', false, 'code', 'invalid_email');
  end if;
  if exists (
    select 1 from public.memberships m join auth.users u on u.id = m.user_id
    where m.org_id = target_org and lower(u.email) = clean_email
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_member');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('firm-partners:' || target_org::text, 0));
  select * into limits from public.partner_invite_limits();
  if (select count(*) from public.partner_invitations i
      where i.org_id = target_org and i.created_at > now() - interval '24 hours') >= limits.per_day then
    return jsonb_build_object('ok', false, 'code', 'invite_rate_limited');
  end if;
  expires := now() + make_interval(days => limits.valid_days);

  update public.partner_invitations
  set revoked_at = now()
  where org_id = target_org and email = clean_email::extensions.citext and accepted_at is null and revoked_at is null;

  insert into public.partner_invitations (org_id, module_key, partner_name, email, role, token_hash, invited_by, expires_at)
  values (target_org, target_module, clean_name, clean_email, 'owner', target_token_hash, caller, expires)
  returning id into new_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'partner.invitation.sent', 'partner_invitation', new_id::text,
          jsonb_build_object('module', target_module, 'partner_name', clean_name, 'email', clean_email));

  return jsonb_build_object('ok', true, 'code', 'invited', 'id', new_id, 'expires_at', expires);
end;
$$;

revoke all on function public.firm_invite_partner(uuid, text, text, text, text) from public, anon;
grant execute on function public.firm_invite_partner(uuid, text, text, text, text) to authenticated;

/**
 * Who manages a partner invites a colleague, as an admin or a member, with the second factor. The partner must
 * still have an active partnership: an agency whose partnerships all ended brings nobody in.
 */
create or replace function public.invite_to_partner(
  target_partner uuid,
  target_email text,
  target_role text,
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
  limits record;
  new_id uuid;
  expires timestamptz;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.has_partner_role(target_partner, array['owner', 'admin']) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if coalesce(target_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_token_hash' using errcode = '22023';
  end if;
  if target_role is null or target_role not in ('admin', 'member') then
    return jsonb_build_object('ok', false, 'code', 'invalid_role');
  end if;
  if target_role = 'admin' and not public.has_partner_role(target_partner, array['owner']) then
    return jsonb_build_object('ok', false, 'code', 'only_owner_invites_admin');
  end if;
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(clean_email) > 254 then
    return jsonb_build_object('ok', false, 'code', 'invalid_email');
  end if;
  if not exists (select 1 from public.partner_links l where l.partner_id = target_partner and l.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'no_partnership');
  end if;

  perform public.lock_partner_team(target_partner);
  if exists (
    select 1 from public.partner_members pm join auth.users u on u.id = pm.user_id
    where pm.partner_id = target_partner and lower(u.email) = clean_email
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_member');
  end if;
  select * into limits from public.partner_invite_limits();
  if (select count(*) from public.partner_invitations i
      where i.partner_id = target_partner and i.created_at > now() - interval '24 hours') >= limits.per_day then
    return jsonb_build_object('ok', false, 'code', 'invite_rate_limited');
  end if;
  expires := now() + make_interval(days => limits.valid_days);

  update public.partner_invitations
  set revoked_at = now()
  where partner_id = target_partner and email = clean_email::extensions.citext and accepted_at is null and revoked_at is null;

  insert into public.partner_invitations (partner_id, email, role, token_hash, invited_by, expires_at)
  values (target_partner, clean_email, target_role, target_token_hash, caller, expires)
  returning id into new_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'partner.team.invitation.sent', 'partner', target_partner::text,
          jsonb_build_object('invitation', new_id, 'role', target_role));

  return jsonb_build_object('ok', true, 'code', 'invited', 'id', new_id, 'expires_at', expires);
end;
$$;

revoke all on function public.invite_to_partner(uuid, text, text, text) from public, anon;
grant execute on function public.invite_to_partner(uuid, text, text, text) to authenticated;

/** Who sent an open invitation (the firm's managers, or the partner's) takes it back. */
create or replace function public.revoke_partner_invitation(target_invitation uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  invitation public.partner_invitations%rowtype;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into invitation from public.partner_invitations where id = target_invitation for update;
  if not found
     or not ((invitation.org_id is not null and public.has_org_role(invitation.org_id, array['owner', 'admin']::public.org_role[]))
             or (invitation.partner_id is not null and public.has_partner_role(invitation.partner_id, array['owner', 'admin']))) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if invitation.accepted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_accepted');
  end if;
  if invitation.revoked_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_revoked');
  end if;
  update public.partner_invitations set revoked_at = now() where id = invitation.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (invitation.org_id, caller, 'partner.invitation.revoked', 'partner_invitation', invitation.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'code', 'revoked');
end;
$$;

revoke all on function public.revoke_partner_invitation(uuid) from public, anon;
grant execute on function public.revoke_partner_invitation(uuid) to authenticated;

/**
 * What the page of an invitation shows to whoever opens its link, signed in or not: who invites (the firm, or the
 * partner), the agency's name, the module, and whether it can still be accepted. The address comes back masked.
 */
create or replace function public.partner_invitation_preview(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  invitation public.partner_invitations%rowtype;
  address text;
  local_part text;
begin
  if coalesce(target_token, '') = '' or char_length(target_token) > 200 then
    return jsonb_build_object('found', false);
  end if;
  select * into invitation
  from public.partner_invitations
  where token_hash = encode(sha256(convert_to(target_token, 'UTF8')), 'hex');
  if not found then
    return jsonb_build_object('found', false);
  end if;
  address := invitation.email::text;
  local_part := split_part(address, '@', 1);
  return jsonb_build_object(
    'found', true,
    'id', invitation.id,
    'kind', case when invitation.org_id is not null then 'firm' else 'team' end,
    'firm', (select o.name from public.organizations o where o.id = invitation.org_id),
    'module', coalesce(invitation.module_key,
      (select l.module_key from public.partner_links l where l.partner_id = invitation.partner_id and l.status = 'active'
       order by l.started_at desc limit 1)),
    'partner', coalesce(invitation.partner_name, (select p.name from public.partners p where p.id = invitation.partner_id)),
    'invited_by', (select p.display_name from public.profiles p where p.id = invitation.invited_by),
    'role', invitation.role,
    'email_hint', left(local_part, 1) || repeat('*', greatest(char_length(local_part) - 1, 2)) || '@' || split_part(address, '@', 2),
    'expires_at', invitation.expires_at,
    'status', case
      when invitation.accepted_at is not null then 'accepted'
      when invitation.revoked_at is not null then 'revoked'
      when invitation.expires_at <= now() then 'expired'
      else 'open'
    end,
    'for_this_account', auth.uid() is not null and lower(coalesce(auth.jwt() ->> 'email', '')) = lower(address)
  );
end;
$$;

revoke all on function public.partner_invitation_preview(text) from public;
grant execute on function public.partner_invitation_preview(text) to anon, authenticated;

/** The open invitations to a partner addressed to the caller's own confirmed e-mail. */
create or replace function public.my_partner_invitations()
returns table (
  id uuid,
  kind text,
  firm text,
  partner text,
  module text,
  invited_by text,
  role text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.id,
    case when i.org_id is not null then 'firm' else 'team' end,
    o.name,
    coalesce(i.partner_name, p.name),
    coalesce(i.module_key, (select l.module_key from public.partner_links l
                            where l.partner_id = i.partner_id and l.status = 'active'
                            order by l.started_at desc limit 1)),
    inviter.display_name,
    i.role,
    i.expires_at
  from public.partner_invitations i
  left join public.organizations o on o.id = i.org_id
  left join public.partners p on p.id = i.partner_id
  left join public.profiles inviter on inviter.id = i.invited_by
  join auth.users u on u.id = auth.uid()
  where u.email_confirmed_at is not null
    and i.email = lower(u.email)::extensions.citext
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  order by i.created_at desc;
$$;

revoke all on function public.my_partner_invitations() from public, anon;
grant execute on function public.my_partner_invitations() to authenticated;

/**
 * Accepts an invitation to a partner. A firm's invitation founds the agency with the caller as its owner and the
 * partnership with the firm, or, from somebody who already manages an agency with no active partnership in that
 * module, links that agency instead. A partner's invitation adds the caller to its team. Accepted once, before it
 * expires, by the account whose confirmed e-mail it was sent to, never by somebody of a firm, and, for a firm's
 * invitation, only while the firm still uses the module.
 */
create or replace function public.accept_partner_invitation(target_invitation uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_email text;
  caller_confirmed timestamptz;
  invitation public.partner_invitations%rowtype;
  mine public.partner_members%rowtype;
  new_partner uuid;
  new_link uuid;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;

  select lower(u.email), u.email_confirmed_at into caller_email, caller_confirmed from auth.users u where u.id = caller;
  select * into invitation from public.partner_invitations where id = target_invitation;
  if not found or caller_email is null or invitation.email::text <> caller_email then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if caller_confirmed is null then
    return jsonb_build_object('ok', false, 'code', 'email_not_confirmed');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('partner-founder:' || caller::text, 0));
  if invitation.partner_id is not null then
    perform public.lock_partner_team(invitation.partner_id);
  end if;
  select * into invitation from public.partner_invitations where id = target_invitation for update;
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
  select * into mine from public.partner_members pm where pm.user_id = caller;

  if invitation.org_id is not null then
    if not public.firm_uses_module(invitation.org_id, invitation.module_key) then
      return jsonb_build_object('ok', false, 'code', 'module_not_enabled');
    end if;
    if mine.partner_id is not null then
      -- An agency already in ONE takes the partnership, when who accepts manages it and it has none active of
      -- that module.
      if mine.role not in ('owner', 'admin') then
        return jsonb_build_object('ok', false, 'code', 'already_in_a_partner');
      end if;
      if exists (select 1 from public.partner_links l
                 where l.partner_id = mine.partner_id and l.module_key = invitation.module_key and l.status = 'active') then
        return jsonb_build_object('ok', false, 'code', 'already_partnered');
      end if;
      new_partner := mine.partner_id;
    else
      insert into public.partners (name, created_by) values (invitation.partner_name, caller) returning id into new_partner;
      insert into public.partner_members (partner_id, user_id, role) values (new_partner, caller, 'owner');
      insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
      values (null, caller, 'partner.created', 'partner', new_partner::text, jsonb_build_object('invitation', invitation.id));
    end if;
    insert into public.partner_links (partner_id, org_id, module_key, started_by)
    values (new_partner, invitation.org_id, invitation.module_key, invitation.invited_by)
    returning id into new_link;
    update public.partner_invitations set accepted_at = now(), accepted_by = caller where id = invitation.id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (invitation.org_id, caller, 'partner.link.started', 'partner_link', new_link::text,
            jsonb_build_object('partner', new_partner, 'module', invitation.module_key, 'invitation', invitation.id));
    return jsonb_build_object('ok', true, 'code', 'partnered', 'partner_id', new_partner, 'link_id', new_link);
  end if;

  if mine.partner_id is not null then
    return jsonb_build_object('ok', false, 'code', 'already_in_a_partner');
  end if;
  insert into public.partner_members (partner_id, user_id, role) values (invitation.partner_id, caller, invitation.role);
  update public.partner_invitations set accepted_at = now(), accepted_by = caller where id = invitation.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'partner.team.joined', 'partner', invitation.partner_id::text,
          jsonb_build_object('invitation', invitation.id, 'role', invitation.role));
  return jsonb_build_object('ok', true, 'code', 'joined', 'partner_id', invitation.partner_id);
end;
$$;

revoke all on function public.accept_partner_invitation(uuid) from public, anon;
grant execute on function public.accept_partner_invitation(uuid) to authenticated;

-- ---------- The partner's team ----------

/** Who is in the partner, as a colleague sees it; whether each has a second factor, to who manages it. */
create or replace function public.partner_team(target_partner uuid)
returns table (
  user_id uuid,
  display_name text,
  email text,
  role text,
  joined_at timestamptz,
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
  if not (public.is_partner_member(target_partner) or public.is_superadmin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  manager := public.is_superadmin() or public.has_partner_role(target_partner, array['owner', 'admin']);
  return query
  select
    pm.user_id,
    p.display_name,
    u.email::text,
    pm.role,
    pm.created_at,
    case when manager then exists (
      select 1 from auth.mfa_factors f where f.user_id = pm.user_id and f.status = 'verified'
    ) end
  from public.partner_members pm
  join public.profiles p on p.id = pm.user_id
  join auth.users u on u.id = pm.user_id
  where pm.partner_id = target_partner
  order by (pm.role = 'owner') desc, (pm.role = 'admin') desc, p.display_name;
end;
$$;

revoke all on function public.partner_team(uuid) from public, anon;
grant execute on function public.partner_team(uuid) to authenticated;

/**
 * Who manages the partner takes a person out of it (the owner anybody but themself, an admin a member), with the
 * second factor; somebody who is not the owner leaves by themself.
 */
create or replace function public.remove_partner_member(target_partner uuid, target_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target_role text;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.is_partner_member(target_partner) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();
  perform public.lock_partner_team(target_partner);
  select pm.role into target_role from public.partner_members pm
  where pm.partner_id = target_partner and pm.user_id = target_user;
  if target_role is null then
    return jsonb_build_object('ok', false, 'code', 'not_a_member');
  end if;
  if target_role = 'owner' then
    return jsonb_build_object('ok', false, 'code', 'owner_stays');
  end if;
  if target_user <> caller and not (
    public.has_partner_role(target_partner, array['owner'])
    or (public.has_partner_role(target_partner, array['admin']) and target_role = 'member')
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  delete from public.partner_members where partner_id = target_partner and user_id = target_user;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, case when target_user = caller then 'partner.team.left' else 'partner.team.removed' end,
          'partner', target_partner::text, jsonb_build_object('user', target_user, 'role', target_role));
  return jsonb_build_object('ok', true, 'code', case when target_user = caller then 'left' else 'removed' end);
end;
$$;

revoke all on function public.remove_partner_member(uuid, uuid) from public, anon;
grant execute on function public.remove_partner_member(uuid, uuid) to authenticated;

/** Who manages the partner renames it, with the second factor. */
create or replace function public.rename_partner(target_partner uuid, target_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  clean_name text := nullif(btrim(regexp_replace(coalesce(target_name, ''), '\s+', ' ', 'g')), '');
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.has_partner_role(target_partner, array['owner', 'admin']) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if clean_name is null or char_length(clean_name) < 2 or char_length(clean_name) > 120 or clean_name ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'code', 'invalid_partner_name');
  end if;
  update public.partners set name = clean_name where id = target_partner and name <> clean_name;
  if found then
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (null, caller, 'partner.renamed', 'partner', target_partner::text, jsonb_build_object('to', clean_name));
    return jsonb_build_object('ok', true, 'code', 'renamed');
  end if;
  return jsonb_build_object('ok', true, 'code', 'unchanged');
end;
$$;

revoke all on function public.rename_partner(uuid, text) from public, anon;
grant execute on function public.rename_partner(uuid, text) to authenticated;

-- ---------- The partnership ----------

/**
 * Ends a partnership, with the second factor and a reason the firm keeps: who manages the firm, or who manages the
 * partner. The partner adds nothing more for that firm; what it already added is kept for the time the module says
 * (0070) and then forgotten. Ending is final: a new partnership starts with a new invitation.
 */
create or replace function public.end_partner_link(target_link uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  link public.partner_links%rowtype;
  reason text := nullif(regexp_replace(btrim(coalesce(target_reason, '')), '\s+', ' ', 'g'), '');
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into link from public.partner_links where id = target_link for update;
  if not found
     or not (public.has_org_role(link.org_id, array['owner', 'admin']::public.org_role[])
             or public.has_partner_role(link.partner_id, array['owner', 'admin'])) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if reason is null or char_length(reason) < 4 or char_length(reason) > 500 or reason ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if link.status = 'ended' then
    return jsonb_build_object('ok', true, 'code', 'already_ended');
  end if;
  update public.partner_links
  set status = 'ended', ended_at = now(), ended_by = caller, end_reason = reason
  where id = link.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (link.org_id, caller, 'partner.link.ended', 'partner_link', link.id::text,
          jsonb_build_object('partner', link.partner_id, 'module', link.module_key,
                             'by', case when public.is_org_member(link.org_id) then 'firm' else 'partner' end));
  return jsonb_build_object('ok', true, 'code', 'ended');
end;
$$;

revoke all on function public.end_partner_link(uuid, text) from public, anon;
grant execute on function public.end_partner_link(uuid, text) to authenticated;

/**
 * The partnerships of a firm, for anybody of it: each partner's name, the module, since when and until when, and
 * who ended it with why, to who manages the firm. The open invitations are read from their table, by who manages.
 */
create or replace function public.firm_partners(target_org uuid)
returns table (
  link_id uuid,
  partner_id uuid,
  partner text,
  module text,
  status text,
  started_at timestamptz,
  ended_at timestamptz,
  end_reason text
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
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  manager := public.is_superadmin() or public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]);
  return query
  select l.id, l.partner_id, p.name, l.module_key, l.status, l.started_at, l.ended_at,
         case when manager then l.end_reason end
  from public.partner_links l
  join public.partners p on p.id = l.partner_id
  where l.org_id = target_org
  order by (l.status = 'active') desc, l.started_at desc;
end;
$$;

revoke all on function public.firm_partners(uuid) from public, anon;
grant execute on function public.firm_partners(uuid) to authenticated;

/**
 * The caller's partner, for the app to know where they work: the partner with their role, and its active
 * partnerships, each with the firm's name and the module. Null for somebody in no partner.
 */
create or replace function public.my_partner()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'kind', p.kind,
    'role', pm.role,
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'org_id', l.org_id, 'firm', o.name, 'module', l.module_key,
                                          'started_at', l.started_at) order by l.started_at)
      from public.partner_links l join public.organizations o on o.id = l.org_id
      where l.partner_id = p.id and l.status = 'active'
    ), '[]'::jsonb)
  )
  from public.partner_members pm
  join public.partners p on p.id = pm.partner_id
  where pm.user_id = auth.uid();
$$;

revoke all on function public.my_partner() from public, anon;
grant execute on function public.my_partner() to authenticated;
