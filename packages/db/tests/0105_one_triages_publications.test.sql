begin;
create extension if not exists pgtap;
select plan(11);

-- ============================================================
-- ONE triages the firm's publications by itself, and the lawyer each was
-- addressed to says they are aware of it (0104). Where the firm lets ONE,
-- the AI's answer is the triage when the AI is sure of a whole text nobody
-- triaged yet, owing a person's awareness; an answer that is not sure, a
-- text cut short or a firm that keeps the triage to a person leave it to a
-- person. The awareness is given by saying so or by triaging it; it is said
-- late after the setting's hours. Two firms: nothing of one reaches the
-- other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1050000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@triaone.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1050000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@triaone.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a1050000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@triaone.invalid', '', now(), '{}', '{"display_name":"Caio Reis"}', now(), now()),
  ('a1050000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'gil@triaone.invalid', '', now(), '{}', '{"display_name":"Gil Prado"}', now(), now()),
  ('a1050000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@triaone.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1050000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-triaone', 'a1050000-0000-4000-8000-000000000001'),
  ('b1050000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-triaone', 'a1050000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1050000-0000-4000-8000-00000000000a', 'a1050000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1050000-0000-4000-8000-00000000000a', 'a1050000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1050000-0000-4000-8000-00000000000a', 'a1050000-0000-4000-8000-000000000003', 'member', 'controladoria'),
  ('b1050000-0000-4000-8000-00000000000a', 'a1050000-0000-4000-8000-000000000004', 'member', 'atendimento'),
  ('b1050000-0000-4000-8000-00000000000b', 'a1050000-0000-4000-8000-000000000005', 'owner', 'advogado');

-- What the DJEN brought: A1 to A5 for firm A (A1, A2, A3 and A5 addressed to Bia, A4 to nobody of the firm, A3 cut
-- short), B1 for firm B.
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, truncated, lawyer_ids)
select ('ce105000-0000-4000-8000-0000000000' || n)::uuid, org::uuid, 'triaone0000000' || n, 'TJGO',
       '50002023920998090051', current_date, 'Intimação', 'Texto inventado ' || n, n = 'a3', lawyers::uuid[]
from (values
  ('a1', 'b1050000-0000-4000-8000-00000000000a', '{a1050000-0000-4000-8000-000000000002}'),
  ('a2', 'b1050000-0000-4000-8000-00000000000a', '{a1050000-0000-4000-8000-000000000002}'),
  ('a3', 'b1050000-0000-4000-8000-00000000000a', '{a1050000-0000-4000-8000-000000000002}'),
  ('a4', 'b1050000-0000-4000-8000-00000000000a', '{}'),
  ('a5', 'b1050000-0000-4000-8000-00000000000a', '{a1050000-0000-4000-8000-000000000002}'),
  ('b1', 'b1050000-0000-4000-8000-00000000000b', '{a1050000-0000-4000-8000-000000000005}')
) as p (n, org, lawyers);

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.pub(n text) returns uuid language sql as
$$ select ('ce105000-0000-4000-8000-0000000000' || n)::uuid; $$;
create function pg_temp.row_of(n text) returns public.publications language sql as
$$ select * from public.publications where id = pg_temp.pub(n); $$;
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
-- What one person reads, with their own session.
create function pg_temp.as_person(who uuid, query text) returns jsonb language plpgsql as $$
declare
  answer jsonb;
begin
  perform pg_temp.sign_in(who);
  execute 'set local role authenticated';
  execute query into answer;
  execute 'reset role';
  return answer;
end;
$$;

-- ---------- The decision and the instructions ----------

select ok(
  (select task = 'publicacao.triagem' and modes = array['auto', 'approval'] and default_mode = 'auto' and not held
   from public.autonomy_decisions where key = 'publication_triage')
  and (select output_schema -> 'properties' ? 'certeza' and output_schema -> 'required' ? 'certeza'
       from public.prompt_versions where task = 'publicacao.triagem' and is_active)
  and (select count(*) = 1 from public.prompt_versions where task = 'publicacao.triagem' and is_active)
  and has_column_privilege('authenticated', 'public.publications', 'ack_owed', 'SELECT')
  and has_column_privilege('authenticated', 'public.publications', 'acked_by', 'SELECT')
  and not has_column_privilege('authenticated', 'public.publications', 'ack_owed', 'UPDATE')
  and has_function_privilege('authenticated', 'public.acknowledge_publication(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.firm_publication_acks(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.publication_acks_owed(integer, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.publication_ack_lawyers(uuid, uuid[])', 'EXECUTE'),
  'ONE triages by default, its instructions ask how sure it is, and the awareness is written only through the functions'
);

-- ---------- ONE triages what it is sure of ----------

insert into res values ('a1', pg_temp.ai_says('a1', 'audiencia', 'alta'));
select ok(
  pg_temp.got('a1', 'applied') = 'true' and pg_temp.got('a1', 'ack_owed') = 'true'
  and (select category = 'audiencia' and ai_applied and ack_owed and triaged_by is null and triaged_at is not null
              and acked_by is null and not review_due
       from pg_temp.row_of('a1'))
  and (select count(*) = 1 from public.audit_events
       where action = 'publication.triaged_by_ai' and entity_id = pg_temp.pub('a1')::text
         and metadata ->> 'ack_owed' = 'true'),
  'an answer the AI is sure of, of a whole text nobody triaged, is the triage, and owes a person''s awareness'
);

insert into res values ('a2', pg_temp.ai_says('a2', 'prazo', 'baixa'));
insert into res values ('a3', pg_temp.ai_says('a3', 'ciencia', 'alta'));
insert into res values ('states', pg_temp.as_person('a1050000-0000-4000-8000-000000000002',
  $q$select jsonb_object_agg(publication_id, state) from public.publication_triage_states(array[
     'ce105000-0000-4000-8000-0000000000a1', 'ce105000-0000-4000-8000-0000000000a2',
     'ce105000-0000-4000-8000-0000000000a3', 'ce105000-0000-4000-8000-0000000000a4',
     'ce105000-0000-4000-8000-0000000000b1']::uuid[])$q$));
select ok(
  (select category is null and ai_category = 'prazo' and not ack_owed from pg_temp.row_of('a2'))
  and (select category is null and ai_category = 'ciencia' and not ack_owed from pg_temp.row_of('a3'))
  and (select payload ->> pg_temp.pub('a2')::text = 'left' and payload ->> pg_temp.pub('a3')::text = 'left'
              and payload ->> pg_temp.pub('a4')::text = 'working' and not (payload ? pg_temp.pub('a1')::text)
              and not (payload ? pg_temp.pub('b1')::text)
       from res where name = 'states'),
  'an answer that is not sure, or of a text cut short, is left to a person, and the screens say ONE is on the rest'
);

-- Firm B keeps the triage to a person.
insert into public.firm_autonomy (org_id, decision, mode) values
  ('b1050000-0000-4000-8000-00000000000b', 'publication_triage', 'approval');
insert into res values ('b1', pg_temp.ai_says('b1', 'audiencia', 'alta'));
select ok(
  (select category is null and ai_category = 'audiencia' and not ack_owed and not ai_applied from pg_temp.row_of('b1'))
  and pg_temp.got('b1', 'applied') = 'false',
  'a firm that keeps the triage to a person has the AI''s answer applied to nothing'
);

-- ---------- What is owed, and when it is late ----------

insert into res values ('owed', pg_temp.as_person('a1050000-0000-4000-8000-000000000002',
  $q$select public.firm_publication_acks('b1050000-0000-4000-8000-00000000000a')$q$));
select ok(
  (select (payload ->> 'total')::integer = 1 and (payload ->> 'late')::integer = 0
          and payload -> 'items' -> 0 ->> 'publication_id' = pg_temp.pub('a1')::text
          and payload -> 'items' -> 0 ->> 'category' = 'audiencia'
          and payload -> 'items' -> 0 ->> 'late' = 'false'
          and payload -> 'items' -> 0 -> 'lawyers' = '["a1050000-0000-4000-8000-000000000002"]'::jsonb
          and (payload ->> 'late_hours')::integer = 4
   from res where name = 'owed'),
  'the firm reads what awareness is owed, with who it waits on'
);

update public.publications set triaged_at = now() - interval '5 hours' where id = pg_temp.pub('a1');
insert into res values ('a4', pg_temp.ai_says('a4', 'ciencia', 'alta'));
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('bell', (select jsonb_agg(row_to_json(o)::jsonb order by o.triaged_at)
  from public.publication_acks_owed(50) o where o.org_id = 'b1050000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  (select jsonb_array_length(payload) = 2
          -- Late: owed its notice and the day's reminder (what is still owed is read as 0295 redefined it).
          and payload -> 0 ->> 'publication_id' = pg_temp.pub('a1')::text
          and payload -> 0 -> 'to_tell' = '["a1050000-0000-4000-8000-000000000002"]'::jsonb
          and payload -> 0 -> 'to_remind' = '["a1050000-0000-4000-8000-000000000002"]'::jsonb
          and payload -> 1 ->> 'publication_id' = pg_temp.pub('a4')::text and payload -> 1 -> 'to_remind' = '[]'::jsonb
          and payload -> 1 -> 'to_tell' = '["a1050000-0000-4000-8000-000000000001", "a1050000-0000-4000-8000-000000000002", "a1050000-0000-4000-8000-000000000003"]'::jsonb
   from res where name = 'bell'),
  'past the setting''s hours it is late; one addressed to nobody of the firm is told to who triages'
);

-- ---------- The awareness given ----------

insert into res values ('gil_ack', pg_temp.as_person('a1050000-0000-4000-8000-000000000004',
  $q$select public.acknowledge_publication('ce105000-0000-4000-8000-0000000000a1')$q$));
insert into res values ('bia_ack', pg_temp.as_person('a1050000-0000-4000-8000-000000000002',
  $q$select public.acknowledge_publication('ce105000-0000-4000-8000-0000000000a1')$q$));
insert into res values ('bia_again', pg_temp.as_person('a1050000-0000-4000-8000-000000000002',
  $q$select public.acknowledge_publication('ce105000-0000-4000-8000-0000000000a1')$q$));
select ok(
  pg_temp.got('gil_ack', 'code') = 'not_allowed'
  and pg_temp.got('bia_ack', 'code') = 'saved' and pg_temp.got('bia_again', 'code') = 'unchanged'
  and (select not ack_owed and acked_by = 'a1050000-0000-4000-8000-000000000002' and acked_at is not null
              and category = 'audiencia' and triaged_by is null
       from pg_temp.row_of('a1'))
  and (select count(*) = 1 from public.audit_events
       where action = 'publication.acknowledged' and entity_id = pg_temp.pub('a1')::text),
  'who triages says they are aware, once, on the record; the attendance does not'
);

insert into res values ('ana_triage', pg_temp.as_person('a1050000-0000-4000-8000-000000000001',
  $q$select public.triage_publication('ce105000-0000-4000-8000-0000000000a4', 'prazo')$q$));
select ok(
  pg_temp.got('ana_triage', 'code') = 'saved'
  and (select category = 'prazo' and triaged_by = 'a1050000-0000-4000-8000-000000000001' and not ack_owed
              and acked_by = 'a1050000-0000-4000-8000-000000000001' and acked_at is not null
       from pg_temp.row_of('a4')),
  'a person who triages what ONE triaged gives the awareness too, with the word they said'
);

insert into res values ('a5', pg_temp.ai_says('a5', 'decisao', 'alta'));
insert into res values ('a5_ack', pg_temp.as_person('a1050000-0000-4000-8000-000000000003',
  $q$select public.acknowledge_publication('ce105000-0000-4000-8000-0000000000a5')$q$));
select ok(
  pg_temp.got('a5', 'ack_owed') = 'true' and pg_temp.got('a5_ack', 'code') = 'saved'
  and (select count(*) = 0 from public.publications where org_id = 'b1050000-0000-4000-8000-00000000000a' and ack_owed)
  and (select (payload ->> 'total')::integer = 0
       from (select pg_temp.as_person('a1050000-0000-4000-8000-000000000003',
               $q$select public.firm_publication_acks('b1050000-0000-4000-8000-00000000000a')$q$) as payload) x),
  'nothing is owed once every triage ONE made was acknowledged'
);

-- ---------- Two firms ----------

insert into res values ('cross_ack', pg_temp.as_person('a1050000-0000-4000-8000-000000000002',
  $q$select public.acknowledge_publication('ce105000-0000-4000-8000-0000000000b1')$q$));
select ok(
  pg_temp.got('cross_ack', 'code') = 'not_found',
  'nobody acknowledges a publication of another firm'
);

select pg_temp.sign_in('a1050000-0000-4000-8000-000000000005');
set local role authenticated;
select throws_ok(
  $$select public.firm_publication_acks('b1050000-0000-4000-8000-00000000000a')$$,
  '42501', 'not_authorized',
  'nobody of another firm reads what this one''s awareness is owed'
);
reset role;

select * from finish();
rollback;
