begin;
create extension if not exists pgtap;
select plan(31);

-- ============================================================
-- Partners (0069): a firm invites a travel agency to be its partner in a
-- module; the first person founds the agency and the partnership, or links
-- an agency they already manage; the agency's managers bring colleagues; a
-- person is in one firm or in one partner; the partnership ends with a
-- reason; nothing of a firm reaches a partner's people and the other way
-- round. Two firms and two agencies.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a7300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-parceiros.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a7300000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza-parceiros.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a7300000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-parceiros.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a7300000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@viagens-sol.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now()),
  ('a7300000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'edu@viagens-sol.invalid', '', now(), '{}', '{"display_name":"Edu Matos"}', now(), now()),
  ('a7300000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fabi@turismo-mar.invalid', '', now(), '{}', '{"display_name":"Fabi Costa"}', now(), now()),
  ('a7300000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'gil@souza-parceiros.invalid', '', now(), '{}', '{"display_name":"Gil Prado"}', now(), now()),
  ('a7300000-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'hugo@turismo-mar.invalid', '', null, '{}', '{"display_name":"Hugo Dias"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b7300000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-parceiros', 'a7300000-0000-4000-8000-000000000001'),
  ('b7300000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-parceiros', 'a7300000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b7300000-0000-4000-8000-00000000000a', 'a7300000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b7300000-0000-4000-8000-00000000000a', 'a7300000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b7300000-0000-4000-8000-00000000000a', 'a7300000-0000-4000-8000-000000000007', 'member', 'atendimento'),
  ('b7300000-0000-4000-8000-00000000000b', 'a7300000-0000-4000-8000-000000000003', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, aal text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', aal,
     'email', (select email from auth.users where id = who))::text, true); $$;
create function pg_temp.anonymous() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.hash(token text) returns text language sql as
$$ select encode(sha256(convert_to(token, 'UTF8')), 'hex'); $$;

-- ---------- A firm invites an agency ----------

select pg_temp.sign_in('a7300000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('invited', public.firm_invite_partner('b7300000-0000-4000-8000-00000000000a',
  'direito-do-passageiro', '  Viagens   Sol ', 'Duda@Viagens-Sol.invalid', pg_temp.hash('convite-sol-1')));
insert into res values ('bad_name', public.firm_invite_partner('b7300000-0000-4000-8000-00000000000a',
  'direito-do-passageiro', 'X', 'duda@viagens-sol.invalid', pg_temp.hash('convite-sol-x')));
insert into res values ('own_person', public.firm_invite_partner('b7300000-0000-4000-8000-00000000000a',
  'direito-do-passageiro', 'Agência Própria', 'bia@souza-parceiros.invalid', pg_temp.hash('convite-bia')));
insert into res values ('no_module', public.firm_invite_partner('b7300000-0000-4000-8000-00000000000a',
  'modulo-que-nao-existe', 'Viagens Sol', 'duda@viagens-sol.invalid', pg_temp.hash('convite-sol-y')));
reset role;

select ok(
  pg_temp.got('invited', 'code') = 'invited'
  and exists (select 1 from public.partner_invitations i where i.id = pg_temp.got('invited', 'id')::uuid
              and i.partner_name = 'Viagens Sol' and i.email = 'duda@viagens-sol.invalid' and i.role = 'owner'),
  'who manages a firm invites an agency, by its name and the e-mail of its first person'
);
select ok(
  pg_temp.got('bad_name', 'code') = 'invalid_partner_name' and pg_temp.got('own_person', 'code') = 'already_member'
  and pg_temp.got('no_module', 'code') = 'module_not_enabled',
  'an invitation needs a name, somebody outside the firm and a module the firm uses'
);
select ok(
  exists (select 1 from public.audit_events a where a.action = 'partner.invitation.sent'
          and a.org_id = 'b7300000-0000-4000-8000-00000000000a'),
  'the invitation is on the firm''s record'
);

select pg_temp.sign_in('a7300000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$ select public.firm_invite_partner('b7300000-0000-4000-8000-00000000000a', 'direito-do-passageiro', 'Viagens Lua',
       'lua@viagens-lua.invalid', encode(sha256(convert_to('convite-lua', 'UTF8')), 'hex')) $$,
  '42501', 'not_authorized',
  'somebody who does not manage the firm invites no agency'
);
reset role;

select pg_temp.sign_in('a7300000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
select throws_ok(
  $$ select public.firm_invite_partner('b7300000-0000-4000-8000-00000000000a', 'direito-do-passageiro', 'Viagens Lua',
       'lua@viagens-lua.invalid', encode(sha256(convert_to('convite-lua', 'UTF8')), 'hex')) $$,
  '42501', 'second_factor_required',
  'inviting an agency asks for the second factor'
);
reset role;

-- ---------- The page of the invitation, and accepting it ----------

select pg_temp.anonymous();
set local role anon;
insert into res values ('preview', public.partner_invitation_preview('convite-sol-1'));
insert into res values ('preview_none', public.partner_invitation_preview('convite-que-nao-existe'));
reset role;

select ok(
  pg_temp.got('preview', 'kind') = 'firm' and pg_temp.got('preview', 'firm') = 'Souza Advogados'
  and pg_temp.got('preview', 'partner') = 'Viagens Sol' and pg_temp.got('preview', 'status') = 'open'
  and pg_temp.got('preview', 'module') = 'direito-do-passageiro'
  and pg_temp.got('preview', 'email_hint') = 'd***@viagens-sol.invalid'
  and pg_temp.got('preview_none', 'found') = 'false',
  'the link says who invites which agency, with the address masked, to anybody who holds it'
);

select pg_temp.sign_in('a7300000-0000-4000-8000-000000000006');
set local role authenticated;
insert into res values ('wrong_account', public.accept_partner_invitation(pg_temp.got('invited', 'id')::uuid));
reset role;
select ok(pg_temp.got('wrong_account', 'code') = 'not_found', 'an invitation is accepted by the invited address only');

select pg_temp.sign_in('a7300000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('duda_invitations', jsonb_build_object('count', (select count(*) from public.my_partner_invitations())));
insert into res values ('accepted', public.accept_partner_invitation(pg_temp.got('invited', 'id')::uuid));
insert into res values ('accepted_again', public.accept_partner_invitation(pg_temp.got('invited', 'id')::uuid));
insert into res values ('duda_reads', jsonb_build_object(
  'partners', (select count(*) from public.partners),
  'members', (select count(*) from public.partner_members),
  'links', (select count(*) from public.partner_links),
  'memberships', (select count(*) from public.memberships),
  'in_firm', public.is_org_member('b7300000-0000-4000-8000-00000000000a'),
  'factor', public.second_factor_required(),
  'mine', public.my_partner()
));
reset role;

select ok(pg_temp.got('duda_invitations', 'count') = '1', 'the invited account finds its invitation');
select ok(
  pg_temp.got('accepted', 'code') = 'partnered'
  and exists (select 1 from public.partners p where p.id = pg_temp.got('accepted', 'partner_id')::uuid and p.name = 'Viagens Sol')
  and exists (select 1 from public.partner_members pm where pm.partner_id = pg_temp.got('accepted', 'partner_id')::uuid
              and pm.user_id = 'a7300000-0000-4000-8000-000000000004' and pm.role = 'owner')
  and exists (select 1 from public.partner_links l where l.id = pg_temp.got('accepted', 'link_id')::uuid
              and l.org_id = 'b7300000-0000-4000-8000-00000000000a' and l.module_key = 'direito-do-passageiro'
              and l.status = 'active' and l.started_by = 'a7300000-0000-4000-8000-000000000001'),
  'accepting founds the agency with its owner and the partnership with the firm'
);
select ok(pg_temp.got('accepted_again', 'code') = 'already_accepted', 'an invitation is accepted once');
select ok(
  pg_temp.got('duda_reads', 'partners') = '1' and pg_temp.got('duda_reads', 'members') = '1'
  and pg_temp.got('duda_reads', 'links') = '1' and pg_temp.got('duda_reads', 'memberships') = '0'
  and pg_temp.got('duda_reads', 'in_firm') = 'false',
  'the agency reads its own account and its partnership, and nothing of the firm'
);
select ok(pg_temp.got('duda_reads', 'factor') = 'true', 'somebody in a partner must have a second factor');
select ok(
  (pg_temp.got('duda_reads', 'mine')::jsonb ->> 'role') = 'owner'
  and (pg_temp.got('duda_reads', 'mine')::jsonb -> 'links' -> 0 ->> 'firm') = 'Souza Advogados',
  'my_partner says where the person works and with which firm'
);
select ok(
  exists (select 1 from public.audit_events a where a.action = 'partner.link.started'
          and a.org_id = 'b7300000-0000-4000-8000-00000000000a'),
  'the partnership is on the firm''s record'
);

select pg_temp.sign_in('a7300000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('bia_reads', jsonb_build_object(
  'partners', (select count(*) from public.partners),
  'members', (select count(*) from public.partner_members),
  'links', (select count(*) from public.partner_links),
  'listed', (select jsonb_agg(jsonb_build_object('partner', f.partner, 'reason', f.end_reason))
             from public.firm_partners('b7300000-0000-4000-8000-00000000000a') f)
));
reset role;
select pg_temp.sign_in('a7300000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('caio_reads', jsonb_build_object('links', (select count(*) from public.partner_links)));
reset role;

select ok(
  pg_temp.got('bia_reads', 'partners') = '0' and pg_temp.got('bia_reads', 'members') = '0'
  and pg_temp.got('bia_reads', 'links') = '1'
  and (pg_temp.got('bia_reads', 'listed')::jsonb -> 0 ->> 'partner') = 'Viagens Sol',
  'the firm reads its partnerships by the partner''s name, never the agency''s people'
);
select ok(pg_temp.got('caio_reads', 'links') = '0', 'another firm reads nothing of the partnership');

-- ---------- A person is in one firm or in one partner ----------

select throws_ok(
  $$ insert into public.memberships (org_id, user_id, role, firm_function)
     values ('b7300000-0000-4000-8000-00000000000b', 'a7300000-0000-4000-8000-000000000004', 'member', 'atendimento') $$,
  '23505', 'in_a_partner',
  'somebody in a partner joins no firm'
);

-- ---------- The agency's team ----------

select pg_temp.sign_in('a7300000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('team_invite', public.invite_to_partner(pg_temp.got('accepted', 'partner_id')::uuid,
  'edu@viagens-sol.invalid', 'member', pg_temp.hash('convite-edu')));
insert into res values ('gil_invite', public.invite_to_partner(pg_temp.got('accepted', 'partner_id')::uuid,
  'gil@souza-parceiros.invalid', 'member', pg_temp.hash('convite-gil')));
reset role;

select pg_temp.sign_in('a7300000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('edu_joins', public.accept_partner_invitation(pg_temp.got('team_invite', 'id')::uuid));
insert into res values ('edu_team', jsonb_build_object(
  'rows', (select count(*) from public.partner_team(pg_temp.got('accepted', 'partner_id')::uuid)),
  'factor_hidden', (select bool_and(t.has_second_factor is null) from public.partner_team(pg_temp.got('accepted', 'partner_id')::uuid) t)
));
reset role;

select ok(
  pg_temp.got('team_invite', 'code') = 'invited' and pg_temp.got('edu_joins', 'code') = 'joined'
  and exists (select 1 from public.partner_members pm where pm.user_id = 'a7300000-0000-4000-8000-000000000005'
              and pm.role = 'member'),
  'who manages the agency brings a colleague in'
);
select ok(
  pg_temp.got('edu_team', 'rows') = '2' and pg_temp.got('edu_team', 'factor_hidden') = 'true',
  'a colleague reads the team, and only who manages it reads who has a second factor'
);

select pg_temp.sign_in('a7300000-0000-4000-8000-000000000005');
set local role authenticated;
select throws_ok(
  format('select public.invite_to_partner(%L, %L, %L, %L)', pg_temp.got('accepted', 'partner_id'),
    'iris@viagens-sol.invalid', 'member', pg_temp.hash('convite-iris')),
  '42501', 'not_authorized',
  'a member of the agency invites nobody'
);
reset role;

select pg_temp.sign_in('a7300000-0000-4000-8000-000000000007');
set local role authenticated;
insert into res values ('gil_joins', public.accept_partner_invitation(pg_temp.got('gil_invite', 'id')::uuid));
reset role;
select ok(pg_temp.got('gil_joins', 'code') = 'already_in_a_firm', 'somebody of a firm joins no partner');

select pg_temp.sign_in('a7300000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('owner_out', public.remove_partner_member(pg_temp.got('accepted', 'partner_id')::uuid,
  'a7300000-0000-4000-8000-000000000004'));
insert into res values ('renamed', public.rename_partner(pg_temp.got('accepted', 'partner_id')::uuid, 'Viagens Sol e Mar'));
reset role;
select pg_temp.sign_in('a7300000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('edu_leaves', public.remove_partner_member(pg_temp.got('accepted', 'partner_id')::uuid,
  'a7300000-0000-4000-8000-000000000005'));
reset role;

select ok(
  pg_temp.got('owner_out', 'code') = 'owner_stays' and pg_temp.got('edu_leaves', 'code') = 'left'
  and not exists (select 1 from public.partner_members pm where pm.user_id = 'a7300000-0000-4000-8000-000000000005'),
  'the owner stays, and a member leaves by themself'
);
select ok(
  pg_temp.got('renamed', 'code') = 'renamed'
  and (select name from public.partners where id = pg_temp.got('accepted', 'partner_id')::uuid) = 'Viagens Sol e Mar',
  'who manages the agency renames it'
);

-- ---------- Ending the partnership, and a new one ----------

select pg_temp.sign_in('a7300000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('end_short', public.end_partner_link(pg_temp.got('accepted', 'link_id')::uuid, 'fim'));
insert into res values ('ended', public.end_partner_link(pg_temp.got('accepted', 'link_id')::uuid, 'A agência mudou de escritório'));
insert into res values ('ended_again', public.end_partner_link(pg_temp.got('accepted', 'link_id')::uuid, 'A agência mudou de escritório'));
insert into res values ('after_end', public.invite_to_partner(pg_temp.got('accepted', 'partner_id')::uuid,
  'iris@viagens-sol.invalid', 'member', pg_temp.hash('convite-iris')));
reset role;

select ok(pg_temp.got('end_short', 'code') = 'reason_required', 'ending a partnership asks for a reason');
select ok(
  pg_temp.got('ended', 'code') = 'ended' and pg_temp.got('ended_again', 'code') = 'already_ended'
  and exists (select 1 from public.partner_links l where l.id = pg_temp.got('accepted', 'link_id')::uuid
              and l.status = 'ended' and l.ended_by = 'a7300000-0000-4000-8000-000000000004')
  and exists (select 1 from public.audit_events a where a.action = 'partner.link.ended'
              and a.org_id = 'b7300000-0000-4000-8000-00000000000a' and a.metadata ->> 'by' = 'partner'),
  'the agency ends its partnership, once, on the firm''s record'
);
select ok(pg_temp.got('after_end', 'code') = 'no_partnership', 'an agency with no partnership brings nobody in');

select pg_temp.sign_in('a7300000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('reinvited', public.firm_invite_partner('b7300000-0000-4000-8000-00000000000a',
  'direito-do-passageiro', 'Viagens Sol', 'duda@viagens-sol.invalid', pg_temp.hash('convite-sol-2')));
reset role;
select pg_temp.sign_in('a7300000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('rocha_invites', public.firm_invite_partner('b7300000-0000-4000-8000-00000000000b',
  'direito-do-passageiro', 'Viagens Sol', 'duda@viagens-sol.invalid', pg_temp.hash('convite-sol-rocha')));
reset role;
select pg_temp.sign_in('a7300000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('relinked', public.accept_partner_invitation(pg_temp.got('reinvited', 'id')::uuid));
insert into res values ('second_firm', public.accept_partner_invitation(pg_temp.got('rocha_invites', 'id')::uuid));
reset role;

select ok(
  pg_temp.got('relinked', 'code') = 'partnered'
  and pg_temp.got('relinked', 'partner_id') = pg_temp.got('accepted', 'partner_id')
  and (select count(*) from public.partner_links l where l.partner_id = pg_temp.got('accepted', 'partner_id')::uuid) = 2,
  'an agency already in ONE takes a new partnership when who manages it accepts'
);
select ok(pg_temp.got('second_firm', 'code') = 'already_partnered', 'an agency works with one firm per module at a time');

-- ---------- Taking an invitation back, and another agency ----------

select pg_temp.sign_in('a7300000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('revoked', public.revoke_partner_invitation(pg_temp.got('rocha_invites', 'id')::uuid));
insert into res values ('mar', public.firm_invite_partner('b7300000-0000-4000-8000-00000000000b',
  'direito-do-passageiro', 'Turismo Mar', 'hugo@turismo-mar.invalid', pg_temp.hash('convite-mar')));
reset role;
select pg_temp.anonymous();
set local role anon;
insert into res values ('preview_revoked', public.partner_invitation_preview('convite-sol-rocha'));
reset role;
select pg_temp.sign_in('a7300000-0000-4000-8000-000000000008');
set local role authenticated;
insert into res values ('unconfirmed', public.accept_partner_invitation(pg_temp.got('mar', 'id')::uuid));
reset role;

select ok(
  pg_temp.got('revoked', 'code') = 'revoked' and pg_temp.got('preview_revoked', 'status') = 'revoked',
  'who invited takes the invitation back, and its link says so'
);
select ok(pg_temp.got('unconfirmed', 'code') = 'email_not_confirmed', 'an address not confirmed accepts nothing');

select pg_temp.sign_in('a7300000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  format('select public.end_partner_link(%L, %L)', pg_temp.got('relinked', 'link_id'), 'Uma razão qualquer'),
  '42501', 'not_authorized',
  'another firm ends no partnership'
);
reset role;

select * from finish();
rollback;
