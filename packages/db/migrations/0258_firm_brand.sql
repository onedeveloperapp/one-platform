-- ============================================================
-- 0258_firm_brand: the firm's logo and its main colour (the owner, 2026-11-20).
--
-- The second phase of the plan "o escritório preparado antes do primeiro atendimento", first part. The firm sends
-- the logo it already uses (a PNG, a JPEG, a WebP or an SVG) in the setup's step "O escritório"; ONE keeps it as a PNG
-- that fits 800 by 400 with its ground see-through, and reads its main colour by a rule (`marca-v1` of
-- `@flyee/documents/brand`); the person confirms the colour or chooses another. The logo and the colour go on what a
-- client sees (later parts of the phase); the logged area keeps ONE's own palette (rule 9).
--
--   * Files of the purpose `brand`: what the firm sends of its brand (the logo now; the letterhead, a Word file or a
--     PDF of a blank page, in the next part), and what ONE makes of it.
--   * `firm_brands`: the firm's logo (as sent and as kept, with its size) and its colour, with where the colour came
--     from (the logo, or a person).
--   * `set_firm_logo` and `set_firm_color`: who manages the firm, with the second factor, on the record; a logo's
--     files must be the firm's own, of the purpose `brand`, kept by the backend.
--   * `firm_setup_facts` gains `brand`: the firm gave its logo.
-- ============================================================

-- ---------- The files of the brand ----------

update public.platform_settings
set value = jsonb_set(value, '{purposes,brand}', jsonb_build_object(
  'people', true,
  'max_bytes', 15728640,
  'mimes', jsonb_build_array(
    'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
))
where key = 'files' and not (value -> 'purposes') ? 'brand';

-- ---------- The firm's brand ----------

create table public.firm_brands (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- The logo as the firm sent it, and as ONE keeps it: a PNG that fits 800 x 400, its ground see-through.
  logo_source_file_id uuid references public.files (id) on delete set null,
  logo_file_id uuid references public.files (id) on delete set null,
  logo_width integer,
  logo_height integer,
  -- The colour the rule read of the logo, kept for when a person gives the choice back to it.
  logo_color text,
  -- The main colour, `#rrggbb`: read from the logo by the rule, or chosen by a person.
  color text,
  color_from text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint firm_brands_color_check check (
    (color is null or color ~ '^#[0-9a-f]{6}$') and (logo_color is null or logo_color ~ '^#[0-9a-f]{6}$')
  ),
  constraint firm_brands_color_from_check check (
    (color is null) = (color_from is null) and (color_from is null or color_from in ('logo', 'person'))
  ),
  constraint firm_brands_logo_size_check check (
    (logo_file_id is null) = (logo_width is null) and (logo_width is null) = (logo_height is null)
    and (logo_width is null or (logo_width between 1 and 800 and logo_height between 1 and 400))
  )
);

alter table public.firm_brands enable row level security;

create policy "firm_brands_select_member" on public.firm_brands
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

grant select on table public.firm_brands to authenticated;

create trigger guard_impersonation_firm_brands after insert or update or delete on public.firm_brands
  for each statement execute function public.guard_impersonation_readonly();

/** Who manages the firm may change its brand: never a support visit, always with the second factor. Internal. */
create or replace function public.firm_brand_guard(target_org uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
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
  return caller;
end;
$$;

revoke all on function public.firm_brand_guard(uuid) from public, anon, authenticated;

/**
 * The firm's logo: the file it sent and the PNG ONE made of it (both the firm's, of the purpose `brand`, the PNG kept
 * by the backend), its size, and the colour the rule read of it, or none. A colour a person chose stays.
 */
create or replace function public.set_firm_logo(
  target_org uuid,
  target_source_file uuid,
  target_logo_file uuid,
  target_width integer,
  target_height integer,
  target_color text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.firm_brand_guard(target_org);
  color_read text := lower(nullif(btrim(coalesce(target_color, '')), ''));
begin
  if not exists (
    select 1 from public.files f
    where f.id = target_source_file and f.org_id = target_org and f.purpose = 'brand'
  ) or not exists (
    select 1 from public.files f
    where f.id = target_logo_file and f.org_id = target_org and f.purpose = 'brand' and f.status = 'stored'
  ) then
    return jsonb_build_object('ok', false, 'code', 'file_not_found');
  end if;
  if color_read is not null and color_read !~ '^#[0-9a-f]{6}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_color');
  end if;
  if target_width is null or target_height is null or target_width not between 1 and 800
     or target_height not between 1 and 400 then
    return jsonb_build_object('ok', false, 'code', 'invalid_logo');
  end if;

  insert into public.firm_brands as b (
    org_id, logo_source_file_id, logo_file_id, logo_width, logo_height, logo_color, color, color_from, updated_by,
    updated_at
  ) values (
    target_org, target_source_file, target_logo_file, target_width, target_height, color_read, color_read,
    case when color_read is null then null else 'logo' end, caller, now()
  )
  on conflict (org_id) do update set
    logo_source_file_id = excluded.logo_source_file_id,
    logo_file_id = excluded.logo_file_id,
    logo_width = excluded.logo_width,
    logo_height = excluded.logo_height,
    logo_color = excluded.logo_color,
    -- A colour a person chose stays; the logo's colour follows the logo.
    color = case when b.color_from = 'person' then b.color else excluded.color end,
    color_from = case when b.color_from = 'person' then b.color_from else excluded.color_from end,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'firm.logo_set', 'organization', target_org::text,
          jsonb_strip_nulls(jsonb_build_object('file', target_logo_file, 'color', color_read)));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_firm_logo(uuid, uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.set_firm_logo(uuid, uuid, uuid, integer, integer, text) to authenticated;

/** The firm's colour, chosen by a person; null gives the choice back to the logo's colour, if the rule read one. */
create or replace function public.set_firm_color(target_org uuid, target_color text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.firm_brand_guard(target_org);
  chosen text := lower(nullif(btrim(coalesce(target_color, '')), ''));
begin
  if chosen is not null and chosen !~ '^#[0-9a-f]{6}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_color');
  end if;
  insert into public.firm_brands as b (org_id, color, color_from, updated_by, updated_at)
  values (target_org, chosen, case when chosen is null then null else 'person' end, caller, now())
  on conflict (org_id) do update set
    color = coalesce(excluded.color, b.logo_color),
    color_from = case when excluded.color is not null then 'person' when b.logo_color is not null then 'logo' end,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'firm.color_set', 'organization', target_org::text,
          jsonb_build_object('color', chosen));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_firm_color(uuid, text) from public, anon;
grant execute on function public.set_firm_color(uuid, text) to authenticated;

-- ---------- The setup's facts ----------

/**
 * What the setup list of a firm reads: each a fact of the data, never a box
 * somebody ticked. `oab_signer` is a registration at the bar together with
 * somebody chosen to sign what ONE prepares; `claim_defaults` is a claim the
 * firm asks by default for some kind of problem; `team` is read only where
 * the firm did not say it works alone; `channel` is a way to the clients;
 * `operation` is how the firm works, said, and `areas` an area it works in
 * (0256); `brand` is the firm's logo, given (0258).
 */
create or replace function public.firm_setup_facts(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  has_oab boolean;
  has_signer boolean;
  org public.organizations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into org from public.organizations o where o.id = target_org;
  has_oab := exists (
    select 1 from public.oab_registrations r
    join public.memberships m on m.user_id = r.user_id
    where m.org_id = target_org
  );
  has_signer := exists (select 1 from public.firm_signers s where s.org_id = target_org);

  return jsonb_build_object(
    'firm_document', org.billing_cpf_cnpj is not null,
    'oab', has_oab,
    'signer', has_signer,
    'oab_signer', has_oab and has_signer,
    'claim_defaults', exists (select 1 from public.firm_claim_defaults d where d.org_id = target_org),
    'team', (select count(*) from public.memberships m where m.org_id = target_org) > 1
      or exists (
        select 1 from public.firm_invitations i
        where i.org_id = target_org and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
      ),
    'works_alone', coalesce(org.works_alone, false),
    'whatsapp', exists (select 1 from public.wa_numbers n where n.org_id = target_org and n.status = 'active'),
    'channel', exists (select 1 from public.wa_numbers n where n.org_id = target_org and n.status = 'active'),
    'first_case', exists (select 1 from public.cases c where c.org_id = target_org),
    'setup_answered', org.setup_answered_at is not null,
    'operation', org.operation_answered_at is not null,
    'areas', exists (select 1 from public.firm_areas a where a.org_id = target_org and a.removed_at is null),
    'brand', exists (select 1 from public.firm_brands b where b.org_id = target_org and b.logo_file_id is not null)
  );
end;
$$;

revoke all on function public.firm_setup_facts(uuid) from public, anon;
grant execute on function public.firm_setup_facts(uuid) to authenticated;
