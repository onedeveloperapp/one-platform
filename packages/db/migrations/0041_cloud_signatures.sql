-- ============================================================
-- 0041_cloud_signatures: a lawyer's signature in the cloud, kept by ONE
-- under rules of its own.
--
-- The owner decided on 2026-10-14 that ONE keeps what an automation of its
-- own needs of a lawyer's credentials, and on 2026-10-15 that what needs no
-- court's authorization is built first. The first such thing is the
-- lawyer's signature: their ICP-Brasil certificate kept in the cloud by a
-- PSC (a "Prestador de Serviço de Confiança" the ITI accredited), which
-- signs a hash for an application the holder authorized at the PSC with
-- their own factors (DOC-ICP-17.01; `@flyee/psc`). ONE never sees those
-- factors nor the key. What it keeps is the authorization the PSC hands
-- back: the token of a signature session, which lives what the lawyer chose
-- and at most the 7 days the norm gives a natural person, with no refresh.
-- It is sealed in the vault of 0017 like a vendor's token, under these
-- rules:
--
--   - it is the lawyer's own act, and of the lawyer's own certificate: only
--     the holder starts it, for themself, as a partner or a lawyer of the
--     firm, with the second factor, never from a support visit
--     (`begin_lawyer_signature`), once they declared their CPF
--     (`declare_lawyer_cpf`), and it comes into force only for a
--     certificate of that CPF (the backend reads the certificate; the
--     database holds the middle of its CPF against the declared one). A
--     connection of a person (`connections.person_id`) is always one of
--     these, one of these is always a person's, and it never passes to
--     another person, firm or PSC;
--   - it is in force only while the person is a partner or a lawyer of the
--     firm, and only with its end, at most 7 days away (a trigger on
--     `connections`, whatever writes it);
--   - it is opened only for a use declared first (`lawyer_signature_open`):
--     what it is for, the case, and the SHA-256 of every document to be
--     signed, kept in `lawyer_signature_uses` with what came of it
--     (`lawyer_signature_finish`), read by the lawyer, the firm's partners
--     and who manages the firm. A use is bound to what it says: the test of
--     an authorization that just arrived signs one text, once; the files of
--     a filing package are those very files, of a lawsuit the lawyer signs.
--     The vault's general read never hands it out, not even to the key's
--     rotation (`vault_read_secret` and `vault_rewrap_pending`, redefined
--     below): it lives 7 days at most, so a key retired from `VAULT_KEYS`
--     stays listed 7 days after a rotation, or the lawyers authorize again;
--   - it ends by the lawyer's word, a partner's or that of who manages the
--     firm, with no second factor, since taking power away is never blocked
--     (`end_lawyer_signature`); by itself when the person leaves the firm or
--     stops being a partner or a lawyer of it; when its time ends
--     (`expire_connections`, 0017); when the PSC says it no longer signs;
--     when the PSC no longer shows the certificate authorized, or shows it
--     out of its validity; and when the platform moves the PSC's address.
--     Every time, the token is discarded at once, and what a use signed
--     while it ended is never handed over.
--
--   psc_providers           the PSCs ONE knows, as data: the base address of
--                           each one's API with its version path, how it
--                           departs from the norm, how many hashes one call
--                           takes, and when the platform confirmed it in the
--                           PSC's own test environment (seeded from the
--                           ITI's list of PSCs and the PSCs' manuals, read on
--                           2026-10-14; none confirmed). Changing it asks the
--                           operator's second factor.
--   lawyer_cpfs             the CPF each lawyer declares, read by them alone
--                           and by the backend, so that the certificate they
--                           authorize is theirs; one account's alone once an
--                           authorization of a certificate of it was kept.
--   lawyer_signature_uses   every opening of a lawyer's authorization, with
--                           what was to be signed and what came of it.
-- ============================================================

-- ---------- The PSCs ----------

create table public.psc_providers (
  slug text primary key,
  name text not null,
  -- The base address of the PSC's API with its version path: the client
  -- writes /oauth/authorize, /oauth/token and the rest after it.
  base_url text not null,
  -- How the PSC takes a hash: base64, as the norm says, or hexadecimal.
  hash_encoding text not null default 'base64',
  -- How the token request's body goes: a form, as the norm says, or JSON.
  token_body text not null default 'form',
  -- How many hashes one call to `signature` takes. One where the PSC's own
  -- manual says nothing: more calls, never a call the PSC refuses.
  max_hashes integer not null default 1,
  -- Offered to the firms. The platform also needs its own client at the PSC
  -- (in the server's environment), so a PSC with no client is not offered.
  active boolean not null default true,
  -- When the platform tried the address, the hash and the body in the PSC's
  -- own test environment. NULL: as read, never tried.
  confirmed_at timestamptz,
  -- Where the address was read, and on which day.
  source text not null,
  read_on date not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint psc_providers_slug_check check (slug ~ '^[a-z][a-z0-9]{1,23}$'),
  constraint psc_providers_name_check check (char_length(btrim(name)) between 2 and 80 and name !~ '[[:cntrl:]]'),
  constraint psc_providers_url_check check (
    char_length(base_url) <= 200
    and base_url ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+(/[A-Za-z0-9._~-]+)*$'
  ),
  constraint psc_providers_hash_check check (hash_encoding in ('base64', 'hex')),
  constraint psc_providers_body_check check (token_body in ('form', 'json')),
  constraint psc_providers_max_check check (max_hashes between 1 and 100),
  constraint psc_providers_source_check check (char_length(btrim(source)) between 8 and 400 and source !~ '[[:cntrl:]]')
);

comment on table public.psc_providers is
  'The ICP-Brasil cloud certificate providers (PSCs) ONE can ask a lawyer''s signature of: base address, departures from DOC-ICP-17.01, hashes per call. Platform data, kept by the operator.';

alter table public.psc_providers enable row level security;
create policy "psc_providers_select_member" on public.psc_providers
  for select to authenticated using (true);
grant select on table public.psc_providers to authenticated;

-- From the ITI's list of PSCs (LPSC, the cycle of 09/07/2026 to 05/01/2027)
-- and each PSC's own manual where one is public, read on 2026-10-14. The
-- address is the one the manual uses where it differs from the list
-- (SerproID). BirdID's manual says its hashes go in hexadecimal and shows
-- its token request in JSON; SerproID's takes 5 hashes a call. None was
-- tried yet: the platform confirms each one when it registers as an
-- application at that PSC.
insert into public.psc_providers (slug, name, base_url, hash_encoding, token_body, max_hashes, source, read_on) values
  ('birdid', 'BirdID (Soluti)', 'https://api.birdid.com.br/v0', 'hex', 'json', 1,
   'Manual da API do BirdID (docs.vaultid.com.br/workspace/cloud/api) e a lista de PSCs do ITI', '2026-10-14'),
  ('serproid', 'SerproID (Serpro)', 'https://serproid.serpro.gov.br/oauth/v0', 'base64', 'form', 5,
   'Manual de integração do SerproID (serproid.serpro.gov.br/manual-integracao)', '2026-10-14'),
  ('safeid', 'SafeID (Safeweb)', 'https://pscsafeweb.safewebpss.com.br/Service/Microservice/OAuth/api/v0', 'base64',
   'form', 1, 'Documentação do SafeID (pscsafeweb.safewebpss.com.br/docs) e a lista de PSCs do ITI', '2026-10-14'),
  ('vidaas', 'VIDaaS (Valid)', 'https://certificado.vidaas.com.br/v0', 'base64', 'form', 1,
   'URIs base do Valid PSC no Portal do Desenvolvedor da Valid e a lista de PSCs do ITI', '2026-10-14'),
  ('remoteid', 'RemoteID (Certisign)', 'https://remoteidcertisign.com.br/api/v0', 'base64', 'form', 1,
   'Lista de PSCs do ITI; os caminhos da norma respondem sob /api/v0', '2026-10-14'),
  ('digitalsign', 'DigitalSign', 'https://dscloud.psc.digitalsign.com.br/v0', 'base64', 'form', 1,
   'Lista de PSCs do ITI', '2026-10-14'),
  ('syngularid', 'SyngularID', 'https://psc.syngularid.com.br/v0', 'base64', 'form', 1,
   'Lista de PSCs do ITI', '2026-10-14'),
  ('goldid', 'GoldID (AC Digital)', 'https://goldid.com.br/psc/v0', 'base64', 'form', 1,
   'Lista de PSCs do ITI', '2026-10-14');

/**
 * The operator records what the platform learned of a PSC: its address, how
 * it takes a hash and a token request, how many hashes a call takes, whether
 * it is offered, and that it was tried in the PSC's own test environment. A
 * change of the address, the hash or the body is no longer what was tried,
 * unless the operator says it was tried again. The address is where every
 * lawyer's token of that PSC is sent, so a change asks the operator's second
 * factor here (not only on the console's screen), and a PSC whose address
 * moved, or that is no longer offered, ends every authorization given at it:
 * a token is only ever sent where it was issued.
 */
create or replace function public.admin_save_psc_provider(
  target_slug text,
  target_name text,
  target_base_url text,
  target_hash_encoding text,
  target_token_body text,
  target_max_hashes integer,
  target_active boolean,
  target_confirmed boolean,
  target_source text,
  target_read_on date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  previous public.psc_providers%rowtype;
  existed boolean;
  same boolean;
  moved boolean;
  conn record;
  ended integer := 0;
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();
  select * into previous from public.psc_providers where slug = target_slug for update;
  existed := found;
  same := existed and previous.base_url = target_base_url and previous.hash_encoding = target_hash_encoding
    and previous.token_body = target_token_body;
  moved := existed and (previous.base_url is distinct from target_base_url or not coalesce(target_active, false));
  insert into public.psc_providers as p (
    slug, name, base_url, hash_encoding, token_body, max_hashes, active, confirmed_at, source, read_on, updated_by
  )
  values (
    target_slug, btrim(coalesce(target_name, '')), target_base_url, target_hash_encoding, target_token_body,
    target_max_hashes, coalesce(target_active, false),
    case when coalesce(target_confirmed, false) then now() end,
    btrim(coalesce(target_source, '')), target_read_on, caller
  )
  on conflict (slug) do update set
    name = excluded.name,
    base_url = excluded.base_url,
    hash_encoding = excluded.hash_encoding,
    token_body = excluded.token_body,
    max_hashes = excluded.max_hashes,
    active = excluded.active,
    confirmed_at = case
      when not coalesce(target_confirmed, false) then null
      when same and p.confirmed_at is not null then p.confirmed_at
      else now()
    end,
    source = excluded.source,
    read_on = excluded.read_on,
    updated_by = caller,
    updated_at = now();

  if moved then
    for conn in
      select c.id, c.org_id from public.connections c
      where c.provider = 'psc.' || target_slug and c.status in ('pending', 'connected', 'error')
      order by c.id
      for update
    loop
      delete from public.connection_secrets where connection_id = conn.id;
      update public.connections set status = 'expired', last_error = 'psc_moved' where id = conn.id;
      insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
      values (conn.org_id, null, 'lawyer_signature.ended', 'connection', conn.id::text,
              jsonb_build_object('psc', target_slug, 'reason', 'psc_moved'));
      ended := ended + 1;
    end loop;
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'admin.psc_provider.saved', 'psc_provider', target_slug,
    jsonb_build_object('active', coalesce(target_active, false), 'confirmed', coalesce(target_confirmed, false),
      'address_changed', existed and previous.base_url is distinct from target_base_url,
      'authorizations_ended', ended));
  return jsonb_build_object('ok', true, 'code', 'saved', 'authorizations_ended', ended);
exception when check_violation or not_null_violation then
  return jsonb_build_object('ok', false, 'code', 'invalid_value');
end;
$$;

revoke all on function public.admin_save_psc_provider(text, text, text, text, text, integer, boolean, boolean, text, date)
  from public, anon;
grant execute on function public.admin_save_psc_provider(text, text, text, text, text, integer, boolean, boolean, text, date)
  to authenticated;

-- ---------- The lawyer's CPF ----------

/**
 * The CPF a lawyer declares, so that the certificate they authorize ONE to
 * sign with is theirs: an ICP-Brasil certificate of a person carries its
 * holder's CPF. One per person. A declaration is a person's word until the
 * PSC signs with a certificate of that CPF the person authorized, and the
 * backend checks that signature (`proven_at`, `prove_lawyer_cpf`): only the
 * holder's own factors at the PSC give one. From then on the CPF is that
 * account's alone on the platform; before, a declaration holds the CPF
 * against nobody, so nobody blocks a lawyer by declaring their CPF first, and
 * the first proof takes the CPF from every declaration nothing proved. Read
 * by the person alone, and by the backend; never by anybody else of the
 * firm, who manages it included.
 */
create table public.lawyer_cpfs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  cpf text not null,
  declared_at timestamptz not null default now(),
  proven_at timestamptz,
  constraint lawyer_cpfs_cpf_check check (public.cpf_is_valid(cpf))
);

create unique index lawyer_cpfs_proven_idx on public.lawyer_cpfs (cpf) where proven_at is not null;
create index lawyer_cpfs_cpf_idx on public.lawyer_cpfs (cpf);

alter table public.lawyer_cpfs enable row level security;
create policy "lawyer_cpfs_select_own" on public.lawyer_cpfs
  for select to authenticated using (user_id = auth.uid());
grant select on table public.lawyer_cpfs to authenticated;

/**
 * A partner or a lawyer declares their own CPF, with the second factor,
 * never from a support visit. It changes only while no authorization of
 * theirs is in course (one in force, or a start of the last ten minutes,
 * which is as long as the return of a PSC is taken: what was authorized was
 * checked against the CPF before), and a CPF another account proved is
 * refused without saying whose, on the record; ten declarations or refusals
 * a day are a person's most. A change is a declaration nothing proved.
 */
create or replace function public.declare_lawyer_cpf(target_cpf text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  digits text := regexp_replace(coalesce(target_cpf, ''), '[^0-9]', '', 'g');
  previous text;
  firm uuid;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select m.org_id into firm from public.memberships m
  where m.user_id = caller and m.firm_function in ('socio', 'advogado')
  order by m.created_at
  limit 1;
  if firm is null then
    return jsonb_build_object('ok', false, 'code', 'not_a_lawyer');
  end if;
  perform public.require_aal2();
  if not public.cpf_is_valid(digits) then
    return jsonb_build_object('ok', false, 'code', 'invalid_cpf');
  end if;

  select l.cpf into previous from public.lawyer_cpfs l where l.user_id = caller for update;
  if previous = digits then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  if (
    select count(*) from public.audit_events a
    where a.action in ('lawyer.cpf_declared', 'lawyer.cpf_refused') and a.actor_id = caller
      and a.created_at > now() - interval '1 day'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'code', 'too_many_attempts');
  end if;
  if previous is not null and exists (
    select 1 from public.connections c
    where c.person_id = caller and (
      (c.status in ('connected', 'error') and c.expires_at > now())
      or (c.status = 'pending' and c.updated_at > now() - interval '10 minutes')
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'end_first');
  end if;
  if exists (select 1 from public.lawyer_cpfs l where l.cpf = digits and l.user_id <> caller and l.proven_at is not null) then
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (firm, caller, 'lawyer.cpf_refused', 'profile', caller::text, jsonb_build_object('reason', 'taken'));
    return jsonb_build_object('ok', false, 'code', 'cpf_taken');
  end if;

  insert into public.lawyer_cpfs (user_id, cpf) values (caller, digits)
  on conflict (user_id) do update set cpf = excluded.cpf, declared_at = now(), proven_at = null;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (firm, caller, 'lawyer.cpf_declared', 'profile', caller::text,
          jsonb_build_object('changed', previous is not null));
  return jsonb_build_object('ok', true, 'code', 'declared');
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'cpf_taken');
end;
$$;

revoke all on function public.declare_lawyer_cpf(text) from public, anon;
grant execute on function public.declare_lawyer_cpf(text) to authenticated;

-- ---------- A connection of a person ----------

-- The lawyer whose authorization a connection keeps. A person's account
-- going takes it with it, and its sealed token with that (0017's cascade).
alter table public.connections add column person_id uuid references public.profiles (id) on delete cascade;

-- A PSC's connection is a person's, keyed by that person (so each lawyer has
-- their own at each PSC), and no other connection is anybody's.
alter table public.connections add constraint connections_person_check check (
  case
    when provider ~ '^psc[.]' then person_id is not null and external_id = person_id::text
    else person_id is null
  end
);

create index connections_person_idx on public.connections (person_id, org_id) where person_id is not null;

-- A lawyer reads their own authorizations, and the firm's partners read
-- every lawyer's (who manages the firm reads every connection, 0017).
create policy "connections_select_person" on public.connections
  for select to authenticated
  using (
    person_id is not null
    and public.is_org_member(org_id)
    and (person_id = auth.uid() or public.has_firm_function(org_id, array['socio']::public.firm_function[]))
  );

/**
 * A lawyer's authorization never passes to another person, firm or PSC (the
 * seal binds the firm and the connection, and the connection binds the
 * rest). It is in force only with its end, at most the 7 days the norm gives
 * a natural person (and a few minutes for the clocks), only while its holder
 * is a partner or a lawyer of the firm, and only for a certificate whose CPF
 * is the one its holder declared (the backend reads the certificate and
 * writes the middle of its CPF beside the seal), whatever puts it in force:
 * the vault's seal, or a recovery after a failure.
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
 * The CPF a person declared, proved: the PSC signed with a certificate of it
 * that the person authorized, and the backend checked the signature. From
 * then on it is that account's alone, and it leaves every declaration of it
 * nothing proved (each on record in that person's firm). A CPF another
 * account proved meanwhile stays theirs.
 */
create or replace function public.prove_lawyer_cpf(target_person uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  proven text;
  released record;
begin
  update public.lawyer_cpfs set proven_at = now()
  where user_id = target_person and proven_at is null
  returning cpf into proven;
  if proven is null then
    return;
  end if;
  for released in
    delete from public.lawyer_cpfs l
    where l.cpf = proven and l.user_id <> target_person and l.proven_at is null
    returning l.user_id
  loop
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values ((select m.org_id from public.memberships m where m.user_id = released.user_id order by m.created_at limit 1),
            null, 'lawyer.cpf_released', 'profile', released.user_id::text,
            jsonb_build_object('reason', 'proven_elsewhere'));
  end loop;
exception when unique_violation then
  -- Proved by another account a moment before: theirs, and this one stays a declaration.
  return;
end;
$$;

revoke all on function public.prove_lawyer_cpf(uuid) from public, anon, authenticated;

create trigger connections_guard_person
  before insert or update of status, expires_at, person_id, org_id, provider, external_id, metadata
  on public.connections
  for each row execute function public.connections_guard_person();

/**
 * The lawyer starts authorizing ONE at their PSC: the connection the backend
 * seals the PSC's answer under. Their own act, for themself: a partner or a
 * lawyer of the firm who declared their CPF, with the second factor, never
 * from a support visit. Starting again at the same PSC reuses the row, and
 * the authorization in force goes on until the new one is sealed.
 */
create or replace function public.begin_lawyer_signature(target_org uuid, target_psc text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  psc public.psc_providers%rowtype;
  existing public.connections%rowtype;
  connection uuid;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.has_firm_function(target_org, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_a_lawyer');
  end if;
  perform public.require_aal2();
  if not exists (select 1 from public.lawyer_cpfs l where l.user_id = caller) then
    return jsonb_build_object('ok', false, 'code', 'cpf_required');
  end if;

  select * into psc from public.psc_providers where slug = target_psc and active;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_psc');
  end if;

  select * into existing from public.connections
  where org_id = target_org and provider = 'psc.' || psc.slug and external_id = caller::text
  for update;

  if found then
    connection := existing.id;
    -- An authorization whose time ran out before the upkeep saw it ends here: its token goes, and this is a start.
    if existing.status in ('connected', 'error') and (existing.expires_at is null or existing.expires_at <= now()) then
      delete from public.connection_secrets where connection_id = existing.id;
      insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
      values (target_org, null, 'lawyer_signature.ended', 'connection', existing.id::text,
              jsonb_build_object('psc', psc.slug, 'reason', 'expired'));
    end if;
    update public.connections set
      label = psc.name,
      status = case when status in ('connected', 'error') and expires_at > now() then status else 'pending' end,
      connected_by = caller,
      disconnected_by = null,
      disconnected_at = null
    where id = existing.id;
  else
    insert into public.connections (org_id, provider, external_id, label, connected_by, person_id)
    values (target_org, 'psc.' || psc.slug, caller::text, psc.name, caller, caller)
    returning id into connection;
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'lawyer_signature.started', 'connection', connection::text,
          jsonb_build_object('psc', psc.slug, 'again', existing.id is not null));

  return jsonb_build_object(
    'ok', true,
    'code', case when existing.id is null then 'started' else 'existing' end,
    'connection_id', connection,
    'org_id', target_org,
    'psc', psc.slug
  );
end;
$$;

revoke all on function public.begin_lawyer_signature(uuid, text) from public, anon;
grant execute on function public.begin_lawyer_signature(uuid, text) to authenticated;

/**
 * Ends a lawyer's authorization: the token is discarded at once, and the
 * lawyer authorizes again to sign through ONE. The lawyer, a partner of the
 * firm or who manages it, never from a support visit. No second factor:
 * taking power away is never blocked. `target_only_pending` ends a start
 * that came to nothing and never an authorization in force: the PSC's return
 * gives up its own start with it, decided under the row's lock, so a second
 * return of the same start never ends what the first one sealed.
 */
create or replace function public.end_lawyer_signature(target_connection uuid, target_only_pending boolean default false)
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
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;

  select * into conn from public.connections where id = target_connection for update;
  -- The same answer for one that does not exist, one of another firm and a vendor's account.
  if not found or conn.person_id is null or not public.is_org_member(conn.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if conn.person_id <> caller
     and not public.has_firm_function(conn.org_id, array['socio']::public.firm_function[])
     and not public.has_org_role(conn.org_id, array['owner', 'admin']::public.org_role[]) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if conn.status = 'disconnected' then
    return jsonb_build_object('ok', true, 'code', 'already_ended');
  end if;
  if coalesce(target_only_pending, false) and conn.status <> 'pending' then
    return jsonb_build_object('ok', true, 'code', 'not_pending');
  end if;

  delete from public.connection_secrets where connection_id = conn.id;
  update public.connections set
    status = 'disconnected',
    disconnected_by = caller,
    disconnected_at = now(),
    last_error = null
  where id = conn.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (conn.org_id, caller, 'lawyer_signature.ended', 'connection', conn.id::text,
          jsonb_build_object('psc', substr(conn.provider, 5),
                             'reason', case when conn.person_id = caller then 'by_lawyer' else 'by_firm' end));

  return jsonb_build_object('ok', true, 'code', 'ended');
end;
$$;

revoke all on function public.end_lawyer_signature(uuid, boolean) from public, anon;
grant execute on function public.end_lawyer_signature(uuid, boolean) to authenticated;

/**
 * Who leaves the firm, or stops being a partner or a lawyer of it, stops
 * signing through ONE at once: every authorization of theirs in that firm
 * ends, its token discarded. A firm or a person on their way out takes
 * their connections with it (the cascades), with nothing to record.
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
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (old.org_id, null, 'lawyer_signature.ended', 'connection', conn.id::text,
            jsonb_build_object('psc', substr(conn.provider, 5),
                               'reason', case when tg_op = 'DELETE' then 'left_firm' else 'function_changed' end));
  end loop;
  return null;
end;
$$;

revoke all on function public.memberships_end_lawyer_signatures() from public, anon, authenticated;

create trigger memberships_end_lawyer_signatures_left after delete on public.memberships
  for each row execute function public.memberships_end_lawyer_signatures();

create trigger memberships_end_lawyer_signatures_function after update of firm_function on public.memberships
  for each row when (old.firm_function is distinct from new.firm_function and new.firm_function not in ('socio', 'advogado'))
  execute function public.memberships_end_lawyer_signatures();

-- ---------- The vault's general read, which a lawyer's authorization never goes through ----------

/**
 * As in 0017, and a lawyer's authorization is refused here, whatever the
 * purpose: it is opened for a declared use only (`lawyer_signature_open`).
 */
create or replace function public.vault_read_secret(target_org uuid, target_connection uuid, target_purpose text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conn public.connections%rowtype;
  sealed public.connection_secrets%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_purpose is null or target_purpose !~ '^[a-z][a-z0-9_.-]{2,63}$' then
    raise exception 'invalid_purpose' using errcode = '22023';
  end if;

  select * into conn from public.connections where id = target_connection and org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if conn.person_id is not null then
    return jsonb_build_object('ok', false, 'code', 'personal');
  end if;

  if conn.status in ('connected', 'error') and conn.expires_at is not null and conn.expires_at <= now() then
    delete from public.connection_secrets where connection_id = conn.id;
    update public.connections set status = 'expired' where id = conn.id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (conn.org_id, null, 'connection.expired', 'connection', conn.id::text,
            jsonb_build_object('provider', conn.provider));
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;
  if conn.status not in ('connected', 'error') then
    return jsonb_build_object('ok', false, 'code', conn.status);
  end if;

  select * into sealed from public.connection_secrets where connection_id = conn.id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_secret');
  end if;

  update public.connections set last_used_at = now() where id = conn.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (conn.org_id, null, 'vault.secret.read', 'connection', conn.id::text,
          jsonb_build_object('provider', conn.provider, 'purpose', target_purpose));

  return jsonb_build_object(
    'ok', true,
    'code', 'read',
    'org_id', conn.org_id,
    'provider', conn.provider,
    'external_id', conn.external_id,
    'status', conn.status,
    'expires_at', conn.expires_at,
    'envelope', jsonb_build_object(
      'key_version', sealed.key_version,
      'iv', sealed.iv,
      'ciphertext', sealed.ciphertext,
      'tag', sealed.auth_tag
    )
  );
end;
$$;

revoke all on function public.vault_read_secret(uuid, uuid, text) from public, anon, authenticated;

/**
 * As in 0017, leaving out the lawyers' authorizations: no read hands one
 * out, and each lives 7 days at most, so a key retired from `VAULT_KEYS`
 * stays listed 7 days after a rotation (or the lawyers authorize again).
 */
create or replace function public.vault_rewrap_pending(target_key_version integer, target_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  pending jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('org_id', batch.org_id, 'connection_id', batch.connection_id)), '[]'::jsonb)
  into pending
  from (
    select s.org_id, s.connection_id
    from public.connection_secrets s
    join public.connections c on c.id = s.connection_id
    where s.key_version < target_key_version and c.person_id is null
    order by s.created_at
    limit least(greatest(coalesce(target_limit, 100), 1), 1000)
  ) batch;
  return pending;
end;
$$;

revoke all on function public.vault_rewrap_pending(integer, integer) from public, anon, authenticated;

-- ---------- Every use of a lawyer's authorization ----------

create table public.lawyer_signature_uses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  person_id uuid references public.profiles (id) on delete set null,
  connection_id uuid references public.connections (id) on delete set null,
  -- The PSC, kept when the connection goes.
  psc text not null,
  -- What it was for: the test ONE makes when the authorization arrives, or
  -- the filing package of a lawsuit.
  purpose text not null,
  -- What it signed for (the package), when there is one.
  subject_id uuid,
  -- The seal the use opened: what the PSC says of the authorization
  -- afterwards is about that seal, never a newer one.
  seal_id uuid not null,
  -- The number the backend claimed the package under (0042): a use signs
  -- for that claim alone, and no later one takes what it signed.
  claim integer,
  case_id uuid references public.cases (id) on delete set null,
  -- The SHA-256 of each document to be signed, in hexadecimal: what anybody
  -- can check a signed file against.
  document_hashes text[] not null,
  -- opened: the authorization was handed to the backend for this use;
  -- signed: every document was signed and each signature checked;
  -- failed: nothing signed here was used (`error_code` says why).
  status text not null default 'opened',
  error_code text,
  -- How many signatures the PSC made for this use.
  signed_count integer,
  opened_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint lawyer_signature_uses_psc_check check (psc ~ '^[a-z][a-z0-9]{1,23}$'),
  constraint lawyer_signature_uses_purpose_check check (purpose in ('authorization.check', 'filing.package')),
  constraint lawyer_signature_uses_hashes_check check (
    cardinality(document_hashes) between 1 and 200
    and array_position(document_hashes, null) is null
    and array_to_string(document_hashes, ',') ~ '^[0-9a-f]{64}(,[0-9a-f]{64})*$'
  ),
  constraint lawyer_signature_uses_status_check check (status in ('opened', 'signed', 'failed')),
  constraint lawyer_signature_uses_claim_check check ((purpose = 'filing.package') = (claim is not null)),
  constraint lawyer_signature_uses_error_check check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint lawyer_signature_uses_outcome_check check (
    (status = 'opened') = (finished_at is null)
    and (status = 'failed') = (error_code is not null)
    and (signed_count is null or signed_count between 0 and cardinality(document_hashes))
  )
);

create index lawyer_signature_uses_person_idx on public.lawyer_signature_uses (org_id, person_id, opened_at desc);
create index lawyer_signature_uses_connection_idx on public.lawyer_signature_uses (connection_id)
  where connection_id is not null;
create index lawyer_signature_uses_case_idx on public.lawyer_signature_uses (case_id) where case_id is not null;

comment on table public.lawyer_signature_uses is
  'Every opening of a lawyer''s cloud signature authorization: what was to be signed (the SHA-256 of each document), for what, and what came of it. Written by the backend only.';

alter table public.lawyer_signature_uses enable row level security;
create policy "lawyer_signature_uses_select" on public.lawyer_signature_uses
  for select to authenticated
  using (
    public.is_org_member(org_id)
    and (
      person_id = auth.uid()
      or public.has_firm_function(org_id, array['socio']::public.firm_function[])
      or public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])
    )
  );
grant select on table public.lawyer_signature_uses to authenticated;

create trigger guard_impersonation_lawyer_signature_uses
  after insert or update or delete on public.lawyer_signature_uses
  for each statement execute function public.guard_impersonation_readonly();

/**
 * Why a use of a lawyer's authorization may not sign the files of a filing
 * package, beyond its files themselves: a package not built, or of a lawsuit
 * the lawyer does not sign. Null when nothing keeps it. 0042 adds the claim
 * the backend signs under and the lawyer it chose.
 */
create or replace function public.lawyer_signature_package_refusal(
  target_package public.filing_packages,
  target_person uuid,
  target_claim integer
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when target_package.status <> 'ready' then 'invalid_subject'
    when not exists (
      select 1 from public.proceeding_lawyers pl
      where pl.proceeding_id = target_package.proceeding_id and pl.user_id = target_person
    ) then 'not_a_signer'
  end;
$$;

revoke all on function public.lawyer_signature_package_refusal(public.filing_packages, uuid, integer) from public, anon, authenticated;

/**
 * Opens a lawyer's authorization for one use, declared first: what it is for,
 * the case, and the SHA-256 of every document to be signed. A use is bound to
 * what it says. The test of an authorization that just arrived names it, signs
 * one text, once, within minutes of its seal. The files of a filing package
 * are those very files, in their order, of a package built and not filed, of
 * a lawsuit the lawyer signs, under the claim the backend holds
 * (`lawyer_signature_package_refusal`). The backend gets the sealed token of
 * the lawyer's authorization in force that lasts the longest (or the one it
 * names), while they are a partner or a lawyer of the firm, with the serial of
 * the certificate that was authorized and the CPF the lawyer declared, so it
 * signs with that certificate or not at all; the use is on record, with the
 * seal it opened, before anything is signed. The backend's alone.
 */
create or replace function public.lawyer_signature_open(
  target_org uuid,
  target_person uuid,
  target_purpose text,
  target_subject uuid,
  target_case uuid,
  target_hashes text[],
  target_connection uuid default null,
  target_claim integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conn public.connections%rowtype;
  sealed public.connection_secrets%rowtype;
  package public.filing_packages%rowtype;
  case_of_use uuid := target_case;
  declared text;
  refusal text;
  use_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_purpose is null or target_purpose not in ('authorization.check', 'filing.package') then
    raise exception 'invalid_purpose' using errcode = '22023';
  end if;
  if target_hashes is null or cardinality(target_hashes) not between 1 and 200
     or array_position(target_hashes, null) is not null
     or array_to_string(target_hashes, ',') !~ '^[0-9a-f]{64}(,[0-9a-f]{64})*$' then
    raise exception 'invalid_hashes' using errcode = '22023';
  end if;
  if target_purpose = 'authorization.check' and (
    target_connection is null or target_subject is not null or target_case is not null or cardinality(target_hashes) <> 1
    or target_claim is not null
  ) then
    raise exception 'invalid_use' using errcode = '22023';
  end if;
  if target_purpose = 'filing.package' and target_claim is null then
    raise exception 'invalid_use' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = target_person and m.firm_function in ('socio', 'advogado')
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_a_lawyer');
  end if;
  if target_case is not null
     and not exists (select 1 from public.cases c where c.id = target_case and c.org_id = target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if target_purpose = 'filing.package' then
    select p.* into package from public.filing_packages p where p.id = target_subject and p.org_id = target_org;
    if not found or (target_case is not null and target_case <> package.case_id) then
      return jsonb_build_object('ok', false, 'code', 'invalid_subject');
    end if;
    case_of_use := package.case_id;
    refusal := public.lawyer_signature_package_refusal(package, target_person, target_claim);
    if refusal is not null then
      return jsonb_build_object('ok', false, 'code', refusal);
    end if;
    if target_hashes is distinct from (
      select array_agg(f.sha256 order by i.position)
      from public.filing_package_items i
      join public.files f on f.id = i.file_id and f.org_id = i.org_id
      where i.package_id = package.id
    ) then
      return jsonb_build_object('ok', false, 'code', 'files_changed');
    end if;
  end if;

  select l.cpf into declared from public.lawyer_cpfs l where l.user_id = target_person;
  if declared is null then
    return jsonb_build_object('ok', false, 'code', 'no_signature');
  end if;

  select c.* into conn
  from public.connections c
  where c.org_id = target_org and c.person_id = target_person and c.provider ~ '^psc[.]'
    and (target_connection is null or c.id = target_connection)
    and c.status in ('connected', 'error') and c.expires_at > now() + interval '1 minute'
    and exists (select 1 from public.connection_secrets s where s.connection_id = c.id)
  order by c.expires_at desc, c.id
  limit 1
  for update of c;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_signature');
  end if;
  select * into sealed from public.connection_secrets where connection_id = conn.id;

  if target_purpose = 'authorization.check' and (
    sealed.created_at < now() - interval '15 minutes'
    or exists (
      select 1 from public.lawyer_signature_uses u
      where u.connection_id = conn.id and u.purpose = 'authorization.check' and u.seal_id = sealed.seal_id
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'check_spent');
  end if;

  insert into public.lawyer_signature_uses (
    org_id, person_id, connection_id, psc, purpose, subject_id, case_id, seal_id, claim, document_hashes
  )
  values (
    target_org, target_person, conn.id, substr(conn.provider, 5), target_purpose, target_subject, case_of_use,
    sealed.seal_id, target_claim, target_hashes
  )
  returning id into use_id;

  update public.connections set last_used_at = now() where id = conn.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (conn.org_id, null, 'vault.secret.read', 'connection', conn.id::text,
          jsonb_build_object('provider', conn.provider, 'purpose', 'psc.' || target_purpose, 'use', use_id,
                             'documents', cardinality(target_hashes)));

  return jsonb_build_object(
    'ok', true,
    'code', 'opened',
    'use_id', use_id,
    'connection_id', conn.id,
    'org_id', conn.org_id,
    'provider', conn.provider,
    'external_id', conn.external_id,
    'status', conn.status,
    'expires_at', conn.expires_at,
    -- The certificate the lawyer authorized, and whose CPF it must carry.
    'serial', conn.metadata ->> 'serial',
    'fingerprint', conn.metadata ->> 'fingerprint',
    'cpf', declared,
    'envelope', jsonb_build_object(
      'key_version', sealed.key_version,
      'iv', sealed.iv,
      'ciphertext', sealed.ciphertext,
      'tag', sealed.auth_tag
    )
  );
end;
$$;

revoke all on function public.lawyer_signature_open(uuid, uuid, text, uuid, uuid, text[], uuid, integer) from public, anon, authenticated;

/**
 * What came of a use: every document signed and each signature checked, or
 * why not (a short code, never the PSC's words). A use whose authorization
 * ended while it signed (the lawyer, a partner or who manages the firm ended
 * it, the lawyer left or stopped being a lawyer of the firm, its time ran
 * out, or a newer authorization took its place) is recorded as such, and
 * what it signed is never handed over (`ended_meanwhile`). What the PSC said
 * of the authorization follows the use, and only of the seal the use opened:
 * when it no longer signs (its time ended, a token already spent, the holder
 * took it back) or signs with nothing ONE may use (no certificate, another
 * certificate than the one authorized, one out of its validity, an address
 * the platform moved), the token is discarded and the lawyer authorizes
 * again; another failure leaves it in force and says so; a success after a
 * failure brings it back. A use signed and checked while its authorization
 * was in force proves the CPF the lawyer declared (`prove_lawyer_cpf`). The
 * backend's alone.
 */
create or replace function public.lawyer_signature_finish(
  target_org uuid,
  target_use uuid,
  target_ok boolean,
  target_error text default null,
  target_signed integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.lawyer_signature_uses%rowtype;
  conn public.connections%rowtype;
  code text := nullif(btrim(target_error), '');
  ok boolean := coalesce(target_ok, false);
  same_seal boolean;
  in_force boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if ok then
    code := null;
  elsif code is null or code !~ '^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'invalid_error_code' using errcode = '22023';
  end if;

  select * into item from public.lawyer_signature_uses where id = target_use and org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if item.status <> 'opened' then
    return jsonb_build_object('ok', false, 'code', 'already_finished');
  end if;

  select * into conn from public.connections where id = item.connection_id for update;
  same_seal := found and exists (
    select 1 from public.connection_secrets s where s.connection_id = conn.id and s.seal_id = item.seal_id
  );
  in_force := same_seal and conn.status in ('connected', 'error') and conn.expires_at > now()
    and exists (
      select 1 from public.memberships m
      where m.org_id = item.org_id and m.user_id = item.person_id and m.firm_function in ('socio', 'advogado')
    );
  if ok and not in_force then
    ok := false;
    code := 'ended_meanwhile';
  end if;

  update public.lawyer_signature_uses set
    status = case when ok then 'signed' else 'failed' end,
    error_code = code,
    signed_count = least(greatest(coalesce(target_signed, case when ok then cardinality(document_hashes) else 0 end), 0),
                         cardinality(document_hashes)),
    finished_at = now()
  where id = item.id;

  if same_seal and conn.status in ('connected', 'error') and code is distinct from 'ended_meanwhile' then
    if ok then
      if conn.status = 'error' then
        update public.connections set status = 'connected', last_error = null where id = conn.id;
        insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
        values (conn.org_id, null, 'connection.recovered', 'connection', conn.id::text,
                jsonb_build_object('provider', conn.provider));
      end if;
    elsif code in ('session_ended', 'token_used', 'denied', 'no_certificate', 'certificate_changed',
                   'certificate_expired', 'psc_moved') then
      delete from public.connection_secrets where connection_id = conn.id;
      update public.connections set status = 'expired', last_error = code where id = conn.id;
      insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
      values (conn.org_id, null, 'lawyer_signature.ended', 'connection', conn.id::text,
              jsonb_build_object('psc', substr(conn.provider, 5), 'reason', code));
    elsif conn.status <> 'error' or conn.last_error is distinct from code then
      update public.connections set status = 'error', last_error = code where id = conn.id;
      insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
      values (conn.org_id, null, 'connection.failed', 'connection', conn.id::text,
              jsonb_build_object('provider', conn.provider, 'error_code', code));
    end if;
  end if;

  if ok then
    perform public.prove_lawyer_cpf(item.person_id);
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (item.org_id, null, 'lawyer_signature.used', 'lawyer_signature_use', item.id::text,
          jsonb_strip_nulls(jsonb_build_object(
            'purpose', item.purpose,
            'subject', item.subject_id,
            'documents', cardinality(item.document_hashes),
            'ok', ok,
            'error_code', code
          )));

  return jsonb_build_object('ok', true, 'code', case when code = 'ended_meanwhile' then 'ended_meanwhile' else 'recorded' end);
end;
$$;

revoke all on function public.lawyer_signature_finish(uuid, uuid, boolean, text, integer) from public, anon, authenticated;
