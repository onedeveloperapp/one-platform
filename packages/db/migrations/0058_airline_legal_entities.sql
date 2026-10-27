-- ============================================================
-- 0058_airline_legal_entities: the legal entity in Brazil of the airlines a passenger of the module sues.
--
-- The rehearsal of the end-to-end test (2026-10-26) could not approve a piece: the airlines were seeded with no
-- legal name and no CNPJ (0021), so the mark `[[RE]]` of a piece was filled as `[COMPLETAR: razão social da
-- companhia]`, which keeps it from being approved (0029), and a power of attorney named the company by the name
-- it flies under (0054). The operator records them through `admin_set_airline`, which no screen calls yet.
--
-- Recorded here for the four Brazilian operators, each checked on 2026-10-26 in the Receita Federal's open CNPJ
-- data (through BrasilAPI's reading of it): active, its head office, scheduled passenger air transport. LATAM's
-- domestic flights, sold under "LA" and under its old code "JJ", are operated by TAM Linhas Aéreas S.A. (trade name
-- LATAM Airlines Brasil), the entity that answers in Brazilian courts for them; an international flight of another
-- company of the group stays the firm's to name in the piece. Nothing else of the airlines changes.
-- ============================================================

update public.airlines set legal_name = 'TAM Linhas Aéreas S.A.', cnpj = '02012862000160', updated_at = now()
where iata in ('LA', 'JJ');
update public.airlines set legal_name = 'GOL Linhas Aéreas S.A.', cnpj = '07575651000159', updated_at = now()
where iata = 'G3';
update public.airlines set legal_name = 'Azul Linhas Aéreas Brasileiras S.A.', cnpj = '09296295000160', updated_at = now()
where iata = 'AD';
update public.airlines set legal_name = 'Passaredo Transportes Aéreos S.A.', cnpj = '00512777000135', updated_at = now()
where iata = '2Z';
