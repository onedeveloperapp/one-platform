-- ============================================================
-- ONE's work of naming a lawsuit's court system (0241). The decision of
-- the court system (0240) found its kind of work already in the catalog
-- with no decision (`sistema_tribunal`, 0120), so 0240's insert kept
-- nothing and the count of ONE's work had a decision with no work of its
-- own (`0121`'s check). The kind is now the decision's.
-- ============================================================

update public.one_work_kinds set decision = 'court_system' where key = 'sistema_tribunal' and decision is null;
