begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- The labour and the federal courts (0275), reference data every firm reads: the 24 regional labour courts and the 6
-- regional federal courts, each of no single state, with the states it covers and the system the DJEN showed; a
-- state's court is still its TJ alone, and the DJEN goes on being watched on the state courts.
-- ============================================================

select is(
  (select array_agg(justice || ':' || n order by justice)
   from (select justice, count(*)::text as n from public.courts group by justice) c),
  array['estadual:27', 'federal:6', 'trabalho:24'], 'the 27 state courts, the 6 federal and the 24 labour ones'
);
select is(
  (select array_agg(acronym) from public.courts where uf = 'GO'), array['TJGO'],
  'a state''s court is still its TJ alone'
);
select is(
  (select array[cnj_segment, cnj_code, array_to_string(ufs, ',')] from public.courts where acronym = 'TRT14'),
  array['5', '14', 'RO,AC'], 'a labour court by its number''s segment and code, with the states it covers'
);
select is(
  (select array[cnj_segment, cnj_code] from public.courts where acronym = 'TRF6'), array['4', '06'],
  'and a federal one'
);
select is(
  (select system from public.court_systems where court = 'TRT18' and proceeding_kind = 'comum'), 'pje',
  'the labour courts run in PJe, as the DJEN showed'
);
select is(
  (select array_agg(court || ':' || system order by court) from public.court_systems
   where court like 'TRF%' and proceeding_kind = 'juizado'),
  array['TRF1:pje', 'TRF2:eproc', 'TRF3:pje', 'TRF4:eproc', 'TRF5:pje', 'TRF6:eproc'],
  'and each federal court''s small-claims courts in its own system'
);
select throws_ok(
  $$insert into public.courts (acronym, name, uf, cnj_segment, cnj_code, justice) values ('TRT30', 'Inventado', 'GO', '5', '30', 'trabalho')$$,
  '23514', null, 'a regional court is of no single state'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select ok(
  (select c.justice = 'estadual' from public.courts c where c.acronym = public.djen_probe_due() ->> 'court'),
  'the DJEN goes on being watched on the state courts'
);
reset role;

select * from finish();
rollback;
