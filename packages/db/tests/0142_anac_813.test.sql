begin;
create extension if not exists pgtap;
select plan(6);

-- ============================================================
-- The platform's library follows Resolução nº 813/2026 of ANAC (0143): arts.
-- 20, 26 and 27 of Resolução nº 400 in their new words, keeping the words of
-- 2016 for earlier flights, art. 27-B new; a piece is handed the words in
-- force on the day of its case's flight. Two firms: a firm's own source of a
-- key stays the firm's, and nothing of one firm reaches the other.
--
-- Every person, firm and number here is invented: the lawsuits are of 2099.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1420000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@anacone.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1420000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@anacone.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1420000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-anacone', 'a1420000-0000-4000-8000-000000000001'),
  ('b1420000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-anacone', 'a1420000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1420000-0000-4000-8000-00000000000a', 'a1420000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1420000-0000-4000-8000-00000000000b', 'a1420000-0000-4000-8000-000000000002', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.source(wanted text) returns public.legal_sources language sql as
$$ select * from public.legal_sources where org_id is null and key = public.legal_source_key('resolucao', 'ANAC', '400', wanted); $$;

-- A case whose flight was on a day, its lawsuit, and a draft whose first text a worker holds the claim of.
create function pg_temp.draft(name text, who uuid, org uuid, flight date, cnj text) returns void
language plpgsql as $$
declare
  made jsonb;
  filed jsonb;
  made_draft uuid;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  made := public.create_case(org, 'cancellation', 'LA', flight,
    jsonb_build_object('full_name', 'Cliente ' || initcap(name), 'birth_date', '1985-04-02'));
  filed := public.save_proceeding((made ->> 'case_id')::uuid, null,
    jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'system', 'projudi', 'comarca', 'Goiânia', 'status', 'filed',
      'cnj', cnj, 'filed_at', to_char(current_date, 'YYYY-MM-DD')),
    array[(made ->> 'party_id')::uuid]);
  reset role;
  insert into public.case_drafts (org_id, case_id, proceeding_id, template_name, template_body, mode, status, work,
    work_claims, work_claimed_at)
  values (org, (made ->> 'case_id')::uuid, (filed ->> 'proceeding_id')::uuid, 'Inicial', 'Texto do modelo da inicial de teste.', 'ai',
    'generating', 'generate', 1, now())
  returning id into made_draft;
  insert into res values (name, made || jsonb_build_object('draft_id', made_draft));
end;
$$;

-- The library a worker is handed of a draft, by key.
create function pg_temp.library(name text) returns jsonb language plpgsql as $$
declare
  handed jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  select w.library into handed from public.case_draft_to_work(pg_temp.got(name, 'draft_id')::uuid, 1) w;
  execute 'reset role';
  return (select jsonb_object_agg(item ->> 'chave', item) from jsonb_array_elements(handed) item);
end;
$$;

select ok(
  (select in_force_from = date '2026-11-25' and quote like 'Art. 20. O transportador deverá informar ao passageiro, de forma clara%'
          and quote like '%§ 3º As informações disponibilizadas por meio de canais digitais%'
          and quote_before like 'Art. 20. O transportador deverá informar imediatamente%'
          and source_url like 'https://www.in.gov.br/%'
   from pg_temp.source('20'))
  and (select in_force_from = date '2026-10-26' and quote like '%Parágrafo único. A obrigação prevista neste artigo não se confunde%'
              and quote_before not like '%Parágrafo único%'
       from pg_temp.source('26')),
  'arts. 20 and 26 take the words of Resolução nº 813, each from its own day, keeping the words of 2016'
);

select ok(
  (select in_force_from = date '2026-10-26' and quote like '%I - (revogado);%' and quote not like '%facilidades de comunicação%'
          and quote like '%crédito para alimentação%' and quote_before like '%I - superior a 1 (uma) hora: facilidades de comunicação;%'
   from pg_temp.source('27'))
  and (select status = 'verified' and in_force_from = date '2026-10-26' and quote_before is null
              and quote like 'Art. 27-B. Excepcionalmente%' and citation like '%27-B%'
       from pg_temp.source('27B')),
  'art. 27 loses the means of communication from 26/10/2026, and art. 27-B joins the platform''s library'
);

select pg_temp.draft('antes', 'a1420000-0000-4000-8000-000000000001', 'b1420000-0000-4000-8000-00000000000a',
  date '2026-09-20', '5001001-82.2099.8.09.0051');
select pg_temp.draft('depois', 'a1420000-0000-4000-8000-000000000001', 'b1420000-0000-4000-8000-00000000000a',
  date '2026-11-02', '5001002-67.2099.8.09.0051');
insert into res values ('antes-lib', pg_temp.library('antes'));
insert into res values ('depois-lib', pg_temp.library('depois'));

select ok(
  pg_temp.got('antes-lib', 'resolucao:ANAC:400#27')::jsonb ->> 'trecho' like '%I - superior a 1 (uma) hora: facilidades de comunicação;%'
  and pg_temp.got('antes-lib', 'resolucao:ANAC:400#27')::jsonb ->> 'redacao' = 'redação anterior a 26/10/2026, a do dia do voo'
  and pg_temp.got('antes-lib', 'resolucao:ANAC:400#20')::jsonb ->> 'trecho' like 'Art. 20. O transportador deverá informar imediatamente%',
  'a flight before Resolução nº 813 is handed the words of 2016, said as the earlier words'
);

select ok(
  pg_temp.got('depois-lib', 'resolucao:ANAC:400#27')::jsonb ->> 'trecho' like '%I - (revogado);%'
  and pg_temp.got('depois-lib', 'resolucao:ANAC:400#27')::jsonb ->> 'redacao' = 'redação em vigor desde 26/10/2026'
  -- Art. 20 changed only on 25/11/2026: a flight of 2 November still has its words of 2016.
  and pg_temp.got('depois-lib', 'resolucao:ANAC:400#20')::jsonb ->> 'trecho' like 'Art. 20. O transportador deverá informar imediatamente%'
  and pg_temp.got('depois-lib', 'resolucao:ANAC:400#14')::jsonb is null
  and (pg_temp.got('depois-lib', 'lei::8078#14')::jsonb ->> 'redacao') is null,
  'a flight after it is handed the new words, each article by its own day, and a source that never changed says nothing of it'
);

-- Firm B has its own words for art. 27: its pieces are handed them, and firm A never sees them.
insert into public.legal_sources (org_id, kind, issuer, number, article, title, quote, source_url, status)
values ('b1420000-0000-4000-8000-00000000000b', 'resolucao', 'ANAC', '400', '27', 'Art. 27 nas palavras do escritório',
  'Texto do art. 27 que o escritório B conferiu.', 'https://www.anac.gov.br/', 'verified');
select pg_temp.draft('beta', 'a1420000-0000-4000-8000-000000000002', 'b1420000-0000-4000-8000-00000000000b',
  date '2026-11-02', '5001003-52.2099.8.09.0051');
insert into res values ('beta-lib', pg_temp.library('beta'));
insert into res values ('depois-lib-2', pg_temp.library('depois'));
select ok(
  pg_temp.got('beta-lib', 'resolucao:ANAC:400#27')::jsonb ->> 'trecho' = 'Texto do art. 27 que o escritório B conferiu.'
  and pg_temp.got('depois-lib-2', 'resolucao:ANAC:400#27')::jsonb ->> 'trecho' like '%I - (revogado);%',
  'a firm''s own words for a key are its pieces'' own, and nothing of firm B reaches firm A'
);

select pg_temp.sign_in('a1420000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(
  (select count(*) = 0 from public.legal_sources where org_id = 'b1420000-0000-4000-8000-00000000000b')
  and (select quote_before is not null from public.legal_sources
       where org_id is null and key = 'resolucao:ANAC:400#27'),
  'a person of firm A reads the platform''s words of both times, and none of firm B''s'
);
reset role;

select * from finish();
rollback;
