-- ============================================================
-- 0275_labour_federal_courts: the labour and the federal courts, where a firm of those areas has its lawsuits (the
-- owner, 2026-11-20).
--
-- The sixth phase of the plan "o escritório preparado antes do primeiro atendimento". The table of the courts held
-- the state courts alone (one per state, `TJ..`), so a lawsuit of a labour or a federal court had no court to be of,
-- no calendar and no system. It now holds the 24 regional labour courts (segment 5 of the unique number) and the 6
-- regional federal courts (segment 4), each with the states it covers and its time zones, and the system each one's
-- lawsuits run in, as the DJEN's communications of 18 November 2026 showed it (`scripts/djen-systems.mjs`: every TRT
-- in PJe; TRF1, TRF3 and TRF5 in PJe; TRF2, TRF4 and TRF6 in eproc), not yet checked against each court's acts.
--
--   * `courts.justice`: estadual, trabalho or federal; `courts.ufs`: the states a regional court covers. A regional
--     court is of no single state (`uf` null): what reads a state's court still finds the TJ.
--   * The count of a deadline knows the justice by the court (rule `prazo-v3` of `@flyee/rules/deadlines`): the
--     holidays of the Justiça Federal are the law's in a federal court (Lei nº 5.010/1966, art. 62); the labour
--     courts count as the CLT says (art. 775 and 775-A), their days off being each court's calendar, as data.
--   * `djen_probe_due` keeps watching the state courts, as before.
-- ============================================================

alter table public.courts drop constraint courts_acronym_check;
alter table public.courts add constraint courts_acronym_check check (acronym ~ '^(TJ[A-Z]{2,3}|TRT[0-9]{1,2}|TRF[0-9])$');
alter table public.courts alter column uf drop not null;
alter table public.courts add column justice text not null default 'estadual';
alter table public.courts add column ufs text[] not null default '{}';
alter table public.courts add constraint courts_justice_check check (
  justice in ('estadual', 'trabalho', 'federal')
  and (justice = 'estadual') = (uf is not null)
  and ufs <@ array['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE',
                   'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']::text[]
);
update public.courts set ufs = array[uf] where justice = 'estadual' and uf is not null and ufs = '{}';

insert into public.courts (acronym, name, uf, cnj_segment, cnj_code, justice, ufs, time_zone, other_zones) values
  ('TRT1', 'Tribunal Regional do Trabalho da 1ª Região', null, '5', '01', 'trabalho', array['RJ']::text[], 'America/Sao_Paulo', '{}'::text[]),
  ('TRT2', 'Tribunal Regional do Trabalho da 2ª Região', null, '5', '02', 'trabalho', array['SP']::text[], 'America/Sao_Paulo', '{}'::text[]),
  ('TRT3', 'Tribunal Regional do Trabalho da 3ª Região', null, '5', '03', 'trabalho', array['MG']::text[], 'America/Sao_Paulo', '{}'::text[]),
  ('TRT4', 'Tribunal Regional do Trabalho da 4ª Região', null, '5', '04', 'trabalho', array['RS']::text[], 'America/Sao_Paulo', '{}'::text[]),
  ('TRT5', 'Tribunal Regional do Trabalho da 5ª Região', null, '5', '05', 'trabalho', array['BA']::text[], 'America/Bahia', '{}'::text[]),
  ('TRT6', 'Tribunal Regional do Trabalho da 6ª Região', null, '5', '06', 'trabalho', array['PE']::text[], 'America/Recife', '{}'::text[]),
  ('TRT7', 'Tribunal Regional do Trabalho da 7ª Região', null, '5', '07', 'trabalho', array['CE']::text[], 'America/Fortaleza', '{}'::text[]),
  ('TRT8', 'Tribunal Regional do Trabalho da 8ª Região', null, '5', '08', 'trabalho', array['PA', 'AP']::text[], 'America/Belem', '{}'::text[]),
  ('TRT9', 'Tribunal Regional do Trabalho da 9ª Região', null, '5', '09', 'trabalho', array['PR']::text[], 'America/Sao_Paulo', '{}'::text[]),
  ('TRT10', 'Tribunal Regional do Trabalho da 10ª Região', null, '5', '10', 'trabalho', array['DF', 'TO']::text[], 'America/Sao_Paulo', array['America/Araguaina']::text[]),
  ('TRT11', 'Tribunal Regional do Trabalho da 11ª Região', null, '5', '11', 'trabalho', array['AM', 'RR']::text[], 'America/Manaus', array['America/Boa_Vista']::text[]),
  ('TRT12', 'Tribunal Regional do Trabalho da 12ª Região', null, '5', '12', 'trabalho', array['SC']::text[], 'America/Sao_Paulo', '{}'::text[]),
  ('TRT13', 'Tribunal Regional do Trabalho da 13ª Região', null, '5', '13', 'trabalho', array['PB']::text[], 'America/Fortaleza', '{}'::text[]),
  ('TRT14', 'Tribunal Regional do Trabalho da 14ª Região', null, '5', '14', 'trabalho', array['RO', 'AC']::text[], 'America/Porto_Velho', array['America/Rio_Branco']::text[]),
  ('TRT15', 'Tribunal Regional do Trabalho da 15ª Região', null, '5', '15', 'trabalho', array['SP']::text[], 'America/Sao_Paulo', '{}'::text[]),
  ('TRT16', 'Tribunal Regional do Trabalho da 16ª Região', null, '5', '16', 'trabalho', array['MA']::text[], 'America/Fortaleza', '{}'::text[]),
  ('TRT17', 'Tribunal Regional do Trabalho da 17ª Região', null, '5', '17', 'trabalho', array['ES']::text[], 'America/Sao_Paulo', '{}'::text[]),
  ('TRT18', 'Tribunal Regional do Trabalho da 18ª Região', null, '5', '18', 'trabalho', array['GO']::text[], 'America/Sao_Paulo', '{}'::text[]),
  ('TRT19', 'Tribunal Regional do Trabalho da 19ª Região', null, '5', '19', 'trabalho', array['AL']::text[], 'America/Maceio', '{}'::text[]),
  ('TRT20', 'Tribunal Regional do Trabalho da 20ª Região', null, '5', '20', 'trabalho', array['SE']::text[], 'America/Maceio', '{}'::text[]),
  ('TRT21', 'Tribunal Regional do Trabalho da 21ª Região', null, '5', '21', 'trabalho', array['RN']::text[], 'America/Fortaleza', '{}'::text[]),
  ('TRT22', 'Tribunal Regional do Trabalho da 22ª Região', null, '5', '22', 'trabalho', array['PI']::text[], 'America/Fortaleza', '{}'::text[]),
  ('TRT23', 'Tribunal Regional do Trabalho da 23ª Região', null, '5', '23', 'trabalho', array['MT']::text[], 'America/Cuiaba', '{}'::text[]),
  ('TRT24', 'Tribunal Regional do Trabalho da 24ª Região', null, '5', '24', 'trabalho', array['MS']::text[], 'America/Campo_Grande', '{}'::text[]),
  ('TRF1', 'Tribunal Regional Federal da 1ª Região', null, '4', '01', 'federal', array['DF', 'AC', 'AM', 'AP', 'BA', 'GO', 'MA', 'MT', 'PA', 'PI', 'RO', 'RR', 'TO']::text[], 'America/Sao_Paulo', array['America/Manaus', 'America/Belem', 'America/Cuiaba']::text[]),
  ('TRF2', 'Tribunal Regional Federal da 2ª Região', null, '4', '02', 'federal', array['RJ', 'ES']::text[], 'America/Sao_Paulo', '{}'::text[]),
  ('TRF3', 'Tribunal Regional Federal da 3ª Região', null, '4', '03', 'federal', array['SP', 'MS']::text[], 'America/Sao_Paulo', array['America/Campo_Grande']::text[]),
  ('TRF4', 'Tribunal Regional Federal da 4ª Região', null, '4', '04', 'federal', array['RS', 'PR', 'SC']::text[], 'America/Sao_Paulo', '{}'::text[]),
  ('TRF5', 'Tribunal Regional Federal da 5ª Região', null, '4', '05', 'federal', array['PE', 'AL', 'CE', 'PB', 'RN', 'SE']::text[], 'America/Recife', array['America/Fortaleza', 'America/Maceio']::text[]),
  ('TRF6', 'Tribunal Regional Federal da 6ª Região', null, '4', '06', 'federal', array['MG']::text[], 'America/Sao_Paulo', '{}'::text[])
on conflict (acronym) do nothing;

insert into public.court_systems (court, proceeding_kind, system, host, source, sampled_on) values
  ('TRT1', 'comum', 'pje', 'pje.trt1.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT2', 'comum', 'pje', 'pje.trt2.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT3', 'comum', 'pje', 'pje.trt3.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT4', 'comum', 'pje', 'pje.trt4.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT5', 'comum', 'pje', 'pje.trt5.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT6', 'comum', 'pje', 'pje.trt6.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT7', 'comum', 'pje', 'pje.trt7.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT8', 'comum', 'pje', 'pje.trt8.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT9', 'comum', 'pje', 'pje.trt9.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT10', 'comum', 'pje', 'pje.trt10.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT11', 'comum', 'pje', 'pje.trt11.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT12', 'comum', 'pje', 'pje.trt12.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT13', 'comum', 'pje', 'pje.trt13.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT14', 'comum', 'pje', 'pje.trt14.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT15', 'comum', 'pje', 'pje.trt15.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT16', 'comum', 'pje', 'pje.trt16.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT17', 'comum', 'pje', 'pje.trt17.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT18', 'comum', 'pje', 'pje.trt18.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT19', 'comum', 'pje', 'pje.trt19.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT20', 'comum', 'pje', 'pje.trt20.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT21', 'comum', 'pje', 'pje.trt21.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT22', 'comum', 'pje', 'pje.trt22.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT23', 'comum', 'pje', 'pje.trt23.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRT24', 'comum', 'pje', 'pje.trt24.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRF1', 'juizado', 'pje', 'pje1g.trf1.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRF1', 'comum', 'pje', 'pje1g.trf1.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRF2', 'juizado', 'eproc', 'eproc.jfrj.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao eproc', '2026-11-18'),
  ('TRF2', 'comum', 'eproc', 'eproc.jfrj.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao eproc', '2026-11-18'),
  ('TRF3', 'juizado', 'pje', 'pje1g.trf3.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRF3', 'comum', 'pje', 'pje1g.trf3.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRF4', 'juizado', 'eproc', 'eproc.jfsc.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao eproc', '2026-11-18'),
  ('TRF4', 'comum', 'eproc', 'eproc.jfsc.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao eproc', '2026-11-18'),
  ('TRF5', 'juizado', 'pje', 'pje1g.trf5.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRF5', 'comum', 'pje', 'pje1g.trf5.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao PJe', '2026-11-18'),
  ('TRF6', 'juizado', 'eproc', 'eproc1g.trf6.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao eproc', '2026-11-18'),
  ('TRF6', 'comum', 'eproc', 'eproc1g.trf6.jus.br', 'Amostra do DJEN de 18/11/2026 (scripts/djen-systems.mjs): as comunicações do tribunal levam ao eproc', '2026-11-18')
on conflict (court, proceeding_kind) do nothing;

-- ---------- The DJEN watched, on the state courts ----------

/** The next court and day the DJEN is looked at for (0201), among the state courts, as before 0275. */
create or replace function public.djen_probe_due()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  last_at timestamptz;
  target text;
  target_day date := today - 1;
begin
  select max(p.at) into last_at from public.djen_probes p;
  if last_at is not null and last_at > now() - make_interval(mins => greatest(public.djen_watch_setting('probe_minutes', 60), 5)) then
    return null;
  end if;
  while extract(isodow from target_day) > 5 loop
    target_day := target_day - 1;
  end loop;
  select c.acronym into target
  from public.courts c
  left join lateral (select max(p.at) as at from public.djen_probes p where p.court = c.acronym) seen on true
  -- The state courts, as before the labour and federal ones joined the table (0275).
  where c.justice = 'estadual'
  order by seen.at nulls first, c.acronym
  limit 1;
  if target is null then
    return null;
  end if;
  return jsonb_build_object('court', target, 'day', target_day);
end;
$$;
