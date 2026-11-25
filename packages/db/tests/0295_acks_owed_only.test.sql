begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- The bell of the awareness of ONE's triage asks the database only for what
-- is still owed (0295): who has not had a publication's notice and, once it
-- is late, who has not had the day's reminder, with the keys the backend
-- writes; the limit comes after that, and one publication can be asked for.
-- Two firms: each publication is told to its own firm's people only.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2950000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@avisoone.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2950000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@avisoone.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a2950000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@avisoone.invalid', '', now(), '{}', '{"display_name":"Caio Reis"}', now(), now()),
  ('a2950000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@avisoone.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b2950000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-avisoone', 'a2950000-0000-4000-8000-000000000001'),
  ('b2950000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-avisoone', 'a2950000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2950000-0000-4000-8000-00000000000a', 'a2950000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2950000-0000-4000-8000-00000000000a', 'a2950000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b2950000-0000-4000-8000-00000000000a', 'a2950000-0000-4000-8000-000000000003', 'member', 'controladoria'),
  ('b2950000-0000-4000-8000-00000000000b', 'a2950000-0000-4000-8000-000000000005', 'owner', 'advogado');

-- What ONE triaged: A1 (to Bia, an hour ago), A2 (to Bia, ten hours ago: late), A3 (to nobody of the firm, half an
-- hour ago), A5 (to Bia, already acknowledged), and B1 for firm B (to Davi, two hours ago).
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, lawyer_ids,
                                 category, triaged_at, ack_owed)
select ('ce295000-0000-4000-8000-0000000000' || n)::uuid, org::uuid, 'avisoone000000' || n, 'TJGO',
       '50002023920998090051', current_date, 'Intimação', 'Texto inventado ' || n, lawyers::uuid[],
       'prazo', now() - ago::interval, n <> 'a5'
from (values
  ('a1', 'b2950000-0000-4000-8000-00000000000a', '{a2950000-0000-4000-8000-000000000002}', '1 hour'),
  ('a2', 'b2950000-0000-4000-8000-00000000000a', '{a2950000-0000-4000-8000-000000000002}', '10 hours'),
  ('a3', 'b2950000-0000-4000-8000-00000000000a', '{}', '30 minutes'),
  ('a5', 'b2950000-0000-4000-8000-00000000000a', '{a2950000-0000-4000-8000-000000000002}', '3 hours'),
  ('b1', 'b2950000-0000-4000-8000-00000000000b', '{a2950000-0000-4000-8000-000000000005}', '2 hours')
) as p (n, org, lawyers, ago);

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to service_role;

create function pg_temp.pub(n text) returns uuid language sql as
$$ select ('ce295000-0000-4000-8000-0000000000' || n)::uuid; $$;
create function pg_temp.who(n text) returns uuid language sql as
$$ select ('a2950000-0000-4000-8000-00000000000' || n)::uuid; $$;
-- What the bell owes, as the backend reads it, by name of each publication.
create function pg_temp.owed(name text, target_limit integer, target_publication uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  insert into res values (name, coalesce((
    select jsonb_agg(jsonb_build_object(
             'n', right(o.publication_id::text, 2), 'org', o.org_id, 'told_key', o.told_key,
             'to_tell', to_jsonb(o.to_tell), 'reminder_key', o.reminder_key, 'to_remind', to_jsonb(o.to_remind))
           order by o.triaged_at)
    from public.publication_acks_owed(target_limit, target_publication) o
    where o.org_id in ('b2950000-0000-4000-8000-00000000000a', 'b2950000-0000-4000-8000-00000000000b')), '[]'));
  execute 'reset role';
end;
$$;
create function pg_temp.item(name text, n text) returns jsonb language sql as
$$ select e from res, jsonb_array_elements(res.payload) e where res.name = item.name and e ->> 'n' = item.n; $$;
create function pg_temp.names(name text) returns text language sql as
$$ select string_agg(e ->> 'n', ',') from res, jsonb_array_elements(res.payload) e where res.name = names.name; $$;
-- A notice the backend wrote: the key it was given, with the person (`notifyUsers`).
create function pg_temp.told(key text, person text) returns void language sql as
$$ insert into public.notifications (user_id, type, title, source_key) values (pg_temp.who(person), 'team', 'Aviso', key || ':' || pg_temp.who(person)); $$;

select ok(
  not has_function_privilege('authenticated', 'public.publication_acks_owed(integer, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.publication_acks_owed(integer, uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.publication_acks_owed(integer, uuid)', 'EXECUTE')
  and not exists (select 1 from pg_proc where proname = 'publication_acks_owed' and pronargs = 1),
  'what the bell owes is read by the backend alone, through one function'
);

-- ---------- Nothing told yet ----------

select pg_temp.owed('first', 200, null);
select ok(
  pg_temp.names('first') = 'a2,b1,a1,a3'
  and pg_temp.item('first', 'a1') -> 'to_tell' = to_jsonb(array[pg_temp.who('2')])
  and pg_temp.item('first', 'a1') -> 'to_remind' = '[]'::jsonb
  and pg_temp.item('first', 'a1') ->> 'told_key' = 'pub-ack:' || pg_temp.pub('a1')
  and pg_temp.item('first', 'a2') -> 'to_remind' = to_jsonb(array[pg_temp.who('2')])
  and pg_temp.item('first', 'a2') ->> 'reminder_key'
      = 'pub-ack-late:' || pg_temp.pub('a2') || ':' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')
  and pg_temp.item('first', 'a3') -> 'to_tell' = to_jsonb(array[pg_temp.who('1'), pg_temp.who('2'), pg_temp.who('3')])
  and pg_temp.item('first', 'b1') -> 'to_tell' = to_jsonb(array[pg_temp.who('5')])
  and pg_temp.item('first', 'b1') ->> 'org' = 'b2950000-0000-4000-8000-00000000000b',
  'each publication is owed to its own firm''s people, the late one its reminder of the day too, the acknowledged one nothing'
);

-- ---------- Some told ----------

select pg_temp.told('pub-ack:' || pg_temp.pub('a1'), '2');
select pg_temp.told('pub-ack:' || pg_temp.pub('a2'), '2');
select pg_temp.told('pub-ack:' || pg_temp.pub('a3'), '1');
-- A reminder of another day says nothing of today's.
select pg_temp.told('pub-ack-late:' || pg_temp.pub('a2') || ':2026-01-01', '2');
select pg_temp.owed('some', 200, null);
select ok(
  pg_temp.names('some') = 'a2,b1,a3'
  and pg_temp.item('some', 'a2') -> 'to_tell' = '[]'::jsonb
  and pg_temp.item('some', 'a2') -> 'to_remind' = to_jsonb(array[pg_temp.who('2')])
  and pg_temp.item('some', 'a3') -> 'to_tell' = to_jsonb(array[pg_temp.who('2'), pg_temp.who('3')]),
  'who already had a notice is not owed it again; a late one is reminded once a day'
);

select pg_temp.told(pg_temp.item('some', 'a2') ->> 'reminder_key', '2');
select pg_temp.owed('reminded', 200, null);
select ok(
  pg_temp.names('reminded') = 'b1,a3',
  'once the day''s reminder is written, the late one owes nothing until the next day'
);

-- ---------- The limit and one publication ----------

select pg_temp.owed('one', 1, null);
select ok(
  pg_temp.names('one') = 'b1',
  'the limit is taken over what is still owed: older publications already told never hold a new one back'
);

select pg_temp.owed('only_a3', 200, pg_temp.pub('a3'));
select pg_temp.owed('only_a1', 200, pg_temp.pub('a1'));
select pg_temp.owed('only_a5', 200, pg_temp.pub('a5'));
select ok(
  pg_temp.names('only_a3') = 'a3' and pg_temp.names('only_a1') is null and pg_temp.names('only_a5') is null,
  'a round may ask for one publication, and gets it only while something of it is owed'
);

-- ---------- The awareness given ----------

update public.publications set ack_owed = false, acked_at = now(), acked_by = pg_temp.who('2')
where id = pg_temp.pub('a3');
select pg_temp.owed('acked', 200, null);
select ok(
  pg_temp.names('acked') = 'b1',
  'once somebody is aware of it, nobody is told of it any more'
);

select * from finish();
rollback;
