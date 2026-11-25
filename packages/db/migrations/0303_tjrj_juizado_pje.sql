-- ============================================================
-- 0303_tjrj_juizado_pje: a new lawsuit at a juizado of the TJRJ goes to the PJe until the eproc reaches its unit.
--
-- 0302 gave the TJRJ's juizado the eproc since 29/10/2026, read from the Aviso Conjunto TJ/CGJ nº 38/2026 of June.
-- The court's own schedule of the eproc (https://www.tjrj.jus.br/eproc/cronogramas) and the OAB-RJ on 26/10/2026 say
-- otherwise: on 29/10/2026 the eproc reached only the Turmas Recursais Cíveis, the Turmas de Uniformização and the
-- Juizados Especiais Cíveis of Macaé and Nova Friburgo; "as unidades com implantação inicialmente prevista para
-- outubro foram remanejadas para dezembro": the Juizados Especiais Cíveis of the Capital and of the 12º and 13º NUR
-- take it on 10/12/2026, the 2º, 3º, 5º, 6º and 8º NUR on 22/01/2027 and the 4º, 7º, 9º, 10º and 11º NUR on 25/02/2027.
-- Until then a new lawsuit of a juizado goes to the PJe, where the DJEN of 2026-11-24 leads 64 of the 64 communications
-- of the court's juizados with a link. The test case 19, at the VI Juizado Especial Cível of the Capital, goes to the
-- PJe.
--
-- The row is the platform's unconfirmed word, as before: the TJRJ's juizado has the PJe, with its file types, and
-- the planned lawsuits of that court and kind have it again at once (`court_systems_repropose`, 0066), approved anew
-- by ONE or by the firm. On 10/12/2026 the operator turns the row to the eproc for the Capital in `/admin/calendario`;
-- a juizado already on the eproc before its region (Macaé, Nova Friburgo) is refused by the firm with the reason, as
-- the table keeps one system per court and kind.
-- ============================================================

update public.court_systems
set system = 'pje',
    host = 'tjrj.pje.jus.br',
    since = null,
    source = 'o cronograma do eproc do TJRJ, atualizado em 26/10/2026, que leva os Juizados Especiais Cíveis da Capital ao eproc só em 10/12/2026 e os demais em 2027; até lá a ação nova do juizado vai ao PJe, aonde o DJEN de 24/11/2026 leva 64 das 64 comunicações dos juizados',
    sample_count = 64,
    sample_total = 64,
    sampled_on = '2026-11-24',
    notes = 'Em 10/12/2026 os Juizados Especiais Cíveis da Capital e do 12º e 13º NUR passam ao eproc, e a linha muda para eproc; o 2º, 3º, 5º, 6º e 8º NUR em 22/01/2027, o 4º, 7º, 9º, 10º e 11º NUR em 25/02/2027. Os juizados de Macaé e de Nova Friburgo já estão no eproc desde 29/10/2026: o escritório recusa o PJe com o motivo.',
    file_types = '{"petition": "Petição inicial"}'::jsonb,
    updated_at = now()
where court = 'TJRJ' and proceeding_kind = 'juizado' and not confirmed;
