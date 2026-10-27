-- ============================================================
-- 0059_airline_one_code: LATAM's company answers under one code.
--
-- 0058 recorded TAM Linhas Aéreas S.A. under LATAM's "LA" and under its old code "JJ". The import of a firm's
-- portfolio reads a party's name by the names each airline is written by in court, its legal name among them
-- (0032), and a party that names two airlines names neither: "TAM Linhas Aéreas S.A." stopped being read as LATAM
-- (the round trip of the import, 2026-10-26). The company is LATAM's ("LA", whose names in court are TAM's), so
-- "JJ" goes back to what 0021 seeded: no legal entity of its own. A case written under "JJ" names the company by
-- hand in its piece, as every airline with no legal entity on record does.
-- ============================================================

update public.airlines set legal_name = null, cnpj = null, updated_at = now() where iata = 'JJ';
