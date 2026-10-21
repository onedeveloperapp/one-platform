begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

-- ============================================================
-- Each firm's WhatsApp (0019).
--
-- One webhook serves every firm: an event is routed by the number it carries
-- to the one firm that number is active in. What may be sent is decided in
-- the database: free text only inside the 24 hours after the person's last
-- message, a template only when approved and never to somebody who opted
-- out, nothing from a support visit. A send is reserved, then claimed, then
-- sent: never twice. Two firms: neither sees a conversation of the other.
--
-- Every person, firm, number and message here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a9000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a9000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bruno@souza.invalid', '', now(), '{}', '{"display_name":"Bruno Lima"}', now(), now()),
  ('a9000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('a9000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a9000000-0000-4000-8000-000000000009';

-- Firm A: Ana (owner, sócia) and Bruno (atendimento). Firm B: Davi (owner, advogado).
insert into public.organizations (id, name, slug, created_by) values
  ('b9000000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'a9000000-0000-4000-8000-000000000001'),
  ('b9000000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'a9000000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b9000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b9000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b9000000-0000-4000-8000-00000000000b', 'a9000000-0000-4000-8000-000000000004', 'owner', 'advogado');

-- The connections, already sealed (the vault has its own file, 0021).
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('d9000000-0000-4000-8000-00000000000a', 'b9000000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-a', 'WhatsApp A', 'connected', 'a9000000-0000-4000-8000-000000000001', now()),
  ('d9000000-0000-4000-8000-00000000000b', 'b9000000-0000-4000-8000-00000000000b', 'whatsapp', 'waba-b', 'WhatsApp B', 'connected', 'a9000000-0000-4000-8000-000000000004', now()),
  ('d9000000-0000-4000-8000-00000000000c', 'b9000000-0000-4000-8000-00000000000a', 'zapsign', null, 'Assinaturas', 'connected', 'a9000000-0000-4000-8000-000000000001', now()),
  ('d9000000-0000-4000-8000-00000000000d', 'b9000000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-pendente', 'Pendente', 'pending', 'a9000000-0000-4000-8000-000000000001', null);

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2', session text default null)
returns void language sql as
$$
  select set_config(
    'request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level, 'session_id', session))::text,
    true
  );
$$;

create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;

create function pg_temp.id_of(name text, field text) returns uuid language sql as
$$ select (payload ->> id_of.field)::uuid from res where res.name = id_of.name; $$;

create function pg_temp.code_of(name text) returns text language sql as
$$ select payload ->> 'code' from res where res.name = code_of.name; $$;

-- ---------- Connecting a number ----------

select pg_temp.sign_in('a9000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.register_wa_number('b9000000-0000-4000-8000-00000000000a', 'd9000000-0000-4000-8000-00000000000a', 'simulator', 'sim-a', 'waba-a', '5562900000001')$$,
  '42501', null,
  'a person does not register a number: the backend does, after sealing its token'
);
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('num_a', public.register_wa_number(
  'b9000000-0000-4000-8000-00000000000a', 'd9000000-0000-4000-8000-00000000000a', 'simulator', 'sim-a', 'waba-a', '+55 (62) 90000-0001', 'Souza Advogados'));
insert into res values ('num_in_use', public.register_wa_number(
  'b9000000-0000-4000-8000-00000000000b', 'd9000000-0000-4000-8000-00000000000b', 'simulator', 'sim-a', 'waba-b', '5562900000001'));
insert into res values ('num_b', public.register_wa_number(
  'b9000000-0000-4000-8000-00000000000b', 'd9000000-0000-4000-8000-00000000000b', 'simulator', 'sim-b', 'waba-b', '5562900000002', null, 'coexistence'));
insert into res values ('num_not_wa', public.register_wa_number(
  'b9000000-0000-4000-8000-00000000000a', 'd9000000-0000-4000-8000-00000000000c', 'simulator', 'sim-c', 'waba-c', '5562900000003'));
insert into res values ('num_pending', public.register_wa_number(
  'b9000000-0000-4000-8000-00000000000a', 'd9000000-0000-4000-8000-00000000000d', 'simulator', 'sim-d', 'waba-d', '5562900000004'));
insert into res values ('num_other_firm', public.register_wa_number(
  'b9000000-0000-4000-8000-00000000000b', 'd9000000-0000-4000-8000-00000000000a', 'simulator', 'sim-e', 'waba-e', '5562900000005'));
insert into res values ('route_a', public.wa_route('simulator', 'sim-a'));
insert into res values ('route_meta', public.wa_route('meta', 'sim-a'));
insert into res values ('route_none', public.wa_route('simulator', 'nao-existe'));
reset role;

select ok(
  pg_temp.code_of('num_a') = 'registered'
  and (select display_phone_number = '5562900000001' and status = 'active' and mode = 'cloud' and verified_name = 'Souza Advogados'
       from public.wa_numbers where id = pg_temp.id_of('num_a', 'number_id')),
  'the backend registers a firm''s number, with its digits only'
);
select is(
  array[pg_temp.code_of('num_in_use'), pg_temp.code_of('num_not_wa'), pg_temp.code_of('num_pending'), pg_temp.code_of('num_other_firm')],
  array['number_in_use', 'connection_not_found', 'connection_not_connected', 'connection_not_found'],
  'a number is active in one firm at a time, and only under a sealed WhatsApp connection of that firm'
);
select ok(
  (select payload ->> 'org_id' = 'b9000000-0000-4000-8000-00000000000a' and payload ->> 'number_id' = pg_temp.id_of('num_a', 'number_id')::text
   from res where name = 'route_a')
  and (select payload = '{"found": false}'::jsonb from res where name = 'route_meta')
  and (select payload = '{"found": false}'::jsonb from res where name = 'route_none'),
  'an event is routed by its number to the one firm it is active in, and only within the provider that signed it'
);

-- ---------- A message arrives ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('in_1', public.wa_ingest_inbound(
  'b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('num_a', 'number_id'), '+55 62 99999-0001', 'Maria Teste',
  'wamid.in.1', 'text', 'Oi, perdi meu voo ontem.'));
insert into res values ('in_1_again', public.wa_ingest_inbound(
  'b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('num_a', 'number_id'), '5562999990001', 'Maria Teste',
  'wamid.in.1', 'text', 'Oi, perdi meu voo ontem.'));
insert into res values ('in_wrong_firm', public.wa_ingest_inbound(
  'b9000000-0000-4000-8000-00000000000b', pg_temp.id_of('num_a', 'number_id'), '5562999990001', 'Maria Teste',
  'wamid.in.9', 'text', 'Para o escritório errado.'));
insert into res values ('in_b', public.wa_ingest_inbound(
  'b9000000-0000-4000-8000-00000000000b', pg_temp.id_of('num_b', 'number_id'), '5562988880002', 'João Teste',
  'wamid.in.b1', 'text', 'Boa tarde.'));
reset role;

select ok(
  pg_temp.code_of('in_1') = 'received'
  and (select contact_wa_id = '5562999990001' and contact_name = 'Maria Teste' and unread_count = 1
              and last_inbound_at is not null and last_message_preview = 'Oi, perdi meu voo ontem.' and last_message_direction = 'in'
       from public.wa_conversations where id = pg_temp.id_of('in_1', 'conversation_id')),
  'a message opens the conversation, counts as unread and starts the 24-hour window'
);
select ok(
  pg_temp.code_of('in_1_again') = 'duplicate'
  and pg_temp.id_of('in_1_again', 'message_id') = pg_temp.id_of('in_1', 'message_id')
  and (select unread_count = 1 from public.wa_conversations where id = pg_temp.id_of('in_1', 'conversation_id'))
  and (select count(*) = 1 from public.wa_messages where wa_message_id = 'wamid.in.1'),
  'the same message delivered twice is one message'
);
select is(pg_temp.code_of('in_wrong_firm'), 'number_not_found', 'a number is never written to under another firm');

-- ---------- Who sees the conversation ----------

select pg_temp.sign_in('a9000000-0000-4000-8000-000000000002');
set local role authenticated;
select ok(
  (select count(*) = 1 from public.wa_conversations) and (select count(*) = 1 from public.wa_messages)
  and (select count(*) = 1 from public.wa_numbers),
  'the people of the firm see its number, its conversation and its message'
);
select ok(
  public.wa_window_open((select last_inbound_at from public.wa_conversations))
  and public.wa_window_closes_at((select last_inbound_at from public.wa_conversations)) > now() + interval '23 hours',
  'and that the window is open, and until when'
);
reset role;

select pg_temp.sign_in('a9000000-0000-4000-8000-000000000004');
set local role authenticated;
select is(
  (select array_agg(contact_name) from public.wa_conversations), array['João Teste'],
  'the other firm sees only its own conversation'
);
select is(
  public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'text', 'Mensagem de outro escritório.') ->> 'code',
  'not_found',
  'and a conversation of another firm does not exist for it'
);
reset role;

select pg_temp.sign_in('a9000000-0000-4000-8000-000000000009');
set local role authenticated;
select ok(
  (select count(*) = 0 from public.wa_conversations) and (select count(*) = 0 from public.wa_messages),
  'the platform operator reads no firm''s conversations'
);
reset role;

-- ---------- Answering inside the window ----------

select pg_temp.sign_in('a9000000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('out_1', public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'text', '  Olá, Maria. Vamos ver o seu caso.  '));
select is(
  array[
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'text', '   ') ->> 'code',
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'text', repeat('a', 4097)) ->> 'code',
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'audio', 'x') ->> 'code'
  ],
  array['empty', 'too_long', 'invalid_kind'],
  'a message has text, within what WhatsApp carries, and is of a kind the firm sends'
);
select throws_ok(
  $$select public.claim_wa_outbox()$$, '42501', null,
  'a person reserves a message and never sends it themselves'
);
select throws_ok(
  $$insert into public.wa_messages (org_id, conversation_id, number_id, direction, kind, body, status)
    select org_id, id, number_id, 'out', 'text', 'direto', 'sent' from public.wa_conversations$$,
  '42501', null,
  'nor writes a message directly'
);
reset role;

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a9000000-0000-4000-8000-000000000009', 'a9000000-0000-4000-8000-000000000002', 'b9000000-0000-4000-8000-00000000000a',
        'Conferindo as conversas', 'f9000000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a9000000-0000-4000-8000-000000000002', 'aal2', 'f9000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format($$select public.reserve_wa_send(%L, 'text', 'Do suporte.')$$, pg_temp.id_of('in_1', 'conversation_id')),
  '42501', 'not_allowed_in_support_session',
  'a support visit never writes to a client in the firm''s name'
);
select is(
  public.wa_mark_read(pg_temp.id_of('in_1', 'conversation_id')) ->> 'code', 'not_allowed_in_support_session',
  'and leaves what is unread as it found it'
);
reset role;

select ok(
  pg_temp.code_of('out_1') = 'queued'
  and (select status = 'queued' and body = 'Olá, Maria. Vamos ver o seu caso.' and sent_by = 'a9000000-0000-4000-8000-000000000002'
              and direction = 'out' and wa_message_id is null
       from public.wa_messages where id = pg_temp.id_of('out_1', 'message_id'))
  and (select unread_count = 0 and last_message_direction = 'out' from public.wa_conversations where id = pg_temp.id_of('in_1', 'conversation_id')),
  'inside the window a person of the firm reserves an answer, which waits to be sent'
);

-- A file of the firm, inside the window: a PDF goes as a document, a photo as an image; never another firm's file.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('pdf_a', public.reserve_file('b9000000-0000-4000-8000-00000000000a', 'upload', 'procuracao.pdf',
  'application/pdf', 3000));
select public.confirm_file(pg_temp.id_of('pdf_a', 'file_id'), repeat('a', 64), 3000, 'application/pdf', 1);
insert into res values ('jpg_a', public.reserve_file('b9000000-0000-4000-8000-00000000000a', 'upload', 'foto.jpg',
  'image/jpeg', 2000));
select public.confirm_file(pg_temp.id_of('jpg_a', 'file_id'), repeat('b', 64), 2000, 'image/jpeg', null);
insert into res values ('pdf_b', public.reserve_file('b9000000-0000-4000-8000-00000000000b', 'upload', 'outro.pdf',
  'application/pdf', 3000));
select public.confirm_file(pg_temp.id_of('pdf_b', 'file_id'), repeat('c', 64), 3000, 'application/pdf', 1);
insert into res values ('big_jpg', public.reserve_file('b9000000-0000-4000-8000-00000000000a', 'upload', 'grande.jpg',
  'image/jpeg', 6000000));
select public.confirm_file(pg_temp.id_of('big_jpg', 'file_id'), repeat('d', 64), 6000000, 'image/jpeg', null);
-- Files the backend makes for its own use: the PDF of a photo, a part cut for a filing package.
insert into res values ('made_pdf', public.reserve_file('b9000000-0000-4000-8000-00000000000a', 'normalized', 'foto.pdf',
  'application/pdf', 3000));
select public.confirm_file(pg_temp.id_of('made_pdf', 'file_id'), repeat('e', 64), 3000, 'application/pdf', 1);
insert into res values ('cut_pdf', public.reserve_file('b9000000-0000-4000-8000-00000000000a', 'filing', '02-prova-parte-1-de-2.pdf',
  'application/pdf', 3000));
select public.confirm_file(pg_temp.id_of('cut_pdf', 'file_id'), repeat('f', 64), 3000, 'application/pdf', 1);
reset role;
select pg_temp.sign_in('a9000000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('out_doc', public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'document',
  'Segue a procuração.', null, null, pg_temp.id_of('pdf_a', 'file_id')));
select is(
  array[
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'document', null, null, null,
      pg_temp.id_of('jpg_a', 'file_id')) ->> 'code',
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'document', null, null, null,
      pg_temp.id_of('pdf_b', 'file_id')) ->> 'code',
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'image', repeat('a', 1025), null, null,
      pg_temp.id_of('jpg_a', 'file_id')) ->> 'code',
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'image', null, null, null,
      pg_temp.id_of('big_jpg', 'file_id')) ->> 'code',
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'document', null, null, null,
      pg_temp.id_of('made_pdf', 'file_id')) ->> 'code',
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'document', null, null, null,
      pg_temp.id_of('cut_pdf', 'file_id')) ->> 'code'
  ],
  array['type_not_allowed', 'file_not_found', 'too_long', 'too_large', 'file_not_found', 'file_not_found'],
  'a file goes as what its bytes are, within what WhatsApp carries of its kind, with a short caption, and only a file of the firm that the backend did not make for its own use'
);
reset role;
select ok(
  pg_temp.code_of('out_doc') = 'queued'
  and (select kind = 'document' and media_file_id = pg_temp.id_of('pdf_a', 'file_id') and media_mime = 'application/pdf'
              and media_filename = 'procuracao.pdf' and body = 'Segue a procuração.' and status = 'queued'
       from public.wa_messages where id = pg_temp.id_of('out_doc', 'message_id')),
  'inside the window a person of the firm sends a file of the firm from the conversation, with its name and a caption'
);

-- ---------- Claim, then send ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claimed', public.claim_wa_outbox(pg_temp.id_of('out_1', 'message_id')));
insert into res values ('claimed_again', public.claim_wa_outbox(pg_temp.id_of('out_1', 'message_id')));
insert into res values ('marked', public.mark_wa_send('b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('out_1', 'message_id'), true, 'wamid.out.1'));
insert into res values ('marked_again', public.mark_wa_send('b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('out_1', 'message_id'), false, null, 'retry'));
insert into res values ('status_other_firm', public.wa_apply_status('b9000000-0000-4000-8000-00000000000b', pg_temp.id_of('num_b', 'number_id'), 'wamid.out.1', 'delivered'));
insert into res values ('status_delivered', public.wa_apply_status('b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('num_a', 'number_id'), 'wamid.out.1', 'delivered', null, 'service', 'free_customer_service'));
insert into res values ('status_back', public.wa_apply_status('b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('num_a', 'number_id'), 'wamid.out.1', 'sent', null, 'utility', 'regular'));
insert into res values ('status_read', public.wa_apply_status('b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('num_a', 'number_id'), 'wamid.out.1', 'read'));
insert into res values ('status_unknown', public.wa_apply_status('b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('num_a', 'number_id'), 'wamid.nao.existe', 'read'));
reset role;

select ok(
  (select jsonb_array_length(payload) = 1
          and payload -> 0 ->> 'to' = '5562999990001' and payload -> 0 ->> 'provider' = 'simulator'
          and payload -> 0 ->> 'phone_number_id' = 'sim-a' and payload -> 0 ->> 'body' = 'Olá, Maria. Vamos ver o seu caso.'
          and payload -> 0 ->> 'connection_id' = 'd9000000-0000-4000-8000-00000000000a'
   from res where name = 'claimed')
  and (select payload = '[]'::jsonb from res where name = 'claimed_again'),
  'the backend claims the message with what it needs to send it, and nobody claims it twice'
);
select ok(
  pg_temp.code_of('marked') = 'marked' and pg_temp.code_of('marked_again') = 'not_sending'
  and (select wa_message_id = 'wamid.out.1' from public.wa_messages where id = pg_temp.id_of('out_1', 'message_id')),
  'what came of the send is recorded once'
);
select pg_temp.as_backend();
set local role service_role;
select throws_ok(
  $$select public.mark_wa_send('b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('out_1', 'message_id'), null)$$,
  '22023', 'invalid_result',
  'an answer that is neither yes nor no is refused, never recorded as a failure'
);
reset role;
select is(
  array[pg_temp.code_of('status_other_firm'), pg_temp.code_of('status_delivered'), pg_temp.code_of('status_back'),
        pg_temp.code_of('status_read'), pg_temp.code_of('status_unknown')],
  array['not_found', 'updated', 'kept', 'updated', 'not_found'],
  'a status moves a message forward and never back, and only a message of that firm and number'
);
select ok(
  (select status = 'read' and pricing_category = 'service' and pricing_type = 'free_customer_service'
   from public.wa_messages where id = pg_temp.id_of('out_1', 'message_id')),
  'the pricing the vendor reported is kept as it first came'
);

-- ---------- Outside the window ----------

update public.wa_conversations set last_inbound_at = now() - interval '25 hours' where id = pg_temp.id_of('in_1', 'conversation_id');

select pg_temp.as_backend();
set local role service_role;
insert into res values ('templates', public.sync_wa_templates('b9000000-0000-4000-8000-00000000000a', 'waba-a', '[
  {"name": "aviso_audiencia", "language": "pt_BR", "category": "UTILITY", "status": "APPROVED",
   "body": "Olá, {{1}}. Sua audiência é em {{2}}.", "param_count": 2},
  {"name": "boas_vindas", "language": "pt_BR", "category": "UTILITY", "status": "PENDING", "body": "Olá. Recebemos o seu contato.", "param_count": 0},
  {"name": "de_um_tipo_novo", "language": "pt_BR", "category": "UTILITY", "status": "EM_ANALISE_ESPECIAL", "body": "Texto.", "param_count": 0}
]'::jsonb));
insert into res values ('templates_b', public.sync_wa_templates('b9000000-0000-4000-8000-00000000000b', 'waba-b', '[
  {"name": "aviso_audiencia", "language": "pt_BR", "category": "UTILITY", "status": "APPROVED", "body": "Aviso do escritório B.", "param_count": 0}
]'::jsonb));
insert into res values ('templates_wrong', public.sync_wa_templates('b9000000-0000-4000-8000-00000000000a', 'waba-b', '[]'::jsonb));
reset role;

select ok(
  (select payload = '{"ok": true, "kept": 2, "skipped": 1}'::jsonb from res where name = 'templates')
  and pg_temp.code_of('templates_wrong') = 'account_not_found',
  'the templates of an account are synced under its firm; one this code cannot represent is left out and counted'
);

select pg_temp.sign_in('a9000000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  array[
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'text', 'Fora da janela.') ->> 'code',
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'template', null,
      (select id from public.wa_templates where name = 'boas_vindas')) ->> 'code',
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'template', null,
      (select id from public.wa_templates where name = 'aviso_audiencia'), '["Maria"]') ->> 'code',
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'template', null,
      (select id from public.wa_templates where name = 'aviso_audiencia'), '["Maria", "  "]') ->> 'code',
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'template', null, gen_random_uuid()) ->> 'code'
  ],
  array['window_closed', 'template_not_approved', 'template_params_mismatch', 'template_params_mismatch', 'template_not_found'],
  'outside the window free text is refused, and a template goes only when approved, with every value it asks for'
);
insert into res values ('out_tpl', public.reserve_wa_send(
  pg_temp.id_of('in_1', 'conversation_id'), 'template', null,
  (select id from public.wa_templates where name = 'aviso_audiencia'), '["Maria", "12/11 às 14h"]'));
reset role;

select ok(
  pg_temp.code_of('out_tpl') = 'queued'
  and (select kind = 'template' and template_name = 'aviso_audiencia' and template_params = '["Maria", "12/11 às 14h"]'::jsonb
              and body = 'Olá, Maria. Sua audiência é em 12/11 às 14h.'
       from public.wa_messages where id = pg_temp.id_of('out_tpl', 'message_id')),
  'an approved template is reserved with its values, and the thread keeps the text as the person will read it'
);

select pg_temp.sign_in('a9000000-0000-4000-8000-000000000004');
set local role authenticated;
select is(
  public.reserve_wa_send(
    (select id from public.wa_conversations),
    'template', null,
    (select id from public.wa_templates where waba_id = 'waba-b')
  ) ->> 'code',
  'queued',
  'each firm sends its own template, of its own account'
);
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('templates_resync', public.sync_wa_templates('b9000000-0000-4000-8000-00000000000a', 'waba-a', '[
  {"name": "aviso_audiencia", "language": "pt_BR", "category": "UTILITY", "status": "PAUSED",
   "body": "Olá, {{1}}. Sua audiência é em {{2}}.", "param_count": 2}
]'::jsonb));
reset role;
select is(
  (select array_agg(name || ':' || status order by name) from public.wa_templates where org_id = 'b9000000-0000-4000-8000-00000000000a'),
  array['aviso_audiencia:paused', 'boas_vindas:disabled'],
  'a new sync follows the account: what was paused is paused, what is gone is kept as disabled'
);

-- ---------- Somebody asks to stop ----------

select pg_temp.as_backend();
set local role service_role;
select public.sync_wa_templates('b9000000-0000-4000-8000-00000000000a', 'waba-a', '[
  {"name": "aviso_audiencia", "language": "pt_BR", "category": "UTILITY", "status": "APPROVED",
   "body": "Olá, {{1}}. Sua audiência é em {{2}}.", "param_count": 2}
]'::jsonb);
insert into res values ('stop', public.wa_ingest_inbound(
  'b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('num_a', 'number_id'), '5562999990001', 'Maria Teste',
  'wamid.in.2', 'text', ' SAIR. '));
insert into res values ('not_stop', public.wa_ingest_inbound(
  'b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('num_a', 'number_id'), '5562999990001', 'Maria Teste',
  'wamid.in.3', 'text', 'Não quero sair do grupo, só tirar uma dúvida.'));
reset role;

select ok(
  (select payload ->> 'opted' = 'out' from res where name = 'stop')
  and (select payload ->> 'opted' is null from res where name = 'not_stop')
  and (select source = 'keyword' from public.wa_optouts where org_id = 'b9000000-0000-4000-8000-00000000000a' and contact_wa_id = '5562999990001')
  and exists (select 1 from public.audit_events where action = 'whatsapp.optout.recorded' and actor_type = 'client'),
  'a message that is exactly a stop word records the opt-out, as done by the client; a sentence that contains the word does not'
);

select pg_temp.sign_in('a9000000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  array[
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'template', null,
      (select id from public.wa_templates where name = 'aviso_audiencia'), '["Maria", "amanhã"]') ->> 'code',
    public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'text', 'Tudo bem, Maria. Não escrevemos mais.') ->> 'code'
  ],
  array['opted_out', 'queued'],
  'no template goes to somebody who opted out; an answer to what they just wrote still does'
);
select throws_ok(
  format($$select public.set_wa_optout(%L, false, 'A cliente pediu por telefone para voltar.')$$, pg_temp.id_of('in_1', 'conversation_id')),
  '42501', 'not_authorized',
  'atendimento does not remove an opt-out'
);
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('back', public.wa_ingest_inbound(
  'b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('num_a', 'number_id'), '5562999990001', 'Maria Teste',
  'wamid.in.4', 'text', 'Voltar'));
reset role;
select ok(
  (select payload ->> 'opted' = 'in' from res where name = 'back')
  and not exists (select 1 from public.wa_optouts where contact_wa_id = '5562999990001'),
  'the person writes the return word and the opt-out is removed'
);

select pg_temp.sign_in('a9000000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  array[
    public.set_wa_optout(pg_temp.id_of('in_1', 'conversation_id'), true, 'curto') ->> 'code',
    public.set_wa_optout(pg_temp.id_of('in_1', 'conversation_id'), true, 'Pediu por telefone para não receber mais.') ->> 'code',
    public.set_wa_optout(pg_temp.id_of('in_1', 'conversation_id'), true, 'Pediu por telefone para não receber mais.') ->> 'code'
  ],
  array['note_required', 'opted_out', 'already_opted_out'],
  'anybody of the firm records an opt-out the person asked for elsewhere, with a note'
);
reset role;

select pg_temp.sign_in('a9000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  public.set_wa_optout(pg_temp.id_of('in_1', 'conversation_id'), false, 'A cliente autorizou de novo, por escrito.') ->> 'code',
  'opted_in',
  'who manages the firm removes it, with a note'
);
reset role;
select ok(
  (select count(*) = 2 from public.audit_events where action = 'whatsapp.optout.removed')
  and exists (select 1 from public.audit_events where action = 'whatsapp.optout.recorded' and actor_type = 'person'
              and metadata ->> 'source' = 'manual'),
  'every change of an opt-out is audited'
);

-- ---------- A send nobody confirmed ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_tpl', public.claim_wa_outbox(pg_temp.id_of('out_tpl', 'message_id')));
reset role;
update public.wa_messages set claimed_at = now() - interval '20 minutes' where id = pg_temp.id_of('out_tpl', 'message_id');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('sweep', public.claim_wa_outbox(null, 50));
reset role;

select ok(
  (select payload -> 0 ->> 'template_name' = 'aviso_audiencia' and payload -> 0 ->> 'template_language' = 'pt_BR'
          and payload -> 0 -> 'template_params' = '["Maria", "12/11 às 14h"]'::jsonb
   from res where name = 'claim_tpl')
  and (select status = 'failed' and error_code = 'unconfirmed' from public.wa_messages where id = pg_temp.id_of('out_tpl', 'message_id')),
  'a message claimed and never confirmed is closed as unconfirmed, never sent a second time'
);

-- ---------- The phone app, and the history ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('echo', public.wa_ingest_mirrored(
  'b9000000-0000-4000-8000-00000000000b', pg_temp.id_of('num_b', 'number_id'), '5562977770003', 'wamid.echo.1',
  'out', 'app', 'text', 'Mandei pelo celular.'));
insert into res values ('echo_again', public.wa_ingest_mirrored(
  'b9000000-0000-4000-8000-00000000000b', pg_temp.id_of('num_b', 'number_id'), '5562977770003', 'wamid.echo.1',
  'out', 'app', 'text', 'Mandei pelo celular.'));
insert into res values ('history', public.wa_ingest_mirrored(
  'b9000000-0000-4000-8000-00000000000b', pg_temp.id_of('num_b', 'number_id'), '5562977770003', 'wamid.hist.1',
  'in', 'history', 'text', 'Mensagem antiga do cliente.', now() - interval '40 days'));
insert into res values ('contact', public.wa_sync_contact(
  'b9000000-0000-4000-8000-00000000000b', pg_temp.id_of('num_b', 'number_id'), '5562977770003', 'Carlos do voo de Recife', 'add'));
select public.wa_note_sync('b9000000-0000-4000-8000-00000000000b', pg_temp.id_of('num_b', 'number_id'), 'contacts');
select public.wa_note_sync('b9000000-0000-4000-8000-00000000000b', pg_temp.id_of('num_b', 'number_id'), 'history', 55);
select public.wa_note_sync('b9000000-0000-4000-8000-00000000000b', pg_temp.id_of('num_b', 'number_id'), 'history', 30);
reset role;

select ok(
  pg_temp.code_of('echo') = 'mirrored' and pg_temp.code_of('echo_again') = 'duplicate' and pg_temp.code_of('history') = 'mirrored'
  and (select last_inbound_at is null and unread_count = 0 and saved_name = 'Carlos do voo de Recife'
              and last_message_preview = 'Mandei pelo celular.'
       from public.wa_conversations where contact_wa_id = '5562977770003')
  and (select count(*) = 2 from public.wa_messages m join public.wa_conversations c on c.id = m.conversation_id
       where c.contact_wa_id = '5562977770003'),
  'what the firm typed on its phone and the shared history are mirrored once, and neither opens the window nor counts as unread'
);
select ok(
  (select contacts_sync_requested_at is not null and history_sync_requested_at is not null and history_progress = 55
   from public.wa_numbers where id = pg_temp.id_of('num_b', 'number_id')),
  'the two syncs of a number that also lives on the phone are recorded, and the progress of the history never goes back'
);

-- ---------- Media that arrives ----------

insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('e9000000-0000-4000-8000-00000000000a', 'b9000000-0000-4000-8000-00000000000a', 'whatsapp', 'org/b9000000-0000-4000-8000-00000000000a/whatsapp/e9000000-0000-4000-8000-00000000000a',
   'cartao-de-embarque.jpg', 'image/jpeg', 100, 'stored', repeat('a', 64), 100, 'image/jpeg', now() + interval '1 hour', now()),
  ('e9000000-0000-4000-8000-00000000000b', 'b9000000-0000-4000-8000-00000000000b', 'whatsapp', 'org/b9000000-0000-4000-8000-00000000000b/whatsapp/e9000000-0000-4000-8000-00000000000b',
   'outro.jpg', 'image/jpeg', 100, 'stored', repeat('b', 64), 100, 'image/jpeg', now() + interval '1 hour', now());

select pg_temp.as_backend();
set local role service_role;
insert into res values ('photo', public.wa_ingest_inbound(
  'b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('num_a', 'number_id'), '5562999990001', 'Maria Teste',
  'wamid.in.5', 'image', 'Meu cartão de embarque', '{"id": "media-1", "mime_type": "image/jpeg"}'));
insert into res values ('media_claim', public.claim_wa_media(10));
insert into res values ('media_claim_again', public.claim_wa_media(10));
insert into res values ('media_other_firm', public.set_wa_media(
  'b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('photo', 'message_id'), 'e9000000-0000-4000-8000-00000000000b'));
insert into res values ('media_stored', public.set_wa_media(
  'b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('photo', 'message_id'), 'e9000000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  (select (payload ->> 'media_pending')::boolean from res where name = 'photo')
  and (select jsonb_array_length(payload) = 1 and payload -> 0 ->> 'media_wa_id' = 'media-1' and payload -> 0 ->> 'provider' = 'simulator'
       from res where name = 'media_claim')
  and (select payload = '[]'::jsonb from res where name = 'media_claim_again')
  and pg_temp.code_of('media_other_firm') = 'file_not_found'
  and (select media_status = 'stored' and media_file_id = 'e9000000-0000-4000-8000-00000000000a'
       from public.wa_messages where id = pg_temp.id_of('photo', 'message_id')),
  'the media of a message is claimed once and kept as a file of the same firm, never of another'
);

select pg_temp.sign_in('a9000000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  public.reserve_file_upload('b9000000-0000-4000-8000-00000000000a', 'whatsapp', 'audio.ogg', 'audio/ogg', 1000) ->> 'code',
  'purpose_not_allowed',
  'a person does not write where the media of WhatsApp is kept'
);
reset role;
select pg_temp.as_backend();
set local role service_role;
select is(
  public.reserve_file('b9000000-0000-4000-8000-00000000000a', 'whatsapp', 'audio.ogg', 'audio/ogg', 1000) ->> 'ok',
  'true',
  'the backend keeps what arrives over WhatsApp, a voice message included'
);
reset role;

-- ---------- The history in one call, an account's numbers, a template's status ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('history_chunk', public.wa_ingest_history(
  'b9000000-0000-4000-8000-00000000000b', pg_temp.id_of('num_b', 'number_id'),
  jsonb_build_array(
    jsonb_build_object('contact', '5562966660004', 'wa_message_id', 'wamid.hist.10', 'direction', 'in', 'kind', 'text',
                       'body', 'Bom dia.', 'wa_timestamp', (now() - interval '10 days')::text),
    jsonb_build_object('contact', '5562966660004', 'wa_message_id', 'wamid.hist.11', 'direction', 'out', 'kind', 'text',
                       'body', 'Bom dia, Paula.', 'wa_timestamp', (now() - interval '10 days' + interval '1 minute')::text,
                       'status', 'read'),
    -- Already known; a kind this code does not know; a side that is none; a moment that is no moment.
    jsonb_build_object('contact', '5562977770003', 'wa_message_id', 'wamid.hist.1', 'direction', 'in', 'kind', 'text',
                       'body', 'Mensagem antiga do cliente.'),
    jsonb_build_object('contact', '5562966660004', 'wa_message_id', 'wamid.hist.12', 'direction', 'in', 'kind', 'holograma', 'body', 'x'),
    jsonb_build_object('contact', '5562966660004', 'wa_message_id', 'wamid.hist.13', 'direction', 'lado', 'kind', 'text', 'body', 'x'),
    jsonb_build_object('contact', '5562966660004', 'wa_message_id', 'wamid.hist.14', 'direction', 'in', 'kind', 'text',
                       'body', 'x', 'wa_timestamp', 'ontem cedo')
  ), 80));
insert into res values ('history_wrong_firm', public.wa_ingest_history(
  'b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('num_b', 'number_id'), '[]'::jsonb));
insert into res values ('account_b', public.wa_account_numbers('simulator', 'waba-b'));
insert into res values ('account_b_meta', public.wa_account_numbers('meta', 'waba-b'));
insert into res values ('tpl_paused', public.wa_set_template_status('simulator', 'waba-a', 'aviso_audiencia', 'pt_BR', 'PAUSED'));
insert into res values ('tpl_meta', public.wa_set_template_status('meta', 'waba-a', 'aviso_audiencia', 'pt_BR', 'REJECTED'));
insert into res values ('tpl_word', public.wa_set_template_status('simulator', 'waba-a', 'aviso_audiencia', 'pt_BR', 'FLAGGED'));
insert into res values ('tpl_unknown', public.wa_set_template_status('simulator', 'waba-a', 'nao_existe', 'pt_BR', 'APPROVED'));
reset role;

select ok(
  (select payload = '{"ok": true, "mirrored": 2, "skipped": 4}'::jsonb from res where name = 'history_chunk')
  and (select count(*) = 2 and bool_and(m.origin = 'history')
       from public.wa_messages m join public.wa_conversations c on c.id = m.conversation_id
       where c.contact_wa_id = '5562966660004')
  and (select last_inbound_at is null and unread_count = 0 and last_message_preview = 'Bom dia, Paula.'
       from public.wa_conversations where contact_wa_id = '5562966660004')
  and (select history_progress = 80 from public.wa_numbers where id = pg_temp.id_of('num_b', 'number_id'))
  and pg_temp.code_of('history_wrong_firm') = 'number_not_found',
  'a piece of the shared history enters in one call: what is new is mirrored, what cannot be read is left out and counted'
);
select ok(
  (select jsonb_array_length(payload) = 1
          and payload -> 0 ->> 'org_id' = 'b9000000-0000-4000-8000-00000000000b'
          and payload -> 0 ->> 'number_id' = pg_temp.id_of('num_b', 'number_id')::text
          and payload -> 0 ->> 'connection_id' = 'd9000000-0000-4000-8000-00000000000b'
   from res where name = 'account_b')
  and (select payload = '[]'::jsonb from res where name = 'account_b_meta'),
  'an event that names an account finds its active numbers, within the provider that signed it'
);
select ok(
  (select payload = '{"ok": true, "changed": 1}'::jsonb from res where name = 'tpl_paused')
  and (select payload = '{"ok": true, "changed": 0}'::jsonb from res where name = 'tpl_meta')
  and pg_temp.code_of('tpl_word') = 'ignored'
  and (select payload = '{"ok": true, "changed": 0}'::jsonb from res where name = 'tpl_unknown')
  and (select status = 'paused' from public.wa_templates
       where org_id = 'b9000000-0000-4000-8000-00000000000a' and name = 'aviso_audiencia')
  and (select status = 'approved' from public.wa_templates
       where org_id = 'b9000000-0000-4000-8000-00000000000b' and name = 'aviso_audiencia'),
  'when the vendor changes a template, only that account''s template changes, within the provider that signed it'
);

-- ---------- The number stops ----------

select pg_temp.sign_in('a9000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('cut', public.disconnect_connection('d9000000-0000-4000-8000-00000000000a'));
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('route_cut', public.wa_route('simulator', 'sim-a'));
insert into res values ('in_cut', public.wa_ingest_inbound(
  'b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('num_a', 'number_id'), '5562999990001', 'Maria Teste',
  'wamid.in.6', 'text', 'Ainda tem alguém aí?'));
insert into res values ('vendor_cut_wrong', public.wa_disconnect_number(
  'b9000000-0000-4000-8000-00000000000a', pg_temp.id_of('num_b', 'number_id'), 'PARTNER_REMOVED'));
insert into res values ('vendor_cut', public.wa_disconnect_number(
  'b9000000-0000-4000-8000-00000000000b', pg_temp.id_of('num_b', 'number_id'), 'PARTNER_REMOVED'));
reset role;

select ok(
  pg_temp.code_of('cut') = 'disconnected'
  and (select status = 'disconnected' and disconnect_reason = 'connection_disconnected'
       from public.wa_numbers where id = pg_temp.id_of('num_a', 'number_id'))
  and (select payload = '{"found": false}'::jsonb from res where name = 'route_cut')
  and pg_temp.code_of('in_cut') = 'number_not_found',
  'cutting the connection takes its number with it: nothing is routed to it any more'
);
select ok(
  pg_temp.code_of('vendor_cut_wrong') = 'not_found' and pg_temp.code_of('vendor_cut') = 'disconnected'
  and (select status = 'disconnected' and disconnect_reason = 'partner_removed'
       from public.wa_numbers where id = pg_temp.id_of('num_b', 'number_id'))
  and exists (select 1 from public.audit_events where action = 'whatsapp.number.disconnected' and metadata ->> 'reason' = 'partner_removed'),
  'when the vendor says a number left, only that firm''s number is closed, and it is audited'
);

select pg_temp.sign_in('a9000000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  public.reserve_wa_send(pg_temp.id_of('in_1', 'conversation_id'), 'text', 'Depois de desconectado.') ->> 'code',
  'number_disconnected',
  'nothing is sent from a number that is no longer connected'
);
select is(public.wa_mark_read(pg_temp.id_of('in_1', 'conversation_id')) ->> 'ok', 'true', 'the conversation stays readable');
reset role;

-- ---------- Connecting again, and the firm that goes ----------

select pg_temp.sign_in('a9000000-0000-4000-8000-000000000001');
set local role authenticated;
select public.begin_connection('b9000000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-a', 'WhatsApp A');
reset role;

-- The signup never ended. A day later the upkeep gives the attempt up: the
-- connection goes back to what it was and the number keeps everything it has.
select set_config('request.jwt.claims', '', true);
set local session_replication_role = replica;
update public.connections set updated_at = now() - interval '2 days' where id = 'd9000000-0000-4000-8000-00000000000a';
set local session_replication_role = origin;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('given_up', public.expire_connections());
reset role;

select ok(
  (select payload ->> 'abandoned' = '1' from res where name = 'given_up')
  and (select status = 'disconnected' from public.connections where id = 'd9000000-0000-4000-8000-00000000000a')
  and (select status = 'disconnected' and connection_id = 'd9000000-0000-4000-8000-00000000000a'
       from public.wa_numbers where id = pg_temp.id_of('num_a', 'number_id'))
  and (select count(*) = 1 from public.wa_conversations where number_id = pg_temp.id_of('num_a', 'number_id'))
  and (select count(*) > 3 from public.wa_messages where number_id = pg_temp.id_of('num_a', 'number_id')),
  'an attempt to reconnect that never ended costs nothing: the connection stays and the number keeps its conversations'
);

select pg_temp.sign_in('a9000000-0000-4000-8000-000000000001');
set local role authenticated;
select public.begin_connection('b9000000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-a', 'WhatsApp A');
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.vault_store_secret('b9000000-0000-4000-8000-00000000000a', 'd9000000-0000-4000-8000-00000000000a', 1,
  'AAAAAAAAAAAAAAAA', 'c2VncmVkbw==', 'AAAAAAAAAAAAAAAAAAAAAA==');
insert into res values ('num_a_again', public.register_wa_number(
  'b9000000-0000-4000-8000-00000000000a', 'd9000000-0000-4000-8000-00000000000a', 'simulator', 'sim-a', 'waba-a', '5562900000001'));
reset role;

select ok(
  pg_temp.id_of('num_a_again', 'number_id') = pg_temp.id_of('num_a', 'number_id')
  and (select status = 'active' and disconnected_at is null from public.wa_numbers where id = pg_temp.id_of('num_a', 'number_id'))
  and (select count(*) = 1 from public.wa_conversations where number_id = pg_temp.id_of('num_a', 'number_id')),
  'connecting the same number again brings it back, with its conversations'
);

-- ---------- The simulator and a real number, never side by side; a number outlives its connection ----------

select set_config('request.jwt.claims', '', true);
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('d9000000-0000-4000-8000-00000000000e', 'b9000000-0000-4000-8000-00000000000a', 'whatsapp', '102938475600001', 'WhatsApp real', 'connected', 'a9000000-0000-4000-8000-000000000001', now());
select pg_temp.as_backend();
set local role service_role;
insert into res values ('real_a', public.register_wa_number(
  'b9000000-0000-4000-8000-00000000000a', 'd9000000-0000-4000-8000-00000000000e', 'meta', '105566778800001', '102938475600001', '5562911112222'));
insert into res values ('sim_after_real', public.register_wa_number(
  'b9000000-0000-4000-8000-00000000000a', 'd9000000-0000-4000-8000-00000000000a', 'simulator', 'sim-a', 'waba-a', '5562900000001'));
reset role;

select ok(
  pg_temp.code_of('real_a') = 'registered'
  and (select status = 'disconnected' and disconnect_reason = 'replaced_by_real_number'
       from public.wa_numbers where id = pg_temp.id_of('num_a', 'number_id'))
  and pg_temp.code_of('sim_after_real') = 'simulator_not_allowed',
  'a firm that connects a real number leaves the simulator for good: a simulated message can never undo what a real person asked'
);

select set_config('request.jwt.claims', '', true);
delete from public.connections where id = 'd9000000-0000-4000-8000-00000000000e';
select ok(
  (select connection_id is null and status = 'disconnected' and disconnect_reason = 'connection_removed'
   from public.wa_numbers where id = pg_temp.id_of('real_a', 'number_id'))
  and (select count(*) = 1 from public.wa_conversations where number_id = pg_temp.id_of('num_a', 'number_id')),
  'a number outlives the connection it had: removing a connection disconnects it and takes no conversation with it'
);

select set_config('request.jwt.claims', '', true);
delete from public.organizations where id = 'b9000000-0000-4000-8000-00000000000a';
select ok(
  not exists (select 1 from public.wa_numbers where org_id = 'b9000000-0000-4000-8000-00000000000a')
  and not exists (select 1 from public.wa_messages where org_id = 'b9000000-0000-4000-8000-00000000000a')
  and not exists (select 1 from public.wa_optouts where org_id = 'b9000000-0000-4000-8000-00000000000a')
  and exists (select 1 from public.wa_conversations where org_id = 'b9000000-0000-4000-8000-00000000000b'),
  'deleting a firm removes its numbers, conversations and messages, and nothing of the other firm'
);

select * from finish();
rollback;
