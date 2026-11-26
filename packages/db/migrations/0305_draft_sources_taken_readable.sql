-- ============================================================
-- 0305_draft_sources_taken_readable: a member reads who took on the sources of a piece (0299).
--
-- 0029 grants the columns of `case_drafts` to a member one by one, and 0299 added four without granting them. The case
-- screen reads them with the rest of each piece (`DRAFT_COLUMNS`), so from the deploy of 2026-11-26 every case page
-- answered an error: the select of the pieces was refused for the whole row. A member reads them as they read the
-- others of their firm's drafts, under the same row-level security.
-- ============================================================

grant select (sources_taken_version, sources_taken_by, sources_taken_at, sources_taken_keys)
  on table public.case_drafts to authenticated;
