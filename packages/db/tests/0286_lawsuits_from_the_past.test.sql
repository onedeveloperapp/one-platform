begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- ============================================================
-- A lawsuit filed before its case was in ONE, and its history read from the DJEN (0286). Firm A's lawyer attaches
-- the receipt of a lawsuit filed weeks before the case was opened: refused while she does not say it was filed
-- before, refused for a day still to come or before the trip, taken once she says it; ONE then owes the reading of
-- the lawsuit's history, which only firm A reads. What the DJEN had of it becomes its publications, marked as of its
-- history; what had passed comes in settled (no awareness owed, a deadline done, a hearing held with no fee, no
-- warning of a payment to the client), what is still ahead as any other. Firm B reads nothing of firm A's, and its own
-- history, which the DJEN does not answer, is tried again and then given up.
--
-- Every person, firm and number here is invented: the lawsuits are of 2099, and the CPF one every manual uses as an
-- example.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2860000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-historico.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2860000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-historico.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2860000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-historico', 'a2860000-0000-4000-8000-000000000001'),
  ('b2860000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-historico', 'a2860000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2860000-0000-4000-8000-00000000000a', 'a2860000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2860000-0000-4000-8000-00000000000b', 'a2860000-0000-4000-8000-000000000002', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert, update on res to authenticated, service_role, anon;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, key text) returns text language sql as
$$ select payload ->> key from res where res.name = got.name; $$;
create function pg_temp.stored(org uuid, who uuid, name text, mark text) returns uuid language plpgsql as $$
declare
  reserved jsonb := public.reserve_file(org, 'upload', name, 'application/pdf', 1000, who);
begin
  perform public.confirm_file((reserved ->> 'file_id')::uuid, repeat(mark, 64), 1000, 'application/pdf', 1);
  return (reserved ->> 'file_id')::uuid;
end;
$$;

-- A case of a delayed flight sixty days ago, its lawsuit at the small-claims court of São Paulo planned, its system
-- approved, its petition accepted and its package built; and the receipt the lawyer uploaded.
create function pg_temp.lawsuit(org uuid, owner uuid, name text, mark text) returns void language plpgsql as $$
declare
  made jsonb;
  saved jsonb;
  file uuid;
  receipt uuid;
  attached jsonb;
  package uuid := gen_random_uuid();
begin
  perform pg_temp.sign_in(owner);
  set local role authenticated;
  made := public.create_case(org, 'delay', 'G3', current_date - 60,
    '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02"}'::jsonb);
  saved := public.save_proceeding((made ->> 'case_id')::uuid, null,
    '{"kind": "juizado", "court": "TJSP", "comarca": "São Paulo", "forum_basis": "domicile", "system": "eproc"}'::jsonb,
    array[(made ->> 'party_id')::uuid]);
  perform public.decide_court_system((saved ->> 'proceeding_id')::uuid, true);
  reset role;
  perform pg_temp.as_backend();
  set local role service_role;
  file := pg_temp.stored(org, owner, 'peticao-' || mark || '.pdf', mark);
  receipt := pg_temp.stored(org, owner, 'recibo-' || mark || '.pdf', case mark when 'a' then 'c' else 'd' end);
  reset role;
  perform pg_temp.sign_in(owner);
  set local role authenticated;
  attached := public.attach_case_document((made ->> 'case_id')::uuid, file, 'petition');
  perform public.decide_case_document((attached ->> 'document_id')::uuid, 'accepted');
  reset role;
  insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values ((saved ->> 'proceeding_id')::uuid, owner, org);
  insert into public.filing_packages (id, org_id, case_id, proceeding_id, court, system, kind, status, petition_document_id, built_at)
  values (package, org, (made ->> 'case_id')::uuid, (saved ->> 'proceeding_id')::uuid, 'TJSP', 'eproc', 'juizado',
          'ready', (attached ->> 'document_id')::uuid, now());
  insert into res values (name, jsonb_build_object('package', package, 'case', made ->> 'case_id',
    'proceeding', saved ->> 'proceeding_id', 'receipt', receipt));
end;
$$;

select pg_temp.lawsuit('b2860000-0000-4000-8000-00000000000a', 'a2860000-0000-4000-8000-000000000001', 'a', 'a');
select pg_temp.lawsuit('b2860000-0000-4000-8000-00000000000b', 'a2860000-0000-4000-8000-000000000002', 'b', 'b');

create function pg_temp.attach(name text, day date, before_one boolean default false) returns jsonb language sql as
$$ select public.attach_filing_receipt(pg_temp.got(name, 'package')::uuid, pg_temp.got(name, 'receipt')::uuid,
     '1000286-84.2099.8.26.0100', day, before_one); $$;

-- ---------- The receipt of a lawsuit filed before its case was in ONE ----------

select pg_temp.sign_in('a2860000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('future', pg_temp.attach('a', current_date + 1, true));
insert into res values ('before_case', pg_temp.attach('a', current_date - 30));
insert into res values ('before_trip', pg_temp.attach('a', current_date - 90, true));
insert into res values ('filed', pg_temp.attach('a', current_date - 30, true));
reset role;

select is(pg_temp.got('future', 'code'), 'filed_on_future', 'a day still to come is no day of filing');
select is(pg_temp.got('before_case', 'code') || ' ' || pg_temp.got('before_case', 'opened_on'),
  'filed_before_case ' || ((now() at time zone 'America/Sao_Paulo')::date)::text,
  'a day before the case was opened is refused while the lawyer does not say the lawsuit was filed before, with the day it was opened');
select is(pg_temp.got('before_trip', 'code'), 'filed_before_trip', 'never a day before the trip the lawsuit is of');
select is(pg_temp.got('filed', 'code') || ' ' || pg_temp.got('filed', 'history'), 'filed true',
  'once she says it, the receipt is taken and ONE reads the lawsuit''s history');
select ok((select r.filed_before_one and r.filed_on = current_date - 30 from public.filing_receipts r
           where r.package_id = pg_temp.got('a', 'package')::uuid),
  'the receipt keeps the day it says and that the lawyer said it was filed before');
select is((select p.status || ' ' || p.cnj || ' ' || p.filed_at::text from public.proceedings p
           where p.id = pg_temp.got('a', 'proceeding')::uuid),
  'filed 10002868420998260100 ' || (current_date - 30)::text, 'the lawsuit is filed with its number and its day');
select is((select r.status from public.proceeding_history_reads r where r.proceeding_id = pg_temp.got('a', 'proceeding')::uuid),
  'due', 'its history is owed to the DJEN''s reading');
select is((select (e.data ->> 'before_one') from public.case_events e
           where e.case_id = pg_temp.got('a', 'case')::uuid and e.kind = 'filing_receipt_attached'),
  'true', 'the case''s trail says the lawsuit was filed before');

-- Firm B reads nothing of firm A's.
select pg_temp.sign_in('a2860000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select count(*)::integer from public.proceeding_history_reads), 0, 'another firm reads nothing of a history it does not have');
reset role;
select pg_temp.sign_in('a2860000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(*)::integer from public.proceeding_history_reads), 1, 'the firm reads its own');
select throws_ok($$select * from public.claim_proceeding_history_reads(1, null)$$, '42501', null,
  'a person cannot claim a history');
reset role;

-- ---------- The history, read ----------

-- Firm A's own lawyer was addressed one of the lawsuit's communications already, read by her registration.
insert into public.publications (org_id, hash, court, cnj, available_on, kind, body, head, lawyer_ids, proceeding_id, case_id)
values ('b2860000-0000-4000-8000-00000000000a', 'hist0003abcdefghijklmnopqrstuv', 'TJSP', '10002868420998260100',
        current_date - 5, 'Intimação', 'Manifeste-se a parte autora.', 'Manifeste-se a parte autora.',
        array['a2860000-0000-4000-8000-000000000001'::uuid], pg_temp.got('a', 'proceeding')::uuid, pg_temp.got('a', 'case')::uuid);

select pg_temp.as_backend();
set local role service_role;
insert into res select 'claim_a', to_jsonb(c) from public.claim_proceeding_history_reads(1, null) c;
reset role;
select is(pg_temp.got('claim_a', 'cnj'), '10002868420998260100', 'the backend claims it with the lawsuit''s number');

create function pg_temp.item(hash text, cnj text, day date, kind text, body text) returns jsonb language sql as
$$ select jsonb_build_object('hash', hash, 'court', 'TJSP', 'cnj', cnj, 'available_on', day::text, 'kind', kind,
     'document_type', null, 'text', body, 'head', body, 'tail', null, 'link', null,
     'unit', '1º Juizado Especial Cível de São Paulo', 'class_name', 'Procedimento do Juizado Especial Cível',
     'active', true, 'cancel_reason', null); $$;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('partial', public.record_proceeding_history(pg_temp.got('claim_a', 'read_id')::uuid,
  pg_temp.got('claim_a', 'claim')::integer, 'partial', jsonb_build_array(
    pg_temp.item('hist0001abcdefghijklmnopqrstuv', '10002868420998260100', current_date - 25, 'Intimação',
      'Fica a parte autora intimada da audiência de conciliação.'),
    -- One of another lawsuit: never kept as this one's.
    pg_temp.item('hist0099abcdefghijklmnopqrstuv', '30002865020998260100', current_date - 25, 'Intimação', 'Intime-se.'))));
insert into res values ('done', public.record_proceeding_history(pg_temp.got('claim_a', 'read_id')::uuid,
  pg_temp.got('claim_a', 'claim')::integer, 'done', jsonb_build_array(
    pg_temp.item('hist0002abcdefghijklmnopqrstuv', '10002868420998260100', current_date - 20, 'Intimação',
      'Fica a parte autora intimada da sentença.'),
    pg_temp.item('hist0003abcdefghijklmnopqrstuv', '10002868420998260100', current_date - 5, 'Intimação',
      'Manifeste-se a parte autora.'),
    pg_temp.item('hist0004abcdefghijklmnopqrstuv', '10002868420998260100', current_date - 1, 'Intimação',
      'Fica a parte autora intimada do alvará.'))));
insert into res values ('late', public.record_proceeding_history(pg_temp.got('claim_a', 'read_id')::uuid,
  pg_temp.got('claim_a', 'claim')::integer, 'done', '[]'::jsonb));
reset role;

select is(pg_temp.got('partial', 'new') || ' ' || pg_temp.got('partial', 'skipped'), '1 1',
  'a part of the history is kept, and a communication of another lawsuit is not');
select is((select r.status || ' ' || r.seen || ' ' || r.kept || ' ' || r.left_out from public.proceeding_history_reads r
           where r.id = pg_temp.got('claim_a', 'read_id')::uuid),
  'done 5 3 2', 'the read is over: what the DJEN had, what became a publication, and what was already one or of another lawsuit');
select is(pg_temp.got('late', 'code'), 'not_working', 'a read that is over takes nothing more');
select is((select count(*)::integer from public.publications p
           where p.proceeding_id = pg_temp.got('a', 'proceeding')::uuid and p.from_history
             and p.case_id = pg_temp.got('a', 'case')::uuid
             and p.lawyer_ids = array['a2860000-0000-4000-8000-000000000001'::uuid]),
  3, 'each communication is a publication of the lawsuit and its case, of its history, addressed to its lawyer');
select ok((select not p.from_history from public.publications p where p.hash = 'hist0003abcdefghijklmnopqrstuv'),
  'one the firm already had is left as it was');
select is((select (e.data ->> 'kept') from public.case_events e
           where e.case_id = pg_temp.got('a', 'case')::uuid and e.kind = 'proceeding_history_read'),
  '3', 'the case''s trail says how many came of the history');
select ok(not exists (select 1 from public.publications p where p.hash = 'hist0099abcdefghijklmnopqrstuv'),
  'nothing of another lawsuit was kept');

-- ---------- What had passed comes in settled ----------

-- ONE triaged the history by itself: no lawyer's awareness is owed of what is past.
update public.publications set category = 'audiencia', ai_applied = true, triaged_at = now(), ack_owed = true
where hash = 'hist0001abcdefghijklmnopqrstuv';
update public.publications set ack_owed = true where hash = 'hist0003abcdefghijklmnopqrstuv';
select ok((select not ack_owed from public.publications where hash = 'hist0001abcdefghijklmnopqrstuv'),
  'a publication of the history owes no awareness');
select ok((select ack_owed from public.publications where hash = 'hist0003abcdefghijklmnopqrstuv'),
  'one the DJEN made available to the lawyer still does');

create function pg_temp.publication(hash text) returns uuid language sql as
$$ select p.id from public.publications p where p.hash = publication.hash; $$;
create function pg_temp.deadline(hash text, due date) returns text language sql as $$
  insert into public.deadlines (org_id, cnj, court, case_id, proceeding_id, publication_id, title, trigger, trigger_on,
                                days, counting, computed_due_on, computed_revision, computed_at)
  values ('b2860000-0000-4000-8000-00000000000a', '10002868420998260100', 'TJSP', pg_temp.got('a', 'case')::uuid,
          pg_temp.got('a', 'proceeding')::uuid, pg_temp.publication(hash), 'Recurso inominado', 'publication',
          current_date - 20, 10, 'business', due, 1, now())
  returning status || coalesce(' ' || done_note, '');
$$;
select is(pg_temp.deadline('hist0002abcdefghijklmnopqrstuv', current_date - 6),
  'done Prazo lido do histórico do processo: o dia já tinha passado quando o caso entrou no ONE.',
  'a deadline of the history whose day had passed is done, with why');
select is(pg_temp.deadline('hist0004abcdefghijklmnopqrstuv', current_date + 9), 'proposed',
  'one whose day is still ahead is as any other');
select is(pg_temp.deadline('hist0003abcdefghijklmnopqrstuv', current_date - 1), 'proposed',
  'one of a publication the DJEN made available to the lawyer is never settled by the history');

-- The fee per hearing is the firm's contract: its finance is open, and its category is there.
update public.organizations set finance_opened_on = current_date - 365 where id = 'b2860000-0000-4000-8000-00000000000a';
insert into public.finance_categories (org_id, code, name, kind, dre_line)
select 'b2860000-0000-4000-8000-00000000000a', 'receita.contratuais', 'Honorários contratuais', 'income', 'receita'
where not exists (select 1 from public.finance_categories c
                  where c.org_id = 'b2860000-0000-4000-8000-00000000000a' and c.code = 'receita.contratuais');
insert into public.case_fees (org_id, case_id, hearing_cents, source)
values ('b2860000-0000-4000-8000-00000000000a', pg_temp.got('a', 'case')::uuid, 15000, 'person')
on conflict (case_id) do update set hearing_cents = excluded.hearing_cents;

create function pg_temp.hearing(hash text, starts timestamptz) returns uuid language sql as $$
  insert into public.hearings (org_id, case_id, proceeding_id, publication_id, source, kind, mode, place, starts_at,
                               time_zone)
  values ('b2860000-0000-4000-8000-00000000000a', pg_temp.got('a', 'case')::uuid, pg_temp.got('a', 'proceeding')::uuid,
          pg_temp.publication(hash), 'publication', 'conciliacao', 'presencial', 'Fórum Central', starts,
          'America/Sao_Paulo')
  returning id;
$$;
insert into res values ('past_hearing', jsonb_build_object('id', pg_temp.hearing('hist0001abcdefghijklmnopqrstuv', now() - interval '10 days')));
insert into res values ('coming_hearing', jsonb_build_object('id', pg_temp.hearing('hist0004abcdefghijklmnopqrstuv', now() + interval '10 days')));
insert into res values ('own_hearing', jsonb_build_object('id', pg_temp.hearing('hist0003abcdefghijklmnopqrstuv', now() + interval '12 days')));
select is((select h.status || ' ' || coalesce(h.outcome, 'sem resultado') from public.hearings h
           where h.id = pg_temp.got('past_hearing', 'id')::uuid),
  'held sem resultado', 'a hearing of the history whose time had passed is held, its result not read');
select ok((select h.outcome_note like 'Audiência lida do histórico do processo:%' from public.hearings h
           where h.id = pg_temp.got('past_hearing', 'id')::uuid), 'and it says why');
select is((select h.status from public.hearings h where h.id = pg_temp.got('coming_hearing', 'id')::uuid), 'scheduled',
  'one still to come is as any other');
-- Moved into the past by what the court published later, it is held too, and owes no fee.
update public.hearings set starts_at = now() - interval '2 days' where id = pg_temp.got('coming_hearing', 'id')::uuid;
update public.hearings set status = 'held', outcome = 'sem_acordo' where id = pg_temp.got('own_hearing', 'id')::uuid;
select is((select h.status from public.hearings h where h.id = pg_temp.got('coming_hearing', 'id')::uuid), 'held',
  'a hearing of the history moved into the past is held');
select is((select string_agg(b.act_key, ',' order by b.act_key) from public.finance_bills b
           where b.org_id = 'b2860000-0000-4000-8000-00000000000a' and b.act_key like 'hearing:%'),
  'hearing:' || pg_temp.got('own_hearing', 'id'),
  'only a hearing held since the case is in ONE owes the fee per hearing');

-- A payment of the history owes the client no warning against the scam; one the DJEN made available now does.
update public.publications set category = 'pagamento', ai_applied = true, triaged_at = now() - interval '1 hour'
where hash in ('hist0004abcdefghijklmnopqrstuv', 'hist0003abcdefghijklmnopqrstuv');
select is((select string_agg(n.publication_id::text, ',')
           from public.notice_candidates('b2860000-0000-4000-8000-00000000000a', pg_temp.got('a', 'case')::uuid) n
           where n.kind = 'payment_alert'),
  pg_temp.publication('hist0003abcdefghijklmnopqrstuv')::text,
  'only the payment the DJEN made available to the lawyer warns the client');

-- ---------- A history the DJEN does not answer ----------

select public.queue_proceeding_history(pg_temp.got('b', 'proceeding')::uuid, null);
update public.proceedings set cnj = '20002869120998090051' where id = pg_temp.got('b', 'proceeding')::uuid;
select public.queue_proceeding_history(pg_temp.got('b', 'proceeding')::uuid, null);
select pg_temp.as_backend();
set local role service_role;
insert into res select 'claim_b', to_jsonb(c) from public.claim_proceeding_history_reads(5, null) c;
insert into res values ('retry_b', public.record_proceeding_history(pg_temp.got('claim_b', 'read_id')::uuid,
  pg_temp.got('claim_b', 'claim')::integer, 'retry', '[]'::jsonb, 'djen_unavailable'));
reset role;
select is(pg_temp.got('retry_b', 'code') || ' ' || (select r.status || ' ' || (r.retry_after > now())::text
          from public.proceeding_history_reads r where r.id = pg_temp.got('claim_b', 'read_id')::uuid),
  'retry due true', 'a DJEN that does not answer is tried again after a wait');
update public.proceeding_history_reads set retry_after = null, attempts = 3 where id = pg_temp.got('claim_b', 'read_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res select 'claim_b2', to_jsonb(c) from public.claim_proceeding_history_reads(5, null) c;
insert into res values ('failed_b', public.record_proceeding_history(pg_temp.got('claim_b2', 'read_id')::uuid,
  pg_temp.got('claim_b2', 'claim')::integer, 'retry', '[]'::jsonb, 'djen_unavailable'));
reset role;
select is(pg_temp.got('failed_b', 'code') || ' ' || (select r.status || ' ' || r.error
          from public.proceeding_history_reads r where r.id = pg_temp.got('claim_b2', 'read_id')::uuid),
  'failed failed djen_unavailable', 'its attempts spent, it is given up with why');
-- Its lawyer asks it again from the case: owed again. Asked of a lawsuit read, or by another firm, nothing changes.
update public.proceedings set status = 'filed', filed_at = current_date - 40 where id = pg_temp.got('b', 'proceeding')::uuid;
select pg_temp.sign_in('a2860000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ask_b', public.ask_proceeding_history(pg_temp.got('b', 'proceeding')::uuid));
select throws_ok(format('select public.ask_proceeding_history(%L)', pg_temp.got('a', 'proceeding')), 'P0002', null,
  'another firm asks nothing of a lawsuit it does not have');
reset role;
select is(pg_temp.got('ask_b', 'code') || ' ' || (select r.status from public.proceeding_history_reads r
          where r.id = pg_temp.got('claim_b2', 'read_id')::uuid),
  'queued due', 'asked again by its lawyer, a history given up is owed again');
select pg_temp.sign_in('a2860000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ask_a', public.ask_proceeding_history(pg_temp.got('a', 'proceeding')::uuid));
reset role;
select is(pg_temp.got('ask_a', 'code'), 'already', 'one already read stays as it is');

select * from finish();
rollback;
