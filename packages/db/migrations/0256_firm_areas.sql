-- ============================================================
-- 0256_firm_areas: the areas a firm works in, and how it works, before ONE attends for it (the owner, 2026-11-20).
--
-- The plan "o escritório preparado antes do primeiro atendimento", approved by the owner with its seven decisions:
-- a lawsuit of any area becomes a case of an area of the firm, the firm says the areas it works in, and ONE answers
-- a new contact on the firm's WhatsApp only once it knows the firm. This is its first phase, in the database:
--
--   * `law_areas`: the areas of law ONE knows, as data (configuration is data): each with what it covers, in the
--     words the setup shows and the routing of the WhatsApp reads, and the platform's module that serves it.
--   * `firm_areas`: the areas of each firm. An area of law ONE knows, or one the firm names that ONE does not know
--     (built with ONE in a later phase). A module the firm contracted brings its area by itself, now and whenever
--     a firm is given one, and its area stays while the firm uses the module.
--   * `firm_operations` and `organizations.operation_answered_at`: how the firm works, said in the setup's step
--     "A operação" (where it works, how clients arrive, how many a month, its hours, the system it used before, and
--     who does each work, which later decides the tools the panel shows), and the areas with it
--     (`save_firm_operation`, by who manages the firm, with the second factor, on the record). The number of areas
--     is a limit of the plan, as data (`areas_max`, read through `org_entitlements`; none set, none applies).
--   * `organizations.attended_before_operation`: ONE answers a new contact only once the firm said its operation;
--     a firm ONE already attended for (a number of its own connected before this migration: the pilot) goes on being
--     attended, and finds the new step on its home as something to do, with nothing blocked (decision 2).
--   * `firm_attendance`: what the routing of a new contact reads of a firm (the backend's).
--   * `cases.area_id` and `cases.case_type`: each case is of an area of its firm; a case of a module takes its
--     module's area by itself, and every case there is is given its own. The kind of case is the area's (the kind of
--     problem stays the passenger module's, 0068).
--   * `firm_setup_facts` gains `operation` and `areas`.
-- ============================================================

-- ---------- The areas of law ONE knows ----------

create table public.law_areas (
  key text primary key,
  name text not null,
  -- What it covers, as the setup shows it and the routing of a new contact reads it.
  covers text not null,
  -- The platform's module that serves it (0068), when one does.
  module text references public.product_modules (key) on delete restrict,
  position integer not null,
  retired_at timestamptz,
  constraint law_areas_key_check check (key ~ '^[a-z][a-z0-9-]{2,40}$'),
  constraint law_areas_name_check check (char_length(btrim(name)) between 2 and 80 and name !~ '[[:cntrl:]]'),
  constraint law_areas_covers_check check (char_length(btrim(covers)) between 2 and 300 and covers !~ '[[:cntrl:]]')
);

alter table public.law_areas enable row level security;

-- Which areas ONE knows is no secret: the setup of every firm lists them.
create policy "law_areas_select_all" on public.law_areas
  for select to authenticated using (true);

grant select on table public.law_areas to authenticated;

insert into public.law_areas (key, name, covers, module, position) values
  ('passageiro', 'Direito do Passageiro',
   'voo cancelado, atrasado ou mudado, conexão perdida, embarque negado, bagagem extraviada, danificada ou atrasada',
   'direito-do-passageiro', 10),
  ('consumidor', 'Consumidor',
   'bancos, cartões, empréstimos, telefonia, internet, energia, compras, cobrança indevida, nome negativado', null, 20),
  ('civel', 'Cível',
   'contratos, indenizações, cobranças entre pessoas, acidentes, vizinhança', null, 30),
  ('familia', 'Família e sucessões',
   'divórcio, pensão alimentícia, guarda, visitas, união estável, paternidade, inventário, testamento', null, 40),
  ('trabalhista', 'Trabalhista',
   'demissão, verbas rescisórias, horas extras, carteira assinada, acidente de trabalho, assédio no trabalho', null, 50),
  ('previdenciario', 'Previdenciário',
   'aposentadoria, auxílio por incapacidade, BPC, pensão por morte, salário-maternidade, revisão de benefício do INSS',
   null, 60),
  ('saude', 'Saúde',
   'plano de saúde que nega cobertura ou reajusta demais, remédio ou tratamento pelo SUS', null, 70),
  ('imobiliario', 'Imobiliário',
   'aluguel, despejo, compra e venda de imóvel, usucapião, condomínio, posse', null, 80),
  ('criminal', 'Criminal',
   'inquérito, prisão, processo penal, medida protetiva, defesa de quem é acusado ou vítima de crime', null, 90),
  ('tributario', 'Tributário',
   'impostos, execução fiscal, dívida com a Receita, o estado ou o município', null, 100),
  ('empresarial', 'Empresarial',
   'sociedades, contratos entre empresas, recuperação judicial, falência', null, 110),
  ('administrativo', 'Administrativo e servidor público',
   'concurso, servidor público, licitação, multas e atos do poder público', null, 120)
on conflict (key) do nothing;

-- ---------- The areas of each firm ----------

create table public.firm_areas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The area of law ONE knows; null for one the firm named that ONE does not know.
  law_area text references public.law_areas (key) on delete restrict,
  name text not null,
  -- How it came: a module the firm contracted, ONE's proposal from the firm's lawsuits, or a person of the firm.
  source text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- An area taken out keeps its row: its cases go on naming it.
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete set null,
  constraint firm_areas_source_check check (source in ('module', 'xray', 'person')),
  constraint firm_areas_name_check check (char_length(btrim(name)) between 2 and 80 and name !~ '[[:cntrl:]]')
);

create unique index firm_areas_law_area_key on public.firm_areas (org_id, law_area)
  where removed_at is null and law_area is not null;
create unique index firm_areas_name_key on public.firm_areas (org_id, lower(btrim(name)))
  where removed_at is null;
create index firm_areas_org_idx on public.firm_areas (org_id) where removed_at is null;

alter table public.firm_areas enable row level security;

create policy "firm_areas_select_member" on public.firm_areas
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

grant select on table public.firm_areas to authenticated;

create trigger guard_impersonation_firm_areas after insert or update or delete on public.firm_areas
  for each statement execute function public.guard_impersonation_readonly();

-- Every module a firm has brings its area.
insert into public.firm_areas (org_id, law_area, name, source)
select m.org_id, l.key, l.name, 'module'
from public.firm_modules m
join public.law_areas l on l.module = m.module_key and l.retired_at is null
on conflict do nothing;

/** A module given to a firm brings its area, unless the firm already has it. */
create or replace function public.firm_modules_bring_area()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.firm_areas (org_id, law_area, name, source)
  select new.org_id, l.key, l.name, 'module'
  from public.law_areas l
  where l.module = new.module_key and l.retired_at is null
    and not exists (
      select 1 from public.firm_areas a
      where a.org_id = new.org_id and a.law_area = l.key and a.removed_at is null
    );
  return new;
end;
$$;

revoke all on function public.firm_modules_bring_area() from public, anon, authenticated;

create trigger firm_modules_bring_area after insert on public.firm_modules
  for each row execute function public.firm_modules_bring_area();

-- ---------- How the firm works ----------

alter table public.organizations add column operation_answered_at timestamptz;
-- A firm ONE already attended for before the setup asked its operation (the pilot): it goes on being attended.
alter table public.organizations add column attended_before_operation boolean not null default false;

update public.organizations o set attended_before_operation = true
where exists (
  select 1 from public.wa_numbers n where n.org_id = o.id and n.status = 'active' and n.provider <> 'test'
);

create table public.firm_operations (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- The states it works in.
  states text[] not null default '{}',
  -- How its clients arrive.
  channels text[] not null default '{}',
  -- How many new cases a month, by band.
  monthly_cases text,
  -- When the firm attends: from, to, and whether on Saturdays.
  hours_from time,
  hours_to time,
  saturdays boolean not null default false,
  -- The system it used before ONE, which leads to the import of its portfolio.
  previous_system text,
  -- Who does each work: what decides the tools the panel shows (a later phase). Null while not said.
  one_finance boolean,
  partners boolean,
  one_filing boolean,
  controladoria boolean,
  answered_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint firm_operations_states_check check (states <@ array[
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ',
    'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
  ]::text[]),
  constraint firm_operations_channels_check check (channels <@ array[
    'indicacao', 'anuncio', 'agencia', 'carteira', 'outro'
  ]::text[]),
  constraint firm_operations_monthly_check check (
    monthly_cases is null or monthly_cases in ('ate_20', 'ate_100', 'ate_500', 'mais_500')
  ),
  constraint firm_operations_hours_check check (
    (hours_from is null) = (hours_to is null) and (hours_from is null or hours_from < hours_to)
  ),
  constraint firm_operations_system_check check (
    previous_system is null or previous_system in ('nenhum', 'astrea', 'advbox', 'projuris', 'planilha', 'outro')
  )
);

alter table public.firm_operations enable row level security;

create policy "firm_operations_select_member" on public.firm_operations
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

grant select on table public.firm_operations to authenticated;

create trigger guard_impersonation_firm_operations after insert or update or delete on public.firm_operations
  for each statement execute function public.guard_impersonation_readonly();

/** The ceiling of areas of the firm's plan (`areas_max`), null where the plan sets none. Internal. */
create or replace function public.firm_areas_ceiling(target_org uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ceiling numeric;
begin
  ceiling := nullif(public.org_entitlements(target_org) -> 'limits' ->> 'areas_max', '')::numeric;
  if ceiling is null or ceiling <= 0 then
    return null;
  end if;
  return ceiling::integer;
end;
$$;

revoke all on function public.firm_areas_ceiling(uuid) from public, anon, authenticated;

/**
 * The firm says how it works and the areas it works in (the setup's step "A operação"): who manages the firm, with
 * the second factor, never a support visit. `target_operation` holds the answers (each optional but the areas);
 * `target_areas` the whole list of the firm's areas, each `{law_area}` (an area of law ONE knows) or `{name}` (one
 * ONE does not know: a name that is one ONE knows is taken as it), with `source` "xray" for one ONE proposed. An area
 * left out is taken out, never the area of a module the firm uses. Answers `{ok, code, areas}`.
 */
create or replace function public.save_firm_operation(target_org uuid, target_operation jsonb, target_areas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  op jsonb := coalesce(target_operation, '{}'::jsonb);
  item jsonb;
  wanted_law text;
  wanted_name text;
  wanted_source text;
  kept uuid[] := '{}';
  found_id uuid;
  ceiling integer;
  total integer;
  hours_from_value time;
  hours_to_value time;
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

  if jsonb_typeof(op) <> 'object' or target_areas is null or jsonb_typeof(target_areas) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid_operation');
  end if;
  if jsonb_array_length(target_areas) = 0 then
    return jsonb_build_object('ok', false, 'code', 'no_areas');
  end if;
  if jsonb_array_length(target_areas) > 40 then
    return jsonb_build_object('ok', false, 'code', 'invalid_operation');
  end if;

  -- The answers, each checked by the table's own rules.
  begin
    hours_from_value := nullif(op ->> 'hours_from', '')::time;
    hours_to_value := nullif(op ->> 'hours_to', '')::time;
    insert into public.firm_operations as f (
      org_id, states, channels, monthly_cases, hours_from, hours_to, saturdays, previous_system,
      one_finance, partners, one_filing, controladoria, answered_by, updated_at
    ) values (
      target_org,
      coalesce((select array_agg(distinct upper(btrim(v))) from jsonb_array_elements_text(
        case when jsonb_typeof(op -> 'states') = 'array' then op -> 'states' else '[]'::jsonb end) v), '{}'),
      coalesce((select array_agg(distinct btrim(v)) from jsonb_array_elements_text(
        case when jsonb_typeof(op -> 'channels') = 'array' then op -> 'channels' else '[]'::jsonb end) v), '{}'),
      nullif(op ->> 'monthly_cases', ''),
      hours_from_value,
      hours_to_value,
      coalesce((op ->> 'saturdays')::boolean, false),
      nullif(op ->> 'previous_system', ''),
      (op ->> 'one_finance')::boolean,
      (op ->> 'partners')::boolean,
      (op ->> 'one_filing')::boolean,
      (op ->> 'controladoria')::boolean,
      caller,
      now()
    )
    on conflict (org_id) do update set
      states = excluded.states, channels = excluded.channels, monthly_cases = excluded.monthly_cases,
      hours_from = excluded.hours_from, hours_to = excluded.hours_to, saturdays = excluded.saturdays,
      previous_system = excluded.previous_system, one_finance = excluded.one_finance,
      partners = excluded.partners, one_filing = excluded.one_filing, controladoria = excluded.controladoria,
      answered_by = excluded.answered_by, updated_at = excluded.updated_at;
  exception
    when check_violation or invalid_datetime_format or invalid_text_representation or datetime_field_overflow then
      return jsonb_build_object('ok', false, 'code', 'invalid_operation');
  end;

  -- The areas: each one said is kept, or added.
  for item in select value from jsonb_array_elements(target_areas) loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'invalid_operation' using errcode = '22023';
    end if;
    wanted_law := nullif(btrim(coalesce(item ->> 'law_area', '')), '');
    wanted_name := nullif(btrim(regexp_replace(coalesce(item ->> 'name', ''), '\s+', ' ', 'g')), '');
    wanted_source := case when item ->> 'source' = 'xray' then 'xray' else 'person' end;
    -- A name that is an area ONE knows is that area.
    if wanted_law is null and wanted_name is not null then
      select l.key into wanted_law from public.law_areas l
      where l.retired_at is null and lower(l.name) = lower(wanted_name);
    end if;
    if wanted_law is not null then
      if not exists (select 1 from public.law_areas l where l.key = wanted_law and l.retired_at is null) then
        raise exception 'unknown_area' using errcode = '22023';
      end if;
      select a.id into found_id from public.firm_areas a
      where a.org_id = target_org and a.law_area = wanted_law and a.removed_at is null;
      if found_id is null then
        insert into public.firm_areas (org_id, law_area, name, source, created_by)
        select target_org, l.key, l.name, wanted_source, caller from public.law_areas l where l.key = wanted_law
        returning id into found_id;
      end if;
    else
      if wanted_name is null or char_length(wanted_name) not between 2 and 80 or wanted_name ~ '[[:cntrl:]]' then
        raise exception 'invalid_area_name' using errcode = '22023';
      end if;
      select a.id into found_id from public.firm_areas a
      where a.org_id = target_org and a.removed_at is null and lower(btrim(a.name)) = lower(wanted_name);
      if found_id is null then
        insert into public.firm_areas (org_id, law_area, name, source, created_by)
        values (target_org, null, wanted_name, 'person', caller)
        returning id into found_id;
      end if;
    end if;
    kept := kept || found_id;
    found_id := null;
  end loop;

  -- The area of a module the firm uses stays whatever was said.
  kept := kept || coalesce((
    select array_agg(a.id) from public.firm_areas a
    join public.law_areas l on l.key = a.law_area
    where a.org_id = target_org and a.removed_at is null and l.module is not null
      and public.firm_uses_module(target_org, l.module)
  ), '{}');

  update public.firm_areas set removed_at = now(), removed_by = caller
  where org_id = target_org and removed_at is null and not (id = any (kept));

  select count(*) into total from public.firm_areas a where a.org_id = target_org and a.removed_at is null;
  ceiling := public.firm_areas_ceiling(target_org);
  if ceiling is not null and total > ceiling then
    raise exception 'areas_limit' using errcode = 'P0001', detail = ceiling::text;
  end if;

  update public.organizations set operation_answered_at = coalesce(operation_answered_at, now())
  where id = target_org;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'firm.operation_saved', 'organization', target_org::text,
          jsonb_build_object('areas', total));
  return jsonb_build_object('ok', true, 'code', 'saved', 'areas', total);
exception
  when raise_exception then
    if sqlerrm = 'areas_limit' then
      return jsonb_build_object('ok', false, 'code', 'areas_limit', 'limit', ceiling);
    end if;
    raise;
  -- Whatever was written before a refusal is undone with it: an operation is saved whole or not at all.
  when invalid_parameter_value then
    if sqlerrm in ('invalid_operation', 'unknown_area', 'invalid_area_name') then
      return jsonb_build_object('ok', false, 'code', sqlerrm);
    end if;
    raise;
end;
$$;

revoke all on function public.save_firm_operation(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_firm_operation(uuid, jsonb, jsonb) to authenticated;

/**
 * What the routing of a new contact on the firm's WhatsApp reads of the firm (the backend's): whether ONE attends for
 * it (decision 2), whether it said its areas, its areas, and the modules it uses.
 */
create or replace function public.firm_attendance(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org public.organizations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into org from public.organizations o where o.id = target_org;
  if org.id is null then
    return jsonb_build_object('ok', false, 'code', 'firm_not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'attends', org.attended_before_operation or org.operation_answered_at is not null,
    'declared', org.operation_answered_at is not null,
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'law_area', a.law_area, 'name', a.name)
                       order by coalesce(l.position, 1000), a.name)
      from public.firm_areas a left join public.law_areas l on l.key = a.law_area
      where a.org_id = target_org and a.removed_at is null
    ), '[]'::jsonb),
    'modules', coalesce((
      select jsonb_agg(m.module_key order by m.module_key) from public.firm_modules m
      where m.org_id = target_org and public.firm_uses_module(target_org, m.module_key)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.firm_attendance(uuid) from public, anon, authenticated;
grant execute on function public.firm_attendance(uuid) to service_role;

-- ---------- The area of each case ----------

alter table public.cases add column area_id uuid references public.firm_areas (id) on delete restrict;
-- The kind of case of the area (a firm's area's own list, a later phase); the passenger module keeps `incident`.
alter table public.cases add column case_type text;
alter table public.cases add constraint cases_case_type_check
  check (case_type is null or (char_length(btrim(case_type)) between 2 and 80 and case_type !~ '[[:cntrl:]]'));

create index cases_area_idx on public.cases (org_id, area_id);

/** A case of a module takes its module's area; an area given is the case's firm's own. */
create or replace function public.cases_area_of_module()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.area_id is null and new.module is not null then
    select a.id into new.area_id
    from public.firm_areas a join public.law_areas l on l.key = a.law_area
    where a.org_id = new.org_id and l.module = new.module and a.removed_at is null
    order by a.created_at
    limit 1;
  end if;
  if new.area_id is not null
     and not exists (select 1 from public.firm_areas a where a.id = new.area_id and a.org_id = new.org_id) then
    raise exception 'area_of_another_firm' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.cases_area_of_module() from public, anon, authenticated;

create trigger cases_area_of_module before insert or update of area_id, module on public.cases
  for each row execute function public.cases_area_of_module();

-- Every case there is is given its module's area.
update public.cases c set area_id = a.id
from public.firm_areas a
join public.law_areas l on l.key = a.law_area
where c.area_id is null and a.org_id = c.org_id and l.module = c.module and a.removed_at is null;

-- ---------- The setup's facts ----------

/**
 * What the setup list of a firm reads: each a fact of the data, never a box
 * somebody ticked. `oab_signer` is a registration at the bar together with
 * somebody chosen to sign what ONE prepares; `claim_defaults` is a claim the
 * firm asks by default for some kind of problem; `team` is read only where
 * the firm did not say it works alone; `channel` is a way to the clients;
 * `operation` is how the firm works, said, and `areas` an area it works in
 * (0256).
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
    'areas', exists (select 1 from public.firm_areas a where a.org_id = target_org and a.removed_at is null)
  );
end;
$$;

revoke all on function public.firm_setup_facts(uuid) from public, anon;
grant execute on function public.firm_setup_facts(uuid) to authenticated;
