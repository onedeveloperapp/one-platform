-- ============================================================
-- 0296_history_reads_go_with_their_case: the reading of a lawsuit's history goes with its case.
--
-- A case removed (the undoing of a portfolio's import, `revert_import_batch`) takes its lawsuits with it, and each
-- lawsuit its history's reading (0286, `on delete cascade` by the lawsuit). The reading kept a second key to the case
-- that set the case to null instead, though a lawsuit never outlives its case. When the reading was written in the
-- same transaction as the removal, PostgreSQL checks the lawsuit's key again on that update, and the lawsuit may be
-- gone already, depending on which of the two actions fires first (by the internal names of their triggers): the
-- whole pgTAP suite on the embedded database met it in 0035 and 0287, each passing alone. The key to the case now
-- takes the reading with the case too, as the lawsuit's does: nothing is ever set to null, and the order no longer
-- matters.
-- ============================================================

alter table public.proceeding_history_reads drop constraint proceeding_history_reads_case_id_org_id_fkey;
alter table public.proceeding_history_reads add constraint proceeding_history_reads_case_id_org_id_fkey
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade;
