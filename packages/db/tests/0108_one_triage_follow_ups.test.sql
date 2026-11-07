begin;
create extension if not exists pgtap;
select plan(11);

-- ============================================================
-- What follows a person's triage also follows ONE's own (0107): a payment
-- ONE triaged warns the client against the scam as one a person triaged,
-- and a payment the AI only answered in the shadow warns nobody; a decision
-- ONE triaged keeps what the rule of the judgment reads of it, only where
-- nobody said a word on it and only through the backend, and a person's word
-- still corrects it. Two firms: nothing of one reaches the other.
--
-- Every person, firm and number here is invented: the phones are of an area
-- code no carrier has, and the lawsuits are of 2099.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1080000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@segueone.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1080000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@segueone.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1080000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-segueone', 'a1080000-0000-4000-8000-000000000001'),
  ('b1080000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-segueone', 'a1080000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1080000-0000-4000-8000-00000000000a', 'a1080000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1080000-0000-4000-8000-00000000000b', 'a1080000-0000-4000-8000-000000000002', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.pub(n text) returns uuid language sql as
$$ select ('ce108000-0000-4000-8000-0000000000' || n)::uuid; $$;
create function pg_temp.row_of(n text) returns public.publications language sql as
$$ select * from public.publications where id = pg_temp.pub(n); $$;

-- A test case of the test chat with its client and a lawsuit filed today, as the test court leaves it.
create function pg_temp.lawsuit(name text, who uuid, org uuid, cnj text, phone text) returns void
language plpgsql as $$
declare
  made jsonb;
  filed jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  made := public.create_case(org, 'cancellation', 'LA', date '2026-09-20',
    jsonb_build_object('full_name', 'Cliente ' || initcap(name), 'birth_date', '1985-04-02', 'phone', phone));
  reset role;
  update public.cases set is_test = true where id = (made ->> 'case_id')::uuid;
  perform pg_temp.sign_in(who);
  set local role authenticated;
  filed := public.save_proceeding((made ->> 'case_id')::uuid, null,
    jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'system', 'projudi', 'comarca', 'Goiânia', 'status', 'filed',
      'cnj', cnj, 'filed_at', to_char(current_date, 'YYYY-MM-DD')),
    array[(made ->> 'party_id')::uuid]);
  reset role;
  insert into res values (name, made || jsonb_build_object('proceeding_id', filed ->> 'proceeding_id'));
end;
$$;

-- The AI's triage of one publication, as the backend runs and records it: its category and how sure it is.
create function pg_temp.ai_says(n text, category text, certainty text) returns jsonb language plpgsql as $$
declare
  held record;
  started jsonb;
  finished jsonb;
  org uuid := (select org_id from public.publications where id = pg_temp.pub(n));
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  select * into held from public.claim_publication_triage(1, pg_temp.pub(n));
  started := public.start_ai_run(org, 'publicacao.triagem', repeat('e', 64), null, 'publication', pg_temp.pub(n)::text,
    'triagem:' || pg_temp.pub(n)::text || ':' || held.claim::text);
  finished := public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded',
    jsonb_build_object('resumo', 'Uma frase.', 'categoria', category, 'certeza', certainty, 'urgente', false), 500, 60);
  finished := public.record_publication_triage(pg_temp.pub(n), held.claim, 'done', (started ->> 'run_id')::uuid);
  execute 'reset role';
  return finished;
end;
$$;

-- What the rule of the judgment read of a publication, as the backend keeps it.
create function pg_temp.judge(publication uuid, judgment boolean) returns jsonb language plpgsql as $$
declare
  answer jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  answer := public.record_publication_judgment_rule(publication, judgment);
  execute 'reset role';
  return answer;
end;
$$;

-- What is due in a firm, of one publication.
create function pg_temp.warned(org uuid, n text) returns bigint language sql as
$$ select count(*) from public.notice_candidates(org, null) c
   where c.kind = 'payment_alert' and c.publication_id = pg_temp.pub(n); $$;

select pg_temp.lawsuit('alfa', 'a1080000-0000-4000-8000-000000000001', 'b1080000-0000-4000-8000-00000000000a',
  '5000701-23.2099.8.09.0051', '5500999108001');
select pg_temp.lawsuit('beta', 'a1080000-0000-4000-8000-000000000002', 'b1080000-0000-4000-8000-00000000000b',
  '5000702-08.2099.8.09.0051', '5500999108002');

-- What the DJEN brought of the lawsuits: A1 to A6 for firm A, B1 for firm B.
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, document_type, body,
  proceeding_id, case_id)
select pg_temp.pub(n), org::uuid, 'segueone000000' || n, 'TJGO', cnj, current_date, 'Intimação', doc, body,
       pg_temp.got(lawsuit, 'proceeding_id')::uuid, pg_temp.got(lawsuit, 'case_id')::uuid
from (values
  ('a1', 'b1080000-0000-4000-8000-00000000000a', 'alfa', '50007012320998090051', null,
   'Expeça-se alvará em favor da parte autora.'),
  ('a2', 'b1080000-0000-4000-8000-00000000000a', 'alfa', '50007012320998090051', null,
   'Expeça-se alvará do valor depositado.'),
  ('a3', 'b1080000-0000-4000-8000-00000000000a', 'alfa', '50007012320998090051', 'Sentença',
   'SENTENÇA. Dispensado o relatório. Julgo procedente o pedido.'),
  ('a4', 'b1080000-0000-4000-8000-00000000000a', 'alfa', '50007012320998090051', 'Sentença',
   'SENTENÇA. Dispensado o relatório. Julgo procedente o pedido.'),
  ('a5', 'b1080000-0000-4000-8000-00000000000a', 'alfa', '50007012320998090051', 'Decisão',
   'Defiro a tutela de urgência.'),
  ('a6', 'b1080000-0000-4000-8000-00000000000a', 'alfa', '50007012320998090051', null,
   'Ciência às partes do retorno dos autos.'),
  ('b1', 'b1080000-0000-4000-8000-00000000000b', 'beta', '50007020820998090051', null,
   'Expeça-se alvará em favor da parte autora.')
) as p (n, org, lawsuit, cnj, doc, body);

select ok(
  pg_temp.got('alfa', 'proceeding_id') is not null and pg_temp.got('beta', 'proceeding_id') is not null
  and (select bool_and(is_test) from public.cases
       where id in (pg_temp.got('alfa', 'case_id')::uuid, pg_temp.got('beta', 'case_id')::uuid))
  and has_function_privilege('service_role', 'public.record_publication_judgment_rule(uuid, boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_publication_judgment_rule(uuid, boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.record_publication_judgment_rule(uuid, boolean)', 'EXECUTE'),
  'a test case of each firm with a lawsuit filed, and the judgment of ONE''s triage written only by the backend'
);

-- ---------- The warning against the scam ----------

insert into res values ('a1', pg_temp.ai_says('a1', 'pagamento', 'alta'));
insert into res values ('a2', pg_temp.ai_says('a2', 'pagamento', 'baixa'));
select ok(
  pg_temp.got('a1', 'applied') = 'true'
  and (select category = 'pagamento' and ai_applied and triaged_by is null from pg_temp.row_of('a1'))
  and pg_temp.warned('b1080000-0000-4000-8000-00000000000a', 'a1') = 1,
  'a payment ONE triaged warns its client against the scam, as one a person triaged'
);

select ok(
  pg_temp.got('a2', 'applied') = 'false'
  and (select category is null and ai_category = 'pagamento' from pg_temp.row_of('a2'))
  and pg_temp.warned('b1080000-0000-4000-8000-00000000000a', 'a2') = 0,
  'a payment the AI answered without being sure stays a person''s to triage, and warns nobody yet'
);

update public.publications set category = 'pagamento', triaged_by = 'a1080000-0000-4000-8000-000000000001',
  triaged_at = now() where id = pg_temp.pub('a2');
select ok(
  pg_temp.warned('b1080000-0000-4000-8000-00000000000a', 'a2') = 1,
  'a payment a person triaged warns as before'
);

-- ---------- Whether a decision ONE triaged is the judgment ----------

insert into res values ('a3', pg_temp.ai_says('a3', 'decisao', 'alta'));
insert into res values ('a3-rule', pg_temp.judge(pg_temp.pub('a3'), true));
select ok(
  pg_temp.got('a3', 'applied') = 'true' and pg_temp.got('a3-rule', 'code') = 'saved'
  and (select judgment and judgment_source = 'rule' and judgment_by is null and judgment_at is not null
       from pg_temp.row_of('a3'))
  and (select count(*) = 1 from public.audit_events
       where action = 'publication.judgment' and entity_id = pg_temp.pub('a3')::text
         and metadata ->> 'source' = 'rule' and actor_id is null)
  and (select count(*) = 1 from public.case_events
       where case_id = pg_temp.got('alfa', 'case_id')::uuid and kind = 'publication_judged'
         and actor_type = 'system' and data ->> 'publication' = pg_temp.pub('a3')::text),
  'a decision ONE triaged keeps what the rule read of it, on the record and in the case''s timeline as ONE''s'
);

insert into res values ('a3-again', pg_temp.judge(pg_temp.pub('a3'), false));
select ok(
  pg_temp.got('a3-again', 'code') = 'kept' and (select judgment from pg_temp.row_of('a3')),
  'the rule reads a decision once, and never over what was said of it'
);

select pg_temp.sign_in('a1080000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a3-person', public.set_publication_judgment(pg_temp.pub('a3'), false, 'person'));
reset role;
insert into res values ('a3-after', pg_temp.judge(pg_temp.pub('a3'), true));
select ok(
  pg_temp.got('a3-person', 'code') = 'saved' and pg_temp.got('a3-after', 'code') = 'kept'
  and (select not judgment and judgment_source = 'person' from pg_temp.row_of('a3')),
  'a person''s word corrects the rule''s, and the rule never writes over it'
);

select pg_temp.sign_in('a1080000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a4-person', public.triage_publication(pg_temp.pub('a4'), 'decisao', null));
reset role;
insert into res values ('a4-rule', pg_temp.judge(pg_temp.pub('a4'), true));
insert into res values ('a5', pg_temp.ai_says('a5', 'decisao', 'alta'));
update public.publications set active = false, cancelled_at = now() where id = pg_temp.pub('a5');
insert into res values ('a5-rule', pg_temp.judge(pg_temp.pub('a5'), false));
insert into res values ('a1-rule', pg_temp.judge(pg_temp.pub('a1'), true));
insert into res values ('a6-rule', pg_temp.judge(pg_temp.pub('a6'), true));
insert into res values ('none-rule', pg_temp.judge('ce108000-0000-4000-8000-0000000000ff', true));
insert into res values ('null-rule', pg_temp.judge(pg_temp.pub('a3'), null));
select ok(
  pg_temp.got('a4-person', 'code') = 'saved' and pg_temp.got('a4-rule', 'code') = 'not_one'
  and (select judgment_source is distinct from 'rule' from pg_temp.row_of('a4'))
  and pg_temp.got('a5-rule', 'code') = 'cancelled'
  and pg_temp.got('a1-rule', 'code') = 'not_decision' and pg_temp.got('a6-rule', 'code') = 'not_decision'
  and pg_temp.got('none-rule', 'code') = 'not_found' and pg_temp.got('null-rule', 'code') = 'invalid_data',
  'the backend keeps the rule''s reading only of a decision in force that ONE triaged'
);

select pg_temp.sign_in('a1080000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.record_publication_judgment_rule('ce108000-0000-4000-8000-0000000000a3', true) $$,
  '42501',
  null,
  'nobody of a firm writes the rule''s reading of a decision: only the backend'
);
reset role;

-- ---------- Two firms ----------

insert into res values ('b1', pg_temp.ai_says('b1', 'pagamento', 'alta'));
select ok(
  pg_temp.got('b1', 'applied') = 'true'
  and pg_temp.warned('b1080000-0000-4000-8000-00000000000b', 'b1') = 1
  and pg_temp.warned('b1080000-0000-4000-8000-00000000000a', 'b1') = 0
  and (select count(*) = 0 from public.notice_candidates('b1080000-0000-4000-8000-00000000000b', null) c
       where c.case_id = pg_temp.got('alfa', 'case_id')::uuid),
  'a payment ONE triaged in one firm warns that firm''s client, and nothing of it reaches the other'
);

select ok(
  (select count(*) = 0 from public.publications
   where org_id = 'b1080000-0000-4000-8000-00000000000b' and judgment_source is not null)
  and (select count(*) = 0 from public.case_events
       where org_id = 'b1080000-0000-4000-8000-00000000000b' and kind = 'publication_judged'),
  'what ONE read of firm A''s decisions touched nothing of firm B'
);

select * from finish();
rollback;
