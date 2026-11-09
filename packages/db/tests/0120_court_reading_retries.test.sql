begin;
create extension if not exists pgtap;
select plan(12);

-- ============================================================
-- A reading of the court that stopped is started over by ONE a week later,
-- up to three times, before a person is called (0119). Paused, it calls
-- nobody; its week past, it starts over with its attempts back; the last time
-- spent, it is a person's; a source that answers, or another number, starts
-- the count over; a person asks for a reading of a paused one as of one given
-- up; a claim never finished pauses too; and a case that ended is not started
-- over. Two firms: nothing of one moves the other's.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1200000-0000-4000-8000-000000000001', 'ana@souza-leitura.invalid', 'Ana Souza'),
  ('a1200000-0000-4000-8000-000000000002', 'davi@rocha-leitura.invalid', 'Davi Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1200000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-leitura', 'a1200000-0000-4000-8000-000000000001'),
  ('b1200000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-leitura', 'a1200000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1200000-0000-4000-8000-00000000000a', 'a1200000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1200000-0000-4000-8000-00000000000b', 'a1200000-0000-4000-8000-000000000002', 'owner', 'socio');

-- Souza: two lawsuits of TJSP in one case, and one in a case that ended. Rocha: one of its own.
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1200000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c1200000-0000-4000-8000-000000000002', 'b1200000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed'),
  ('c1200000-0000-4000-8000-000000000003', 'b1200000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1200000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-00000000000a', 'c1200000-0000-4000-8000-000000000001',
   'comum', 'TJSP', 'filed', '10003015320998260100', '2026-10-01'),
  ('f1200000-0000-4000-8000-000000000002', 'b1200000-0000-4000-8000-00000000000a', 'c1200000-0000-4000-8000-000000000001',
   'comum', 'TJSP', 'filed', '10003023820998260100', '2026-10-01'),
  ('f1200000-0000-4000-8000-000000000003', 'b1200000-0000-4000-8000-00000000000a', 'c1200000-0000-4000-8000-000000000002',
   'comum', 'TJSP', 'filed', '10003032320998260100', '2026-10-01'),
  ('f1200000-0000-4000-8000-000000000004', 'b1200000-0000-4000-8000-00000000000b', 'c1200000-0000-4000-8000-000000000003',
   'comum', 'TJSP', 'filed', '10003040820998260100', '2026-10-01');

-- One attempt a reading, so each claim that fails gives the reading up.
update public.platform_settings set value = value || '{"max_attempts": 1}'::jsonb where key = 'tracking';

create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.tracking(lawsuit text) returns public.proceeding_tracking language sql as
$$ select * from public.proceeding_tracking where proceeding_id = ('f1200000-0000-4000-8000-00000000000' || lawsuit)::uuid; $$;

create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role;

/** The backend claims the reading of one lawsuit and says the source gave no answer; answers what was recorded. */
create function pg_temp.fail(lawsuit text, outcome text default 'retry') returns jsonb language plpgsql as $$
declare
  claimed record;
  answer jsonb;
begin
  perform pg_temp.as_backend();
  set local role service_role;
  select * into claimed from public.claim_proceeding_reads(array['aggregator'], 10, false, (pg_temp.tracking(lawsuit)).id);
  if claimed.tracking_id is null then
    reset role;
    return jsonb_build_object('claimed', false);
  end if;
  answer := public.record_proceeding_read(claimed.tracking_id, claimed.claim, outcome, null, null, 'aggregator_http_503');
  reset role;
  return answer || jsonb_build_object('claimed', true);
end;
$$;

/** The week of a paused reading passes. */
create function pg_temp.week_passes(lawsuit text) returns void language sql as $$
  update public.proceeding_tracking set retry_at = now() - interval '1 minute'
  where id = (pg_temp.tracking(lawsuit)).id and status = 'paused';
$$;

-- ---------- Given up: paused, calling nobody ----------

insert into res values ('first', pg_temp.fail('1'));
select ok(
  (select value ->> 'code' = 'paused' from res where key = 'first')
    and (select status = 'paused' and retry_rounds = 0 and retry_at between now() + interval '7 days' - interval '1 minute'
                                                               and now() + interval '7 days' + interval '1 minute'
                and next_read_at is null and work_error = 'aggregator_http_503'
         from pg_temp.tracking('1')),
  'a reading given up pauses, to be started over by ONE a week later'
);
select pg_temp.sign_in('a1200000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (select (public.firm_today('b1200000-0000-4000-8000-00000000000a') ->> 'tracking_failed')::int),
  0,
  'and calls nobody: the home counts no reading given up'
);
reset role;
select is(pg_temp.fail('1') ->> 'claimed', 'false', 'before its week it is not read');

-- ---------- Its week past, started over; the last time spent, a person's ----------

select pg_temp.week_passes('1');
insert into res values ('second', pg_temp.fail('1', 'failed'));
select ok(
  (select value ->> 'claimed' = 'true' and value ->> 'code' = 'paused' from res where key = 'second')
    and (select status = 'paused' and retry_rounds = 1 from pg_temp.tracking('1')),
  'its week past, ONE starts it over with its attempts back, and a new give-up pauses it again'
);

select pg_temp.week_passes('1');
select pg_temp.fail('1', 'failed');
select pg_temp.week_passes('1');
insert into res values ('last', pg_temp.fail('1', 'failed'));
select ok(
  (select value ->> 'code' = 'failed' from res where key = 'last')
    and (select status = 'failed' and retry_rounds = 3 and retry_at is null from pg_temp.tracking('1')),
  'after the third time it is given up for good'
);
select pg_temp.sign_in('a1200000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (select (public.firm_today('b1200000-0000-4000-8000-00000000000a') ->> 'tracking_failed')::int),
  1,
  'and only then calls a person'
);
reset role;

-- ---------- A person asks; a source that answers starts the count over ----------

-- The second lawsuit pauses; a person asks for it now, as of one given up.
select pg_temp.fail('2');
select pg_temp.sign_in('a1200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ask', public.request_proceeding_read('f1200000-0000-4000-8000-000000000002'));
reset role;
select ok(
  (select value ->> 'ok' = 'true' from res where key = 'ask')
    and (select status = 'waiting' and retry_at is null and work_attempts = 0 and next_read_at <= now()
         from pg_temp.tracking('2')),
  'a person asks for a reading of a paused one at once'
);

-- Their request gives up too, with the count where it was.
insert into res values ('asked-failed', pg_temp.fail('2'));
select ok(
  (select value ->> 'code' = 'paused' from res where key = 'asked-failed')
    and (select status = 'paused' and retry_rounds = 0 from pg_temp.tracking('2')),
  'a person''s request that gives up pauses too, the weekly count where it was'
);

-- Two times started over, the source answers at the next (the court does not show it yet): the count starts over.
update public.proceeding_tracking set retry_rounds = 2 where id = (pg_temp.tracking('2')).id;
select pg_temp.week_passes('2');
insert into res values ('answered', pg_temp.fail('2', 'not_found'));
select ok(
  (select value ->> 'code' = 'not_found' from res where key = 'answered')
    and (select status = 'not_found' and retry_rounds = 0 and retry_at is null from pg_temp.tracking('2')),
  'a source that answers starts the count over'
);

-- Another number is another lawsuit, and starts over too.
update public.proceeding_tracking set status = 'paused', retry_at = now() + interval '7 days', retry_rounds = 2
where id = (pg_temp.tracking('3')).id;
update public.proceedings set cnj = '10001119020998260100' where id = 'f1200000-0000-4000-8000-000000000003';
select ok(
  (select status = 'waiting' and retry_rounds = 0 and retry_at is null from pg_temp.tracking('3')),
  'another number of the lawsuit starts the count over'
);

-- ---------- A claim never finished, a case that ended, and the other firm ----------

-- Rocha's reading is claimed and its worker never comes back: the claim goes back given up, and pauses.
select pg_temp.as_backend();
set local role service_role;
insert into res select 'rocha-claim', to_jsonb(c)
  from public.claim_proceeding_reads(array['aggregator'], 10, false, (pg_temp.tracking('4')).id) c;
reset role;
update public.proceeding_tracking set work_claimed_at = now() - interval '2 hours' where id = (pg_temp.tracking('4')).id;
select pg_temp.as_backend();
set local role service_role;
select count(*) from public.claim_proceeding_reads(array['projudi'], 10, false);
reset role;
select ok(
  (select status = 'paused' and work_error = 'abandoned' and retry_rounds = 0 and retry_at > now() + interval '6 days'
   from pg_temp.tracking('4'))
    and (select status = 'not_found' from pg_temp.tracking('2')),
  'a claim never finished pauses as well, and nothing of the other firm moved'
);

-- Souza's second case ends while its reading waits for its week: it is not started over.
update public.proceeding_tracking set status = 'paused', retry_at = now() - interval '1 minute', retry_rounds = 0,
  next_read_at = null
where id = (pg_temp.tracking('3')).id;
update public.cases set status = 'closed', closed_at = now() where id = 'c1200000-0000-4000-8000-000000000002';
select pg_temp.as_backend();
set local role service_role;
select count(*) from public.claim_proceeding_reads(array['aggregator'], 10, false);
reset role;
select ok(
  (select status = 'paused' and retry_rounds = 0 from pg_temp.tracking('3')),
  'a reading of a case that ended is not started over'
);

select * from finish();
rollback;
