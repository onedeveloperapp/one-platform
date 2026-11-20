-- ============================================================
-- 0263_filing_ways: how a firm and each of its lawyers file on a court's
-- screen, the lawyer's court login kept by ONE, and the lawyer's browser
-- extension linked to their account.
--
-- The owner, on 2026-11-20 (root CLAUDE.md, "Three ways to file"), accepting
-- the risk in TJGO, TJRJ and TJSP: a lawsuit goes on the court's own screen
-- (1) from ONE's own browser with the lawyer's court login, the lawyer
-- approving each batch and typing the court's code through ONE when the
-- court asks it; (2) through the extension, in the session the lawyer opened
-- with their own login, ONE filling and sending the batch they confirm; or
-- (3) by hand, with ONE's package and guide. What the firm and each lawyer
-- decide of it is asked in their setups (the canvas the owner approved the
-- same day), never left to the settings. So:
--
--   court_screen_systems  the court systems ONE may work on, as the
--                         platform's data: the court, the system, the host
--                         its screens answer at, how its login asks the
--                         second factor, which of the two automated ways
--                         the platform turned on there (only once the
--                         court's written rules were read: TJSP and TJGO
--                         now, TJRJ once its Aviso Normativo Conjunto
--                         TJ/CGJ 19/2026 is read), and the rule read, quoted.
--   firm_filing_ways      the firm's way, decided by who decides for the
--                         firm with the second factor: the most automated
--                         way any lawyer of it may choose. An automated way
--                         carries the firm's acknowledgment of the risk, a
--                         text of `consent_terms` ('protocolo-escritorio').
--   lawyer_filing_ways    each lawyer's way at each system, their own act
--                         with the second factor: the firm's or a less
--                         automated one, an automated one with the lawyer's
--                         own acknowledgment ('protocolo-advogado'). Leaving
--                         the first way ends the court login kept for it.
--   connections 'court.*' the lawyer's court login, kept as the cloud
--                         signature is (0041): a connection of that person,
--                         sealed in the vault, started only by the lawyer for
--                         themself with the second factor (`begin_court_login`,
--                         after choosing the first way), never read by the
--                         vault's general read (0041 refuses every person's
--                         connection there), opened only for a batch the
--                         lawyer approved (0264), ended at once by the
--                         lawyer, a partner or who manages the firm, by the
--                         lawyer leaving or ceasing to be a lawyer of the
--                         firm, and when the court refuses it. Never a second
--                         factor's seed nor a certificate: the court's code is
--                         asked of the lawyer at each batch. A key retired from
--                         `VAULT_KEYS` ends the logins it sealed (they are not
--                         rewrapped, 0041): the lawyers enter them again.
--   extension_links       the lawyer's extension linked to their account by a
--                         code ONE shows them (its hash kept ten minutes), and
--                         from then on known by a token whose hash alone is
--                         kept; ended by the lawyer, a partner or who manages
--                         the firm, and by the lawyer leaving.
-- ============================================================

-- ---------- The court systems ONE may work on ----------

create table public.court_screen_systems (
  key text primary key,
  court text not null,
  system text not null,
  host text not null unique,
  name text not null,
  -- password_app    login and password, then the six digits of an authenticator app;
  -- password_email  login and password, then a code the court sends to the lawyer's e-mail.
  login_kind text not null,
  -- The automated ways the platform turned on at this system: 'browser' (ONE's own browser with the lawyer's
  -- login) and 'extension' (the lawyer's own session). None until the court's written rules were read.
  ways text[] not null default '{}',
  rule_note text,
  rule_read_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (court, system),
  constraint court_screen_systems_key_check check (key ~ '^[a-z][a-z0-9-]{2,39}$'),
  constraint court_screen_systems_court_check check (court ~ '^[A-Z]{2,8}$'),
  constraint court_screen_systems_system_check check (system in ('projudi', 'eproc', 'pje', 'esaj')),
  constraint court_screen_systems_host_check check (host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  constraint court_screen_systems_name_check check (char_length(btrim(name)) between 3 and 80),
  constraint court_screen_systems_login_check check (login_kind in ('password_app', 'password_email')),
  constraint court_screen_systems_ways_check check (ways <@ array['browser', 'extension']::text[]),
  constraint court_screen_systems_rule_check check (rule_note is null or char_length(rule_note) <= 1000)
);

alter table public.court_screen_systems enable row level security;
create policy "court_screen_systems_select" on public.court_screen_systems
  for select to authenticated using (true);
revoke all on table public.court_screen_systems from public, anon, authenticated;
grant select on table public.court_screen_systems to authenticated;
create trigger court_screen_systems_updated_at
  before update on public.court_screen_systems
  for each row execute function public.set_updated_at();

insert into public.court_screen_systems (key, court, system, host, name, login_kind, ways, rule_note, rule_read_on) values
  ('eproc-tjsp', 'TJSP', 'eproc', 'eproc1g.tjsp.jus.br', 'eproc do TJSP', 'password_app', array['browser', 'extension'],
   'Resolução TJSP 963/2025, art. 18, I: o usuário deve "resguardar o sigilo de suas credenciais de acesso"; arts. 37 e 38: o uso inadequado leva ao "bloqueio preventivo do usuário, temporário e total", comunicado à OAB.',
   '2026-11-20'),
  ('projudi-tjgo', 'TJGO', 'projudi', 'projudi.tjgo.jus.br', 'Projudi do TJGO', 'password_email', array['browser', 'extension'],
   'Resolução TJGO 59/2016, art. 11: a senha de acesso ao sistema é "de seu uso pessoal e intransferível".',
   '2026-11-18'),
  ('eproc-tjrj', 'TJRJ', 'eproc', 'eproc1g.tjrj.jus.br', 'eproc do TJRJ', 'password_app', '{}',
   'Ato Normativo TJ 9/2010: as credenciais são pessoais e intransferíveis. O Aviso Normativo Conjunto TJ/CGJ 19/2026, sobre o uso do eproc, ainda não foi lido.',
   '2026-11-18');

/** How automated a way is: the firm's way is the most a lawyer of it may choose. Internal. */
create or replace function public.filing_way_rank(target_way text)
returns integer
language sql
immutable
as $$
  select case target_way when 'browser' then 3 when 'extension' then 2 when 'hand' then 1 else 0 end;
$$;

-- ---------- What the firm and the lawyer acknowledge ----------

insert into public.consent_terms (slug, version, title, body_md, is_active) values
  ('protocolo-escritorio', 1, 'Protocolo automático nos tribunais: o que o escritório assume',
   $md$O escritório escolhe que o ONE protocole as ações na tela do próprio tribunal, com o acesso de cada advogado que concordar: pelo navegador do ONE, com o login que o advogado informar, ou pela extensão no navegador do advogado, na sessão que ele mesmo abrir.

O escritório está ciente de que:

- os tribunais dizem que as credenciais de acesso são do advogado e pedem o sigilo delas (TJGO, Resolução 59/2016, art. 11; TJRJ, Ato Normativo 9/2010; TJSP, Resolução 963/2025, art. 18, I);
- um tribunal pode limitar ou bloquear o acesso de um advogado por rotinas automatizadas (Portaria da Presidência do CNJ 316/2024, art. 9), e o TJSP prevê o bloqueio temporário e total, comunicado à OAB (Resolução 963/2025, arts. 37 e 38);
- se um acesso for bloqueado, o ONE passa aquele advogado para a forma seguinte, e nenhuma ação é enviada duas vezes;
- o ONE nunca contorna as proteções do tribunal: não resolve captcha, não esconde quem acessa e nunca guarda o segredo do aplicativo de segundo fator.

O escritório assume esse risco.$md$, true),
  ('protocolo-advogado', 1, 'Protocolo automático com o meu acesso: o que eu assumo',
   $md$Eu autorizo o ONE a protocolar as ações em que assino na tela do tribunal escolhido: pelo navegador do ONE, com o login que eu informar, ou pela extensão no meu navegador, na sessão que eu mesmo abrir.

Estou ciente de que:

- o acesso é meu, e o tribunal pede o sigilo das minhas credenciais (TJGO, Resolução 59/2016, art. 11; TJRJ, Ato Normativo 9/2010; TJSP, Resolução 963/2025, art. 18, I);
- o tribunal pode limitar ou bloquear o meu acesso por rotinas automatizadas (Portaria da Presidência do CNJ 316/2024, art. 9), e o TJSP prevê o bloqueio temporário e total, comunicado à OAB (Resolução 963/2025, arts. 37 e 38);
- cada lote só é protocolado depois da minha aprovação, e o código do meu aplicativo é pedido a mim na hora, nunca guardado;
- a senha fica lacrada no cofre do ONE, só para protocolar, e eu a tiro de lá quando quiser.

Eu assumo esse risco.$md$, true);

/** The text in force of a filing acknowledgment ('protocolo-escritorio' or 'protocolo-advogado'). Internal. */
create or replace function public.filing_term_in_force(target_slug text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.id from public.consent_terms t
  where t.slug = target_slug and t.locale = 'pt-BR' and t.is_active
  order by t.version desc limit 1;
$$;

-- The screens show the text in force and send its id back with the acknowledgment (active texts are public).
revoke all on function public.filing_term_in_force(text) from public, anon;
grant execute on function public.filing_term_in_force(text) to authenticated;

-- ---------- The firm's way ----------

create table public.firm_filing_ways (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  way text not null,
  term_id uuid references public.consent_terms (id),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz not null default now(),
  constraint firm_filing_ways_way_check check (way in ('browser', 'extension', 'hand')),
  constraint firm_filing_ways_term_check check (way = 'hand' or term_id is not null)
);

alter table public.firm_filing_ways enable row level security;
create policy "firm_filing_ways_select_member" on public.firm_filing_ways
  for select to authenticated using (public.is_org_member(org_id));
revoke all on table public.firm_filing_ways from public, anon, authenticated;
grant select on table public.firm_filing_ways to authenticated;
create trigger guard_impersonation_firm_filing_ways after insert or update or delete on public.firm_filing_ways
  for each statement execute function public.guard_impersonation_readonly();

/**
 * Who decides for the firm sets its way, with the second factor: an automated
 * way only with the firm's acknowledgment in force. A lawyer whose way is now
 * more automated than the firm's goes down to it (and a login kept for the
 * first way ends).
 */
create or replace function public.set_firm_filing_way(target_org uuid, target_way text, target_term uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  term uuid;
  lowered record;
begin
  if caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_impersonated() then
    raise exception 'impersonated' using errcode = '42501';
  end if;
  if not public.decides_for_firm(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if target_way is null or target_way not in ('browser', 'extension', 'hand') then
    return jsonb_build_object('ok', false, 'code', 'invalid_way');
  end if;
  if target_way <> 'hand' then
    term := public.filing_term_in_force('protocolo-escritorio');
    if term is null or target_term is distinct from term then
      return jsonb_build_object('ok', false, 'code', 'term_not_accepted');
    end if;
  end if;

  insert into public.firm_filing_ways (org_id, way, term_id, decided_by, decided_at)
  values (target_org, target_way, case when target_way = 'hand' then null else term end, caller, now())
  on conflict (org_id) do update set
    way = excluded.way, term_id = excluded.term_id, decided_by = excluded.decided_by, decided_at = excluded.decided_at;

  for lowered in
    select w.user_id, w.system_key, w.way from public.lawyer_filing_ways w
    where w.org_id = target_org and public.filing_way_rank(w.way) > public.filing_way_rank(target_way)
    for update
  loop
    update public.lawyer_filing_ways set
      way = target_way,
      term_id = case when target_way = 'hand' then null else term_id end,
      decided_at = now()
    where org_id = target_org and user_id = lowered.user_id and system_key = lowered.system_key;
    if lowered.way = 'browser' then
      perform public.discard_court_login(target_org, lowered.user_id, lowered.system_key, 'firm_way');
    end if;
  end loop;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'filing_way.firm_set', 'organization', target_org::text,
          jsonb_build_object('way', target_way, 'term', term));
  return jsonb_build_object('ok', true, 'code', 'saved', 'way', target_way);
end;
$$;

-- ---------- Each lawyer's way at each system ----------

create table public.lawyer_filing_ways (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  system_key text not null references public.court_screen_systems (key) on update cascade,
  way text not null,
  term_id uuid references public.consent_terms (id),
  decided_at timestamptz not null default now(),
  primary key (org_id, user_id, system_key),
  constraint lawyer_filing_ways_way_check check (way in ('browser', 'extension', 'hand')),
  constraint lawyer_filing_ways_term_check check (way = 'hand' or term_id is not null)
);

alter table public.lawyer_filing_ways enable row level security;
-- The team knows how each lawyer files (a case says it); only the lawyer chooses it.
create policy "lawyer_filing_ways_select_member" on public.lawyer_filing_ways
  for select to authenticated using (public.is_org_member(org_id));
revoke all on table public.lawyer_filing_ways from public, anon, authenticated;
grant select on table public.lawyer_filing_ways to authenticated;
create trigger guard_impersonation_lawyer_filing_ways after insert or update or delete on public.lawyer_filing_ways
  for each statement execute function public.guard_impersonation_readonly();

/**
 * The lawyer's own way at a system, with the second factor: one the platform
 * turned on there (or by hand), no more automated than the firm's, and an
 * automated one with the lawyer's acknowledgment in force. Leaving the first
 * way discards the court login kept for it.
 */
create or replace function public.set_lawyer_filing_way(
  target_org uuid,
  target_system text,
  target_way text,
  target_term uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  sys public.court_screen_systems%rowtype;
  firm_way text;
  term uuid;
  before text;
begin
  if caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_impersonated() then
    raise exception 'impersonated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = caller and m.firm_function in ('socio', 'advogado')
  ) then
    raise exception 'not_a_lawyer' using errcode = '42501';
  end if;
  perform public.require_aal2();
  select * into sys from public.court_screen_systems where key = target_system;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_system');
  end if;
  if target_way is null or target_way not in ('browser', 'extension', 'hand') then
    return jsonb_build_object('ok', false, 'code', 'invalid_way');
  end if;
  if target_way <> 'hand' and not (target_way = any (sys.ways)) then
    return jsonb_build_object('ok', false, 'code', 'way_not_offered');
  end if;
  select w.way into firm_way from public.firm_filing_ways w where w.org_id = target_org;
  if public.filing_way_rank(target_way) > public.filing_way_rank(coalesce(firm_way, 'browser')) then
    return jsonb_build_object('ok', false, 'code', 'beyond_firm_way');
  end if;
  if target_way <> 'hand' then
    term := public.filing_term_in_force('protocolo-advogado');
    if term is null or target_term is distinct from term then
      return jsonb_build_object('ok', false, 'code', 'term_not_accepted');
    end if;
  end if;

  select w.way into before from public.lawyer_filing_ways w
  where w.org_id = target_org and w.user_id = caller and w.system_key = target_system
  for update;

  insert into public.lawyer_filing_ways (org_id, user_id, system_key, way, term_id, decided_at)
  values (target_org, caller, target_system, target_way, case when target_way = 'hand' then null else term end, now())
  on conflict (org_id, user_id, system_key) do update set
    way = excluded.way, term_id = excluded.term_id, decided_at = excluded.decided_at;

  if before = 'browser' and target_way <> 'browser' then
    perform public.discard_court_login(target_org, caller, target_system, 'way_changed');
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'filing_way.lawyer_set', 'profile', caller::text,
          jsonb_build_object('system', target_system, 'way', target_way, 'term', term));
  return jsonb_build_object('ok', true, 'code', 'saved', 'way', target_way);
end;
$$;

-- ---------- The lawyer's court login ----------

-- A PSC's authorization (0041) and a court login are a person's, keyed by that person; no other connection is.
alter table public.connections drop constraint connections_person_check;
alter table public.connections add constraint connections_person_check check (
  case
    when provider ~ '^psc[.]' or provider ~ '^court[.]' then person_id is not null and external_id = person_id::text
    else person_id is null
  end
);

/**
 * As in 0041, and a court login is in force only while its holder is a
 * partner or a lawyer of the firm, at a system the platform knows, with no end
 * of its own (the court ends it by refusing it). A PSC's authorization keeps
 * every rule of 0041.
 */
create or replace function public.connections_guard_person()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (old.person_id is not null or new.person_id is not null) and (
    new.person_id is distinct from old.person_id
    or new.org_id is distinct from old.org_id
    or new.provider is distinct from old.provider
    or new.external_id is distinct from old.external_id
  ) then
    raise exception 'lawyer_signature_identity' using errcode = '23514';
  end if;
  if new.person_id is null or new.status not in ('connected', 'error') then
    return new;
  end if;
  if new.provider ~ '^court[.]' then
    if not exists (select 1 from public.court_screen_systems s where 'court.' || s.key = new.provider) then
      raise exception 'court_login_unknown_system' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.memberships m
      where m.org_id = new.org_id and m.user_id = new.person_id and m.firm_function in ('socio', 'advogado')
    ) then
      raise exception 'court_login_not_a_lawyer' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.expires_at is null or new.expires_at > now() + interval '7 days 10 minutes' then
    raise exception 'lawyer_signature_without_end' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.org_id = new.org_id and m.user_id = new.person_id and m.firm_function in ('socio', 'advogado')
  ) then
    raise exception 'lawyer_signature_not_a_lawyer' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.lawyer_cpfs l
    where l.user_id = new.person_id and substr(l.cpf, 4, 6) = new.metadata ->> 'holder_cpf_middle'
  ) then
    raise exception 'lawyer_signature_other_holder' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.connections_guard_person() from public, anon, authenticated;

/**
 * The lawyer starts handing ONE their login at a system: the connection the
 * backend seals it under, at once, in the same request (the login never waits
 * in the clear anywhere). Their own act, for themself, with the second factor,
 * never from a support visit, once their way there is the first one. The hint
 * is what the screens show of the login (a CPF with its middle hidden), never
 * the login whole. Starting again reuses the row: the login in force goes on
 * until the new one is sealed.
 */
create or replace function public.begin_court_login(target_org uuid, target_system text, target_hint text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  sys public.court_screen_systems%rowtype;
  existing public.connections%rowtype;
  connection uuid;
  hint text := nullif(btrim(coalesce(target_hint, '')), '');
begin
  if caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_impersonated() then
    raise exception 'impersonated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = caller and m.firm_function in ('socio', 'advogado')
  ) then
    raise exception 'not_a_lawyer' using errcode = '42501';
  end if;
  perform public.require_aal2();
  select * into sys from public.court_screen_systems where key = target_system;
  if not found or not ('browser' = any (sys.ways)) then
    return jsonb_build_object('ok', false, 'code', 'way_not_offered');
  end if;
  if not exists (
    select 1 from public.lawyer_filing_ways w
    where w.org_id = target_org and w.user_id = caller and w.system_key = target_system and w.way = 'browser'
  ) then
    return jsonb_build_object('ok', false, 'code', 'way_not_chosen');
  end if;
  if hint is null or char_length(hint) > 40 or hint ~ '\d{6}' then
    return jsonb_build_object('ok', false, 'code', 'invalid_hint');
  end if;

  select * into existing from public.connections
  where org_id = target_org and provider = 'court.' || target_system and external_id = caller::text
  for update;
  if found then
    update public.connections set
      status = case when existing.status in ('connected', 'error') then existing.status else 'pending' end,
      label = sys.name,
      disconnected_by = null,
      disconnected_at = null,
      connected_by = caller,
      metadata = existing.metadata || jsonb_build_object('login_hint', hint)
    where id = existing.id;
    connection := existing.id;
  else
    insert into public.connections (org_id, provider, external_id, label, connected_by, person_id, metadata)
    values (target_org, 'court.' || target_system, caller::text, sys.name, caller, caller,
            jsonb_build_object('login_hint', hint))
    returning id into connection;
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'court_login.begun', 'connection', connection::text,
          jsonb_build_object('system', target_system));
  return jsonb_build_object('ok', true, 'code', 'begun', 'connection_id', connection);
end;
$$;

/**
 * Ends a lawyer's court login: its seal discarded at once. Internal: by the
 * lawyer's word, the firm's, a way that left the first one, the lawyer
 * leaving, or the court refusing it.
 */
create or replace function public.discard_court_login(target_org uuid, target_person uuid, target_system text, target_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  conn record;
begin
  for conn in
    select c.id from public.connections c
    where c.org_id = target_org and c.person_id = target_person and c.provider = 'court.' || target_system
      and c.status <> 'disconnected'
    for update
  loop
    delete from public.connection_secrets where connection_id = conn.id;
    update public.connections set
      status = 'disconnected',
      disconnected_by = case when target_reason in ('by_lawyer', 'by_firm') then auth.uid() end,
      disconnected_at = now(),
      last_error = null
    where id = conn.id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, auth.uid(), 'court_login.ended', 'connection', conn.id::text,
            jsonb_build_object('system', target_system, 'reason', target_reason));
  end loop;
end;
$$;

revoke all on function public.discard_court_login(uuid, uuid, text, text) from public, anon, authenticated;

/**
 * The lawyer, a partner or who manages the firm takes a court login out of
 * ONE. No second factor: taking power away is never blocked.
 */
create or replace function public.end_court_login(target_connection uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  conn public.connections%rowtype;
begin
  if caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_impersonated() then
    raise exception 'impersonated' using errcode = '42501';
  end if;
  select * into conn from public.connections where id = target_connection;
  if not found or conn.provider !~ '^court[.]' or not public.is_org_member(conn.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if conn.person_id <> caller
     and not public.has_firm_function(conn.org_id, array['socio']::public.firm_function[])
     and not public.has_org_role(conn.org_id, array['owner', 'admin']::public.org_role[]) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.discard_court_login(conn.org_id, conn.person_id, substr(conn.provider, 7),
    case when conn.person_id = caller then 'by_lawyer' else 'by_firm' end);
  return jsonb_build_object('ok', true, 'code', 'ended');
end;
$$;

/**
 * What the backend found when it entered the court with a login (service
 * role): `verified` marks it checked by the court; `refused` (the court said
 * the login or the password is wrong) and `blocked` (the court blocked the
 * account) end it at once, since a wrong password tried again may block the
 * lawyer's account. Nothing of the court's own words is kept.
 */
create or replace function public.court_login_checked(target_org uuid, target_connection uuid, target_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conn public.connections%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_outcome is null or target_outcome not in ('verified', 'refused', 'blocked') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  select * into conn from public.connections where id = target_connection and org_id = target_org for update;
  if not found or conn.provider !~ '^court[.]' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if target_outcome = 'verified' then
    if conn.status not in ('connected', 'error') then
      return jsonb_build_object('ok', false, 'code', conn.status);
    end if;
    update public.connections set
      status = 'connected',
      last_error = null,
      last_used_at = now(),
      metadata = metadata || jsonb_build_object('verified_at', now())
    where id = conn.id;
  else
    perform public.discard_court_login(conn.org_id, conn.person_id, substr(conn.provider, 7),
      case target_outcome when 'refused' then 'court_refused' else 'court_blocked' end);
    update public.connections set last_error = 'court_' || target_outcome where id = conn.id;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (conn.org_id, null, 'court_login.checked', 'connection', conn.id::text,
          jsonb_build_object('system', substr(conn.provider, 7), 'outcome', target_outcome));
  return jsonb_build_object('ok', true, 'code', target_outcome);
end;
$$;

/**
 * As in 0041: a person leaving the firm, or ceasing to be a partner or a
 * lawyer of it, ends every connection of theirs there at once, its seal
 * discarded; a court login is recorded as such.
 */
create or replace function public.memberships_end_lawyer_signatures()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conn record;
begin
  if not exists (select 1 from public.organizations o where o.id = old.org_id)
     or not exists (select 1 from public.profiles p where p.id = old.user_id) then
    return null;
  end if;
  for conn in
    select c.id, c.provider from public.connections c
    where c.org_id = old.org_id and c.person_id = old.user_id and c.status <> 'disconnected'
    order by c.id
    for update
  loop
    delete from public.connection_secrets where connection_id = conn.id;
    update public.connections set
      status = 'disconnected',
      disconnected_by = null,
      disconnected_at = now(),
      last_error = null
    where id = conn.id;
    if conn.provider ~ '^court[.]' then
      insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
      values (old.org_id, null, 'court_login.ended', 'connection', conn.id::text,
              jsonb_build_object('system', substr(conn.provider, 7),
                                 'reason', case when tg_op = 'DELETE' then 'left_firm' else 'function_changed' end));
    else
      insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
      values (old.org_id, null, 'lawyer_signature.ended', 'connection', conn.id::text,
              jsonb_build_object('psc', substr(conn.provider, 5),
                                 'reason', case when tg_op = 'DELETE' then 'left_firm' else 'function_changed' end));
    end if;
  end loop;
  update public.extension_links set
    ended_at = now(), end_reason = case when tg_op = 'DELETE' then 'left_firm' else 'function_changed' end
  where org_id = old.org_id and user_id = old.user_id and ended_at is null;
  return null;
end;
$$;

revoke all on function public.memberships_end_lawyer_signatures() from public, anon, authenticated;

-- ---------- The lawyer's extension, linked to their account ----------

create table public.extension_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- While linking: the SHA-256 of the code ONE showed the lawyer, for ten minutes.
  code_hash text unique,
  code_expires_at timestamptz,
  -- Once linked: the SHA-256 of the token the extension holds. The token itself is never kept.
  token_hash text unique,
  label text,
  created_at timestamptz not null default now(),
  linked_at timestamptz,
  last_seen_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  end_reason text,
  unique (id, org_id),
  constraint extension_links_code_check check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
  constraint extension_links_token_check check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  constraint extension_links_state_check check (
    (linked_at is null and token_hash is null) or (linked_at is not null and token_hash is not null and code_hash is null)),
  constraint extension_links_label_check check (label is null or char_length(label) <= 80),
  constraint extension_links_reason_check check (
    end_reason is null or end_reason in ('by_lawyer', 'by_firm', 'replaced', 'left_firm', 'function_changed'))
);

create index extension_links_user_idx on public.extension_links (org_id, user_id) where ended_at is null;

alter table public.extension_links enable row level security;
create policy "extension_links_select" on public.extension_links
  for select to authenticated
  using (
    public.is_org_member(org_id)
    and (user_id = auth.uid()
         or public.has_firm_function(org_id, array['socio']::public.firm_function[])
         or public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
  );
revoke all on table public.extension_links from public, anon, authenticated;
grant select (id, org_id, user_id, label, created_at, linked_at, last_seen_at, ended_at, end_reason, code_expires_at)
  on public.extension_links to authenticated;
create trigger guard_impersonation_extension_links after insert or update or delete on public.extension_links
  for each statement execute function public.guard_impersonation_readonly();

/**
 * The lawyer asks to link their extension: ONE shows them a code, whose hash
 * alone comes here, valid ten minutes. Their own act, with the second factor,
 * once their way at some system is the extension's. A code asked before and
 * never used is dropped.
 */
create or replace function public.begin_extension_link(target_org uuid, target_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  link uuid;
begin
  if caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_impersonated() then
    raise exception 'impersonated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = caller and m.firm_function in ('socio', 'advogado')
  ) then
    raise exception 'not_a_lawyer' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if target_code_hash is null or target_code_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_code');
  end if;
  if not exists (
    select 1 from public.lawyer_filing_ways w
    where w.org_id = target_org and w.user_id = caller and w.way = 'extension'
  ) then
    return jsonb_build_object('ok', false, 'code', 'way_not_chosen');
  end if;
  delete from public.extension_links where org_id = target_org and user_id = caller and linked_at is null;
  insert into public.extension_links (org_id, user_id, code_hash, code_expires_at)
  values (target_org, caller, target_code_hash, now() + interval '10 minutes')
  returning id into link;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'extension_link.begun', 'extension_link', link::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'code', 'begun', 'link_id', link);
end;
$$;

/**
 * The extension hands in the code (the backend, service role, with the hash
 * of the code and of a new token): a code in its ten minutes links once, and
 * the lawyer's link before it ends. Nothing tells a wrong code from an
 * expired one.
 */
create or replace function public.claim_extension_link(target_code_hash text, target_token_hash text, target_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.extension_links%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_code_hash is null or target_code_hash !~ '^[0-9a-f]{64}$'
     or target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select * into link from public.extension_links
  where code_hash = target_code_hash and linked_at is null and ended_at is null and code_expires_at > now()
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.org_id = link.org_id and m.user_id = link.user_id and m.firm_function in ('socio', 'advogado')
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  update public.extension_links set ended_at = now(), end_reason = 'replaced'
  where org_id = link.org_id and user_id = link.user_id and linked_at is not null and ended_at is null;
  update public.extension_links set
    code_hash = null, code_expires_at = null, token_hash = target_token_hash, linked_at = now(), last_seen_at = now(),
    label = left(nullif(btrim(coalesce(target_label, '')), ''), 80)
  where id = link.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (link.org_id, null, 'extension_link.linked', 'extension_link', link.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'code', 'linked', 'link_id', link.id, 'org_id', link.org_id, 'user_id', link.user_id);
end;
$$;

/**
 * Who an extension's token is (service role): the link in force, its firm and
 * its lawyer, while the lawyer is still a partner or a lawyer of the firm.
 */
create or replace function public.extension_link_of(target_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.extension_links%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select * into link from public.extension_links
  where token_hash = target_token_hash and ended_at is null;
  if not found or not exists (
    select 1 from public.memberships m
    where m.org_id = link.org_id and m.user_id = link.user_id and m.firm_function in ('socio', 'advogado')
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  update public.extension_links set last_seen_at = now()
  where id = link.id and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
  return jsonb_build_object('ok', true, 'link_id', link.id, 'org_id', link.org_id, 'user_id', link.user_id);
end;
$$;

/** The lawyer, a partner or who manages the firm ends an extension's link. */
create or replace function public.end_extension_link(target_link uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  link public.extension_links%rowtype;
begin
  if caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_impersonated() then
    raise exception 'impersonated' using errcode = '42501';
  end if;
  select * into link from public.extension_links where id = target_link for update;
  if not found or not public.is_org_member(link.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if link.user_id <> caller
     and not public.has_firm_function(link.org_id, array['socio']::public.firm_function[])
     and not public.has_org_role(link.org_id, array['owner', 'admin']::public.org_role[]) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if link.ended_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_ended');
  end if;
  update public.extension_links set
    ended_at = now(), ended_by = caller,
    end_reason = case when link.user_id = caller then 'by_lawyer' else 'by_firm' end,
    code_hash = null, code_expires_at = null
  where id = link.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (link.org_id, caller, 'extension_link.ended', 'extension_link', link.id::text,
          jsonb_build_object('reason', case when link.user_id = caller then 'by_lawyer' else 'by_firm' end));
  return jsonb_build_object('ok', true, 'code', 'ended');
end;
$$;

-- ---------- Grants ----------

revoke all on function public.filing_way_rank(text) from public, anon;
grant execute on function public.filing_way_rank(text) to authenticated;
revoke all on function public.set_firm_filing_way(uuid, text, uuid) from public, anon;
grant execute on function public.set_firm_filing_way(uuid, text, uuid) to authenticated;
revoke all on function public.set_lawyer_filing_way(uuid, text, text, uuid) from public, anon;
grant execute on function public.set_lawyer_filing_way(uuid, text, text, uuid) to authenticated;
revoke all on function public.begin_court_login(uuid, text, text) from public, anon;
grant execute on function public.begin_court_login(uuid, text, text) to authenticated;
revoke all on function public.end_court_login(uuid) from public, anon;
grant execute on function public.end_court_login(uuid) to authenticated;
revoke all on function public.court_login_checked(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.begin_extension_link(uuid, text) from public, anon;
grant execute on function public.begin_extension_link(uuid, text) to authenticated;
revoke all on function public.claim_extension_link(text, text, text) from public, anon, authenticated;
revoke all on function public.extension_link_of(text) from public, anon, authenticated;
revoke all on function public.end_extension_link(uuid) from public, anon;
grant execute on function public.end_extension_link(uuid) to authenticated;
