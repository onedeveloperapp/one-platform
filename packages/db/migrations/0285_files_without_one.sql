-- ============================================================
-- A firm that said ONE prepares no filing package (0285). The owner's canvas
-- of 2026-11-24 ("Configuração do escritório, antes e depois") moved the
-- question "O ONE deve preparar os pacotes de protocolo dos processos?"
-- (0256, `firm_operations.one_filing`) to the top of the setup's step of the
-- filing, before how the firm and its lawyers file on the courts' screens. A
-- firm that answers no is asked nothing of how it files: the list of the
-- setup on the home would otherwise leave its filing way missing forever.
--
-- `firm_setup_facts` gains `files_without_one`, true when the firm said no;
-- the home leaves the step of the filing out of its list by it. Nothing else
-- of the facts changes (redefined from 0273).
-- ============================================================

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
    'brand', exists (select 1 from public.firm_brands b where b.org_id = target_org and b.logo_file_id is not null),
    'personality', exists (select 1 from public.firm_personalities p where p.org_id = target_org and p.status = 'approved'),
    'filing_way', exists (select 1 from public.firm_filing_ways w where w.org_id = target_org),
    'files_without_one', exists (
      select 1 from public.firm_operations o where o.org_id = target_org and o.one_filing is false
    ),
    'area_scripts', not exists (
      select 1 from public.firm_areas a
      left join public.law_areas l on l.key = a.law_area
      where a.org_id = target_org and a.removed_at is null and l.module is null
        and public.area_script_in_force(a.id) is null
    )
  );
end;
$$;

revoke all on function public.firm_setup_facts(uuid) from public, anon;
grant execute on function public.firm_setup_facts(uuid) to authenticated;
