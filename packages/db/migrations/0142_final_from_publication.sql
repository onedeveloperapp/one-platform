-- ============================================================
-- 0142_final_from_publication: the court's certificate that the judgment
-- became final, read where it is published.
--
-- ONE reads what each lawsuit came to (0130): every movement of the court,
-- and every publication the triage says is the judgment or a payment. The
-- certificate that the judgment became final (trânsito em julgado) often
-- reaches the firm only as a publication of the DJEN, triaged as a notice
-- ("ciência") or as something else, and nobody read it: the lawsuit never
-- learned it became final. Now the backend reads every publication triaged as
-- anything but the judgment or a payment once more, for that certificate
-- alone, by the rule `resultado-v1` (`certifiesFinal`: a certification or the
-- past tense, never the order of what follows the trânsito that every judgment
-- writes), and the fact is the lawsuit's as any other ONE reads (0130), its
-- day the day the DJEN made the publication available.
--
-- A mark of its own (`final_read_at`), apart from the reading of 0130, so a
-- publication read for this is still read for its result if it is ever said to
-- be the judgment. What the DJEN brought more than 30 days ago is history, read
-- by nobody.
-- ============================================================

alter table public.publications add column final_read_at timestamptz;

update public.publications
set final_read_at = now()
where final_read_at is null and available_on < (now() at time zone 'America/Sao_Paulo')::date - 30;

-- What the backend reads next: the triaged publications not read for the certificate yet.
create index publications_final_read_idx on public.publications (captured_at)
  where final_read_at is null and category is not null;

/**
 * What ONE's rule read of a publication for the certificate that the judgment
 * became final (the backend's): read once; a certificate of a lawsuit of an
 * open case is the lawsuit's fact (`lawsuit_fact_write`, 0130), as ONE's,
 * the day the DJEN made it available. Never of the judgment itself or a
 * payment, which 0130 reads, nor of a publication cancelled or of no lawsuit.
 */
create or replace function public.record_publication_final(target_publication uuid, target_final boolean, target_words text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  publication public.publications%rowtype;
  fact uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.publications set final_read_at = now() where id = target_publication and final_read_at is null
  returning * into publication;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'read_before');
  end if;
  if target_final is not true or not publication.active or publication.proceeding_id is null
     or publication.category is null or publication.category = 'pagamento'
     or (publication.category = 'decisao' and publication.judgment is true) then
    return jsonb_build_object('ok', true, 'code', 'nothing');
  end if;
  if not exists (select 1 from public.cases c where c.id = publication.case_id and c.status not in ('closed', 'declined')) then
    return jsonb_build_object('ok', true, 'code', 'case_ended');
  end if;
  fact := public.lawsuit_fact_write(publication.proceeding_id, jsonb_build_object(
    'kind', 'transito',
    'happened_on', publication.available_on,
    'words', left(coalesce(target_words, ''), 600)
  ), null, publication.id, null);
  return jsonb_build_object('ok', true, 'code', 'recorded', 'fact', fact);
end;
$$;

revoke all on function public.record_publication_final(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.record_publication_final(uuid, boolean, text) to service_role;
