-- ============================================================
-- 0299_lawyer_takes_the_sources: a partner or a lawyer approves a piece that cites what the firm's library does not
-- cover, taking those sources on (the owner, 2026-11-25).
--
-- On the test case 19 the lawyer wrote the initial over with a text of their own; it cited the CPC (art. 272), the
-- Código Brasileiro de Aeronáutica (art. 256) and the Tema 1.417 of the STF, none of them in the firm's verified
-- library, and the piece could not be approved until each was registered there (0029: "only a text whose every
-- citation is in the verified library is approved"). The owner: "não poderia deixar na responsabilidade do advogado
-- para que essa peça seja salva? pois assim não fica travado aguardando incluir citação na biblioteca".
--
--   * `take_draft_sources`: a partner or a lawyer takes on, for the version they read, every source it cites that the
--     library does not cover; who, when and which are kept on the draft and said on the case's trail.
--   * `case_draft_state_blocker` lets a version whose sources were taken on go on to its approval; a new version is
--     read again, and is held until somebody takes its own on or the library covers them. ONE never takes them on.
-- ============================================================

alter table public.case_drafts
  add column sources_taken_version integer,
  add column sources_taken_by uuid references public.profiles (id) on delete set null,
  add column sources_taken_at timestamptz,
  add column sources_taken_keys text[] not null default '{}';
alter table public.case_drafts add constraint case_drafts_sources_taken_check check (
  (sources_taken_version is null) = (sources_taken_at is null) and cardinality(sources_taken_keys) <= 200
);

/** The sources a version of a draft cites that the firm's verified library does not cover, once each (0299). Internal. */
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
    and not public.legal_source_covers(d.org_id, c.kind, c.issuer, c.number, c.article);
$$;

revoke all on function public.case_draft_uncovered_keys(uuid, integer) from public, anon, authenticated;

/**
 * A partner or a lawyer takes on the sources the version they read cites and the firm's library does not cover
 * (0299): the version may then be approved, the responsibility for those sources theirs, kept with who, when and
 * which. Answers `{ok, code: 'taken' | 'nothing_to_take', sources}`, or `{ok: false, code}`: `draft_not_found`,
 * `not_allowed`, `not_proposed`, `draft_changed`, `citations_not_checked`.
 */
create or replace function public.take_draft_sources(target_draft uuid, target_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  draft public.case_drafts%rowtype;
  current_case public.cases%rowtype;
  keys text[];
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into draft from public.case_drafts where id = target_draft;
  if not found or not public.is_org_member(draft.org_id) then
    return jsonb_build_object('ok', false, 'code', 'draft_not_found');
  end if;
  current_case := public.case_for_writer(draft.case_id);
  if not public.has_firm_function(draft.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  select * into draft from public.case_drafts where id = target_draft for update;
  if draft.status <> 'proposed' or draft.version < 1 then
    return jsonb_build_object('ok', false, 'code', 'not_proposed');
  end if;
  -- What is taken on is what the person read: another version arrived meanwhile, and it is read again.
  if target_version is distinct from draft.version then
    return jsonb_build_object('ok', false, 'code', 'draft_changed', 'version', draft.version);
  end if;
  if draft.checked_version is distinct from draft.version then
    return jsonb_build_object('ok', false, 'code', 'citations_not_checked');
  end if;
  keys := public.case_draft_uncovered_keys(draft.id, draft.version);
  if cardinality(keys) = 0 then
    return jsonb_build_object('ok', true, 'code', 'nothing_to_take', 'sources', '[]'::jsonb);
  end if;
  update public.case_drafts
  set sources_taken_version = draft.version, sources_taken_by = caller, sources_taken_at = now(),
      sources_taken_keys = keys[1:200]
  where id = draft.id;
  perform public.record_case_event(draft.org_id, draft.case_id, 'draft_sources_taken', 'person',
    jsonb_build_object('draft', draft.id, 'version', draft.version, 'sources', to_jsonb(keys[1:50])));
  return jsonb_build_object('ok', true, 'code', 'taken', 'sources', to_jsonb(keys));
end;
$$;

revoke all on function public.take_draft_sources(uuid, integer) from public, anon;
grant execute on function public.take_draft_sources(uuid, integer) to authenticated;

/**
 * Why a draft cannot be approved by its state (0125, redefined): as before, and a version whose uncovered sources a
 * partner or a lawyer took on is no longer held by them (0299).
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
