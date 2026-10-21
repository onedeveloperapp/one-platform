-- ============================================================
-- 0000_init: identity and tenancy.
--
-- A person is an account (auth.users plus a profile). A firm is an
-- organization. A person belongs to a firm through a membership, which says
-- two different things:
--   * role: what the person may do to the FIRM ACCOUNT (owner, admin,
--     member): the team, the plan, the billing profile;
--   * firm_function: what the person does IN the firm (sócio, advogado,
--     controladoria, atendimento): what the product shows them and lets them
--     approve.
-- Many firms share this database and never see each other: every table that
-- belongs to a firm carries `org_id`, and its policies ask is_org_member().
--
-- Sign-up creates only the profile. A firm is founded or joined by invitation
-- in 0003_firm_team, which audits both.
--
-- PRIVILEGE CONVENTION (every migration follows it): this project is
-- "secure by default" — nothing in `public` is reachable by the API roles
-- unless a migration grants it.
--   * tables: an explicit `grant` to `authenticated` (or `anon`) beside the
--     policies that make it meaningful; RLS on every table.
--   * functions: `revoke all ... from public, anon` right after the
--     definition, then an explicit `grant execute` to the roles that may call
--     it. PostgreSQL grants EXECUTE to PUBLIC by default, which is why the
--     revoke is never optional.
--   * the service role is the trusted backend and receives everything through
--     the default privileges below.
-- packages/db/tests/0012_grants_catalog_scan.test.sql fails when a table or
-- function becomes reachable by `anon` without being on its allowlist.
-- ============================================================

grant usage on schema public to anon, authenticated, service_role;

-- Older Supabase projects grant every new table, sequence and function to
-- anon and authenticated by default. Revoke that explicitly, so a project of
-- either generation ends up with the same model: column-level grants only
-- protect anything when the API roles hold no table-level privilege. New
-- functions are not executable by PUBLIC either.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public;

alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

-- Case-insensitive text, for e-mail addresses (invitations, the waitlist).
create extension if not exists citext with schema extensions;

-- ---------- Languages ----------

/**
 * The languages the platform is written in. ONE is written in Portuguese
 * only. This is the one place the database says so: every `locale` check and
 * i18n_ok() read it, so a second language is one `create or replace` here,
 * beside the same change in the app (`LOCALES`, apps/web/src/constants.ts).
 */
create or replace function public.supported_locales()
returns text[]
language sql
immutable
as $$
  select array['pt-BR']::text[];
$$;

revoke all on function public.supported_locales() from public;
grant execute on function public.supported_locales() to anon, authenticated;

-- ---------- Enums ----------

-- What a person may do to the firm account.
create type public.org_role as enum ('owner', 'admin', 'member');

-- What a person does in the firm. The words are the firms' own.
create type public.firm_function as enum ('socio', 'advogado', 'controladoria', 'atendimento');

-- ---------- Tables ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  is_superadmin boolean not null default false,
  locale text not null default 'pt-BR',
  timezone text not null default 'America/Sao_Paulo',
  marketing_email_opt_out boolean not null default false,
  email_unsubscribe_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_locale_check check (locale = any (public.supported_locales())),
  constraint profiles_display_name_length check (display_name is null or char_length(display_name) <= 120)
);

create unique index profiles_email_unsubscribe_token_idx on public.profiles (email_unsubscribe_token);

comment on column public.profiles.is_superadmin is
  'The platform operator. Changed only by set_user_superadmin (0001), never by the person.';
comment on column public.profiles.marketing_email_opt_out is
  'Stops the news. Transactional e-mail (receipts, notices about the account) is not affected.';

-- The firm.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid references public.profiles (id) on delete set null,
  -- Brazilian billing profile, required by Asaas to issue a charge (and the
  -- NFS-e). Digits only.
  billing_cpf_cnpj text,
  billing_postal_code text,
  billing_address_number text,
  billing_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_length check (char_length(btrim(name)) between 2 and 120),
  constraint organizations_billing_cpf_cnpj_check
    check (billing_cpf_cnpj is null or billing_cpf_cnpj ~ '^([0-9]{11}|[0-9]{14})$'),
  constraint organizations_billing_postal_code_check
    check (billing_postal_code is null or billing_postal_code ~ '^[0-9]{8}$'),
  constraint organizations_billing_phone_check
    check (billing_phone is null or billing_phone ~ '^[0-9]{10,11}$')
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.org_role not null default 'member',
  firm_function public.firm_function not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- A person belongs to ONE firm at a time. It is a product rule of the first
-- year, not a limit of the model: every policy and every RPC already takes the
-- firm, so lifting it is dropping this index and giving the app a way to pick
-- the firm it is looking at.
create unique index memberships_one_firm_per_person_idx on public.memberships (user_id);
create index memberships_org_idx on public.memberships (org_id);
-- A firm has exactly one owner. Ownership moves through transfer_firm_ownership.
create unique index memberships_one_owner_idx on public.memberships (org_id) where role = 'owner';

comment on column public.memberships.role is
  'What the person may do to the firm account: the owner and the admins manage the team, the plan and the billing profile.';
comment on column public.memberships.firm_function is
  'What the person does in the firm. It decides what the product shows them and what they may approve.';

-- ---------- Helper functions (security definer, used by policies) ----------

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;

create or replace function public.has_org_role(target_org uuid, roles public.org_role[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid() and m.role = any (roles)
  );
$$;

revoke all on function public.has_org_role(uuid, public.org_role[]) from public, anon;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;

create or replace function public.has_firm_function(target_org uuid, functions public.firm_function[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid() and m.firm_function = any (functions)
  );
$$;

revoke all on function public.has_firm_function(uuid, public.firm_function[]) from public, anon;
grant execute on function public.has_firm_function(uuid, public.firm_function[]) to authenticated;

-- Whether the caller and another person are in the same firm: what lets a
-- colleague's registration at the bar be read (0003).
create or replace function public.shares_firm_with(target_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.org_id = mine.org_id
    where mine.user_id = auth.uid() and theirs.user_id = target_user
  );
$$;

revoke all on function public.shares_firm_with(uuid) from public, anon;
grant execute on function public.shares_firm_with(uuid) to authenticated;

create or replace function public.is_superadmin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select p.is_superadmin from public.profiles p where p.id = auth.uid()), false);
$$;

revoke all on function public.is_superadmin() from public, anon;
grant execute on function public.is_superadmin() to authenticated;

-- The firm the caller belongs to, or NULL for an account that has founded or
-- joined none yet. A convenience for what is about the PERSON (a consent, a
-- preference): anything that reads or writes a firm's data takes the firm as
-- an argument and checks membership, never this.
create or replace function public.current_org_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select m.org_id
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at asc, m.id asc
  limit 1;
$$;

revoke all on function public.current_org_id() from public, anon;
grant execute on function public.current_org_id() to authenticated;

/**
 * Whether this session passed the second factor. Functions that change who
 * has access to a firm, or that approve something in its name, call
 * require_aal2() first: a stolen password alone must not be enough for them.
 * A session with no JWT (service role, migration, psql) is not a person and
 * is not asked.
 */
create or replace function public.is_aal2()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

revoke all on function public.is_aal2() from public, anon;
grant execute on function public.is_aal2() to authenticated;

create or replace function public.require_aal2()
returns void
language plpgsql
stable
as $$
begin
  if auth.uid() is not null and not public.is_aal2() then
    raise exception 'second_factor_required'
      using errcode = '42501',
            hint = 'Confirm the second factor (2FA) and try again.';
  end if;
end;
$$;

revoke all on function public.require_aal2() from public, anon;
grant execute on function public.require_aal2() to authenticated;

create or replace function public.slugify(value text)
returns text
language sql
immutable
strict
set search_path = public
as $$
  -- lower() runs first, so only lower-case accents need mapping. The two
  -- translate() arguments MUST stay the same length (79 chars): a mismatch
  -- silently shifts every mapping after the offending character.
  select trim(
    both '-' from
    regexp_replace(
      translate(
        lower(value),
        'áàâãäåāăąçćčĉċďđéèêëēĕėęěğĝġģíìîïĩīĭįıĺľłļñńňņóòôõöøōŏőŕřšśşŝťţúùûüũūŭůűųýÿŷžźż',
        'aaaaaaaaacccccddeeeeeeeeeggggiiiiiiiiillllnnnnooooooooorrssssttuuuuuuuuuuyyyzzz'
      ),
      '[^a-z0-9]+', '-', 'g'
    )
  );
$$;

comment on function public.slugify(text) is
  'Accent-aware slug: transliterates Latin letters before collapsing separators. Used for firm slugs.';

revoke all on function public.slugify(text) from public, anon;
grant execute on function public.slugify(text) to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon;

create or replace function public.validate_profile_timezone()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.timezone := nullif(btrim(new.timezone), '');
  if new.timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception using errcode = '22023', message = 'invalid_timezone';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_profile_timezone() from public, anon;

-- ---------- Guards ----------

/**
 * `profiles.is_superadmin` is the platform-operator flag. The column grants
 * below already keep a person from writing it, and this trigger is the second
 * fence: it keys on WHO is asking (is_superadmin() reads the database, which
 * PostgREST cannot forge), so a future policy or grant change cannot quietly
 * reopen self-promotion.
 *
 * A session with no JWT (service role, migration, psql) passes: that is how
 * the FIRST superadmin is made, and the only way back in if the set is ever
 * emptied.
 */
create or replace function public.guard_superadmin_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `before update of is_superadmin` fires whenever the column is MENTIONED,
  -- so a write that merely carries the same value is not a change.
  if new.is_superadmin is not distinct from old.is_superadmin then
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if not public.is_superadmin() then
    raise exception 'superadmin_not_self_assignable'
      using errcode = '42501',
            hint = 'Only a platform superadmin can grant this role.';
  end if;

  if new.id = auth.uid() then
    raise exception 'superadmin_self_change_forbidden'
      using errcode = '42501',
            hint = 'Ask another superadmin: removing your own role could leave the platform with no operator.';
  end if;

  return new;
end;
$$;

comment on function public.guard_superadmin_flag() is
  'Refuses any change to profiles.is_superadmin that does not come from an existing superadmin acting on somebody else (or from a session with no JWT: service role, migration, psql).';

revoke all on function public.guard_superadmin_flag() from public, anon;

/**
 * A firm is never deleted by a direct write. Deleting one erases its cases,
 * its purchases and their change history, and leaves stored files behind
 * unless the audited path cleans them: that path is admin_delete_account
 * (0013), which runs as a superadmin outside a support visit. There is
 * deliberately no DELETE policy on organizations either; this trigger stands
 * behind the missing policy, because a policy is one careless migration away
 * from coming back.
 */
create or replace function public.guard_organization_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No JWT at all: the service role, a migration, psql.
  if auth.uid() is null then
    return old;
  end if;

  if public.is_superadmin() and not public.is_impersonated() then
    return old;
  end if;

  raise exception 'firm_delete_not_self_service'
    using errcode = '42501',
          hint = 'Deleting a firm also erases its data and change history. That runs through the audited path in the platform console (admin_delete_account), never through a direct write.';
end;
$$;

comment on function public.guard_organization_delete() is
  'Refuses any firm deletion that is not the audited path: a session with no JWT (service role/migration) or a superadmin outside a support visit.';

revoke all on function public.guard_organization_delete() from public, anon;

-- ---------- Row Level Security ----------

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy "profiles_select_superadmin" on public.profiles
  for select to authenticated
  using (public.is_superadmin());

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- A person edits the name and the avatar directly. The timezone goes through
-- update_member_profile (0001), which audits it; is_superadmin goes through
-- set_user_superadmin. The column list is the fence.
--
-- A colleague's row is NOT readable here on purpose: the row also carries the
-- operator flag and the unsubscribe token. Colleagues read each other through
-- firm_team() (0003), which returns only what a roster shows.
grant select on table public.profiles to authenticated;
grant update (display_name, avatar_url) on table public.profiles to authenticated;

create policy "organizations_select_member" on public.organizations
  for select to authenticated
  using (public.is_org_member(id));

create policy "organizations_select_superadmin" on public.organizations
  for select to authenticated
  using (public.is_superadmin());

-- Read-only for the API roles. A firm is created by create_firm and renamed
-- by rename_firm (0003), and its billing profile goes through
-- update_billing_profile (0004): each one checks who is asking and leaves an
-- audit event, which a direct write would not.
grant select on table public.organizations to authenticated;

create policy "memberships_select_member" on public.memberships
  for select to authenticated
  using (public.is_org_member(org_id));

create policy "memberships_select_superadmin" on public.memberships
  for select to authenticated
  using (public.is_superadmin());

-- Read-only for the API roles: who belongs to a firm, with which role and
-- function, changes only through the audited functions of 0003. A person able
-- to insert a membership could put themself inside any firm.
grant select on table public.memberships to authenticated;

-- ---------- Sign-up bootstrap ----------

/**
 * Creates the profile of every new auth user, e-mail or OAuth alike. It
 * creates no firm: a new account either founds one or accepts an invitation
 * (0003), and until then it belongs to none.
 *
 * Metadata read (all optional): display_name (or the provider's full_name /
 * name) and avatar_url (or picture). Anything else is ignored rather than
 * failing the sign-up.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(
      coalesce(
        nullif(btrim(meta ->> 'display_name'), ''),
        nullif(btrim(meta ->> 'full_name'), ''),
        nullif(btrim(meta ->> 'name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'Pessoa'
      ),
      120
    ),
    coalesce(nullif(meta ->> 'avatar_url', ''), nullif(meta ->> 'picture', ''))
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Triggers ----------

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger profiles_validate_timezone
  before insert or update of timezone on public.profiles
  for each row execute function public.validate_profile_timezone();

create trigger guard_superadmin_flag
  before update of is_superadmin on public.profiles
  for each row execute function public.guard_superadmin_flag();

create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create trigger memberships_updated_at
  before update on public.memberships
  for each row execute function public.set_updated_at();

create trigger guard_organization_delete
  before delete on public.organizations
  for each row execute function public.guard_organization_delete();
