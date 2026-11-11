begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- The complaint before the lawsuit, only where the unit asks it (0180): a
-- unit whose profile asks it holds the piece of its lawsuits until the case
-- has a complaint and its channel's days ran; the client gives the protocol
-- on their link and says what the airline answered; one nobody answered by
-- its day is closed by ONE; what the airline paid is kept; the piece's
-- instructions say how to use it. Two firms: nothing of one reaches the other.
--
-- Every person, firm and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1780000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-reclamacao.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1780000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-reclamacao.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1780000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-reclamacao', 'a1780000-0000-4000-8000-000000000001'),
  ('b1780000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-reclamacao', 'a1780000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1780000-0000-4000-8000-00000000000a', 'a1780000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1780000-0000-4000-8000-00000000000b', 'a1780000-0000-4000-8000-000000000002', 'owner', 'socio');
-- The juizado of Goianira asks the complaint; the one of Anápolis says nothing.
update public.court_units set prior_complaint = 'required'
where court = 'TJGO' and comarca = 'Goianira' and kind = 'juizado';
insert into public.people (id, org_id, full_name) values
  ('d1780000-0000-4000-8000-000000000001', 'b1780000-0000-4000-8000-00000000000a', 'Maria Teste');
insert into public.cases (id, org_id, seq, module, incident, status, airline_iata) values
  ('c1780000-0000-4000-8000-000000000001', 'b1780000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'drafting', 'LA'),
  ('c1780000-0000-4000-8000-000000000002', 'b1780000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'drafting', 'LA'),
  ('c1780000-0000-4000-8000-000000000003', 'b1780000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'drafting', 'LA');
insert into public.case_parties (org_id, case_id, person_id, role) values
  ('b1780000-0000-4000-8000-00000000000a', 'c1780000-0000-4000-8000-000000000001', 'd1780000-0000-4000-8000-000000000001', 'claimant');
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at) values
  ('a8780000-0000-4000-8000-000000000001', 'b1780000-0000-4000-8000-00000000000a', 'c1780000-0000-4000-8000-000000000001',
   'd1780000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-da-reclamacao', 'UTF8')), 'hex'), now() + interval '30 days');
insert into public.proceedings (id, org_id, case_id, kind, court, forum_city, status) values
  ('f1780000-0000-4000-8000-000000000001', 'b1780000-0000-4000-8000-00000000000a', 'c1780000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'Goianira', 'planned'),
  ('f1780000-0000-4000-8000-000000000002', 'b1780000-0000-4000-8000-00000000000a', 'c1780000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'Goianira', 'planned'),
  ('f1780000-0000-4000-8000-000000000003', 'b1780000-0000-4000-8000-00000000000b', 'c1780000-0000-4000-8000-000000000003',
   'juizado', 'TJGO', 'Anápolis', 'planned');
-- The second case made its complaint twenty days ago and nobody answered it.
insert into public.admin_complaints (org_id, case_id, channel, protocol, filed_on, answer_due_on) values
  ('b1780000-0000-4000-8000-00000000000a', 'c1780000-0000-4000-8000-000000000002', 'consumidor_gov', '2026.11.000123',
   current_date - 20, current_date - 10);

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

select ok(
  public.case_prior_complaint('c1780000-0000-4000-8000-000000000001') ->> 'state' = 'owed'
  and public.case_prior_complaint('c1780000-0000-4000-8000-000000000001') -> 'units' = '["Juizado Especial Cível da Comarca de Goianira"]'::jsonb
  and not public.advance_piece_due('f1780000-0000-4000-8000-000000000001')
  and public.case_prior_complaint('c1780000-0000-4000-8000-000000000003') ->> 'state' = 'not_required'
  and public.advance_piece_due('f1780000-0000-4000-8000-000000000003'),
  'a unit whose profile asks the complaint holds the piece until the case has one; another does not'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res values ('bad', public.client_link_record_complaint('token-da-reclamacao', 'x', current_date));
insert into res values ('saved', public.client_link_record_complaint('token-da-reclamacao', ' 2026.11.000456 ', current_date));
insert into res values ('open', public.client_link_prior_complaint('token-da-reclamacao'));
reset role;

select ok(
  pg_temp.got('bad', 'code') = 'invalid_protocol' and pg_temp.got('saved', 'code') = 'saved'
  and pg_temp.got('saved', 'state') = 'waiting'
  and (select a.protocol = '2026.11.000456' and a.by_client and a.answer_due_on = current_date + 10 and a.channel = 'consumidor_gov'
       from public.admin_complaints a where a.case_id = 'c1780000-0000-4000-8000-000000000001')
  and pg_temp.got('open', 'airline') is not null
  and not public.advance_piece_due('f1780000-0000-4000-8000-000000000001')
  and exists (select 1 from public.case_events e where e.case_id = 'c1780000-0000-4000-8000-000000000001'
              and e.kind = 'complaint_saved' and e.actor_type = 'client'),
  'the client gives the protocol on the link: the complaint is the case one, due on the channel days, and the piece waits'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res values ('answer', public.client_link_complaint_answer('token-da-reclamacao', 'settled', 30000));
insert into res values ('again', public.client_link_complaint_answer('token-da-reclamacao', 'answered', null));
reset role;

select ok(
  pg_temp.got('answer', 'state') = 'done' and pg_temp.got('again', 'code') = 'not_owed'
  and (select a.outcome = 'settled' and a.paid_cents = 30000 from public.admin_complaints a
       where a.case_id = 'c1780000-0000-4000-8000-000000000001')
  and public.advance_piece_due('f1780000-0000-4000-8000-000000000001'),
  'the client says the airline settled and what it paid; then the piece is due'
);

-- ONE closes the complaint nobody answered by its day.
update public.case_advances set claims = 7, claimed_at = now() where case_id = 'c1780000-0000-4000-8000-000000000002';
select ok(
  (public.case_prior_complaint('c1780000-0000-4000-8000-000000000002') ->> 'overdue')::boolean
  and public.case_advance_steps_due('c1780000-0000-4000-8000-000000000002'),
  'a complaint past its days unanswered makes the case due for a look of ONE'
);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res values ('closed', public.advance_prior_complaint('c1780000-0000-4000-8000-000000000002', 7));
reset role;
select ok(
  pg_temp.got('closed', 'state') = 'done' and pg_temp.got('closed', 'waiting') is null
  and (select a.outcome = 'no_answer' from public.admin_complaints a where a.case_id = 'c1780000-0000-4000-8000-000000000002')
  and exists (select 1 from public.case_events e where e.case_id = 'c1780000-0000-4000-8000-000000000002'
              and e.kind = 'complaint_saved' and e.actor_type = 'system'),
  'ONE closes it as unanswered, told in the timeline as done by ONE'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1780000-0000-4000-8000-000000000002', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
insert into res values ('other_view', public.case_prior_complaint_view('c1780000-0000-4000-8000-000000000001'));
reset role;
select ok(
  pg_temp.got('other_view', 'code') = 'not_found'
  and not has_function_privilege('anon', 'public.client_link_record_complaint(text, text, date)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.client_link_complaint_answer(text, text, bigint)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.advance_prior_complaint(uuid, integer)', 'EXECUTE'),
  'another firm reads nothing of it, and only the backend writes the word of the client'
);

select ok(
  (select strpos(v.system_prompt, 'valor_pago_em_centavos') > 0 and strpos(v.system_prompt, '[[PRIORIDADE]]') > 0
   from public.prompt_versions v where v.task = 'caso.peca.minuta' and v.is_active)
  and public.wait_owner('prior_complaint_owed') = 'client' and public.wait_owner('prior_complaint_waiting') = 'client',
  'the piece instructions in force say how to use the complaint, and its waits are the client ones'
);

select * from finish();
rollback;
