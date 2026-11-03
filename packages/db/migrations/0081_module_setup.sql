-- ============================================================
-- 0081_module_setup: each module's own setup and colour, and the words of
-- the clause a firm gives its partner agencies.
--
-- The owner, 2026-11-03: the firm's setup mixed what every firm needs (the
-- core: the second factor, who signs, the team, the papers a client signs,
-- the channel) with what one module needs (the Valor da Causa Pedido of the
-- air-passenger problems, the partner agency). The core is set up once;
-- then each module the firm contracted has a setup of its own, in the
-- module's colour, before the home, and the modules to come are shown
-- disabled. And the clause of the agency's contract: the agency registers it
-- (it is the agency's contract with the passenger, 0070), but its words are
-- the firm's to give, the legal party of the partnership.
--
--   product_modules.tone        the module's colour among the tones the
--                               design system has (never a new colour):
--                               the passenger module the secondary (the
--                               cyan of the logo), Previdenciário accent-1,
--                               Trabalhista accent-4; the primary stays the
--                               core's, the red is risk's.
--   firm_modules.setup_answered_at
--                               when who manages the firm finished the
--                               module's setup or set it aside; a firm that
--                               answered its setup before the split answered
--                               the module's steps in it.
--   answer_module_setup         who manages the firm says it, on its record.
--   pax_firm_clauses            the words a firm gives its agencies for the
--                               clause, by version, written by who decides
--                               for the firm (`decides_for_firm`, 0078) with
--                               the second factor (`pax_save_firm_clause`),
--                               starting from ONE's proposal written for the
--                               firm (`pax_firm_clause_proposal`).
--   pax_clause_offer            what an agency's setup offers it: the words
--                               of its firm when the firm gave them, else
--                               ONE's proposal (0080), and whose they are.
-- ============================================================

-- ---------- The module's colour ----------

alter table public.product_modules add column tone text;
alter table public.product_modules add constraint product_modules_tone_check
  check (tone is null or tone in ('primary', 'secondary', 'accent-1', 'accent-2', 'accent-3', 'accent-4'));

update public.product_modules set tone = 'secondary' where key = 'direito-do-passageiro';
update public.product_modules set tone = 'accent-1' where key = 'direito-previdenciario';
update public.product_modules set tone = 'accent-4' where key = 'direito-trabalhista';

-- ---------- The module's own setup, per firm ----------

alter table public.firm_modules add column setup_answered_at timestamptz;

-- A firm that answered its setup before the split went through the module's steps in it.
update public.firm_modules fm set setup_answered_at = o.setup_answered_at
from public.organizations o
where o.id = fm.org_id and o.setup_answered_at is not null;

/**
 * Who manages the firm says the setup of one of its modules is answered: finished, or set aside. Once is enough: a
 * second answer keeps the first moment. Never in a support visit.
 */
create or replace function public.answer_module_setup(target_org uuid, target_module text)
returns jsonb
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
  if not exists (select 1 from public.firm_modules m where m.org_id = target_org and m.module_key = target_module) then
    return jsonb_build_object('ok', false, 'code', 'module_not_enabled');
  end if;
  update public.firm_modules set setup_answered_at = now()
  where org_id = target_org and module_key = target_module and setup_answered_at is null;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'firm.module_setup_answered', 'organization', target_org::text,
          jsonb_build_object('module', target_module));
  return jsonb_build_object('ok', true, 'code', 'answered');
end;
$$;

revoke all on function public.answer_module_setup(uuid, text) from public, anon;
grant execute on function public.answer_module_setup(uuid, text) to authenticated;

-- ---------- The words of the clause a firm gives its agencies ----------

-- The agency is said in general in the words a firm gives: the clause is in that agency's own contract.
update public.platform_settings
set value = jsonb_set(value, '{clause_proposal,agency_generic}', to_jsonb('a agência'::text))
where key = 'partners' and value ? 'clause_proposal' and not (value -> 'clause_proposal') ? 'agency_generic';

create table public.pax_firm_clauses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  version integer not null,
  -- The words as the firm wrote them. Never edited: a change is a new version.
  body text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, version),
  constraint pax_firm_clauses_version_check check (version > 0),
  constraint pax_firm_clauses_body_check check (
    char_length(btrim(body)) between 40 and 1200 and body !~ '[\x01-\x09\x0b-\x1f\x7f]'
  )
);

alter table public.pax_firm_clauses enable row level security;

-- A support visit writes nothing of a firm's (0009).
create trigger guard_impersonation_pax_firm_clauses after insert or update or delete on public.pax_firm_clauses
  for each statement execute function public.guard_impersonation_readonly();

create policy "pax_firm_clauses_select_member" on public.pax_firm_clauses
  for select to authenticated
  using (public.is_org_member(org_id));

revoke all on table public.pax_firm_clauses from public, anon, authenticated;
grant select on table public.pax_firm_clauses to authenticated;

/**
 * ONE's proposal written for a firm to give its agencies: the platform's words (0080) with the firm's name, and the
 * agency said in general, since the clause stands in each agency's own contract. Null when the platform has none.
 */
create or replace function public.pax_firm_clause_proposal(target_org uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  firm text;
  setting jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select o.name into firm from public.organizations o where o.id = target_org;
  setting := (select s.value -> 'clause_proposal' from public.platform_settings s where s.key = 'partners');
  if firm is null or coalesce(setting ->> 'body', '') = '' then
    return null;
  end if;
  return replace(
    replace(setting ->> 'body', '{agencia}', coalesce(setting ->> 'agency_generic', 'a agência')),
    '{escritorio}', firm
  );
end;
$$;

revoke all on function public.pax_firm_clause_proposal(uuid) from public, anon;
grant execute on function public.pax_firm_clause_proposal(uuid) to authenticated;

/**
 * Who decides for the firm (a partner, or, with none, who manages it: 0078) gives the words of the clause its
 * agencies register, with the second factor and never in a support visit. A version is never changed: the same
 * words are no new version.
 */
create or replace function public.pax_save_firm_clause(target_org uuid, target_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  body text := btrim(regexp_replace(replace(coalesce(target_body, ''), E'\r\n', E'\n'), '[ \t]+', ' ', 'g'));
  next_version integer;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.decides_for_firm(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if char_length(body) not between 40 and 1200 or body ~ '[\x01-\x09\x0b-\x1f\x7f]' then
    return jsonb_build_object('ok', false, 'code', 'invalid_clause');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pax-firm-clause:' || target_org::text, 0));
  if body = (select c.body from public.pax_firm_clauses c where c.org_id = target_org order by c.version desc limit 1) then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  select coalesce(max(c.version), 0) + 1 into next_version from public.pax_firm_clauses c where c.org_id = target_org;
  insert into public.pax_firm_clauses (org_id, version, body, created_by) values (target_org, next_version, body, caller);
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'pax.firm_clause.saved', 'organization', target_org::text,
          jsonb_build_object('version', next_version));
  return jsonb_build_object('ok', true, 'code', 'saved', 'version', next_version);
end;
$$;

revoke all on function public.pax_save_firm_clause(uuid, text) from public, anon;
grant execute on function public.pax_save_firm_clause(uuid, text) to authenticated;

/**
 * What an agency's setup offers it for its clause (0080): the words its firm gave, in force, when the firm of its
 * partnership in the passenger module gave any; else ONE's proposal. Says whose they are, and the firm's name.
 */
create or replace function public.pax_clause_offer(target_partner uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  agency text;
  firm_id uuid;
  firm text;
  words text;
  clause_version integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_partner_member(target_partner) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select p.name into agency from public.partners p where p.id = target_partner;
  select l.org_id, o.name into firm_id, firm
  from public.partner_links l
  join public.organizations o on o.id = l.org_id
  where l.partner_id = target_partner and l.status = 'active' and l.module_key = 'direito-do-passageiro'
  order by l.started_at desc
  limit 1;
  if firm_id is not null then
    select c.body, c.version into words, clause_version
    from public.pax_firm_clauses c where c.org_id = firm_id order by c.version desc limit 1;
  end if;
  if words is not null then
    return jsonb_build_object(
      'text', replace(replace(words, '{agencia}', agency), '{escritorio}', firm),
      'source', 'firm', 'firm', firm, 'version', clause_version
    );
  end if;
  return jsonb_build_object('text', public.pax_clause_proposal(target_partner), 'source', 'one', 'firm', firm);
end;
$$;

revoke all on function public.pax_clause_offer(uuid) from public, anon;
grant execute on function public.pax_clause_offer(uuid) to authenticated;
