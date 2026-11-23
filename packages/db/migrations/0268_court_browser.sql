-- ============================================================
-- 0268_court_browser: ONE's own browser on ONE's server, the first of the
-- owner's three ways to file (2026-11-20, root CLAUDE.md, "Three ways to
-- file"). It files a batch a lawyer approved with the court login the lawyer
-- gave ONE (0263, 0264), and checks a login with the court as soon as the
-- lawyer gives it. So:
--
--   court_screen_systems.start_path  where ONE's browser opens a system; the
--                         court sends it on to its sign-in from there (the
--                         eproc of TJSP to the court's single sign-on).
--   court_login_uses.purpose  'batch' (0264), or 'check': ONE entering the
--                         court once, right after the lawyer gave the login,
--                         only to see the court take it. It stops where the
--                         court asks the second factor and types no code.
--   claim_court_login_check  the next login to check (service role): one a
--                         lawyer gave for ONE's browser at a system whose
--                         second factor is an app's code (a code by e-mail
--                         would reach the lawyer for nothing), not checked
--                         yet, tried at most five times and an hour apart,
--                         each opening kept as every opening is.
--   begin_court_login     as in 0263, and a login given again is checked
--                         again: what the court said of the one before no
--                         longer holds.
--   files 'filing_screen' the court's screen ONE's browser keeps for the
--                         lawyer's word before the first filing at a system
--                         (0264's `summary_file_id`): an image, written by
--                         the backend only.
-- ============================================================

-- ---------- Where ONE's browser opens each system ----------

alter table public.court_screen_systems add column start_path text not null default '/';
alter table public.court_screen_systems add constraint court_screen_systems_start_path_check
  check (start_path ~ '^/[A-Za-z0-9/_.-]{0,80}$');

update public.court_screen_systems set start_path = '/eproc/' where key in ('eproc-tjsp', 'eproc-tjrj');

-- ---------- Why a login was opened ----------

alter table public.court_login_uses add column purpose text not null default 'batch';
alter table public.court_login_uses add constraint court_login_uses_purpose_check
  check (purpose in ('batch', 'check'));

-- ---------- The court's screen kept for the lawyer's word ----------

update public.platform_settings
set value = jsonb_set(value, '{purposes,filing_screen}', jsonb_build_object(
  'people', false,
  'max_bytes', 10485760,
  'mimes', jsonb_build_array('image/png', 'image/jpeg')
))
where key = 'files' and not (value -> 'purposes') ? 'filing_screen';

-- ---------- A login given again is checked again ----------

/** As in 0263, and a login given again forgets what the court said of the one before. */
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
      metadata = (existing.metadata - 'verified_at' - 'check_tried_at' - 'check_tries')
                 || jsonb_build_object('login_hint', hint)
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

-- ---------- Checking a login as soon as it is given ----------

/**
 * The next court login ONE's browser checks with the court (service role):
 * one a lawyer gave for ONE's browser at a system whose second factor is the
 * code of an app, sealed, never checked, tried fewer than five times and not
 * in the last hour, of a person who is still a lawyer of the firm with that
 * way. Opened here, the opening kept (`court_login_uses`, purpose 'check') and
 * audited; null when none is due.
 */
create or replace function public.claim_court_login_check()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conn public.connections%rowtype;
  sealed public.connection_secrets%rowtype;
  sys public.court_screen_systems%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select c.* into conn
  from public.connections c
  join public.court_screen_systems s on c.provider = 'court.' || s.key
  where c.status = 'connected'
    and c.last_error is null
    and c.person_id is not null
    and not (c.metadata ? 'verified_at')
    and coalesce((c.metadata ->> 'check_tries')::integer, 0) < 5
    and (c.metadata ->> 'check_tried_at' is null
         or (c.metadata ->> 'check_tried_at')::timestamptz < now() - interval '1 hour')
    and s.login_kind = 'password_app'
    and 'browser' = any (s.ways)
    and exists (select 1 from public.connection_secrets x where x.connection_id = c.id)
    and exists (
      select 1 from public.memberships m
      where m.org_id = c.org_id and m.user_id = c.person_id and m.firm_function in ('socio', 'advogado'))
    and exists (
      select 1 from public.lawyer_filing_ways w
      where w.org_id = c.org_id and w.user_id = c.person_id and w.system_key = s.key and w.way = 'browser')
  order by c.updated_at, c.id
  limit 1
  for update of c skip locked;
  if not found then
    return null;
  end if;
  select * into sealed from public.connection_secrets where connection_id = conn.id;
  select * into sys from public.court_screen_systems where key = substr(conn.provider, 7);

  update public.connections set metadata = metadata || jsonb_build_object(
    'check_tried_at', now(),
    'check_tries', coalesce((metadata ->> 'check_tries')::integer, 0) + 1)
  where id = conn.id;
  insert into public.court_login_uses (org_id, person_id, connection_id, batch_id, system_key, purpose)
  values (conn.org_id, conn.person_id, conn.id, null, sys.key, 'check');
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (conn.org_id, null, 'court_login.opened', 'connection', conn.id::text,
          jsonb_build_object('system', sys.key, 'purpose', 'check'));
  return jsonb_build_object(
    'ok', true, 'code', 'read', 'org_id', conn.org_id, 'connection_id', conn.id, 'person_id', conn.person_id,
    'provider', conn.provider, 'external_id', conn.external_id, 'status', conn.status, 'expires_at', conn.expires_at,
    'system', sys.key, 'host', sys.host, 'start_path', sys.start_path,
    'envelope', jsonb_build_object('key_version', sealed.key_version, 'iv', sealed.iv,
                                   'ciphertext', sealed.ciphertext, 'tag', sealed.auth_tag));
end;
$$;

-- ---------- Grants ----------

revoke all on function public.begin_court_login(uuid, text, text) from public, anon;
grant execute on function public.begin_court_login(uuid, text, text) to authenticated;
revoke all on function public.claim_court_login_check() from public, anon, authenticated;
