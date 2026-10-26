-- ============================================================
-- 0056_setup_claims: the claim a firm asks by default joins the facts of its setup.
--
-- ONE creates the lawsuits of a case once each claimant has a claim, and writes the firm's default of the
-- case's kind of problem for a claimant nobody set one for (0052). A firm that never said any has every case
-- wait for a person, so saying them is part of setting the firm up: the facts of the setup (0044) gain
-- `claim_defaults`, a default said for at least one kind of problem, and the list on the home leads to the
-- step of the setup where they are said. Nothing else of the facts changes.
-- ============================================================

/**
 * What the setup list of a firm reads: each a fact of the data, never a box
 * somebody ticked. `oab_signer` is a registration at the bar together with
 * somebody chosen to sign what ONE prepares; `claim_defaults` is a claim the
 * firm asks by default for some kind of problem; `team` is read only where
 * the firm did not say it works alone; `channel` is a way to the clients.
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
    'setup_answered', org.setup_answered_at is not null
  );
end;
$$;

revoke all on function public.firm_setup_facts(uuid) from public, anon;
grant execute on function public.firm_setup_facts(uuid) to authenticated;
