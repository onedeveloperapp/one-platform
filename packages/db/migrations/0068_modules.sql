-- ============================================================
-- 0068_modules: the product modules of ONE, the ones each firm uses, and
-- the module every case is of.
--
-- The owner decided on 2026-10-29 that Direito do Passageiro is one module
-- of ONE among the ones to come, separated from the core, with an area of
-- its own for the travel agency a firm partners with. This is the first
-- step: the platform knows its modules as data.
--
--   product_modules  the modules ONE has, by key, with the ones every new
--                    firm is given. Seeded with `direito-do-passageiro`.
--                    Not the inherited `modules` of the billing ladder
--                    (0004), which are priced add-ons of a subscription:
--                    ONE's own billing (M3) decides how a module is sold.
--   firm_modules     which modules each firm uses: every firm that exists
--                    takes the passenger module, and a firm founded from
--                    now on takes the default ones by a trigger. The
--                    operator gives or takes one (`admin_set_firm_module`,
--                    on the record).
--   cases.module     the module a case is of. Every case so far is a
--                    passenger's; the passenger's own columns (the kind of
--                    problem, the airline, the day of the flight) stay where
--                    they are, and the kind of problem is now required of a
--                    passenger case only, so that a case of another module
--                    fits the same table.
--
-- `firm_uses_module` is what the functions of a module ask before they act
-- for a firm (the partners of 0069 first); `firm_has_module` is the same
-- answer for the firm's own screens.
-- ============================================================

-- ---------- The modules ----------

create table public.product_modules (
  key text primary key,
  name text not null,
  -- Given to every firm founded from now on.
  is_default boolean not null default false,
  -- A module no longer offered: no firm is given it any more, and the firms
  -- that have it keep what they made with it.
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  constraint product_modules_key_check check (key ~ '^[a-z][a-z0-9-]{2,40}$'),
  constraint product_modules_name_check check (char_length(btrim(name)) between 2 and 80 and name !~ '[[:cntrl:]]')
);

alter table public.product_modules enable row level security;

-- What modules ONE has is no secret: every screen that names one reads it.
create policy "product_modules_select_all" on public.product_modules
  for select to authenticated using (true);

grant select on table public.product_modules to authenticated;

insert into public.product_modules (key, name, is_default) values
  ('direito-do-passageiro', 'Direito do Passageiro', true)
on conflict (key) do nothing;

-- ---------- The modules of each firm ----------

create table public.firm_modules (
  org_id uuid not null references public.organizations (id) on delete cascade,
  module_key text not null references public.product_modules (key) on delete restrict,
  enabled_at timestamptz not null default now(),
  -- Null when the platform gave it (a firm's founding, this migration).
  enabled_by uuid references public.profiles (id) on delete set null,
  primary key (org_id, module_key)
);

alter table public.firm_modules enable row level security;

create policy "firm_modules_select_member" on public.firm_modules
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

grant select on table public.firm_modules to authenticated;

create trigger guard_impersonation_firm_modules after insert or update or delete on public.firm_modules
  for each statement execute function public.guard_impersonation_readonly();

-- Every firm that exists works with the passenger module today.
insert into public.firm_modules (org_id, module_key)
select o.id, 'direito-do-passageiro' from public.organizations o
on conflict do nothing;

/** A firm founded takes the modules every new firm is given. */
create or replace function public.organizations_default_modules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.firm_modules (org_id, module_key)
  select new.id, m.key from public.product_modules m where m.is_default and m.retired_at is null
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.organizations_default_modules() from public, anon, authenticated;

create trigger organizations_default_modules after insert on public.organizations
  for each row execute function public.organizations_default_modules();

/**
 * Whether the firm uses the module, for the functions of a module to ask
 * before they act for it, whoever calls them (a partner of the firm too). A
 * module retired is used by nobody. Internal.
 */
create or replace function public.firm_uses_module(target_org uuid, target_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.firm_modules fm
    join public.product_modules m on m.key = fm.module_key
    where fm.org_id = target_org and fm.module_key = target_module and m.retired_at is null
  );
$$;

revoke all on function public.firm_uses_module(uuid, text) from public, anon, authenticated;

/** The same answer for a screen: to the firm's own people and the platform operator; false to anybody else. */
create or replace function public.firm_has_module(target_org uuid, target_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (public.is_org_member(target_org) or public.is_superadmin())
    and public.firm_uses_module(target_org, target_module);
$$;

revoke all on function public.firm_has_module(uuid, text) from public, anon;
grant execute on function public.firm_has_module(uuid, text) to authenticated;

/**
 * The platform operator gives a module to a firm or takes it away, with the
 * second factor and a note, on the record. Taking a module away keeps what
 * the firm made with it (its cases stay); what the module does from then on
 * for the firm stops (a partner of that module, 0069, stops being able to add
 * anything).
 */
create or replace function public.admin_set_firm_module(
  target_org uuid,
  target_module text,
  target_enabled boolean,
  target_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  note text := nullif(regexp_replace(btrim(coalesce(target_note, '')), '\s+', ' ', 'g'), '');
  module public.product_modules%rowtype;
  had boolean;
begin
  if caller is null or not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if note is null or char_length(note) < 8 or char_length(note) > 500 or note ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'code', 'note_required');
  end if;
  if target_enabled is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if not exists (select 1 from public.organizations o where o.id = target_org) then
    return jsonb_build_object('ok', false, 'code', 'firm_not_found');
  end if;
  select * into module from public.product_modules where key = target_module;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'module_not_found');
  end if;
  if target_enabled and module.retired_at is not null then
    return jsonb_build_object('ok', false, 'code', 'module_retired');
  end if;

  had := exists (select 1 from public.firm_modules fm where fm.org_id = target_org and fm.module_key = module.key);
  if had = target_enabled then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  if target_enabled then
    insert into public.firm_modules (org_id, module_key, enabled_by) values (target_org, module.key, caller);
  else
    delete from public.firm_modules where org_id = target_org and module_key = module.key;
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, case when target_enabled then 'module.enabled' else 'module.disabled' end,
          'organization', target_org::text, jsonb_build_object('module', module.key, 'note', note));
  return jsonb_build_object('ok', true, 'code', case when target_enabled then 'enabled' else 'disabled' end);
end;
$$;

revoke all on function public.admin_set_firm_module(uuid, text, boolean, text) from public, anon;
grant execute on function public.admin_set_firm_module(uuid, text, boolean, text) to authenticated;

-- ---------- The module of each case ----------

alter table public.cases add column module text not null default 'direito-do-passageiro'
  references public.product_modules (key) on delete restrict;

-- The kind of problem is the passenger module's: required of a passenger case, and of no other.
alter table public.cases alter column incident drop not null;
alter table public.cases add constraint cases_module_incident_check
  check ((module = 'direito-do-passageiro') = (incident is not null));

create index cases_module_idx on public.cases (org_id, module);
