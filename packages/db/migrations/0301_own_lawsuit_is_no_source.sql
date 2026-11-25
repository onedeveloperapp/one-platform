-- ============================================================
-- 0301_own_lawsuit_is_no_source: the number of a lawsuit of the piece's own case is never a source it cites.
--
-- A piece filed in a lawsuit names it ("Processo nº ..." at its head), and the reader of what a piece cites
-- (`@flyee/knowledge/citations`) takes every number in the CNJ's format as a decision of a court below, to be
-- verified in the firm's library like any precedent. The library never covers the case's own lawsuit, so on
-- 2026-11-25 a petition of juntada and a manifestation of the test firm were held as citing an unverified source,
-- which was their own lawsuit. The number of a lawsuit of the case itself is the piece's address: it is not listed
-- among the sources, nor holds the piece, nor is taken on (0299). A lawsuit of any other case stays a precedent.
--
--   * `cites_own_lawsuit`: whether a citation is the number of a lawsuit of the draft's own case.
--   * `case_draft_sources` (0029), `case_draft_uncovered_keys` and `case_draft_state_blocker` (0299) leave it out.
-- ============================================================

/** Whether what a draft cites is the number of a lawsuit of the draft's own case (0301). Internal. */
create or replace function public.cites_own_lawsuit(target_case uuid, kind text, number text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select cites_own_lawsuit.kind = 'processo' and exists (
    select 1 from public.proceedings p
    where p.case_id = target_case and p.cnj = cites_own_lawsuit.number
  );
$$;

revoke all on function public.cites_own_lawsuit(uuid, text, text) from public, anon, authenticated;

/**
 * What the latest version of a draft cites, each source once: its key, how
 * it is written, how many times, and whether the firm's verified library
 * answers for it today, the ones it does not answer for first. Read by the
 * screens, so that what they show is what the gate reads
 * (`legal_source_covers`), whatever the size of the library or the number
 * of versions. Nothing while the latest version was not read. For the
 * people of its firm. (0029, redefined: the number of a lawsuit of the
 * draft's own case is not a source, 0301.)
 */
create or replace function public.case_draft_sources(target_draft uuid)
returns table (key text, kind text, issuer text, number text, article text, raw text, times integer, covered boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into draft from public.case_drafts d where d.id = target_draft;
  if not found or not public.is_org_member(draft.org_id) or draft.checked_version is distinct from draft.version then
    return;
  end if;
  return query
  select c.key, c.kind, c.issuer, c.number, c.article,
         (array_agg(c.raw order by c.position))[1],
         count(*)::integer,
         public.legal_source_covers(draft.org_id, c.kind, c.issuer, c.number, c.article)
  from public.case_draft_citations c
  where c.draft_id = draft.id and c.version = draft.version
    and not public.cites_own_lawsuit(draft.case_id, c.kind, c.number)
  group by c.key, c.kind, c.issuer, c.number, c.article
  order by 8, min(c.position)
  limit 500;
end;
$$;

revoke all on function public.case_draft_sources(uuid) from public, anon;
grant execute on function public.case_draft_sources(uuid) to authenticated;

/**
 * The sources a version of a draft cites that the firm's verified library does not cover, once each (0299),
 * the number of a lawsuit of the draft's own case left out (0301). Internal.
 */
create or replace function public.case_draft_uncovered_keys(target_draft uuid, target_version integer)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct c.key order by c.key), '{}'::text[])
  from public.case_draft_citations c
  join public.case_drafts d on d.id = c.draft_id
  where c.draft_id = target_draft and c.version = target_version
    and not public.legal_source_covers(d.org_id, c.kind, c.issuer, c.number, c.article)
    and not public.cites_own_lawsuit(d.case_id, c.kind, c.number);
$$;

revoke all on function public.case_draft_uncovered_keys(uuid, integer) from public, anon, authenticated;

/**
 * Why a draft cannot be approved by its state (0125, redefined by 0299): as before, and the number of a lawsuit
 * of the draft's own case never holds it (0301).
 */
create or replace function public.case_draft_state_blocker(target_draft uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  justice text;
begin
  select * into draft from public.case_drafts where id = target_draft;
  if not found or draft.status <> 'proposed' or draft.version < 1 then
    return 'not_proposed';
  end if;
  if draft.work is not distinct from 'revise' then
    return 'revision_in_course';
  end if;
  if draft.checked_version is distinct from draft.version then
    return 'citations_not_checked';
  end if;
  if draft.sources_taken_version is distinct from draft.version and exists (
    select 1 from public.case_draft_citations c
    where c.draft_id = draft.id and c.version = draft.version
      and not public.legal_source_covers(draft.org_id, c.kind, c.issuer, c.number, c.article)
      and not public.cites_own_lawsuit(draft.case_id, c.kind, c.number)
  ) then
    return 'citations_not_verified';
  end if;
  justice := public.free_justice_piece_blocker(draft.id);
  if justice is not null then
    return justice;
  end if;
  return null;
end;
$$;

revoke all on function public.case_draft_state_blocker(uuid) from public, anon, authenticated;
