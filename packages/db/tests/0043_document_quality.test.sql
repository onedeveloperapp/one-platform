begin;
create extension if not exists pgtap;
select plan(19);

-- ============================================================
-- The photo of a document, measured where it arrives (0024).
--
-- A rule of the backend measures how well a photo can be read; the database
-- says which kinds of document are measured and by which limits, keeps what
-- was measured beside the document, once, and hands it to the work on the
-- document. A client told their photo is hard to read takes another (the one
-- they did not send is not kept) or sends it all the same (and that is on
-- record). The rule measures and a person decides: nothing here accepts or
-- refuses a document. Two firms: nothing of one reaches the other.
--
-- Every person, firm and CPF here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a4300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a4300000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b4300000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'a4300000-0000-4000-8000-000000000001'),
  ('b4300000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'a4300000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b4300000-0000-4000-8000-00000000000a', 'a4300000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b4300000-0000-4000-8000-00000000000b', 'a4300000-0000-4000-8000-000000000004', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.as_client() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.hash(token text) returns text language sql as
$$ select encode(sha256(convert_to(token, 'UTF8')), 'hex'); $$;
-- A file the backend measured and kept (called as the service role).
create function pg_temp.stored(org uuid, file_name text, mime text) returns uuid language plpgsql as $$
declare
  reserved jsonb := public.reserve_file(org, 'upload', file_name, mime, 4000);
begin
  perform public.confirm_file((reserved ->> 'file_id')::uuid, repeat('a', 64), 4000, mime, 1);
  return (reserved ->> 'file_id')::uuid;
end;
$$;
-- What the rule measured of a photo, as the backend hands it over.
create function pg_temp.measure(problems jsonb) returns jsonb language sql as $$
  select jsonb_build_object('rule', 'qualidade-da-imagem-v1', 'width', 1500, 'height', 2000, 'sharpness', 212.4,
    'shadow', 18, 'highlight', 246, 'problems', problems,
    'limits', '{"min_long_side": 1000, "min_sharpness": 30, "crisp_sharpness": 150, "min_highlight": 90, "max_shadow": 200, "min_range": 40}'::jsonb);
$$;

-- A case of each firm, with photos the backend kept: two papers and a photo of what happened in firm A, a paper in firm B.
select pg_temp.sign_in('a4300000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('b4300000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02"}'::jsonb));
insert into res values ('link', public.create_client_link(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, pg_temp.hash('token-da-maria-da-foto-1234567890')));
reset role;
select pg_temp.sign_in('a4300000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('b4300000-0000-4000-8000-00000000000b', 'cancellation', null, null,
  '{"full_name": "Paulo Teste", "cpf": "52998224725", "birth_date": "1980-01-10"}'::jsonb));
insert into res values ('link_b', public.create_client_link(pg_temp.got('case_b', 'case_id')::uuid,
  pg_temp.got('case_b', 'person_id')::uuid, pg_temp.hash('token-do-paulo-da-foto-1234567890')));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res
select name, jsonb_build_object('file_id', pg_temp.stored(org::uuid, file_name, 'image/jpeg'))
from (values
  ('f_identity', 'b4300000-0000-4000-8000-00000000000a', 'rg.jpg'),
  ('f_address', 'b4300000-0000-4000-8000-00000000000a', 'conta.jpg'),
  ('f_evidence', 'b4300000-0000-4000-8000-00000000000a', 'mala.jpg'),
  ('f_identity_b', 'b4300000-0000-4000-8000-00000000000b', 'rg-b.jpg')
) as files (name, org, file_name);
reset role;
select pg_temp.sign_in('a4300000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('identity', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('f_identity', 'file_id')::uuid, 'identity', pg_temp.got('case', 'party_id')::uuid));
insert into res values ('address', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('f_address', 'file_id')::uuid, 'address_proof', pg_temp.got('case', 'party_id')::uuid));
insert into res values ('evidence', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('f_evidence', 'file_id')::uuid, 'evidence'));
reset role;
select pg_temp.sign_in('a4300000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('identity_b', public.attach_case_document(pg_temp.got('case_b', 'case_id')::uuid,
  pg_temp.got('f_identity_b', 'file_id')::uuid, 'identity', pg_temp.got('case_b', 'party_id')::uuid));
reset role;

-- ---------- Which kinds are measured, and by which limits ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('rule_identity', public.document_quality_rule('identity'));
insert into res values ('rules', jsonb_build_object(
  'ticket', public.document_quality_rule('ticket') is not null,
  'receipt', public.document_quality_rule('receipt') is not null,
  'evidence', public.document_quality_rule('evidence') is null,
  'other', public.document_quality_rule('other') is null,
  'petition', public.document_quality_rule('petition') is null,
  'none', public.document_quality_rule(null) is null));
reset role;
select ok(
  (select payload = '{"min_long_side": 1000, "min_sharpness": 30, "crisp_sharpness": 150, "min_highlight": 90, "max_shadow": 200, "min_range": 40}'::jsonb
   from res where name = 'rule_identity')
  and pg_temp.got('rules', 'ticket') = 'true' and pg_temp.got('rules', 'receipt') = 'true'
  and pg_temp.got('rules', 'evidence') = 'true' and pg_temp.got('rules', 'other') = 'true'
  and pg_temp.got('rules', 'petition') = 'true' and pg_temp.got('rules', 'none') = 'true',
  'the photo of a paper to be read is measured by the limits of the setting; a photo of what happened, and what is no kind, by none'
);

-- No person asks the rule or records a measure: the functions are not theirs to call...
select pg_temp.sign_in('a4300000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.document_quality_rule('identity')$$,
  '42501', 'permission denied for function document_quality_rule', 'the rule is not a member''s to ask'
);
select throws_ok(
  format('select public.record_document_quality(%L, %L)', pg_temp.got('identity', 'document_id'), pg_temp.measure('[]'::jsonb)),
  '42501', 'permission denied for function record_document_quality', 'and no member records what was measured of a photo'
);
select throws_ok(
  format('select public.client_link_upload_to_finish(%L, %L)', 'token-da-maria-da-foto-1234567890', pg_temp.got('identity', 'document_id')),
  '42501', 'permission denied for function client_link_upload_to_finish', 'nor is handed what the backend reads of an upload of a link'
);
insert into res values ('setting_seen', jsonb_build_object('count',
  (select count(*) from public.platform_settings where key = 'document_quality')));
reset role;
-- ...and each of them asks who is calling, whoever was let in: a person's session is refused by the function itself.
select throws_ok(
  $$select public.document_quality_rule('identity')$$,
  '42501', 'not_authorized', 'the rule answers the backend alone'
);
select throws_ok(
  format('select public.record_document_insisted(%L)', pg_temp.got('identity', 'document_id')),
  '42501', 'not_authorized', 'and so does what is kept of a photo'
);

-- ---------- What was measured, kept beside the document ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('bad_shape', jsonb_build_object(
  'text', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid, '"nítida"'::jsonb) ->> 'code',
  'no_width', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid, pg_temp.measure('[]'::jsonb) - 'width') ->> 'code',
  'width_text', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid,
    pg_temp.measure('[]'::jsonb) || '{"width": "1500"}'::jsonb) ->> 'code',
  'width_part', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid,
    pg_temp.measure('[]'::jsonb) || '{"width": 1500.5}'::jsonb) ->> 'code',
  'light', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid,
    pg_temp.measure('[]'::jsonb) || '{"shadow": 300}'::jsonb) ->> 'code',
  'huge', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid,
    pg_temp.measure('[]'::jsonb) || '{"sharpness": 1e3000}'::jsonb) ->> 'code',
  'sharp_over', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid,
    pg_temp.measure('[]'::jsonb) || '{"sharpness": 999.5}'::jsonb) ->> 'code',
  'sharp_missing', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid,
    pg_temp.measure('[]'::jsonb) - 'sharpness') ->> 'code',
  'sharp_none', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid,
    pg_temp.measure('[]'::jsonb) || '{"sharpness": null}'::jsonb) ->> 'code',
  'problem', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid, pg_temp.measure('["ugly"]'::jsonb)) ->> 'code',
  'problems', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid, pg_temp.measure('"blurry"'::jsonb)) ->> 'code',
  'twice', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid,
    pg_temp.measure('["blurry", "blurry"]'::jsonb)) ->> 'code',
  'rule', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid,
    pg_temp.measure('[]'::jsonb) || '{"rule": "uma regra qualquer"}'::jsonb) ->> 'code',
  'rule_number', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid,
    pg_temp.measure('[]'::jsonb) || '{"rule": 7}'::jsonb) ->> 'code',
  'no_limits', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid,
    pg_temp.measure('[]'::jsonb) || '{"limits": null}'::jsonb) ->> 'code',
  'limit_missing', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid,
    pg_temp.measure('[]'::jsonb) #- '{limits,min_range}') ->> 'code',
  'limit_text', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid,
    jsonb_set(pg_temp.measure('[]'::jsonb), '{limits,min_sharpness}', '"sessenta"'::jsonb)) ->> 'code',
  'nobody', public.record_document_quality('00000000-0000-4000-8000-000000000000', pg_temp.measure('[]'::jsonb)) ->> 'code',
  'still_empty', (select quality is null from public.case_documents where id = pg_temp.got('identity', 'document_id')::uuid)));
reset role;
select ok(
  (select count(*) = 17 from jsonb_each_text((select payload from res where name = 'bad_shape')) as said (name, code)
   where said.code = 'invalid_quality')
  and pg_temp.got('bad_shape', 'nobody') = 'not_found' and pg_temp.got('bad_shape', 'still_empty') = 'true',
  'only a measure of the rule is kept, and what is not one is answered as such, never raised: whole sides, numbers a measure can be, problems of the rule''s list each once, a rule by its name, and every limit'
);

select pg_temp.as_backend();
set local role service_role;
-- A photo with nothing against it, with things nobody asked for beside it and inside its limits.
insert into res values ('good', public.record_document_quality(pg_temp.got('identity', 'document_id')::uuid,
  jsonb_set(pg_temp.measure('[]'::jsonb), '{limits,person}', '"Maria Teste"'::jsonb)
    || '{"note": "nada a ver", "person": "Maria Teste", "insisted": true}'::jsonb));
-- A photo hard to read that came some other way than a link: nobody was told, nobody insisted.
insert into res values ('poor', public.record_document_quality(pg_temp.got('address', 'document_id')::uuid,
  pg_temp.measure('["blurry", "too_dark"]'::jsonb)));
insert into res values ('again', public.record_document_quality(pg_temp.got('address', 'document_id')::uuid, pg_temp.measure('[]'::jsonb)));
insert into res values ('insist_kept', public.record_document_insisted(pg_temp.got('address', 'document_id')::uuid));
insert into res values ('insist_good', public.record_document_insisted(pg_temp.got('identity', 'document_id')::uuid));
insert into res values ('insist_unmeasured', public.record_document_insisted(pg_temp.got('evidence', 'document_id')::uuid));
insert into res values ('kept_good', (select quality from public.case_documents where id = pg_temp.got('identity', 'document_id')::uuid));
insert into res values ('kept_poor', (select quality from public.case_documents where id = pg_temp.got('address', 'document_id')::uuid));
reset role;
select ok(
  pg_temp.got('good', 'code') = 'measured'
  and (select payload - 'measured_at' = pg_temp.measure('[]'::jsonb) || '{"insisted": false}'::jsonb from res where name = 'kept_good')
  and (select payload ->> 'measured_at' is not null and not payload ? 'note' and not payload ? 'person'
              and not (payload -> 'limits') ? 'person'
       from res where name = 'kept_good'),
  'a measure is kept with its numbers, its limits and when it was taken, and nothing else that came with it or inside it'
);
select ok(
  pg_temp.got('poor', 'code') = 'measured' and pg_temp.got('again', 'code') = 'already_measured'
  and (select payload -> 'problems' = '["blurry", "too_dark"]'::jsonb and not (payload ->> 'insisted')::boolean
       from res where name = 'kept_poor')
  -- "Sent all the same" is said of a photo a client still held when told: never of one the firm already has,
  -- of one with nothing against it, nor of one nobody measured.
  and pg_temp.got('insist_kept', 'code') = 'nothing_to_insist' and pg_temp.got('insist_good', 'code') = 'nothing_to_insist'
  and pg_temp.got('insist_unmeasured', 'code') = 'nothing_to_insist',
  'what keeps a photo from being read is kept as the rule said it; a document is measured once, and nobody is said to have insisted who was not asked'
);

-- ---------- A client told their photo is hard to read ----------

-- The link reserves two photos; the backend measures each where it arrives, before anything is kept.
select pg_temp.as_client();
set local role anon;
insert into res values ('up1', public.client_link_reserve_upload('token-da-maria-da-foto-1234567890', 'identity',
  pg_temp.got('case', 'party_id')::uuid, 'rg-frente.jpg', 'image/jpeg', 300000));
insert into res values ('up2', public.client_link_reserve_upload('token-da-maria-da-foto-1234567890', 'receipt',
  null, 'recibo.jpg', 'image/jpeg', 200000));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('up1_measured', public.record_document_quality(pg_temp.got('up1', 'document_id')::uuid, pg_temp.measure('["blurry"]'::jsonb)));
insert into res values ('up2_measured', public.record_document_quality(pg_temp.got('up2', 'document_id')::uuid, pg_temp.measure('["flat"]'::jsonb)));
reset role;
-- The client sends the receipt all the same (it is faded, not badly taken)...
select pg_temp.as_backend();
set local role service_role;
insert into res values ('up2_insisted', public.record_document_insisted(pg_temp.got('up2', 'document_id')::uuid));
select public.confirm_file(pg_temp.got('up2', 'file_id')::uuid, repeat('b', 64), 200000, 'image/jpeg', null);
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('up2_finish', public.client_link_finish_upload('token-da-maria-da-foto-1234567890', pg_temp.got('up2', 'document_id')::uuid));
-- ...and takes the identity again: the photo that was not sent goes, by this link alone.
insert into res values ('drop_other_link', public.client_link_discard_upload('token-do-paulo-da-foto-1234567890', pg_temp.got('up1', 'document_id')::uuid));
insert into res values ('drop_wrong_token', public.client_link_discard_upload('token-que-nao-existe', pg_temp.got('up1', 'document_id')::uuid));
insert into res values ('drop_sent', public.client_link_discard_upload('token-da-maria-da-foto-1234567890', pg_temp.got('up2', 'document_id')::uuid));
insert into res values ('drop_firm', public.client_link_discard_upload('token-da-maria-da-foto-1234567890', pg_temp.got('identity', 'document_id')::uuid));
insert into res values ('drop', public.client_link_discard_upload('token-da-maria-da-foto-1234567890', pg_temp.got('up1', 'document_id')::uuid));
insert into res values ('drop_again', public.client_link_discard_upload('token-da-maria-da-foto-1234567890', pg_temp.got('up1', 'document_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
-- The document gone, its file went with it: the backend finds nothing left to forget, only bytes to remove.
insert into res values ('forgotten', public.discard_file(pg_temp.got('up1', 'file_id')::uuid));
insert into res values ('kept_up2', (select quality from public.case_documents where id = pg_temp.got('up2', 'document_id')::uuid));
reset role;
select ok(
  pg_temp.got('up1', 'code') = 'reserved' and pg_temp.got('up1_measured', 'code') = 'measured'
  and pg_temp.got('up2_measured', 'code') = 'measured' and pg_temp.got('up2_insisted', 'code') = 'insisted'
  and pg_temp.got('up2_finish', 'code') = 'received'
  and (select payload -> 'problems' = '["flat"]'::jsonb and (payload ->> 'insisted')::boolean from res where name = 'kept_up2')
  and (select status = 'received' from public.case_documents where id = pg_temp.got('up2', 'document_id')::uuid),
  'a photo is measured before it is kept; told it is hard to read, the client sends it all the same, and the firm receives it with both on record'
);
select ok(
  pg_temp.got('drop_other_link', 'code') = 'not_found' and pg_temp.got('drop_wrong_token', 'code') = 'link_not_open'
  -- What the firm received, and what the firm itself attached, is not a client's to take back.
  and pg_temp.got('drop_sent', 'code') = 'already_sent' and pg_temp.got('drop_firm', 'code') = 'not_found'
  and pg_temp.got('drop', 'code') = 'discarded' and pg_temp.got('drop', 'file_id') = pg_temp.got('up1', 'file_id')
  and pg_temp.got('drop', 'storage_path') = pg_temp.got('up1', 'storage_path')
  and pg_temp.got('drop_again', 'code') = 'not_found'
  and not exists (select 1 from public.case_documents where id = pg_temp.got('up1', 'document_id')::uuid)
  and pg_temp.got('forgotten', 'code') = 'not_found'
  and not exists (select 1 from public.files where id = pg_temp.got('up1', 'file_id')::uuid)
  and exists (select 1 from public.audit_events e where e.action = 'file.discarded' and e.entity_id = pg_temp.got('up1', 'file_id'))
  -- The attempt was made: it still counts against the link's ceiling.
  and (select upload_count = 2 from public.client_links where token_hash = pg_temp.hash('token-da-maria-da-foto-1234567890')),
  'a photo the client did not send is taken back through their own link, and nothing of it stays: neither the document that waited for it nor the file'
);

-- ---------- What the backend is handed to finish an upload, and the edges of taking one back ----------

select pg_temp.as_client();
set local role anon;
insert into res values ('up3', public.client_link_reserve_upload('token-da-maria-da-foto-1234567890', 'ticket',
  null, 'bilhete.jpg', 'image/jpeg', 250000));
insert into res values ('up4', public.client_link_reserve_upload('token-da-maria-da-foto-1234567890', 'boarding_pass',
  null, 'cartao.jpg', 'image/jpeg', 250000));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('state_up3', public.client_link_upload_to_finish('token-da-maria-da-foto-1234567890', pg_temp.got('up3', 'document_id')::uuid));
insert into res values ('state_up2', public.client_link_upload_to_finish('token-da-maria-da-foto-1234567890', pg_temp.got('up2', 'document_id')::uuid));
insert into res values ('state_other', public.client_link_upload_to_finish('token-do-paulo-da-foto-1234567890', pg_temp.got('up3', 'document_id')::uuid));
insert into res values ('state_firm', public.client_link_upload_to_finish('token-da-maria-da-foto-1234567890', pg_temp.got('identity', 'document_id')::uuid));
insert into res values ('state_no_link', public.client_link_upload_to_finish('token-que-nao-existe', pg_temp.got('up3', 'document_id')::uuid));
insert into res values ('insist_nobody', public.record_document_insisted('00000000-0000-4000-8000-000000000000'));
-- The backend kept the file of the third upload and the link was not told yet: it is as good as sent.
select public.confirm_file(pg_temp.got('up3', 'file_id')::uuid, repeat('c', 64), 250000, 'image/jpeg', null);
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('drop_kept', public.client_link_discard_upload('token-da-maria-da-foto-1234567890', pg_temp.got('up3', 'document_id')::uuid));
reset role;
-- The firm ends the link: nothing more is sent through it, and what it reserved and never sent is still its holder's to take back.
select pg_temp.sign_in('a4300000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ended', public.revoke_client_link(pg_temp.got('link', 'link_id')::uuid));
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('reserve_ended', public.client_link_reserve_upload('token-da-maria-da-foto-1234567890', 'ticket',
  null, 'outro.jpg', 'image/jpeg', 1000));
insert into res values ('drop_ended', public.client_link_discard_upload('token-da-maria-da-foto-1234567890', pg_temp.got('up4', 'document_id')::uuid));
reset role;
select ok(
  (select payload ->> 'code' = 'found' and payload ->> 'kind' = 'ticket' and payload ->> 'status' = 'uploading'
          and payload ->> 'file_status' = 'reserved' and payload -> 'quality' = 'null'::jsonb
          and payload ->> 'file_id' = pg_temp.got('up3', 'file_id') and payload ->> 'storage_path' = pg_temp.got('up3', 'storage_path')
   from res where name = 'state_up3')
  and (select payload ->> 'status' = 'received' and payload ->> 'file_status' = 'stored'
              and payload -> 'quality' -> 'problems' = '["flat"]'::jsonb and (payload -> 'quality' ->> 'insisted')::boolean
       from res where name = 'state_up2')
  -- Another link, a document the firm attached, and a token that opens nothing: nothing is handed over.
  and pg_temp.got('state_other', 'code') = 'not_found' and pg_temp.got('state_firm', 'code') = 'not_found'
  and pg_temp.got('state_no_link', 'code') = 'link_not_open',
  'the backend is handed what an upload of a link is and where it stands, by the link''s own token, and nothing through another'
);
select ok(
  pg_temp.got('insist_nobody', 'code') = 'not_found'
  and pg_temp.got('drop_kept', 'code') = 'already_sent'
  and exists (select 1 from public.case_documents where id = pg_temp.got('up3', 'document_id')::uuid)
  and exists (select 1 from public.files where id = pg_temp.got('up3', 'file_id')::uuid and status = 'stored')
  and pg_temp.got('ended', 'code') = 'revoked' and pg_temp.got('reserve_ended', 'ok') = 'false'
  and pg_temp.got('drop_ended', 'code') = 'discarded'
  and not exists (select 1 from public.case_documents where id = pg_temp.got('up4', 'document_id')::uuid)
  -- Its file's record went with it, whoever called: nothing is left for a backend that never comes.
  and not exists (select 1 from public.files where id = pg_temp.got('up4', 'file_id')::uuid),
  'a file the backend already kept is not a client''s to take back; an ended link sends nothing more, and still lets go of what it never sent'
);

-- ---------- What the work on a document is handed ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claimed', jsonb_build_object('count', (select count(*) from public.claim_case_documents(10))));
insert into res
select 'work_' || d.kind, to_jsonb(d) from public.case_documents c
cross join lateral public.case_document_to_process(c.id) d
where c.org_id = 'b4300000-0000-4000-8000-00000000000a';
reset role;
select ok(
  pg_temp.got('claimed', 'count') = '5'
  -- Measured where it arrived: the work reads the measure, and the rule its kind is measured by.
  and (select payload -> 'quality' -> 'problems' = '["blurry", "too_dark"]'::jsonb and payload -> 'quality_rule' ->> 'min_sharpness' = '30'
              and payload -> 'quality_rule' ->> 'min_long_side' = '1000'
       from res where name = 'work_address_proof')
  and (select payload -> 'quality' ->> 'rule' = 'qualidade-da-imagem-v1' from res where name = 'work_identity')
  and (select (payload -> 'quality' ->> 'insisted')::boolean from res where name = 'work_receipt')
  -- A photo of what happened: nobody measured it, and nobody will.
  and (select payload -> 'quality' = 'null'::jsonb and payload -> 'quality_rule' = 'null'::jsonb from res where name = 'work_evidence'),
  'the work on a document reads what was measured of its photo, and the rule of its kind when it is one the setting names'
);

-- ---------- Each firm its own ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('b_measured', public.record_document_quality(pg_temp.got('identity_b', 'document_id')::uuid,
  pg_temp.measure('["too_small"]'::jsonb)));
reset role;
select pg_temp.sign_in('a4300000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('seen_by_a', jsonb_build_object(
  'measured', (select count(*) from public.case_documents where quality is not null),
  'poor', (select count(*) from public.case_documents where quality -> 'problems' <> '[]'::jsonb),
  'of_b', (select count(*) from public.case_documents where org_id = 'b4300000-0000-4000-8000-00000000000b')));
reset role;
select pg_temp.sign_in('a4300000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('seen_by_b', jsonb_build_object(
  'measured', (select count(*) from public.case_documents where quality is not null),
  'problems', (select quality -> 'problems' from public.case_documents where id = pg_temp.got('identity_b', 'document_id')::uuid),
  'limits', (select quality -> 'limits' ->> 'min_sharpness' from public.case_documents where id = pg_temp.got('identity_b', 'document_id')::uuid),
  'of_a', (select count(*) from public.case_documents where org_id = 'b4300000-0000-4000-8000-00000000000a')));
reset role;
select ok(
  pg_temp.got('b_measured', 'code') = 'measured'
  and pg_temp.got('seen_by_a', 'measured') = '3' and pg_temp.got('seen_by_a', 'poor') = '2' and pg_temp.got('seen_by_a', 'of_b') = '0'
  and pg_temp.got('seen_by_b', 'measured') = '1' and pg_temp.got('seen_by_b', 'of_a') = '0'
  and (select payload -> 'problems' = '["too_small"]'::jsonb from res where name = 'seen_by_b')
  -- A firm reads what its photo was measured as and against which limits; the setting itself is the operator's to change.
  and pg_temp.got('seen_by_b', 'limits') = '30' and pg_temp.got('setting_seen', 'count') = '0',
  'the people of a firm read what was measured of their own documents, and against what, and nothing of the other firm''s'
);

-- ---------- The setting decides, and a measure is small ----------

update public.platform_settings set value = jsonb_set(value, '{kinds}', '["identity"]'::jsonb) where key = 'document_quality';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('narrowed', jsonb_build_object(
  'identity', public.document_quality_rule('identity') is not null,
  'receipt', public.document_quality_rule('receipt') is null));
reset role;
-- A limit somebody left as text, or left out: nothing is measured by a rule that could not judge.
update public.platform_settings set value = jsonb_set(value, '{min_sharpness}', '"30"'::jsonb) where key = 'document_quality';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('broken', jsonb_build_object('text', public.document_quality_rule('identity') is null));
reset role;
update public.platform_settings set value = (value - 'min_sharpness') || '{"kinds": "identity"}'::jsonb where key = 'document_quality';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('broken_2', jsonb_build_object('missing', public.document_quality_rule('identity') is null));
reset role;
delete from public.platform_settings where key = 'document_quality';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('unset', jsonb_build_object('identity', public.document_quality_rule('identity') is null));
reset role;
select ok(
  pg_temp.got('narrowed', 'identity') = 'true' and pg_temp.got('narrowed', 'receipt') = 'true'
  and pg_temp.got('broken', 'text') = 'true' and pg_temp.got('broken_2', 'missing') = 'true'
  and pg_temp.got('unset', 'identity') = 'true',
  'which kinds are measured is data: a kind taken off the list is not measured, and a setting that does not hold every limit as a number measures nothing'
);
select throws_ok(
  format('update public.case_documents set quality = jsonb_build_object(%L, repeat(%L, 3000)) where id = %L',
    'rule', 'x', pg_temp.got('evidence', 'document_id')),
  '23514', null::text, 'a measure is a few numbers: nothing large is kept under its name'
);
select throws_ok(
  format('update public.case_documents set quality = %L::jsonb where id = %L', '["blurry"]', pg_temp.got('evidence', 'document_id')),
  '23514', null::text, 'and it is an object, whoever writes it'
);
select ok(
  not has_function_privilege('authenticated', 'public.record_document_quality(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.record_document_quality(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_document_insisted(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.record_document_insisted(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.document_quality_rule(text)', 'execute')
  and not has_function_privilege('anon', 'public.document_quality_rule(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.client_link_upload_to_finish(text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.client_link_upload_to_finish(text, uuid)', 'execute')
  -- The link is the client's voice: whoever holds its token takes back what it did not send.
  and has_function_privilege('anon', 'public.client_link_discard_upload(text, uuid)', 'execute')
  and has_column_privilege('authenticated', 'public.case_documents', 'quality', 'SELECT')
  and not has_table_privilege('authenticated', 'public.case_documents', 'UPDATE')
  and not has_table_privilege('anon', 'public.case_documents', 'SELECT'),
  'the rule and its record are called by the backend alone; a member reads the measure and writes none; a client reaches nothing but through their link'
);

select * from finish();
rollback;
