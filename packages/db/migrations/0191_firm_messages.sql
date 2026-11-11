-- ============================================================
-- The firm's own words in ONE's messages (0191), phase 6 of the case
-- journey plan: each message ONE writes in a conversation as free text
-- (inside the 24 hours) may take the firm's own words, checked before they
-- count. The messages are data (`one_messages`: where each goes, the values
-- it must carry and the ones it may, ONE's own words as an example); the
-- firm's versions are kept, never rewritten (`firm_message_texts`, one in
-- force per message), and taking them all off is going back to ONE's.
-- The database refuses a text without a value it must carry, a value it
-- does not know, a dash or an exclamation mark, a promise of a result, and
-- a text of the wrong size; what the bar's rules on advertising weigh is
-- said by the screen for the firm to weigh, as the notices' are (0038). A
-- message outside the 24 hours is a template the vendor approves, written
-- in the notices (0038), never here.
-- ============================================================

create table public.one_messages (
  key text primary key,
  name text not null,
  -- Where it goes and when, as the screen says it.
  where_said text not null,
  position integer not null,
  -- The values it must carry, and the ones it may, written {link}, {nome}, {caso}.
  required text[] not null default '{}',
  optional text[] not null default '{}',
  -- ONE's own words, as an example the screen shows (the code writes ONE's message as it always did).
  example text not null,
  constraint one_messages_key_check check (key ~ '^[a-z][a-z_]{2,40}$')
);

alter table public.one_messages enable row level security;
create policy "one_messages_select_all" on public.one_messages for select to authenticated using (true);
grant select on table public.one_messages to authenticated;

insert into public.one_messages (key, name, where_said, position, required, optional, example) values
  ('link_steps', 'O link e os próximos passos',
   'Logo que o passageiro aceita seguir e o caso é aberto: o link do cliente e o que fazer nele.', 10,
   array['link'], array['nome', 'caso'],
   'Pronto, {nome}. O escritório abriu o seu caso, número {caso}. Abra o seu link e siga os passos: {link}. O link é só seu.'),
  ('case_received', 'Recebemos tudo',
   'Quando o cliente avisa no link que terminou, ou quando o caso já tem tudo de que precisa.', 20,
   '{}', array['nome'],
   'Recebi tudo o que o seu caso precisa, {nome}. Obrigado. O escritório prepara a ação e avisa você por aqui.'),
  ('not_qualified', 'Quando o voo não dá um caso',
   'Quando o passageiro quer seguir, mas pela regra o problema não se qualifica.', 30,
   '{}', array['nome'],
   'Obrigado por responder, {nome}. Pelo que vimos deste voo, o escritório não vai abrir um caso agora. Se quiser falar com uma pessoa do escritório, é só escrever aqui.'),
  ('declined', 'Quando o passageiro não quer seguir',
   'Quando o passageiro responde que não quer seguir com o caso.', 40,
   '{}', array['nome'],
   'Tudo bem, {nome}. O escritório não vai seguir com este caso. Se mudar de ideia, é só escrever aqui.'),
  ('called_person', 'Quando uma pessoa continua a conversa',
   'Quando o ONE chama uma pessoa do escritório para continuar.', 50,
   '{}', '{}',
   'Uma pessoa do escritório vai continuar esta conversa com você.')
on conflict (key) do nothing;

create table public.firm_message_texts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null references public.one_messages (key) on delete cascade,
  version integer not null,
  body text not null,
  active boolean not null default true,
  written_by uuid references public.profiles (id) on delete set null,
  written_at timestamptz not null default now(),
  unique (org_id, key, version),
  constraint firm_message_texts_body_check check (char_length(body) between 10 and 1000)
);

create unique index firm_message_texts_active_idx on public.firm_message_texts (org_id, key) where active;

alter table public.firm_message_texts enable row level security;
create policy "firm_message_texts_select_member" on public.firm_message_texts
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.firm_message_texts to authenticated;
create trigger guard_impersonation_firm_message_texts after insert or update or delete on public.firm_message_texts
  for each statement execute function public.guard_impersonation_readonly();

/**
 * What keeps a firm's text of a message from counting (0191), or null: a value it must carry and does not, a value
 * the message does not know, a dash or an exclamation mark, a promise of a result, or its size.
 */
create or replace function public.firm_message_problem(target_key text, target_body text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  message public.one_messages%rowtype;
  body text := btrim(coalesce(target_body, ''));
  value text;
  plain text;
begin
  select * into message from public.one_messages where key = target_key;
  if not found then
    return jsonb_build_object('code', 'not_found');
  end if;
  if char_length(body) < 10 or char_length(body) > 1000 then
    return jsonb_build_object('code', 'size');
  end if;
  foreach value in array message.required loop
    if strpos(body, '{' || value || '}') = 0 then
      return jsonb_build_object('code', 'missing_value', 'value', value);
    end if;
  end loop;
  for value in select m[1] from regexp_matches(body, '\{([^}]*)\}', 'g') as m loop
    if not (value = any (message.required) or value = any (message.optional)) then
      return jsonb_build_object('code', 'unknown_value', 'value', value);
    end if;
  end loop;
  if body ~ '[—–!]' then
    return jsonb_build_object('code', 'copy_rules');
  end if;
  plain := translate(lower(body), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc');
  if plain ~ '(garant|com certeza|certeza de ganhar|vai ganhar|vai receber|indenizacao certa|sem risco|100 ?%|causa ganha)' then
    return jsonb_build_object('code', 'promise');
  end if;
  return null;
end;
$$;

revoke all on function public.firm_message_problem(text, text) from public, anon;
grant execute on function public.firm_message_problem(text, text) to authenticated;

/**
 * Who decides for the firm writes its version of a message (0191): checked, kept as the next version and put in force;
 * never a support visit, on the record.
 */
create or replace function public.save_firm_message(target_org uuid, target_key text, target_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  problem jsonb;
  next_version integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.decides_for_firm(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  problem := public.firm_message_problem(target_key, target_body);
  if problem is not null then
    return jsonb_build_object('ok', false) || problem;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('firm_message:' || target_org::text || ':' || target_key, 0));
  select coalesce(max(version), 0) + 1 into next_version
  from public.firm_message_texts where org_id = target_org and key = target_key;
  update public.firm_message_texts set active = false where org_id = target_org and key = target_key and active;
  insert into public.firm_message_texts (org_id, key, version, body, written_by)
  values (target_org, target_key, next_version, btrim(target_body), auth.uid());
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'firm_message.saved', 'organization', target_org::text,
          jsonb_build_object('key', target_key, 'version', next_version));
  return jsonb_build_object('ok', true, 'code', 'saved', 'version', next_version);
end;
$$;

revoke all on function public.save_firm_message(uuid, text, text) from public, anon;
grant execute on function public.save_firm_message(uuid, text, text) to authenticated;

/** Who decides for the firm goes back to ONE's words of a message (0191): its versions stay, none in force. */
create or replace function public.reset_firm_message(target_org uuid, target_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.decides_for_firm(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  update public.firm_message_texts set active = false where org_id = target_org and key = target_key and active;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'firm_message.reset', 'organization', target_org::text, jsonb_build_object('key', target_key));
  return jsonb_build_object('ok', true, 'code', 'reset');
end;
$$;

revoke all on function public.reset_firm_message(uuid, text) from public, anon;
grant execute on function public.reset_firm_message(uuid, text) to authenticated;

/** A version the firm wrote before is put back in force (0191). */
create or replace function public.restore_firm_message(target_org uuid, target_key text, target_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  kept public.firm_message_texts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.decides_for_firm(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  select * into kept from public.firm_message_texts
  where org_id = target_org and key = target_key and version = target_version;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  -- A version written before the checks it fails now is never put back.
  if public.firm_message_problem(target_key, kept.body) is not null then
    return jsonb_build_object('ok', false, 'code', 'no_longer_passes');
  end if;
  update public.firm_message_texts set active = false where org_id = target_org and key = target_key and active;
  update public.firm_message_texts set active = true where id = kept.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'firm_message.restored', 'organization', target_org::text,
          jsonb_build_object('key', target_key, 'version', target_version));
  return jsonb_build_object('ok', true, 'code', 'restored');
end;
$$;

revoke all on function public.restore_firm_message(uuid, text, integer) from public, anon;
grant execute on function public.restore_firm_message(uuid, text, integer) to authenticated;
