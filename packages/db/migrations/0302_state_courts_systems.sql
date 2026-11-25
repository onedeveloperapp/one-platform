-- ============================================================
-- 0302_state_courts_systems: the systems the platform's table lacked for five state courts and kinds.
--
-- On 2026-11-25 the test case 19 stopped before its filing package: its lawsuit, at the VI Juizado Especial Cível of
-- the Capital of the TJRJ, had its court, its comarca and its unit, and no system, because `court_systems` had no row
-- for the TJRJ's juizado (ONE names a lawsuit's system from that table only, 0066; the DJEN sample of 2026-10-08 that
-- seeded it held no communication of a juizado of the TJRJ with a link). The same was missing for the juizado of the
-- TJDFT and of the TJMG and for both kinds of the TJRR: any passenger of those states in a juizado would stop there.
-- Read again on 2026-11-25, from the courts' own acts where the DJEN cannot tell what a new case takes:
--
--   * TJRJ, juizado: eproc. The Aviso Conjunto TJ/CGJ nº 38/2026 (published 26/06/2026) took the Juizados Especiais
--     Cíveis and Turmas Recursais Cíveis of the Capital to the eproc on 29/10/2026, the 12º and 13º NUR on 10/12/2026
--     and the other NUR after them; the DJEN of 2026-11-24 still links the juizado's cases in course to the PJe (64 of
--     64), which the cases filed before keep. A juizado of the interior before its date is refused by the firm with
--     the reason, which the platform reads (`admin_court_system_refusals`).
--   * TJDFT, juizado: PJe. The DJEN of 2026-11-24: 183 of the court's 200 communications link to pje.tjdft.jus.br and
--     the rest to its second degree; its civil court is PJe too.
--   * TJMG, juizado: eproc. Its last cycle, on 25/05/2026 (Portaria Conjunta nº 1.800/PR/2026), took the eproc to the
--     Juizados Especiais and Turmas Recursais of every comarca; the eproc is the court's only system for new cases.
--   * TJRR, comum and juizado: Projudi, the court's system for its lawsuits (Carta de Serviços do TJRR 2026); the
--     DJEN's communications of the court carry no link.
--
-- Each row is the platform's unconfirmed word, as every row the DJEN seeded: ONE names it on the lawsuit as its own,
-- the firm approves it or refuses it with why (0066), and the operator confirms it in `/admin/calendario`. A row the
-- operator wrote meanwhile is kept. The file types follow the system, as 0036 set them for the other state courts.
-- Inserting a row gives it at once to the planned lawsuits of its court and kind (`court_systems_repropose`, 0066).
-- ============================================================

insert into public.court_systems (court, proceeding_kind, system, host, since, source, sample_count, sample_total,
                                  sampled_on, notes, file_types) values
  ('TJRJ', 'juizado', 'eproc', 'eproc1g.tjrj.jus.br', '2026-10-29',
   'o Aviso Conjunto TJ/CGJ nº 38/2026 do TJRJ, que leva ao eproc os Juizados Especiais Cíveis da Capital desde 29/10/2026, os do 12º e do 13º NUR em 10/12/2026 e os demais NUR depois',
   null, null, null,
   'Os processos em curso continuam no PJe (DJEN de 24/11/2026: 64 de 64 comunicações de juizado com link). Um juizado do interior antes da data do seu NUR ainda distribui no sistema antigo: o escritório recusa com o motivo, e a plataforma confere.',
   '{"petition": "Petição inicial (INIC)"}'::jsonb),
  ('TJDFT', 'juizado', 'pje', 'pje.tjdft.jus.br', null,
   'a amostra do DJEN de 24/11/2026, em que 183 das 200 comunicações do TJDFT levam ao PJe do primeiro grau e as demais ao do segundo',
   183, 200, '2026-11-24',
   'A amostra não trouxe comunicação de juizado; a vara cível do tribunal também é PJe.',
   '{"petition": "Petição inicial"}'::jsonb),
  ('TJMG', 'juizado', 'eproc', 'eproc1g.tjmg.jus.br', '2026-05-25',
   'a Portaria Conjunta nº 1.800/PR/2026 do TJMG, cujo último ciclo, em 25/05/2026, levou o eproc aos Juizados Especiais de todas as comarcas, único sistema do tribunal para ações novas',
   null, null, null,
   'Os processos que já estavam no PJe continuam nele até a migração autorizada pelo tribunal.',
   '{"petition": "Petição inicial (INIC)"}'::jsonb),
  ('TJRR', 'comum', 'projudi', null, null,
   'a Carta de Serviços do TJRR de 2026, que tem o Projudi como o sistema dos processos do tribunal',
   null, null, null,
   'As comunicações do tribunal no DJEN não trazem link do sistema.',
   '{}'::jsonb),
  ('TJRR', 'juizado', 'projudi', null, null,
   'a Carta de Serviços do TJRR de 2026, que tem o Projudi como o sistema dos processos do tribunal',
   null, null, null,
   'As comunicações do tribunal no DJEN não trazem link do sistema.',
   '{}'::jsonb)
on conflict (court, proceeding_kind) do nothing;
