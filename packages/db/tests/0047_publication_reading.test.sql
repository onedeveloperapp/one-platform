begin;
create extension if not exists pgtap;
select plan(46);

-- ============================================================
-- ONE reads, in a publication triaged as a deadline or a hearing of a
-- lawsuit of the firm, the term or the hearing it sets, and records it
-- through the person's own functions, as ONE, where the firm lets it
-- (0040). What the AI read is taken only when the publication's words say
-- it and say nothing that could make it wrong; the rest is left to a
-- person, with why, and a hearing nobody wrote is watched until somebody
-- does it. Two firms.
--
-- Every person, firm and number here is invented: the lawsuits are of a year
-- to come.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a4700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-leitura.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a4700000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza-leitura.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a4700000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-leitura.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b4700000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-leitura', 'a4700000-0000-4000-8000-000000000001'),
  ('b4700000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-leitura', 'a4700000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b4700000-0000-4000-8000-00000000000a', 'a4700000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b4700000-0000-4000-8000-00000000000a', 'a4700000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b4700000-0000-4000-8000-00000000000b', 'a4700000-0000-4000-8000-000000000004', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert, update on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.pub(name text) returns uuid language sql as
$$ select (payload ->> pub.name)::uuid from res where res.name = 'pubs'; $$;
create function pg_temp.reading(name text) returns jsonb language sql as
$$ select to_jsonb(r) from public.publication_readings r where r.publication_id = pg_temp.pub(reading.name); $$;
-- A day some days from today, as a court writes it and as the AI answers it.
create function pg_temp.day(offset_days integer) returns text language sql as
$$ select to_char(current_date + offset_days, 'DD/MM/YYYY'); $$;
create function pg_temp.iso(offset_days integer) returns text language sql as
$$ select to_char(current_date + offset_days, 'YYYY-MM-DD'); $$;

-- A case of a firm with a lawsuit the court has (TJGO, Goiânia), as a person of the firm records it.
create function pg_temp.lawsuit(org uuid, cpf text, cnj text) returns jsonb language plpgsql as $$
declare
  made jsonb := public.create_case(org, 'delay', 'G3', date '2026-01-20',
    jsonb_build_object('full_name', 'Maria Teste', 'cpf', cpf, 'birth_date', '1985-04-02'));
  saved jsonb;
begin
  saved := public.save_proceeding((made ->> 'case_id')::uuid, null,
    jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'system', 'projudi', 'comarca', 'Goiânia', 'status', 'filed',
      'cnj', cnj, 'filed_at', '2026-02-02'),
    array[(made ->> 'party_id')::uuid]);
  return made || jsonb_build_object('proceeding_id', saved ->> 'proceeding_id');
end;
$$;
-- A publication of a lawsuit of a firm, as the reading of the gazette keeps it.
create function pg_temp.of(case_name text, body text, hash text, available date default current_date - 2)
returns uuid language sql as $$
  insert into public.publications (org_id, hash, court, cnj, available_on, kind, body, head, proceeding_id, case_id)
  select coalesce(c.payload ->> 'org', 'b4700000-0000-4000-8000-00000000000a')::uuid, hash, 'TJGO', c.payload ->> 'cnj',
    available, 'Intimação', body, left(body, 120), (c.payload ->> 'proceeding_id')::uuid, (c.payload ->> 'case_id')::uuid
  from res c where c.name = of.case_name
  returning id;
$$;
-- The AI's answer to a reading, as the executor records a run (called as the service role).
create function pg_temp.ran(org uuid, task text, publication uuid, answer jsonb) returns uuid language plpgsql as $$
declare
  started jsonb := public.start_ai_run(org, task, md5(answer::text) || md5(publication::text), null,
    'publication', publication::text, task || ':' || publication::text || ':' || md5(answer::text));
begin
  perform public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded', answer, 900, 120);
  return (started ->> 'run_id')::uuid;
end;
$$;
-- A reading claimed by name, read and recorded with the AI's answer.
create function pg_temp.read(name text, kind text, answer jsonb) returns jsonb language plpgsql as $$
declare
  held record;
  publication uuid := pg_temp.pub(name);
begin
  select * into held from public.claim_publication_readings(1, publication) c where c.kind = read.kind;
  if not found then
    return jsonb_build_object('claimed', false);
  end if;
  return public.record_publication_reading(publication, kind, held.claim, 'done',
    pg_temp.ran((select org_id from public.publications where id = publication),
      case kind when 'deadline' then 'publicacao.prazo' else 'publicacao.audiencia' end, publication, answer),
    null) || jsonb_build_object('claimed', true);
end;
$$;
-- The AI's answer for a term of so many days.
create function pg_temp.term(days integer, excerpt text, act text default 'outro', counting text default 'uteis')
returns jsonb language sql as $$
  select jsonb_build_object('ha_prazo', true, 'dias', days, 'contagem', counting, 'a_partir', 'publicacao', 'ato', act,
    'trecho', excerpt, 'observacoes', '');
$$;
-- The AI's answer for a hearing on a day and at an hour.
create function pg_temp.hearing(day_iso text, hour text, kind text, mode text, place text, link text, excerpt text,
  situation text default 'marcada') returns jsonb language sql as $$
  select jsonb_build_object('ha_audiencia', true, 'situacao', situation, 'data', day_iso, 'hora', hour,
    'tipo', kind, 'modo', mode, 'local', place, 'link', link, 'trecho', excerpt, 'observacoes', '');
$$;

select pg_temp.sign_in('a4700000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_1', pg_temp.lawsuit('b4700000-0000-4000-8000-00000000000a', '12345678909', '5000101-02.2099.8.09.0051')
  || '{"cnj": "50001010220998090051"}'::jsonb);
insert into res values ('case_2', pg_temp.lawsuit('b4700000-0000-4000-8000-00000000000a', '52998224725', '5000202-39.2099.8.09.0051')
  || '{"cnj": "50002023920998090051"}'::jsonb);
insert into res values ('case_3', pg_temp.lawsuit('b4700000-0000-4000-8000-00000000000a', '11144477735', '5000303-76.2099.8.09.0051')
  || '{"cnj": "50003037620998090051"}'::jsonb);
insert into res values ('case_4', pg_temp.lawsuit('b4700000-0000-4000-8000-00000000000a', null, '5000505-53.2099.8.09.0051')
  || '{"cnj": "50005055320998090051"}'::jsonb);
-- Hearings a person wrote by hand, from their cases: one the agenda has at the moment a publication sets, one at
-- another hour of the day another publication sets.
insert into res values ('by_hand_same', public.save_hearing(null, pg_temp.got('case_2', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'presencial', 'day', pg_temp.iso(35), 'time', '11:00')));
insert into res values ('by_hand_other', public.save_hearing(null, pg_temp.got('case_2', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'presencial', 'day', pg_temp.iso(40), 'time', '15:00')));
reset role;
-- The third lawsuit was closed: no hearing is written in it.
update public.proceedings set status = 'closed' where id = pg_temp.got('case_3', 'proceeding_id')::uuid;
select pg_temp.sign_in('a4700000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', pg_temp.lawsuit('b4700000-0000-4000-8000-00000000000b', '12345678909', '5000808-67.2099.8.09.0051')
  || '{"cnj": "50008086720998090051", "org": "b4700000-0000-4000-8000-00000000000b"}'::jsonb);
reset role;

insert into res values ('pubs', jsonb_build_object(
  -- Terms.
  'term', pg_temp.of('case_1',
    'Vistos. Fica a parte autora intimada para, no prazo de 15 (quinze) dias, manifestar-se sobre os documentos juntados.',
    'leitura-term-00000000000001'),
  'wrong', pg_temp.of('case_1', 'Intime-se a parte autora para, em 10 (dez) dias, juntar o comprovante de residência.',
    'leitura-wrong-0000000000001'),
  'days', pg_temp.of('case_1', 'Intime-se a parte autora para, em 10 (dez) dias, juntar o comprovante de residência.',
    'leitura-days-00000000000001'),
  'calendar', pg_temp.of('case_2', 'Manifeste-se a parte autora no prazo de cinco dias corridos sobre o laudo.',
    'leitura-calendar-0000000001'),
  'decorrido', pg_temp.of('case_2', 'Manifeste-se a parte autora em 5 (cinco) dias sobre o laudo. Decorrido o prazo, conclusos.',
    'leitura-decorrido-000000001'),
  'struck', pg_temp.of('case_1',
    '<p>Intime-se a parte autora para, no prazo de <s>5 (cinco)</s> 15 (quinze) dias, emendar a inicial.</p>',
    'leitura-struck-00000000001'),
  'start', pg_temp.of('case_2',
    'Intime-se a parte autora para, no prazo de 15 (quinze) dias, a contar da juntada do mandado, se manifestar.',
    'leitura-start-0000000000001'),
  'thisdate', pg_temp.of('case_2', 'Prazo de 10 (dez) dias a contar desta data para alegações finais.',
    'leitura-thisdate-0000000001'),
  'fromintimation', pg_temp.of('case_1',
    'Intime-se a parte autora para, no prazo de 15 (quinze) dias, contados a partir da intimação, juntar a procuração.',
    'leitura-fromintim-000000001'),
  'two', pg_temp.of('case_2',
    'Intime-se a ré para contestar em 15 (quinze) dias e a autora para, em 5 (cinco) dias, juntar procuração.',
    'leitura-two-000000000000001'),
  'wrongact', pg_temp.of('case_1', 'Intime-se a parte autora para, no prazo de 15 dias, se manifestar.',
    'leitura-wrongact-0000000001'),
  'person', pg_temp.of('case_2', 'Intime-se para, no prazo de 15 dias, apresentar réplica.', 'leitura-person-00000000001'),
  'old', pg_temp.of('case_2', 'Intime-se para, no prazo de 15 dias, apresentar réplica.', 'leitura-old-000000000000001',
    current_date - 30),
  'cut', pg_temp.of('case_1', 'Intime-se a parte autora para, no prazo de 15 (quinze) dias, juntar o laudo.',
    'leitura-cut-000000000000001'),
  'hours', pg_temp.of('case_1',
    'Intime-se a parte autora para, em 48 (quarenta e oito) horas, informar o endereço e, no prazo de 5 (cinco) dias, juntar o bilhete.',
    'leitura-hours-0000000000001'),
  'list', pg_temp.of('case_1', 'Intime-se a parte autora para, em 15 e 30 dias, juntar os documentos.',
    'leitura-list-00000000000001'),
  'inhearing', pg_temp.of('case_1',
    'Sentença proferida em audiência. Saem as partes intimadas para, no prazo de 10 (dez) dias, recorrer.',
    'leitura-inhearing-000000001'),
  'corridosafter', pg_temp.of('case_1', 'Manifeste-se a parte autora em 5 (cinco) dias corridos sobre o laudo.',
    'leitura-corridos-0000000001'),
  'after', pg_temp.of('case_1',
    'Após o trânsito em julgado, intime-se a parte autora para, no prazo de 15 (quinze) dias, requerer o cumprimento da sentença.',
    'leitura-after-0000000000001'),
  'hoursglued', pg_temp.of('case_1',
    'Intime-se a parte autora para, no prazo de 48h, regularizar a representação, e, no prazo de 15 (quinze) dias, manifestar-se sobre a contestação.',
    'leitura-hoursglued-00000001'),
  'listwords', pg_temp.of('case_1',
    'Intimem-se as partes para se manifestarem no prazo de 15 (quinze) e 30 (trinta) dias, respectivamente.',
    'leitura-listwords-000000001'),
  'ficam', pg_temp.of('case_1',
    'Ficam as partes intimadas para, no prazo de 5 (cinco) dias, especificarem as provas que pretendem produzir.',
    'leitura-ficam-0000000000001'))
  -- A call takes a hundred arguments at most: the hearings in an object of their own.
  || jsonb_build_object(
  -- Hearings.
  'hearing', pg_temp.of('case_1', 'Designo audiência de conciliação para o dia ' || pg_temp.day(30)
      || ', às 14h30, por videoconferência, na sala <a href="https://sala.exemplo.invalid/aud1?x=1&amp;y=2">de audiências virtual</a>.',
    'leitura-hearing-00000000001'),
  'plain', pg_temp.of('case_4', 'Fica designada audiência para o dia ' || pg_temp.day(31)
      || ', às 10h00, na sala 2 do Juizado Especial Cível.', 'leitura-plain-0000000000001'),
  'agenda', pg_temp.of('case_2', 'Designo audiência de conciliação para o dia ' || pg_temp.day(35) || ', às 11h, no fórum.',
    'leitura-agenda-00000000001'),
  'conflict', pg_temp.of('case_2', 'Designo audiência de conciliação para o dia ' || pg_temp.day(40) || ', às 16h, no fórum.',
    'leitura-conflict-0000000001'),
  'moved', pg_temp.of('case_2', 'Designo para o dia ' || pg_temp.day(41) || ', às 9h, a audiência de conciliação.',
    'leitura-moved-0000000000001'),
  'movedtext', pg_temp.of('case_1', 'Redesigno a audiência designada para ' || pg_temp.day(42) || ', às 14h, para '
      || pg_temp.day(43) || ', às 9h.', 'leitura-movedtext-000000001'),
  'mode', pg_temp.of('case_1', 'Designo audiência de conciliação para o dia ' || pg_temp.day(44)
      || ', às 15h, por videoconferência.', 'leitura-mode-00000000000001'),
  'place', pg_temp.of('case_2', 'Designo audiência de instrução e julgamento para o dia ' || pg_temp.day(45)
      || ', às 16h, na sala 3 do Fórum Cível.', 'leitura-place-0000000000001'),
  'link', pg_temp.of('case_1', 'Designo audiência una para o dia ' || pg_temp.day(46)
      || ', às 11h, por videoconferência, na sala virtual https://sala.exemplo.invalid/aud2.', 'leitura-link-00000000000001'),
  'prefix', pg_temp.of('case_2', 'Designo audiência de conciliação para o dia ' || pg_temp.day(47)
      || ', às 13h, por videoconferência, no endereço https://sala.exemplo.invalid/j/81234567890?pwd=AbC.',
    'leitura-prefix-00000000001'),
  'notime', pg_temp.of('case_1', 'Designo audiência de conciliação para o dia 10/11/2099.',
    'leitura-notime-00000000001'),
  'judgment', pg_temp.of('case_1', 'Processo incluído na pauta da sessão virtual de julgamento da Turma Recursal, com início em '
      || pg_temp.day(49) || ', às 14h.', 'leitura-judgment-0000000001'),
  'twodates', pg_temp.of('case_1', 'Designo audiência de conciliação para o dia ' || pg_temp.day(50)
      || ', às 14h. Designo audiência de instrução para o dia ' || pg_temp.day(51) || ', às 9h.', 'leitura-twodates-0000000001'),
  'switch', pg_temp.of('case_1', 'Designo audiência de conciliação para o dia ' || pg_temp.day(52)
      || ', às 17h, por videoconferência.', 'leitura-switch-00000000001'),
  'notfiled', pg_temp.of('case_3', 'Designo audiência de conciliação para o dia ' || pg_temp.day(53) || ', às 10h.',
    'leitura-notfiled-0000000001'),
  'kinds', pg_temp.of('case_1', 'Designo audiência de conciliação para o dia ' || pg_temp.day(54) || ', às 10h.',
    'leitura-kinds-0000000000001'),
  'twohours', pg_temp.of('case_1', 'Designo audiência de conciliação para o dia ' || pg_temp.day(56)
      || ', às 14h, e de instrução, no mesmo dia, às 16h.', 'leitura-twohours-0000000001'),
  'cancelfar', pg_temp.of('case_1', 'A audiência designada para o dia ' || pg_temp.day(57)
      || ', às 14h, na sala 2 do fórum, fica cancelada.', 'leitura-cancelfar-000000001'),
  'mixed', pg_temp.of('case_1', 'Designo audiência presencial de conciliação para o dia ' || pg_temp.day(58)
      || ', às 15h, facultada aos advogados a participação por videoconferência.', 'leitura-mixed-0000000000001'),
  'twolinks', pg_temp.of('case_1', 'Designo audiência de conciliação para o dia ' || pg_temp.day(59)
      || ', às 11h, por videoconferência, na sala https://sala.exemplo.invalid/aud5. Consulte o processo em https://tribunal.exemplo.invalid/consulta.',
    'leitura-twolinks-0000000001'),
  'zone', pg_temp.of('case_1', 'Designo audiência de conciliação para o dia ' || pg_temp.day(61)
      || ', às 9h (horário de Brasília), por videoconferência.', 'leitura-zone-00000000000001'),
  'reappear', pg_temp.of('case_2', 'Designo audiência de conciliação para o dia ' || pg_temp.day(62) || ', às 9h, no fórum.',
    'leitura-reappear-0000000001'),
  'reapraz', pg_temp.of('case_2', 'Defiro o pedido de reaprazamento da ré. Designo nova audiência de conciliação para o dia '
      || pg_temp.day(64) || ', às 14h, na sala 2.', 'leitura-reapraz-00000000001'),
  'another', pg_temp.of('case_2', 'Designo audiência de instrução e julgamento para o dia ' || pg_temp.day(70)
      || ', às 14h, no fórum.', 'leitura-another-00000000001'),
  'samemoment', pg_temp.of('case_2', 'Designo audiência de conciliação para o dia ' || pg_temp.day(35)
      || ', às 11h, por videoconferência, na sala https://sala.exemplo.invalid/aud7.', 'leitura-samemoment-00000001'),
  'twohearings', pg_temp.of('case_1', 'Designo audiência de conciliação para o dia ' || pg_temp.day(63)
      || ', às 14h. Não havendo acordo, fica designada audiência de instrução para o dia 24/11, no mesmo horário.',
    'leitura-twohearings-0000001'),
  'sameroom', pg_temp.of('case_4', 'Fica designada audiência para o dia ' || pg_temp.day(31)
      || ', às 10h00, na sala 5 do Juizado Especial Cível.', 'leitura-sameroom-0000000001'),
  'sameday', pg_temp.of('case_b', 'Designo audiência de conciliação para o dia ' || pg_temp.day(66) || ', às 15h, no fórum.',
    'leitura-sameday-00000000001'),
  -- The work of the backend.
  'retry', pg_temp.of('case_2', 'Intime-se a autora para, em 5 dias, juntar documentos.', 'leitura-retry-0000000000001'),
  'release', pg_temp.of('case_2', 'Intime-se a autora para, em 5 dias, juntar a procuração.', 'leitura-release-00000000001'),
  'stale', pg_temp.of('case_2', 'Intime-se a autora para, em 5 dias, juntar o contrato.', 'leitura-stale-0000000000001'),
  'wait', pg_temp.of('case_2', 'Intime-se a autora para, em 5 dias, juntar o bilhete.', 'leitura-wait-00000000000001'),
  'unlink', pg_temp.of('case_2', 'Intime-se a autora para, em 5 dias, juntar o cartão.', 'leitura-unlink-00000000001'),
  'cancel', pg_temp.of('case_2', 'Intime-se a autora para, em 5 dias, juntar a nota.', 'leitura-cancel-00000000001'),
  -- Of the other firm.
  'firm_b', pg_temp.of('case_b', 'Fica a parte autora intimada para, no prazo de 15 (quinze) dias, manifestar-se.',
    'leitura-firm-b-00000000001')));
-- A publication triaged as a hearing of a lawsuit the firm does not have in ONE.
insert into public.publications (org_id, hash, court, cnj, available_on, kind, body, head)
values ('b4700000-0000-4000-8000-00000000000a', 'leitura-nolawsuit-000000001', 'TJGO', '50004041620998090051',
  current_date - 2, 'Intimação', 'Designo audiência para o dia ' || pg_temp.day(55) || ', às 9h.', 'Designo audiência');
update res set payload = payload || jsonb_build_object('nolawsuit',
  (select id from public.publications where hash = 'leitura-nolawsuit-000000001')) where name = 'pubs';

-- People of each firm triage them.
select pg_temp.sign_in('a4700000-0000-4000-8000-000000000001');
set local role authenticated;
select public.triage_publication(pg_temp.pub(x), 'prazo')
from unnest(array['term', 'wrong', 'days', 'calendar', 'decorrido', 'struck', 'start', 'thisdate', 'fromintimation', 'two',
  'wrongact', 'person', 'old', 'retry', 'release', 'stale', 'wait', 'unlink', 'cancel', 'cut', 'hours', 'list', 'inhearing',
  'corridosafter', 'after', 'hoursglued', 'listwords', 'ficam']) as x;
select public.triage_publication(pg_temp.pub(x), 'audiencia')
from unnest(array['hearing', 'plain', 'agenda', 'conflict', 'moved', 'movedtext', 'mode', 'place', 'link', 'prefix', 'notime',
  'judgment', 'twodates', 'switch', 'notfiled', 'kinds', 'nolawsuit', 'twohours', 'cancelfar', 'mixed', 'twolinks', 'zone',
  'reappear', 'reapraz', 'another', 'samemoment', 'twohearings', 'sameroom']) as x;
-- A hearing a person wrote by hand and cancelled, on the day another publication sets.
insert into res values ('by_hand_cancelled', public.save_hearing(null, pg_temp.got('case_2', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'presencial', 'day', pg_temp.iso(62), 'time', '09:00')));
select public.set_hearing_status(pg_temp.got('by_hand_cancelled', 'id')::uuid, 'cancelled', null, 'Desmarcada pelo juízo.');
-- A person proposes the deadline of one before ONE reads it.
insert into res values ('by_person', public.propose_deadline(pg_temp.pub('person'), null,
  'Réplica', 'replica', 'publication', null, 15, 'business'));
reset role;
-- One was triaged long ago.
update public.publications set triaged_at = now() - interval '11 days' where id = pg_temp.pub('old');
select pg_temp.sign_in('a4700000-0000-4000-8000-000000000004');
set local role authenticated;
select public.triage_publication(pg_temp.pub('firm_b'), 'prazo');
-- A hearing of the other firm's lawsuit a person wrote and cancelled, on the day a publication of it sets, with none
-- to come.
insert into res values ('b_cancelled', public.save_hearing(null, pg_temp.got('case_b', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'presencial', 'day', pg_temp.iso(66), 'time', '10:00')));
select public.set_hearing_status(pg_temp.got('b_cancelled', 'id')::uuid, 'cancelled', null, 'Desmarcada pelo juízo.');
select public.triage_publication(pg_temp.pub('sameday'), 'audiencia');
reset role;

select ok(
  (select count(*) = 55 from public.publication_readings r where r.org_id = 'b4700000-0000-4000-8000-00000000000a' and r.status = 'due')
  and (pg_temp.reading('hearing') ->> 'kind') = 'hearing' and (pg_temp.reading('term') ->> 'kind') = 'deadline'
  and pg_temp.reading('nolawsuit') is null
  and (pg_temp.reading('firm_b') ->> 'status') = 'due',
  'a publication triaged as a deadline or a hearing of a lawsuit of a firm that lets ONE read owes its reading'
);

-- ---------- Terms ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_term', pg_temp.read('term', 'deadline',
  pg_temp.term(15, 'Fica a parte autora intimada para, no prazo de 15 (quinze) dias, manifestar-se sobre os documentos juntados.',
    'manifestacao_documentos')));
reset role;

select ok(
  pg_temp.got('read_term', 'code') = 'done'
  and (select d.proposed_auto and d.created_by is null and d.days = 15 and d.counting = 'business'
              and d.trigger = 'publication' and d.trigger_on = current_date - 2 and d.act = 'manifestacao_documentos'
              and d.title = 'Manifestação sobre documentos'
       from public.deadlines d where d.publication_id = pg_temp.pub('term'))
  and (pg_temp.reading('term') ->> 'deadline_id') is not null
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_1', 'case_id')::uuid
              and e.kind = 'deadline_proposed' and e.actor_type = 'system')
  and exists (select 1 from public.audit_events a where a.action = 'deadline.proposed' and a.actor_id is null
              and (a.metadata ->> 'auto')::boolean),
  'ONE proposes the deadline the publication sets, counted from the publication by the rule, as ONE'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_wrong', pg_temp.read('wrong', 'deadline',
  pg_temp.term(10, 'Intime-se a parte autora para, em 10 (dez) dias úteis, juntar a procuração.')));
insert into res values ('read_days', pg_temp.read('days', 'deadline',
  pg_temp.term(15, 'Intime-se a parte autora para, em 10 (dez) dias, juntar o comprovante de residência.')));
insert into res values ('read_struck', pg_temp.read('struck', 'deadline',
  pg_temp.term(15, 'Intime-se a parte autora para, no prazo de 15 (quinze) dias, emendar a inicial.')));
insert into res values ('read_start', pg_temp.read('start', 'deadline',
  pg_temp.term(15, 'Intime-se a parte autora para, no prazo de 15 (quinze) dias')));
insert into res values ('read_thisdate', pg_temp.read('thisdate', 'deadline',
  pg_temp.term(10, 'Prazo de 10 (dez) dias a contar desta data para alegações finais.')));
insert into res values ('read_two', pg_temp.read('two', 'deadline',
  pg_temp.term(15, 'Intime-se a ré para contestar em 15 (quinze) dias')));
reset role;
-- Triaged as something else and back: what ONE left to a person stays the person's.
select pg_temp.sign_in('a4700000-0000-4000-8000-000000000001');
set local role authenticated;
select public.triage_publication(pg_temp.pub('wrong'), 'ciencia');
select public.triage_publication(pg_temp.pub('wrong'), 'prazo');
reset role;

select ok(
  pg_temp.got('read_wrong', 'reason') = 'excerpt_not_in_text'
  and (pg_temp.reading('wrong') ->> 'status') = 'unread'
  and pg_temp.got('read_days', 'reason') = 'days_not_in_excerpt'
  and pg_temp.got('read_struck', 'reason') = 'struck_text'
  and pg_temp.got('read_start', 'reason') = 'other_start'
  and pg_temp.got('read_thisdate', 'reason') = 'other_start'
  and pg_temp.got('read_two', 'reason') = 'several_terms'
  and not exists (select 1 from public.deadlines d where d.publication_id in
    (pg_temp.pub('wrong'), pg_temp.pub('days'), pg_temp.pub('struck'), pg_temp.pub('start'), pg_temp.pub('thisdate'),
     pg_temp.pub('two'))),
  'a term the words do not say, or say with something that could make it wrong, is left to a person'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_calendar', pg_temp.read('calendar', 'deadline',
  pg_temp.term(5, 'Manifeste-se a parte autora no prazo de cinco dias corridos sobre o laudo.', 'manifestacao')));
insert into res values ('read_decorrido', pg_temp.read('decorrido', 'deadline',
  pg_temp.term(5, 'Manifeste-se a parte autora em 5 (cinco) dias sobre o laudo. Decorrido o prazo, conclusos.', 'manifestacao')));
insert into res values ('read_fromintimation', pg_temp.read('fromintimation', 'deadline',
  pg_temp.term(15, 'Intime-se a parte autora para, no prazo de 15 (quinze) dias, contados a partir da intimação, juntar a procuração.')));
insert into res values ('read_wrongact', pg_temp.read('wrongact', 'deadline',
  pg_temp.term(15, 'Intime-se a parte autora para, no prazo de 15 dias, se manifestar.', 'replica')));
reset role;

select ok(
  pg_temp.got('read_calendar', 'code') = 'done'
  and (select d.days = 5 and d.counting = 'calendar' from public.deadlines d where d.publication_id = pg_temp.pub('calendar'))
  and (select d.counting = 'business' from public.deadlines d where d.publication_id = pg_temp.pub('decorrido'))
  and pg_temp.got('read_fromintimation', 'code') = 'done'
  and (select d.act is null and d.title = 'Prazo da publicação' from public.deadlines d
       where d.publication_id = pg_temp.pub('wrongact')),
  'days in words and calendar days are read as written, "decorrido" is no calendar day, a term counted from the intimation is the publication''s, and an act the text does not name is not given'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_person', pg_temp.read('person', 'deadline',
  pg_temp.term(15, 'Intime-se para, no prazo de 15 dias, apresentar réplica.', 'replica')));
insert into res values ('read_old', pg_temp.read('old', 'deadline',
  pg_temp.term(15, 'Intime-se para, no prazo de 15 dias, apresentar réplica.', 'replica')));
reset role;

select ok(
  pg_temp.got('by_person', 'code') = 'proposed'
  and not (pg_temp.got('read_person', 'claimed'))::boolean
  and (pg_temp.reading('person') ->> 'reason') = 'recorded_by_person'
  and (select count(*) = 1 from public.deadlines d where d.publication_id = pg_temp.pub('person'))
  and not (pg_temp.got('read_old', 'claimed'))::boolean
  and (pg_temp.reading('old') ->> 'status') = 'unread' and (pg_temp.reading('old') ->> 'reason') = 'too_old',
  'what a person recorded first stands and no model is asked for it; old work is left to a person'
);

update public.publications set truncated = true where id = pg_temp.pub('cut');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_cut', pg_temp.read('cut', 'deadline',
  pg_temp.term(15, 'Intime-se a parte autora para, no prazo de 15 (quinze) dias, juntar o laudo.')));
insert into res values ('read_hours', pg_temp.read('hours', 'deadline',
  pg_temp.term(5, 'no prazo de 5 (cinco) dias, juntar o bilhete.')));
insert into res values ('read_list', pg_temp.read('list', 'deadline',
  pg_temp.term(30, 'Intime-se a parte autora para, em 15 e 30 dias, juntar os documentos.')));
insert into res values ('read_inhearing', pg_temp.read('inhearing', 'deadline',
  pg_temp.term(10, 'Saem as partes intimadas para, no prazo de 10 (dez) dias, recorrer.')));
insert into res values ('read_corridosafter', pg_temp.read('corridosafter', 'deadline',
  pg_temp.term(5, 'Manifeste-se a parte autora em 5 (cinco) dias')));
reset role;

select ok(
  pg_temp.got('read_cut', 'reason') = 'text_truncated'
  and pg_temp.got('read_hours', 'reason') = 'other_units'
  and pg_temp.got('read_list', 'reason') = 'several_terms'
  and pg_temp.got('read_inhearing', 'reason') = 'intimated_in_hearing'
  and not exists (select 1 from public.deadlines d where d.publication_id in
    (pg_temp.pub('cut'), pg_temp.pub('hours'), pg_temp.pub('list'), pg_temp.pub('inhearing'))),
  'a text cut short, a term in hours beside one in days, a list of terms and a term set in the hearing itself are left to a person'
);
select ok(
  pg_temp.got('read_corridosafter', 'code') = 'done'
  and (select d.counting = 'calendar' from public.deadlines d where d.publication_id = pg_temp.pub('corridosafter')),
  'calendar days the text says anywhere are counted so, whatever the excerpt or the AI left out'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_after', pg_temp.read('after', 'deadline',
  pg_temp.term(15, 'intime-se a parte autora para, no prazo de 15 (quinze) dias, requerer o cumprimento da sentença')));
insert into res values ('read_hoursglued', pg_temp.read('hoursglued', 'deadline',
  pg_temp.term(15, 'no prazo de 15 (quinze) dias, manifestar-se sobre a contestação')));
insert into res values ('read_listwords', pg_temp.read('listwords', 'deadline',
  pg_temp.term(30, 'Intimem-se as partes para se manifestarem no prazo de 15 (quinze) e 30 (trinta) dias, respectivamente.')));
insert into res values ('read_ficam', pg_temp.read('ficam', 'deadline',
  pg_temp.term(5, 'Ficam as partes intimadas para, no prazo de 5 (cinco) dias, especificarem as provas que pretendem produzir.')));
reset role;

select ok(
  pg_temp.got('read_after', 'reason') = 'other_start'
  and pg_temp.got('read_hoursglued', 'reason') = 'other_units'
  and pg_temp.got('read_listwords', 'reason') = 'several_terms'
  and pg_temp.got('read_ficam', 'code') = 'done'
  and exists (select 1 from public.deadlines d where d.publication_id = pg_temp.pub('ficam') and d.days = 5)
  and not exists (select 1 from public.deadlines d where d.publication_id in
    (pg_temp.pub('after'), pg_temp.pub('hoursglued'), pg_temp.pub('listwords'))),
  'a term that runs once something has happened, one in hours written onto its figure and a list in words are left to a person; "ficam as partes intimadas" is how a publication tells them'
);

-- ---------- Hearings ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_hearing', pg_temp.read('hearing', 'hearing',
  pg_temp.hearing(pg_temp.iso(30), '14:30', 'conciliacao', 'videoconferencia', null, 'https://sala.exemplo.invalid/aud1?x=1&y=2',
    'Designo audiência de conciliação para o dia ' || pg_temp.day(30)
      || ', às 14h30, por videoconferência, na sala de audiências virtual (https://sala.exemplo.invalid/aud1?x=1&y=2)')));
insert into res values ('read_plain', pg_temp.read('plain', 'hearing',
  pg_temp.hearing(pg_temp.iso(31), '10:00', 'instrucao', 'presencial', 'sala 2 do Juizado Especial Cível', null,
    'Fica designada audiência para o dia ' || pg_temp.day(31) || ', às 10h00')));
reset role;

select ok(
  pg_temp.got('read_hearing', 'code') = 'done'
  and (select h.created_auto and h.created_by is null and h.source = 'publication' and h.kind = 'conciliacao'
              and h.mode = 'videoconferencia' and h.link = 'https://sala.exemplo.invalid/aud1?x=1&y=2'
              and h.starts_at = ((pg_temp.iso(30))::date + time '14:30') at time zone 'America/Sao_Paulo'
       from public.hearings h where h.publication_id = pg_temp.pub('hearing'))
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_1', 'case_id')::uuid
              and e.kind = 'hearing_scheduled' and e.actor_type = 'system')
  and exists (select 1 from public.audit_events a where a.action = 'hearing.scheduled' and a.actor_id is null
              and (a.metadata ->> 'auto')::boolean)
  and pg_temp.got('read_plain', 'code') = 'done'
  and (select h.kind = 'outra' and h.mode = 'presencial' and h.place = 'sala 2 do Juizado Especial Cível'
       from public.hearings h where h.publication_id = pg_temp.pub('plain')),
  'ONE writes the hearing the publication sets, in the court''s zone, as ONE, with the link whole and a kind the text names'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_agenda', pg_temp.read('agenda', 'hearing',
  pg_temp.hearing(pg_temp.iso(35), '11:00', 'conciliacao', 'presencial', null, null,
    'Designo audiência de conciliação para o dia ' || pg_temp.day(35) || ', às 11h')));
insert into res values ('read_conflict', pg_temp.read('conflict', 'hearing',
  pg_temp.hearing(pg_temp.iso(40), '16:00', 'conciliacao', 'presencial', null, null,
    'Designo audiência de conciliação para o dia ' || pg_temp.day(40) || ', às 16h')));
reset role;

select ok(
  pg_temp.got('read_agenda', 'code') = 'done' and pg_temp.got('read_agenda', 'reason') = 'already_in_agenda'
  and (pg_temp.reading('agenda') ->> 'hearing_id') = pg_temp.got('by_hand_same', 'id')
  and not exists (select 1 from public.hearings h where h.publication_id = pg_temp.pub('agenda'))
  and pg_temp.got('read_conflict', 'reason') = 'conflicting_hearing'
  and not exists (select 1 from public.hearings h where h.publication_id = pg_temp.pub('conflict')),
  'a hearing the agenda has at that moment is the publication''s; another of the lawsuit that day is a person''s to weigh'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_moved', pg_temp.read('moved', 'hearing',
  pg_temp.hearing(pg_temp.iso(41), '09:00', 'conciliacao', 'presencial', null, null,
    'Designo para o dia ' || pg_temp.day(41) || ', às 9h, a audiência de conciliação.', 'redesignada')));
insert into res values ('read_movedtext', pg_temp.read('movedtext', 'hearing',
  pg_temp.hearing(pg_temp.iso(42), '14:00', 'outra', 'presencial', null, null,
    'Redesigno a audiência designada para ' || pg_temp.day(42) || ', às 14h')));
insert into res values ('read_judgment', pg_temp.read('judgment', 'hearing',
  pg_temp.hearing(pg_temp.iso(49), '14:00', 'outra', 'videoconferencia', null, null,
    'Processo incluído na pauta da sessão virtual de julgamento da Turma Recursal, com início em ' || pg_temp.day(49) || ', às 14h')));
insert into res values ('read_twodates', pg_temp.read('twodates', 'hearing',
  pg_temp.hearing(pg_temp.iso(50), '14:00', 'conciliacao', 'presencial', null, null,
    'Designo audiência de conciliação para o dia ' || pg_temp.day(50) || ', às 14h')));
insert into res values ('read_notime', pg_temp.read('notime', 'hearing',
  pg_temp.hearing('2099-11-10', '10:11', 'conciliacao', 'presencial', null, null,
    'Designo audiência de conciliação para o dia 10/11/2099')));
reset role;

select ok(
  pg_temp.got('read_moved', 'reason') = 'hearing_moved'
  and pg_temp.got('read_movedtext', 'reason') = 'hearing_changed'
  and pg_temp.got('read_judgment', 'reason') = 'judgment_session'
  and pg_temp.got('read_twodates', 'reason') = 'several_dates'
  and pg_temp.got('read_notime', 'reason') = 'time_not_in_excerpt'
  and not exists (select 1 from public.hearings h where h.publication_id in
    (pg_temp.pub('moved'), pg_temp.pub('movedtext'), pg_temp.pub('judgment'), pg_temp.pub('twodates'), pg_temp.pub('notime'))),
  'a hearing moved (by the AI''s word or the text''s), a session of judgment, a text of two days and a day read as an hour are left to a person'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_mode', pg_temp.read('mode', 'hearing',
  pg_temp.hearing(pg_temp.iso(44), '15:00', 'conciliacao', 'presencial', null, null,
    'Designo audiência de conciliação para o dia ' || pg_temp.day(44) || ', às 15h')));
insert into res values ('read_place', pg_temp.read('place', 'hearing',
  pg_temp.hearing(pg_temp.iso(45), '16:00', 'instrucao', 'presencial', 'sala 5 do Fórum Cível', null,
    'Designo audiência de instrução e julgamento para o dia ' || pg_temp.day(45) || ', às 16h')));
insert into res values ('read_link', pg_temp.read('link', 'hearing',
  pg_temp.hearing(pg_temp.iso(46), '11:00', 'una', 'videoconferencia', null, 'https://sala.exemplo.invalid/aud9',
    'Designo audiência una para o dia ' || pg_temp.day(46) || ', às 11h')));
insert into res values ('read_prefix', pg_temp.read('prefix', 'hearing',
  pg_temp.hearing(pg_temp.iso(47), '13:00', 'conciliacao', 'videoconferencia', null, 'https://sala.exemplo.invalid/j/81234567890',
    'Designo audiência de conciliação para o dia ' || pg_temp.day(47) || ', às 13h')));
reset role;

select ok(
  pg_temp.got('read_mode', 'reason') = 'mode_unclear'
  and pg_temp.got('read_place', 'reason') = 'place_not_in_text'
  and pg_temp.got('read_link', 'reason') = 'link_not_in_text'
  and pg_temp.got('read_prefix', 'reason') = 'link_not_in_text'
  and not exists (select 1 from public.hearings h where h.publication_id in
    (pg_temp.pub('mode'), pg_temp.pub('place'), pg_temp.pub('link'), pg_temp.pub('prefix'))),
  'how the client is to be there (the way, the place, the whole link) is the text''s, or a person''s'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_twohours', pg_temp.read('twohours', 'hearing',
  pg_temp.hearing(pg_temp.iso(56), '14:00', 'conciliacao', 'presencial', null, null,
    'Designo audiência de conciliação para o dia ' || pg_temp.day(56) || ', às 14h')));
insert into res values ('read_cancelfar', pg_temp.read('cancelfar', 'hearing',
  pg_temp.hearing(pg_temp.iso(57), '14:00', 'outra', 'presencial', 'sala 2 do fórum', null,
    'A audiência designada para o dia ' || pg_temp.day(57) || ', às 14h, na sala 2 do fórum')));
insert into res values ('read_mixed', pg_temp.read('mixed', 'hearing',
  pg_temp.hearing(pg_temp.iso(58), '15:00', 'conciliacao', 'videoconferencia', null, null,
    'Designo audiência presencial de conciliação para o dia ' || pg_temp.day(58) || ', às 15h')));
insert into res values ('read_twolinks', pg_temp.read('twolinks', 'hearing',
  pg_temp.hearing(pg_temp.iso(59), '11:00', 'conciliacao', 'videoconferencia', null, 'https://tribunal.exemplo.invalid/consulta',
    'Designo audiência de conciliação para o dia ' || pg_temp.day(59) || ', às 11h, por videoconferência')));
insert into res values ('read_reappear', pg_temp.read('reappear', 'hearing',
  pg_temp.hearing(pg_temp.iso(62), '09:00', 'conciliacao', 'presencial', null, null,
    'Designo audiência de conciliação para o dia ' || pg_temp.day(62) || ', às 9h')));
reset role;

select ok(
  pg_temp.got('read_twohours', 'reason') = 'several_times'
  and pg_temp.got('read_cancelfar', 'reason') = 'hearing_changed'
  and pg_temp.got('read_mixed', 'reason') = 'mode_unclear'
  and pg_temp.got('read_twolinks', 'reason') = 'link_not_in_text'
  and not exists (select 1 from public.hearings h where h.publication_id in
    (pg_temp.pub('twohours'), pg_temp.pub('cancelfar'), pg_temp.pub('mixed'), pg_temp.pub('twolinks'))),
  'two hours of one text, a cancellation said far from its hearing, being there and at a distance at once, and a link that is not the room''s are left to a person'
);
select ok(
  pg_temp.got('read_reappear', 'reason') = 'conflicting_hearing'
  and not exists (select 1 from public.hearings h where h.publication_id = pg_temp.pub('reappear')),
  'a hearing a person cancelled on that day is never written again by ONE'
);

-- An hour said in Brasília's time, of a court of another zone.
update public.courts set time_zone = 'America/Cuiaba' where acronym = 'TJGO';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_zone', pg_temp.read('zone', 'hearing',
  pg_temp.hearing(pg_temp.iso(61), '09:00', 'conciliacao', 'videoconferencia', null, null,
    'Designo audiência de conciliação para o dia ' || pg_temp.day(61) || ', às 9h (horário de Brasília)')));
reset role;
update public.courts set time_zone = 'America/Sao_Paulo' where acronym = 'TJGO';

select ok(
  pg_temp.got('read_zone', 'reason') = 'zone_named'
  and not exists (select 1 from public.hearings h where h.publication_id = pg_temp.pub('zone')),
  'an hour the text says in Brasília''s time, of a court of another zone, is left to a person'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_reapraz', pg_temp.read('reapraz', 'hearing',
  pg_temp.hearing(pg_temp.iso(64), '14:00', 'conciliacao', 'presencial', 'sala 2', null,
    'Designo nova audiência de conciliação para o dia ' || pg_temp.day(64) || ', às 14h, na sala 2')));
insert into res values ('read_another', pg_temp.read('another', 'hearing',
  pg_temp.hearing(pg_temp.iso(70), '14:00', 'instrucao', 'presencial', null, null,
    'Designo audiência de instrução e julgamento para o dia ' || pg_temp.day(70) || ', às 14h, no fórum')));
insert into res values ('read_samemoment', pg_temp.read('samemoment', 'hearing',
  pg_temp.hearing(pg_temp.iso(35), '11:00', 'conciliacao', 'videoconferencia', null, 'https://sala.exemplo.invalid/aud7',
    'Designo audiência de conciliação para o dia ' || pg_temp.day(35)
      || ', às 11h, por videoconferência, na sala https://sala.exemplo.invalid/aud7')));
insert into res values ('read_twohearings', pg_temp.read('twohearings', 'hearing',
  pg_temp.hearing(pg_temp.iso(63), '14:00', 'conciliacao', 'presencial', null, null,
    'Designo audiência de conciliação para o dia ' || pg_temp.day(63) || ', às 14h')));
insert into res values ('read_sameroom', pg_temp.read('sameroom', 'hearing',
  pg_temp.hearing(pg_temp.iso(31), '10:00', 'outra', 'presencial', null, null,
    'Fica designada audiência para o dia ' || pg_temp.day(31) || ', às 10h00')));
insert into res values ('read_sameday', pg_temp.read('sameday', 'hearing',
  pg_temp.hearing(pg_temp.iso(66), '15:00', 'conciliacao', 'presencial', null, null,
    'Designo audiência de conciliação para o dia ' || pg_temp.day(66) || ', às 15h')));
reset role;

select ok(
  pg_temp.got('read_reapraz', 'reason') = 'hearing_changed'
  and pg_temp.got('read_another', 'reason') = 'conflicting_hearing'
  and pg_temp.got('read_samemoment', 'reason') = 'conflicting_hearing'
  and pg_temp.got('read_twohearings', 'reason') = 'several_dates'
  and pg_temp.got('read_sameroom', 'reason') = 'conflicting_hearing'
  and not exists (select 1 from public.hearings h where h.publication_id in
    (pg_temp.pub('reapraz'), pg_temp.pub('another'), pg_temp.pub('samemoment'), pg_temp.pub('twohearings'),
     pg_temp.pub('sameroom'))),
  'a new hearing in the place of another, one beside a hearing still to come, the hearing of the agenda held another way or in another room, and a second hearing on a day without its year are left to a person'
);
select ok(
  pg_temp.got('read_sameday', 'reason') = 'conflicting_hearing'
  and not exists (select 1 from public.hearings h where h.publication_id = pg_temp.pub('sameday')),
  'a hearing a person cancelled on that day is a person''s to weigh, even in a lawsuit with no other hearing to come'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('kinds_deadline', jsonb_build_object('count',
  (select count(*) from public.claim_publication_readings(5, pg_temp.pub('kinds'), array['deadline']))));
insert into res values ('kinds_hearing', jsonb_build_object('count',
  (select count(*) from public.claim_publication_readings(5, pg_temp.pub('kinds'), array['hearing']))));
reset role;

select ok(
  pg_temp.got('kinds_deadline', 'count')::integer = 0 and pg_temp.got('kinds_hearing', 'count')::integer = 1,
  'only the kinds a model can read now are claimed'
);

-- The firm stops letting ONE register hearings while one is due; a lawsuit not in court has none written.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_notfiled', pg_temp.read('notfiled', 'hearing',
  pg_temp.hearing(pg_temp.iso(53), '10:00', 'conciliacao', 'presencial', null, null,
    'Designo audiência de conciliação para o dia ' || pg_temp.day(53) || ', às 10h')));
reset role;
select pg_temp.sign_in('a4700000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a_mode', public.set_firm_autonomy('b4700000-0000-4000-8000-00000000000a', 'publication_hearing', 'approval'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_switch', pg_temp.read('switch', 'hearing',
  pg_temp.hearing(pg_temp.iso(52), '17:00', 'conciliacao', 'videoconferencia', null, null,
    'Designo audiência de conciliação para o dia ' || pg_temp.day(52) || ', às 17h')));
reset role;
select pg_temp.sign_in('a4700000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_firm_autonomy('b4700000-0000-4000-8000-00000000000a', 'publication_hearing', 'auto');
reset role;

select ok(
  not (pg_temp.got('read_notfiled', 'claimed'))::boolean
  and (pg_temp.reading('notfiled') ->> 'reason') = 'not_filed'
  and pg_temp.got('a_mode', 'ok')::boolean and not (pg_temp.got('read_switch', 'claimed'))::boolean
  and (pg_temp.reading('switch') ->> 'status') = 'skipped' and (pg_temp.reading('switch') ->> 'reason') = 'firm_choice'
  and not exists (select 1 from public.hearings h where h.publication_id in (pg_temp.pub('switch'), pg_temp.pub('notfiled'))),
  'a hearing of a lawsuit not in court, and a reading of a firm that no longer lets ONE do it, cost no model and record nothing'
);

-- ---------- The work of the backend ----------

select pg_temp.as_backend();
set local role service_role;
-- Tried again after a wait, until its tries are spent.
insert into res values ('retry_1', (select to_jsonb(c) from public.claim_publication_readings(1, pg_temp.pub('retry')) c));
insert into res values ('retry_1_done', public.record_publication_reading(pg_temp.pub('retry'), 'deadline',
  pg_temp.got('retry_1', 'claim')::integer, 'retry', null, 'output_incomplete'));
update public.publication_readings set retry_after = now() - interval '1 second' where publication_id = pg_temp.pub('retry');
insert into res values ('retry_2', (select to_jsonb(c) from public.claim_publication_readings(1, pg_temp.pub('retry')) c));
-- A late worker that names a claim no longer in force records nothing.
insert into res values ('retry_late', public.record_publication_reading(pg_temp.pub('retry'), 'deadline',
  pg_temp.got('retry_1', 'claim')::integer, 'failed', null, 'late'));
select public.record_publication_reading(pg_temp.pub('retry'), 'deadline', pg_temp.got('retry_2', 'claim')::integer, 'retry',
  null, 'output_incomplete');
update public.publication_readings set retry_after = now() - interval '1 second' where publication_id = pg_temp.pub('retry');
insert into res values ('retry_3', (select to_jsonb(c) from public.claim_publication_readings(1, pg_temp.pub('retry')) c));
insert into res values ('retry_3_done', public.record_publication_reading(pg_temp.pub('retry'), 'deadline',
  pg_temp.got('retry_3', 'claim')::integer, 'retry', null, 'output_incomplete'));
reset role;

select ok(
  pg_temp.got('retry_1_done', 'code') = 'retry'
  and pg_temp.got('retry_late', 'code') = 'not_working'
  and pg_temp.got('retry_3_done', 'code') = 'failed'
  and (pg_temp.reading('retry') ->> 'status') = 'failed' and (pg_temp.reading('retry') ->> 'reason') = 'output_incomplete',
  'a reading the model keeps answering badly is tried a few times, then left to a person; a late worker records nothing'
);

select pg_temp.as_backend();
set local role service_role;
-- Given back by the provider: the try does not count, the time does.
insert into res values ('release_1', (select to_jsonb(c) from public.claim_publication_readings(1, pg_temp.pub('release')) c));
insert into res values ('release_1_done', public.record_publication_reading(pg_temp.pub('release'), 'deadline',
  pg_temp.got('release_1', 'claim')::integer, 'released', null, 'provider_unavailable'));
insert into res values ('release_after', pg_temp.reading('release'));
update public.publication_readings set releases = 6, retry_after = null where publication_id = pg_temp.pub('release');
-- A claim whose worker stopped, with its tries spent.
insert into res values ('stale_1', (select to_jsonb(c) from public.claim_publication_readings(1, pg_temp.pub('stale')) c));
update public.publication_readings set claimed_at = now() - interval '1 hour', attempts = 3
where publication_id = pg_temp.pub('stale');
-- One no model read within the hours the setting gives.
update public.publication_readings set due_since = now() - interval '3 hours' where publication_id = pg_temp.pub('wait');
insert into res values ('settled', jsonb_build_object('count', public.settle_publication_readings()));
reset role;

select ok(
  pg_temp.got('release_1_done', 'code') = 'released'
  and pg_temp.got('release_after', 'status') = 'due' and pg_temp.got('release_after', 'attempts')::integer = 0
  and pg_temp.got('release_after', 'releases')::integer = 1
  and (pg_temp.reading('release') ->> 'status') = 'failed' and (pg_temp.reading('release') ->> 'reason') = 'provider_unavailable'
  and (pg_temp.reading('stale') ->> 'status') = 'failed' and (pg_temp.reading('stale') ->> 'reason') = 'attempts_spent'
  and (pg_temp.reading('wait') ->> 'status') = 'failed' and (pg_temp.reading('wait') ->> 'reason') = 'not_read_in_time',
  'a reading given back too often, tried too often, or waiting too long for a model is a person''s: a term may be running'
);

-- The publication is no longer of a lawsuit, then is again; another is cancelled by the court.
update public.publications set proceeding_id = null, case_id = null where id = pg_temp.pub('unlink');
insert into res values ('unlinked', pg_temp.reading('unlink'));
update public.publications set proceeding_id = pg_temp.got('case_2', 'proceeding_id')::uuid,
  case_id = pg_temp.got('case_2', 'case_id')::uuid where id = pg_temp.pub('unlink');
update public.publications set active = false, cancelled_at = now(), cancel_reason = 'Publicada por engano.'
  where id = pg_temp.pub('cancel');

select ok(
  pg_temp.got('unlinked', 'status') = 'skipped' and pg_temp.got('unlinked', 'reason') = 'no_lawsuit'
  and (pg_temp.reading('unlink') ->> 'status') = 'due'
  and (pg_temp.reading('cancel') ->> 'status') = 'skipped' and (pg_temp.reading('cancel') ->> 'reason') = 'cancelled',
  'a reading follows its publication: let go while no lawsuit is linked, due again when one is, and given up when the court cancels it'
);

-- ---------- A hearing nobody wrote is not lost ----------

select pg_temp.sign_in('a4700000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('unwritten', public.firm_publications_without_hearing('b4700000-0000-4000-8000-00000000000a', 100));
insert into res values ('today', public.firm_today('b4700000-0000-4000-8000-00000000000a'));
insert into res values ('settled_hearing', public.settle_publication_hearing(pg_temp.pub('moved')));
insert into res values ('unwritten_after', public.firm_publications_without_hearing('b4700000-0000-4000-8000-00000000000a', 100));
reset role;
create function pg_temp.listed(name text, publication text) returns boolean language sql as $$
  select exists (select 1 from res, jsonb_array_elements(res.payload -> 'rows') r
                 where res.name = listed.name and r ->> 'id' = pg_temp.pub(publication)::text);
$$;

select ok(
  pg_temp.listed('unwritten', 'moved') and pg_temp.listed('unwritten', 'conflict') and pg_temp.listed('unwritten', 'nolawsuit')
  and pg_temp.listed('unwritten', 'notfiled') and pg_temp.listed('unwritten', 'switch')
  and not pg_temp.listed('unwritten', 'hearing') and not pg_temp.listed('unwritten', 'agenda')
  and not pg_temp.listed('unwritten', 'kinds')
  and pg_temp.got('today', 'publications_without_hearing')::integer = pg_temp.got('unwritten', 'total')::integer,
  'a publication triaged as a hearing that still owes it is watched and counted (of a lawsuit not in ONE too); what ONE wrote, found or is reading is not'
);
select ok(
  pg_temp.got('settled_hearing', 'code') = 'saved'
  and not pg_temp.listed('unwritten_after', 'moved')
  and exists (select 1 from public.audit_events a where a.action = 'publication.hearing_settled'
              and a.entity_id = pg_temp.pub('moved')::text and a.actor_id = 'a4700000-0000-4000-8000-000000000001'),
  'who writes hearings says the hearing a publication set needs nothing more, on the record'
);

select pg_temp.sign_in('a4700000-0000-4000-8000-000000000002');
set local role authenticated;
select ok(
  (public.settle_publication_hearing(pg_temp.pub('conflict')) ->> 'code') = 'not_allowed',
  'who answers clients does not settle a hearing'
);
reset role;
select pg_temp.sign_in('a4700000-0000-4000-8000-000000000004');
set local role authenticated;
select ok(
  (public.settle_publication_hearing(pg_temp.pub('conflict')) ->> 'code') = 'not_found',
  'nobody of another firm settles a hearing of this one'
);
select throws_ok(
  $$select public.firm_publications_without_hearing('b4700000-0000-4000-8000-00000000000a')$$,
  '42501', null,
  'nobody of another firm reads its watch'
);
reset role;

-- The deadlines' watch leaves out what ONE is reading.
select pg_temp.sign_in('a4700000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('untimed', public.firm_publications_without_deadline('b4700000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  not pg_temp.listed('untimed', 'unlink') and pg_temp.listed('untimed', 'two') and pg_temp.listed('untimed', 'wait')
  and not pg_temp.listed('untimed', 'term'),
  'a publication triaged as a deadline is watched while it owes it, except while ONE reads it'
);

-- ---------- The words, as the checks read them ----------

select ok(
  public.reading_term_values('no prazo de 15 (quinze) dias') = array[15]
  and public.reading_term_values('quinze (15) dias e 15 dias corridos') = array[15]
  and public.reading_term_values('prazo de vinte e cinco dias úteis; em 05 dias') = array[5, 25]
  and public.reading_term_values('em 150 dias') = array[150]
  and public.reading_term_values('multa de 15 reais') = '{}'::integer[]
  and public.reading_dates('para o dia 05/03/2099, às') = array[date '2099-03-05']
  and public.reading_dates('para o dia 5/3/99') = array[date '2099-03-05']
  and public.reading_dates('em 1º de março de 2099') = array[date '2099-03-01']
  and public.reading_dates('Processo 5000101-02.2099.8.09.0051') = '{}'::date[]
  and public.reading_date('2099-02-30') is null,
  'the checks read numbers of days and days as a publication writes them, and nothing that is not one'
);
select ok(
  public.reading_times('às 14h30') = array[time '14:30'] and public.reading_times('às 14:30h') = array[time '14:30']
  and public.reading_times('às 14 horas e 30 minutos') = array[time '14:30']
  and public.reading_times('às 14h e 30min') = array[time '14:30'] and public.reading_times('às 14 h 30') = array[time '14:30']
  and public.reading_times('às 9h.') = array[time '09:00'] and public.reading_times('às 09:00h') = array[time '09:00']
  and public.reading_times('para o dia 10/11/2099') = '{}'::time[]
  and public.reading_times('às 14h, e depois às 9h') = array[time '14:00', time '09:00'],
  'an hour is read in each of the ways a court writes it, a whole hour never inside a longer one, and a day never as an hour'
);
select ok(
  public.reading_other_start('Prazo de 10 (dez) dias a contar desta data para alegações finais.')
  and public.reading_other_start('em 15 dias do trânsito em julgado')
  and public.reading_other_start('a partir de hoje, no prazo de 5 dias')
  and public.reading_other_start('Intime-se para, em 15 dias', 'Intime-se para, em 15 dias, a contar da juntada do mandado, se manifestar.')
  and public.reading_other_start('até 5 dias antes da audiência')
  and public.reading_other_start('intimem-se as partes para, em 5 dias, se manifestarem',
    'Nesta data, intimem-se as partes para, em 5 dias, se manifestarem.')
  and public.reading_other_start('Nesta data, intimem-se as partes para, em 5 dias, se manifestarem',
    'Nesta data, intimem-se as partes para, em 5 dias, se manifestarem.')
  and not public.reading_other_start('no prazo de 15 dias, contados a partir da intimação')
  and not public.reading_other_start('no prazo de 15 dias a contar da sua intimação')
  and not public.reading_other_start('no prazo de 15 dias contados da data da publicação')
  and not public.reading_other_start('no prazo de 5 dias, a contar da intimação, após o que voltem conclusos')
  and not public.reading_other_start('Intime-se para, em 15 dias, pagar', 'Intime-se para, em 15 dias, pagar. Após o decurso do prazo, conclusos.'),
  'a term counted from anything but the publication is seen, in the excerpt and right before or after it, and what the publication''s own start is called is not'
);
select ok(
  public.reading_changes_hearing('Redesigno a audiência para o dia 10/11/2099')
  and public.reading_changes_hearing('Fica cancelada a audiência designada')
  and public.reading_changes_hearing('Torno sem efeito a audiência')
  and not public.reading_changes_hearing('Ação de indenização por cancelamento de voo; designo audiência de conciliação')
  and not public.reading_changes_hearing('Recebo o recurso sem efeito suspensivo e designo audiência')
  and public.reading_judgment_session('Processo incluído na pauta da sessão virtual de julgamento da Turma Recursal')
  and public.reading_mode('audiência por videoconferência') = 'videoconferencia'
  and public.reading_mode('audiência híbrida, presencial e por vídeo') = 'hibrida'
  and public.reading_mode('na sala 3 do processo virtual') = 'presencial'
  and public.reading_links('<a href="https://x.exemplo.invalid/j/1?pwd=A&amp;b=2">aqui</a>, ou https://y.exemplo.invalid/a.')
      = array['https://x.exemplo.invalid/j/1?pwd=A&b=2', 'https://y.exemplo.invalid/a'],
  'a hearing moved or cancelled, a session of judgment, the way a hearing is held and the links of a text are read as the text says them, and a cancelled flight is no cancelled hearing'
);
select ok(
  public.reading_in_text('Intime-se a parte autora para, no prazo de 15 dias',
    '<html><head><style>p { color: red }</style></head><body><p>Intime-se a parte autora para, no prazo de 15&nbsp;dias.</p>'
    || '<script>if (a < b) { x() }</script><p>Fim do texto publicado.</p></body></html>')
  and public.reading_in_text('Fim do texto publicado', '<style>a</style><p>Fim do texto publicado.</p><script>b</script>')
  and public.reading_in_text('a intimação da parte autora', 'Determino a intima&#xE7;&#227;o da parte autora.')
  and public.reading_in_text('INTIMAÇÃO da parte', 'Determino a INTIMA&CCEDIL;&ATILDE;O da parte.')
  and public.reading_in_text('15 dias, sob pena de multa', 'em 15 dias &ndash; sob pena de multa.')
  and public.reading_in_text('o valor de 15 reais', 'O valor de 1<b>5</b> reais.')
  and public.reading_in_text('acesse a sala aqui (https://sala.exemplo.invalid/x) no dia marcado',
    'Acesse a sala <a href="https://sala.exemplo.invalid/x">aqui</a> no dia marcado.')
  and public.reading_in_text('INTIME-SE, no prazo de 15 dias', 'Vistos. Intime-se no prazo de 15 (quinze) dias.') is false
  and public.reading_in_text('sala 2', 'na sala 2 do juizado', 2) and not public.reading_in_text('sala 5', 'na sala 2 do juizado', 2),
  'an excerpt is looked for in the words of the page as the app reads them: without its marks, with its entities read'
);

-- ---------- Only the backend reads, and each firm sees its own ----------

select ok(
  not has_function_privilege('authenticated', 'public.claim_publication_readings(integer, uuid, text[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.settle_publication_readings()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_publication_reading(uuid, text, integer, text, uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.publication_reading_to_read(uuid, text, integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.settle_publication_hearing(uuid)', 'EXECUTE')
  and has_column_privilege('authenticated', 'public.publication_readings', 'status', 'SELECT')
  and has_column_privilege('authenticated', 'public.publication_readings', 'reason', 'SELECT')
  and not has_column_privilege('authenticated', 'public.publication_readings', 'run_id', 'SELECT')
  and not has_column_privilege('authenticated', 'public.publication_readings', 'claims', 'SELECT')
  and not has_column_privilege('authenticated', 'public.publications', 'hearing_settled_by', 'SELECT'),
  'reading is the backend''s; the firm reads what ONE did and why, never the run or the claim'
);

select pg_temp.sign_in('a4700000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.claim_publication_readings(5, null)$$,
  '42501', null,
  'no session claims a reading'
);
select ok(
  (select count(*) > 0 from public.publication_readings where org_id = 'b4700000-0000-4000-8000-00000000000a')
  and (select count(*) = 0 from public.publication_readings where org_id = 'b4700000-0000-4000-8000-00000000000b'),
  'anybody of the firm reads what ONE read of its publications, and nothing of another firm'
);
reset role;
select pg_temp.sign_in('a4700000-0000-4000-8000-000000000004');
set local role authenticated;
select ok(
  (select count(*) = 2 from public.publication_readings) and (select count(*) = 2 from public.publication_readings
    where publication_id in (pg_temp.pub('firm_b'), pg_temp.pub('sameday'))),
  'the other firm reads only its own'
);
reset role;

-- ONE writes only in the case the backend names, only a new hearing, and nobody's session is ONE.
select pg_temp.as_backend();
set local role service_role;
select throws_ok(
  format('select public.propose_deadline(%L, null, %L, null, %L, null, 5, %L)', pg_temp.pub('wrong'), 'Prazo', 'publication', 'business'),
  '42501', null,
  'the backend proposes nothing as ONE without naming the case'
);
select set_config('one.system_case', pg_temp.got('case_2', 'case_id'), true);
select throws_ok(
  format('select public.propose_deadline(%L, null, %L, null, %L, null, 5, %L)', pg_temp.pub('wrong'), 'Prazo', 'publication', 'business'),
  '42501', null,
  'naming one case lets ONE write in no other'
);
select set_config('one.system_case', pg_temp.got('case_1', 'case_id'), true);
select throws_ok(
  format('select public.save_hearing(%L, null, %L::jsonb)',
    (select h.id from public.hearings h where h.publication_id = pg_temp.pub('hearing')),
    jsonb_build_object('kind', 'outra', 'mode', 'presencial', 'day', pg_temp.iso(60), 'time', '10:00')),
  '42501', null,
  'ONE changes no hearing: it only writes a new one'
);
select set_config('one.system_case', '', true);
reset role;
select pg_temp.sign_in('a4700000-0000-4000-8000-000000000004');
set local role authenticated;
select set_config('one.system_case', pg_temp.got('case_1', 'case_id'), true);
select ok(
  (public.propose_deadline(pg_temp.pub('term'), null, 'Prazo', null, 'publication', null, 5, 'business') ->> 'code') = 'not_found',
  'naming a case as ONE''s lets no session propose a deadline of another firm'
);
select set_config('one.system_case', '', true);
reset role;

-- The operator holds the reading of terms through its task: every firm reads it held, and an answer that would
-- wait for a person enters the queue already withdrawn.
update public.ai_tasks set autonomy = 'approval' where slug = 'publicacao.prazo';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('held_run', jsonb_build_object('run', pg_temp.ran('b4700000-0000-4000-8000-00000000000a',
  'publicacao.prazo', pg_temp.pub('term'), '{"ha_prazo": false}'::jsonb)));
reset role;
select ok(
  public.firm_autonomy_mode('b4700000-0000-4000-8000-00000000000a', 'publication_deadline') = 'approval'
  and not public.reading_allowed('b4700000-0000-4000-8000-00000000000a', 'deadline')
  and (select a.status = 'withdrawn' from public.approvals a where a.run_id = pg_temp.got('held_run', 'run')::uuid),
  'the operator holds the reading through its task, and its answer never waits in the queue'
);
update public.ai_tasks set autonomy = 'sampled', sample_percent = 20 where slug = 'publicacao.prazo';
select ok(
  not public.reading_allowed('b4700000-0000-4000-8000-00000000000a', 'deadline'),
  'a sample of a task no person can check holds the reading too'
);

select ok(
  public.reading_term_values('no prazo de 15 (quinze) e 30 (trinta) dias, respectivamente') = array[15, 30]
  and public.reading_term_values('em cento e vinte dias') = array[120]
  and public.reading_term_values('em trezentos e sessenta e cinco dias') = array[365]
  and public.reading_term_values('em quinze e trinta dias') = array[15, 30]
  and public.reading_term_values('de 10 a 15 dias') = array[10, 15]
  and public.reading_other_units('no prazo de 48h, regularizar')
  and public.reading_other_units('em 72 hs, informar')
  and public.reading_other_units('em até 48 horas, juntar')
  and public.reading_other_units('no prazo de 1 (um) mês')
  and not public.reading_other_units('às 14h, na sala 2, e das 8h às 18h no balcão')
  and not public.reading_other_units('às 14 horas e 30 minutos')
  and public.reading_times('às 9 horas e 30') = array[time '09:30']
  and public.reading_times('às 14h e 30, na sala 2') = array[time '14:30']
  and not (time '14:00' = any (public.reading_times('às 14h e trinta minutos')))
  and not (time '14:30' = any (public.reading_times('às 14h e trinta minutos')))
  and public.reading_times('às 14h e às 16h') = array[time '14:00', time '16:00'],
  'numbers in words and lists, a term in hours however it is written, and minutes said in words are read as a court writes them'
);
select ok(
  public.reading_names_zone('às 9h (Brasília), por videoconferência')
  and public.reading_names_zone('às 9h, UTC-3')
  and not public.reading_names_zone('às 9h, horário local')
  and not public.reading_hearing_intimation('Ficam as partes intimadas para, no prazo de 15 dias, se manifestarem.')
  and not public.reading_hearing_intimation('Fica a parte autora intimada para, em 5 dias, juntar.')
  and public.reading_hearing_intimation('Saem as partes devidamente intimadas.')
  and public.reading_hearing_intimation('Ficam os presentes intimados.')
  and public.reading_changes_hearing('Defiro o pedido de reaprazamento. Designo nova audiência de conciliação.')
  and public.reading_changes_hearing('Fica a audiência convertida para a modalidade virtual.')
  and not public.reading_changes_hearing('Designo audiência de conciliação. A autora alega que a passagem foi cancelada pela ré.')
  and public.reading_changes_hearing('Designo audiência de conciliação. A audiência anteriormente marcada fica cancelada.')
  and public.reading_unmarked('Intime-se <NOME DA PARTE> para <b>pagar</b>.') = 'Intime-se <NOME DA PARTE> para pagar.'
  and public.reading_hearing_intimation('TERMO DE SESSÃO DE CONCILIAÇÃO. Aberta a sessão, presentes as partes, não houve acordo. '
    || 'Ficam as partes intimadas para, no prazo de 15 (quinze) dias, especificarem provas.')
  and public.reading_hearing_intimation('Os presentes saem intimados.')
  and public.reading_other_start('Uma vez juntado o laudo, intimem-se as partes para, no prazo comum de 15 (quinze) dias, se manifestarem.',
    'Vistos. Uma vez juntado o laudo, intimem-se as partes para, no prazo comum de 15 (quinze) dias, se manifestarem.')
  and not public.reading_other_start('Intime-se a parte autora para, no prazo de 15 dias, falar sobre os documentos juntados.',
    'Intime-se a parte autora para, no prazo de 15 dias, falar sobre os documentos juntados.')
  and public.reading_other_units('em 5 (cinco) dias, emendar e, no decêndio seguinte, recolher as custas')
  and public.reading_mode('Designo audiência de conciliação virtual.') = 'videoconferencia'
  and public.reading_mode('Designo audiência de conciliação neste processo virtual, no fórum.') = 'presencial'
  and not public.reading_loose_days('pelo link https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=y, '
    || 'conforme mov. 12.1 e evento 10.2')
  and public.reading_loose_days('no 12/11, às 9h')
  and public.reading_loose_days('fica designada audiência de instrução para o dia 24/11, no mesmo horário')
  and public.reading_loose_days('no dia 24, às 9h')
  and public.reading_loose_days('em 24 de novembro, às 9h')
  and not public.reading_loose_days('no dia 24/11/2099, às 9h, conforme a Lei 9.099/95 e o art. 334, fls. 1.022')
  and not public.reading_loose_days('em 24 de novembro de 2099, processo 5000101-02.2099.8.09.0051'),
  'a zone named, an intimation in a hearing, a hearing moved or converted, the marks of a page and a day without its year are read as a court writes them'
);

-- The court cancels a publication ONE found a hearing of the agenda for: nothing of that hearing is told while nobody
-- saw it.
update public.publications set active = false, cancelled_at = now(), cancel_reason = 'Publicada por engano.'
  where id = pg_temp.pub('agenda');
select ok(
  public.hearing_publication_cancelled(pg_temp.got('by_hand_same', 'id')::uuid, null)
  and not public.hearing_publication_cancelled(pg_temp.got('by_hand_other', 'id')::uuid, null),
  'a publication the court took back answers for the hearing ONE found it in the agenda for, until somebody sees it'
);

select * from finish();
rollback;
