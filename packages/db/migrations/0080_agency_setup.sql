-- ============================================================
-- 0080_agency_setup: the travel agency's own setup, as a firm has one (0044).
--
-- The owner, 2026-11-03: an agency's first person accepted the firm's
-- invitation and was sent to the generic security screen (everybody of a
-- partner owes the second factor, 0069), with nothing said of what the
-- agency has to do. The agency now has a setup of its own, in its area
-- (`/parceiro/configurar`), whose first step is the second factor, which
-- every write of the agency asks for: then the agency's name, the clause of
-- its contract the passenger reads on the link (0070: without it no link is
-- issued), the team and the way its passengers reach ONE.
--
--   partners.setup_answered_at  when who manages the agency finished its
--                               setup or set it aside; while it is null the
--                               agency's home opens on the setup for them.
--                               An agency that already has a clause or a
--                               passenger was set up by then.
--   answer_partner_setup        who manages the agency says it, on the
--                               platform's record (no firm reads it), never
--                               in a support visit.
--   my_partner                  says whether the setup was answered.
--   the clause ONE proposes     the platform's words (the setting
--                               `partners.clause_proposal`, for the curator),
--                               filled with the agency's and the firm's
--                               names by `pax_clause_proposal`: the agency
--                               reads them, changes what it wants and
--                               registers them as its clause through
--                               `pax_save_consent_term` (0070). ONE proposes
--                               and never registers: the clause is the
--                               agency's, in the contract it signs with the
--                               passenger.
-- ============================================================

-- ---------- When the agency's setup was answered ----------

alter table public.partners add column setup_answered_at timestamptz;

update public.partners p set setup_answered_at = now()
where exists (select 1 from public.pax_consent_terms t where t.partner_id = p.id)
   or exists (select 1 from public.pax_travelers t where t.partner_id = p.id);

/**
 * Who manages the agency says its setup is answered: finished, or set aside to be done later. Once is enough: a
 * second answer keeps the first moment. Never in a support visit.
 */
create or replace function public.answer_partner_setup(target_partner uuid)
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
  if not public.has_partner_role(target_partner, array['owner', 'admin']) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.partners set setup_answered_at = now()
  where id = target_partner and setup_answered_at is null;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'partner.setup_answered', 'partner', target_partner::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'code', 'answered');
end;
$$;

revoke all on function public.answer_partner_setup(uuid) from public, anon;
grant execute on function public.answer_partner_setup(uuid) to authenticated;

/**
 * The caller's partner, for the app to know where they work: the partner with their role, whether its setup was
 * answered, and its active partnerships, each with the firm's name and the module. Null for somebody in no partner.
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
    'setup_answered', p.setup_answered_at is not null,
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

-- ---------- The clause ONE proposes ----------

-- The platform's words, for the curator: what the passenger authorizes, for whom, what happens after a problem,
-- the children the client answers for, and how to take it back (LGPD, arts. 7, § 5, 8 and 14, § 1). Short enough
-- that the agency's and the firm's names of the longest length still fit a clause (0070: 1,200 characters).
update public.platform_settings
set value = value || jsonb_build_object('clause_proposal', jsonb_build_object(
  'body', 'O cliente autoriza, de forma específica, que {agencia} compartilhe com o escritório {escritorio} o seu nome, o seu WhatsApp e os voos desta viagem, para que o escritório acompanhe os voos e o avise pelo WhatsApp se algum for cancelado, mudar ou atrasar. Se, depois de um aviso, o cliente disser que quer falar com o escritório sobre o problema, autoriza também que a agência passe ao escritório os seus dados e os documentos que enviou, para o escritório avaliar o caso. O cliente dá a mesma autorização quanto aos dados das crianças e dos adolescentes de quem é responsável e que viajam com ele. A autorização pode ser retirada a qualquer momento, sem custo e sem prejuízo dos serviços contratados, pelo link que a agência enviar ou respondendo SAIR no WhatsApp.',
  -- Said in place of the firm's name while the agency has no active partnership.
  'firm_unknown', 'parceiro da agência'
))
where key = 'partners' and not value ? 'clause_proposal';

/**
 * The clause ONE proposes to an agency, with its name and the firm's of its partnership in the passenger module
 * filled in, for somebody of the agency to read, change and register. Null when the platform has none.
 */
create or replace function public.pax_clause_proposal(target_partner uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  agency text;
  firm text;
  setting jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_partner_member(target_partner) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select p.name into agency from public.partners p where p.id = target_partner;
  select o.name into firm
  from public.partner_links l
  join public.organizations o on o.id = l.org_id
  where l.partner_id = target_partner and l.status = 'active' and l.module_key = 'direito-do-passageiro'
  order by l.started_at desc
  limit 1;
  setting := (select s.value -> 'clause_proposal' from public.platform_settings s where s.key = 'partners');
  if agency is null or coalesce(setting ->> 'body', '') = '' then
    return null;
  end if;
  return replace(
    replace(setting ->> 'body', '{agencia}', agency),
    '{escritorio}', coalesce(firm, setting ->> 'firm_unknown', '')
  );
end;
$$;

revoke all on function public.pax_clause_proposal(uuid) from public, anon;
grant execute on function public.pax_clause_proposal(uuid) to authenticated;
