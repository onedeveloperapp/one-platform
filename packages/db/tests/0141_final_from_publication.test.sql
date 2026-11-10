begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- The court's certificate that the judgment became final, read where it is
-- published (0142): a publication triaged as anything but the judgment or a
-- payment is read once more, by the backend alone, and a certificate is the
-- lawsuit's trânsito as ONE's, its day the DJEN's, once per lawsuit. Never of
-- the judgment itself, a payment, a publication of no lawsuit. Two firms:
-- nothing of one reaches the other.
--
-- Every person, firm and number here is invented: the lawsuits are of 2099.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1410000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@transitoone.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1410000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@transitoone.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1410000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-transitoone', 'a1410000-0000-4000-8000-000000000001'),
  ('b1410000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-transitoone', 'a1410000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1410000-0000-4000-8000-00000000000a', 'a1410000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1410000-0000-4000-8000-00000000000b', 'a1410000-0000-4000-8000-000000000002', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.pub(n text) returns uuid language sql as
$$ select ('ce141000-0000-4000-8000-0000000000' || n)::uuid; $$;

create function pg_temp.lawsuit(name text, who uuid, org uuid, cnj text) returns void
language plpgsql as $$
declare
  made jsonb;
  filed jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  made := public.create_case(org, 'cancellation', 'LA', date '2026-09-20',
    jsonb_build_object('full_name', 'Cliente ' || initcap(name), 'birth_date', '1985-04-02'));
  filed := public.save_proceeding((made ->> 'case_id')::uuid, null,
    jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'system', 'projudi', 'comarca', 'Goiânia', 'status', 'filed',
      'cnj', cnj, 'filed_at', to_char(current_date, 'YYYY-MM-DD')),
    array[(made ->> 'party_id')::uuid]);
  reset role;
  insert into res values (name, made || jsonb_build_object('proceeding_id', filed ->> 'proceeding_id'));
end;
$$;

-- What the backend records of a publication, read for the certificate.
create function pg_temp.final(n text, certified boolean) returns jsonb language plpgsql as $$
declare
  answer jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  answer := public.record_publication_final(pg_temp.pub(n), certified, 'Certifico que a sentença transitou em julgado.');
  execute 'reset role';
  return answer;
end;
$$;

create function pg_temp.finals(proceeding text) returns bigint language sql as
$$ select count(*) from public.lawsuit_facts
   where proceeding_id = pg_temp.got(proceeding, 'proceeding_id')::uuid and kind = 'transito' and corrected_at is null; $$;

select pg_temp.lawsuit('alfa', 'a1410000-0000-4000-8000-000000000001', 'b1410000-0000-4000-8000-00000000000a',
  '5000901-30.2099.8.09.0051');
select pg_temp.lawsuit('beta', 'a1410000-0000-4000-8000-000000000002', 'b1410000-0000-4000-8000-00000000000b',
  '5000902-15.2099.8.09.0051');

-- A1 a certificate triaged as a notice, A2 a second one, A3 the judgment, A4 a payment, A5 of no lawsuit; B1 firm B's.
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, document_type, body,
  proceeding_id, case_id, category, judgment, triaged_at)
select pg_temp.pub(n), org::uuid, 'transitoone000' || n, 'TJGO', cnj, current_date - 2, 'Intimação', 'Certidão',
       'CERTIDÃO. Certifico que a sentença transitou em julgado.',
       case when lawsuit is null then null else pg_temp.got(lawsuit, 'proceeding_id')::uuid end,
       case when lawsuit is null then null else pg_temp.got(lawsuit, 'case_id')::uuid end,
       category, judgment, case when category is null then null else now() end
from (values
  ('a1', 'b1410000-0000-4000-8000-00000000000a', 'alfa', '50009013020998090051', 'ciencia', null::boolean),
  ('a2', 'b1410000-0000-4000-8000-00000000000a', 'alfa', '50009013020998090051', 'outro', null),
  ('a3', 'b1410000-0000-4000-8000-00000000000a', 'alfa', '50009013020998090051', 'decisao', true),
  ('a4', 'b1410000-0000-4000-8000-00000000000a', 'alfa', '50009013020998090051', 'pagamento', null),
  ('a5', 'b1410000-0000-4000-8000-00000000000a', null, '50009013020998090051', 'ciencia', null),
  ('b1', 'b1410000-0000-4000-8000-00000000000b', 'beta', '50009021520998090051', 'ciencia', null)
) as p (n, org, lawsuit, cnj, category, judgment);

select ok(
  has_function_privilege('service_role', 'public.record_publication_final(uuid, boolean, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_publication_final(uuid, boolean, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.record_publication_final(uuid, boolean, text)', 'EXECUTE')
  and (select count(*) = 6 from public.publications where id::text like 'ce141000%' and final_read_at is null),
  'only the backend reads a publication for the certificate, and the new publications wait for it'
);

insert into res values ('a1', pg_temp.final('a1', true));
select ok(
  pg_temp.got('a1', 'code') = 'recorded' and pg_temp.finals('alfa') = 1
  and (select by_one and source = 'rule' and ack_owed and happened_on = current_date - 2
              and publication_id = pg_temp.pub('a1') and words like 'Certifico%'
       from public.lawsuit_facts where id = pg_temp.got('a1', 'fact')::uuid)
  and (select final_read_at is not null and outcome_read_at is null from public.publications where id = pg_temp.pub('a1'))
  and (select count(*) = 1 from public.case_events
       where case_id = pg_temp.got('alfa', 'case_id')::uuid and kind = 'outcome_recorded' and actor_type = 'system'),
  'a certificate triaged as a notice is the lawsuit''s trânsito as ONE''s, its day the DJEN''s, asking the lawyers'' awareness'
);

insert into res values ('a1-again', pg_temp.final('a1', true));
insert into res values ('a2', pg_temp.final('a2', true));
select ok(
  pg_temp.got('a1-again', 'code') = 'read_before' and pg_temp.got('a2', 'code') = 'recorded'
  and pg_temp.got('a2', 'fact') = pg_temp.got('a1', 'fact') and pg_temp.finals('alfa') = 1,
  'a publication is read once, and a second certificate of the lawsuit completes the trânsito it has'
);

insert into res values ('a3', pg_temp.final('a3', true));
insert into res values ('a4', pg_temp.final('a4', true));
insert into res values ('a5', pg_temp.final('a5', true));
select ok(
  pg_temp.got('a3', 'code') = 'nothing' and pg_temp.got('a4', 'code') = 'nothing' and pg_temp.got('a5', 'code') = 'nothing'
  and (select bool_and(final_read_at is not null) from public.publications where id in (pg_temp.pub('a3'), pg_temp.pub('a4'), pg_temp.pub('a5'))),
  'the judgment itself, a payment and a publication of no lawsuit are read and say nothing here'
);

update public.publications set active = false, cancelled_at = now(), final_read_at = null where id = pg_temp.pub('a2');
insert into res values ('a2-cancelled', pg_temp.final('a2', true));
select ok(
  pg_temp.got('a2-cancelled', 'code') = 'nothing' and pg_temp.finals('alfa') = 1,
  'a publication the court cancelled says nothing'
);

select pg_temp.sign_in('a1410000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.record_publication_final('ce141000-0000-4000-8000-0000000000a1', true, null) $$,
  '42501',
  null,
  'nobody of a firm records the certificate: only the backend'
);
reset role;

insert into res values ('b1', pg_temp.final('b1', true));
select ok(
  pg_temp.got('b1', 'code') = 'recorded' and pg_temp.finals('beta') = 1 and pg_temp.finals('alfa') = 1
  and (select org_id = 'b1410000-0000-4000-8000-00000000000b' from public.lawsuit_facts
       where id = pg_temp.got('b1', 'fact')::uuid),
  'firm B''s certificate is firm B''s lawsuit''s, and nothing of it reaches firm A'
);

select * from finish();
rollback;
