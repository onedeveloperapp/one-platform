-- ============================================================
-- 0124 · A declaração de residência que deixou de ser necessária
--
-- 0123 ended a declaration no longer needed (its bill refused afterwards,
-- a bill in the person's own name accepted, another bill in somebody
-- else's name in its place, or a partner or a lawyer going on without it)
-- with its envelope, but left the paper ONE had issued for it: the paper's
-- row kept the person from being issued a declaration again (one paper of a
-- kind per person, `case_papers`), so a second bill in somebody else's name
-- waited for good, and the paper's PDFs, accepted documents of the case,
-- could still go to the court with that person's filing.
--
-- Now a declaration that ends takes its paper with it: the paper's row
-- goes, so a declaration owed again is issued again, and the PDF ONE issued
-- and the copy the client signed are refused with the reason, so no filing
-- takes them. A refused paper of this kind is never asked of the client
-- again (`document_refused` reads only the kinds a client sends).
-- ============================================================

/**
 * Ends a person's open declaration that is no longer needed (`void`) or that a partner or a lawyer went on without
 * (`waived`), as in 0123, and with it the paper ONE issued for it: an envelope still open is cancelled (a ZapSign
 * envelope already sent owes its cancel at ZapSign, as in 0023), the PDF issued and the copy signed are refused, and
 * the paper's row goes, so a declaration owed again is issued again. Internal.
 */
create or replace function public.end_residence_declaration(
  target_declaration uuid,
  target_status text,
  target_reason text,
  target_actor_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  declaration public.residence_declarations%rowtype;
  paper public.case_papers%rowtype;
  envelope public.signature_envelopes%rowtype;
begin
  update public.residence_declarations
  set status = target_status, ended_reason = left(target_reason, 500), ended_by = auth.uid(), ended_at = now()
  where id = target_declaration and status = 'open'
  returning * into declaration;
  if declaration.id is null then
    return;
  end if;
  select * into paper from public.case_papers p
  where p.case_id = declaration.case_id and p.person_id = declaration.person_id and p.kind = 'declaracao_residencia'
  for update;
  if paper.id is not null then
    select e.* into envelope from public.signature_envelopes e where e.id = paper.envelope_id for update;
    if envelope.id is not null and envelope.status in ('reserved', 'pending', 'received', 'uncertain') then
      update public.signature_envelopes
      set status = 'cancelled', ended_reason = left(target_reason, 500), decided_by = auth.uid(),
          provider_cancel_pending = (envelope.method = 'zapsign' and envelope.status = 'pending' and envelope.provider_id is not null)
      where id = envelope.id;
      perform public.record_case_event(declaration.org_id, declaration.case_id, 'signature_cancelled', target_actor_type,
        jsonb_build_object('envelope', envelope.id));
    end if;
    -- The PDF issued and the copy signed (gov.br sends back a document of its own) go to no court.
    update public.case_documents d
    set status = 'rejected', decided_at = now(), decided_by = auth.uid(),
        rejected_reason = 'A declaração de residência deixou de ser necessária.'
    where d.case_id = declaration.case_id and d.status in ('received', 'accepted')
      and d.id in (paper.document_id, envelope.signed_document_id);
    delete from public.case_papers where id = paper.id;
  end if;
  perform public.record_case_event(declaration.org_id, declaration.case_id,
    case target_status when 'waived' then 'residence_declaration_waived' else 'residence_declaration_ended' end,
    target_actor_type, jsonb_build_object('person', declaration.person_id, 'declaration', declaration.id));
end;
$$;

revoke all on function public.end_residence_declaration(uuid, text, text, text) from public, anon, authenticated;

/**
 * What keeps a person's open declaration from going with a filing (0123, redefined): as before, and only a paper
 * issued for this declaration counts as its signature, never one of a declaration that ended before it.
 */
create or replace function public.residence_declaration_blocker(target_case uuid, target_person uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when d.relation is null then 'residence_relation_missing'
    when p.city is not null and d.bill_city is not null
         and (public.plain_name(p.city) <> public.plain_name(d.bill_city)
              or (p.uf is not null and d.bill_uf is not null and p.uf <> d.bill_uf))
      then 'residence_address_conflict'
    when not exists (
      select 1 from public.case_papers paper
      join public.signature_envelopes e on e.id = paper.envelope_id
      where paper.case_id = d.case_id and paper.person_id = d.person_id and paper.kind = 'declaracao_residencia'
        and paper.created_at >= d.created_at and e.status = 'signed'
    ) then 'residence_declaration_unsigned'
  end
  from public.residence_declarations d
  join public.people p on p.id = d.person_id
  where d.case_id = target_case and d.person_id = target_person and d.status = 'open';
$$;

revoke all on function public.residence_declaration_blocker(uuid, uuid) from public, anon, authenticated;

-- A declaration 0123 ended before this one keeps no paper either: its row goes and its PDFs are refused.
with ended as (
  select paper.id as paper_id, paper.document_id, e.signed_document_id, paper.case_id
  from public.case_papers paper
  left join public.signature_envelopes e on e.id = paper.envelope_id
  where paper.kind = 'declaracao_residencia'
    -- No open declaration the paper was issued for: none at all, or one owed after the paper (another bill).
    and not exists (
      select 1 from public.residence_declarations d
      where d.case_id = paper.case_id and d.person_id = paper.person_id and d.status = 'open'
        and d.created_at <= paper.created_at
    )
), refused as (
  update public.case_documents d
  set status = 'rejected', decided_at = now(),
      rejected_reason = 'A declaração de residência deixou de ser necessária.'
  from ended
  where d.case_id = ended.case_id and d.status in ('received', 'accepted')
    and d.id in (ended.document_id, ended.signed_document_id)
  returning d.id
)
delete from public.case_papers paper using ended where paper.id = ended.paper_id;
