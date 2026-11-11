-- ============================================================
-- The competent unit before the piece (0179), item 3.4 of the case journey
-- plan. 0145 gave each planned lawsuit the comarca of the client's city; the
-- unit that judges it (the "juízo") was only what a person wrote, and the
-- piece addressed "Juizado Especial Cível da Comarca de X" when nobody had.
-- Now each comarca has its units as data (`court_units`, the platform's, read
-- by any account): who they are, how a lawsuit reaches them (`scope`:
-- `comarca`, distributed by lottery among the comarca's units of that
-- competence, CPC art. 285, so the petition is addressed to them all; `unit`,
-- one unit alone), the act it was read in, whether the operator confirmed it,
-- and its profile: whether it asks a complaint before the lawsuit
-- (`prior_complaint`, written by the operator until the jurimetry of phase 5
-- reads it, with the decisions it was read in), which item 3.5 reads. A
-- planned lawsuit takes the unit of its court, comarca and kind
-- (`proceedings_unit`), named by ONE (`unit_by_one`), which the piece's
-- `[[JUIZO]]` writes; a unit a person wrote stays theirs. Nothing here chooses
-- a judge: a comarca of several units is addressed to all of them.
--
-- Seeded with the TJGO: one row per comarca and kind, addressed to the
-- comarca's units (the comarcas of the compiled Lei estadual 16.435/2008,
-- 0145), unconfirmed until the operator reads the court's acts.
-- ============================================================

create table public.court_units (
  id uuid primary key default gen_random_uuid(),
  court text not null,
  comarca text not null,
  kind text not null,
  -- How the petition addresses it: "Juizado Especial Cível da Comarca de Goiânia".
  name text not null,
  scope text not null default 'comarca',
  source_url text not null,
  read_on date not null,
  confirmed boolean not null default false,
  -- The unit's profile (item 3.5): null while nobody read it.
  prior_complaint text,
  profile_note text,
  profile_sources jsonb not null default '[]'::jsonb,
  profile_by uuid references public.profiles (id) on delete set null,
  profile_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint court_units_kind_check check (kind in ('juizado', 'comum')),
  constraint court_units_scope_check check (scope in ('comarca', 'unit')),
  constraint court_units_names_check check (
    char_length(comarca) between 2 and 120 and char_length(name) between 5 and 200 and name !~ '[[:cntrl:]]'
  ),
  constraint court_units_source_check check (source_url like 'https://%' and char_length(source_url) <= 500),
  constraint court_units_prior_check check (prior_complaint is null or prior_complaint in ('required', 'not_required')),
  constraint court_units_note_check check (coalesce(char_length(profile_note), 0) <= 2000),
  constraint court_units_sources_check check (jsonb_typeof(profile_sources) = 'array')
);

create unique index court_units_name_idx on public.court_units (court, (public.slugify(comarca)), kind, (public.slugify(name)));
create unique index court_units_comarca_idx on public.court_units (court, (public.slugify(comarca)), kind)
  where scope = 'comarca';

alter table public.court_units enable row level security;
create policy "court_units_select_member" on public.court_units for select to authenticated using (true);
grant select on table public.court_units to authenticated;
create trigger court_units_updated_at before update on public.court_units
  for each row execute function public.set_updated_at();

insert into public.court_units (court, comarca, kind, name, scope, source_url, read_on)
select c.court, c.comarca, k.kind,
  case k.kind when 'juizado' then 'Juizado Especial Cível' else 'Vara Cível' end || ' da Comarca de ' || c.comarca,
  'comarca', min(c.source_url), date '2026-11-10'
from public.court_comarcas c
cross join (values ('juizado'), ('comum')) as k (kind)
where c.court = 'TJGO'
group by c.court, c.comarca, k.kind
on conflict do nothing;

-- Each lawsuit says the unit ONE named for it.
alter table public.proceedings add column unit_id uuid references public.court_units (id) on delete set null;
alter table public.proceedings add column unit_by_one boolean not null default false;

/** The unit of a court, comarca and kind a lawsuit is addressed to by the table, or null. Internal. */
create or replace function public.court_unit_for(target_court text, target_comarca text, target_kind text)
returns public.court_units
language sql
stable
security definer
set search_path = public
as $$
  select u.* from public.court_units u
  where u.court = target_court and public.slugify(u.comarca) = public.slugify(target_comarca)
    and u.kind = target_kind and u.scope = 'comarca'
  limit 1;
$$;

revoke all on function public.court_unit_for(text, text, text) from public, anon, authenticated;

/**
 * A planned lawsuit takes the unit of its court, comarca and kind (named by ONE), after its comarca was settled
 * (`proceedings_comarca` runs first, by name); a unit a person wrote stays theirs, joined to the table when its
 * words are a unit's there. A lawsuit the court has keeps what it was recorded with.
 */
create or replace function public.proceedings_unit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  found_unit public.court_units%rowtype;
  written text := nullif(btrim(coalesce(new.unit, '')), '');
begin
  if new.status <> 'planned' then
    return new;
  end if;
  if written is not null and (tg_op = 'INSERT' or new.unit is distinct from old.unit) then
    -- A person wrote it; or the operator renamed the unit ONE had named, which stays ONE's.
    select u.* into found_unit from public.court_units u
    where u.court = new.court and public.slugify(u.name) = public.slugify(written) limit 1;
    new.unit_by_one := tg_op = 'UPDATE' and old.unit_by_one and found_unit.id is not distinct from old.unit_id
      and found_unit.id is not null;
    new.unit_id := found_unit.id;
    return new;
  end if;
  if written is not null and not new.unit_by_one then
    return new;
  end if;
  found_unit := public.court_unit_for(new.court, new.comarca, new.kind);
  if found_unit.id is not null then
    new.unit := found_unit.name;
    new.unit_id := found_unit.id;
    new.unit_by_one := true;
  elsif new.unit_by_one then
    new.unit := null;
    new.unit_id := null;
  end if;
  return new;
end;
$$;

revoke all on function public.proceedings_unit() from public, anon, authenticated;

create trigger proceedings_unit before insert or update of comarca, forum_city, court, kind, status, unit
  on public.proceedings for each row execute function public.proceedings_unit();

-- The lawsuits still planned take their unit now.
update public.proceedings set unit = unit where status = 'planned';

/**
 * The operator writes a unit, or its profile (item 3.5: whether it asks a complaint before the lawsuit, with what it
 * was read in); the planned lawsuits ONE addressed to it take its new name. Never a support visit.
 */
create or replace function public.admin_save_court_unit(target_unit uuid, target_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  fields jsonb := coalesce(target_fields, '{}'::jsonb);
  unit_row public.court_units%rowtype;
  court_code text := upper(btrim(coalesce(fields ->> 'court', '')));
  prior text := nullif(btrim(coalesce(fields ->> 'prior_complaint', '')), '');
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if prior is not null and prior not in ('required', 'not_required') then
    return jsonb_build_object('ok', false, 'code', 'invalid_profile');
  end if;
  begin
    if target_unit is null then
      if not exists (select 1 from public.courts c where c.acronym = court_code) then
        return jsonb_build_object('ok', false, 'code', 'unknown_court');
      end if;
      insert into public.court_units (court, comarca, kind, name, scope, source_url, read_on, confirmed,
                                      prior_complaint, profile_note, profile_sources, profile_by, profile_at)
      values (court_code, btrim(coalesce(fields ->> 'comarca', '')), fields ->> 'kind', btrim(coalesce(fields ->> 'name', '')),
              coalesce(fields ->> 'scope', 'comarca'), btrim(coalesce(fields ->> 'source_url', '')),
              coalesce((fields ->> 'read_on')::date, (now() at time zone 'America/Sao_Paulo')::date),
              coalesce((fields ->> 'confirmed')::boolean, false), prior,
              nullif(btrim(coalesce(fields ->> 'profile_note', '')), ''), coalesce(fields -> 'profile_sources', '[]'::jsonb),
              case when prior is not null then caller end, case when prior is not null then now() end)
      returning * into unit_row;
    else
      select * into unit_row from public.court_units where id = target_unit for update;
      if not found then
        return jsonb_build_object('ok', false, 'code', 'not_found');
      end if;
      update public.court_units set
        name = coalesce(nullif(btrim(coalesce(fields ->> 'name', '')), ''), name),
        source_url = coalesce(nullif(btrim(coalesce(fields ->> 'source_url', '')), ''), source_url),
        read_on = coalesce((fields ->> 'read_on')::date, read_on),
        confirmed = coalesce((fields ->> 'confirmed')::boolean, confirmed),
        prior_complaint = case when fields ? 'prior_complaint' then prior else prior_complaint end,
        profile_note = case when fields ? 'profile_note' then nullif(btrim(coalesce(fields ->> 'profile_note', '')), '')
                            else profile_note end,
        profile_sources = case when fields ? 'profile_sources' then coalesce(fields -> 'profile_sources', '[]'::jsonb)
                               else profile_sources end,
        profile_by = case when fields ? 'prior_complaint' then caller else profile_by end,
        profile_at = case when fields ? 'prior_complaint' then now() else profile_at end
      where id = unit_row.id
      returning * into unit_row;
    end if;
  exception
    when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format then
      return jsonb_build_object('ok', false, 'code', 'invalid_data');
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'unit_exists');
  end;
  update public.proceedings set unit = unit_row.name
  where unit_id = unit_row.id and unit_by_one and status = 'planned' and unit is distinct from unit_row.name;
  -- What the unit asks may change what ONE waits for in the cases of its planned lawsuits.
  perform public.wake_case_advance(p.case_id)
  from public.proceedings p where p.unit_id = unit_row.id and p.status = 'planned';
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'court_unit.saved', 'court_unit', unit_row.id::text, jsonb_build_object('court', unit_row.court, 'comarca', unit_row.comarca, 'kind', unit_row.kind,
                       'prior_complaint', unit_row.prior_complaint, 'confirmed', unit_row.confirmed));
  return jsonb_build_object('ok', true, 'code', 'saved', 'unit_id', unit_row.id);
end;
$$;

revoke all on function public.admin_save_court_unit(uuid, jsonb) from public, anon;
grant execute on function public.admin_save_court_unit(uuid, jsonb) to authenticated;
