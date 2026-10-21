-- ============================================================
-- 0019_whatsapp: each firm's WhatsApp, through the official Cloud API.
--
-- A firm connects its own number (its token sits in the vault, 0017), and one
-- webhook serves every firm: an event is routed by the `phone_number_id` it
-- carries, to the one firm that number is active in.
--
--   wa_numbers        a number of a firm: the account it belongs to, whether
--                     it also lives on the phone app (coexistence), its state;
--   wa_contacts       the names the firm's phone has for its contacts
--                     (coexistence contact sync);
--   wa_conversations  one per number and person: the unread count, and when
--                     the person last wrote, which is what the 24-hour window
--                     counts from;
--   wa_messages       every message in and out. A body is never edited: the
--                     row is its own record of who sent what and when, so no
--                     audit event is written per message;
--   wa_templates      the approved messages that may start a conversation;
--   wa_optouts        the people who asked a firm to stop.
--
-- The rules that decide what may be sent are here, in `reserve_wa_send`, and
-- nowhere else: free text and media only inside the 24 hours after the
-- person's last message; outside it only an approved template; never a
-- template to somebody who opted out; never anything from a support visit.
-- A send is reserved first (the row is written as `queued`) and sent after
-- (claim, then send): a message may fail to go out, it never goes out twice.
--
-- The provider is `meta` or `simulator`. A simulated number never reaches
-- the vendor, and the webhook only lets an event touch the numbers of the
-- provider whose signature it carries.
-- ============================================================

insert into public.platform_settings (key, value, is_public) values
  ('whatsapp', jsonb_build_object(
    'graph_api_version', 'v25.0',
    'service_window_hours', 24,
    'optout_keywords', jsonb_build_array('sair', 'parar', 'pare', 'cancelar', 'descadastrar', 'stop'),
    'optin_keywords', jsonb_build_array('voltar', 'start'),
    'unconfirmed_after_minutes', 10,
    -- A conversation waiting for an answer is "closing" when its window ends within these hours.
    'closing_soon_hours', 4,
    -- The largest file the Cloud API carries, per kind of message (its reference, read on 2026-10-09).
    'media_max_bytes', jsonb_build_object('image', 5242880, 'document', 104857600)
  ), false)
on conflict (key) do nothing;

-- What people send over WhatsApp is kept in the firm's files (0018), under its
-- own purpose: only the backend writes it, and only the types WhatsApp carries.
update public.platform_settings
set value = jsonb_set(value, '{purposes,whatsapp}', jsonb_build_object(
  'people', false,
  'max_bytes', 31457280,
  'mimes', jsonb_build_array(
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr',
    'video/mp4', 'video/3gpp'
  )
))
where key = 'files' and not (value -> 'purposes') ? 'whatsapp';

-- ---------- Numbers ----------

create table public.wa_numbers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The connection whose sealed token speaks for this number (0017). NULL only
  -- for a number whose connection no longer exists: the number stays, with its
  -- conversations, and connecting it again gives it one.
  connection_id uuid,
  provider text not null,
  -- The vendor's id of the number: what a webhook carries, how the firm is found.
  phone_number_id text not null,
  waba_id text not null,
  -- Digits only, with the country code.
  display_phone_number text not null,
  verified_name text,
  -- `cloud`: the number lives only here. `coexistence`: it also lives on the
  -- phone app, whose messages arrive as echoes.
  mode text not null default 'cloud',
  status text not null default 'active',
  disconnect_reason text,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  -- Coexistence: the two syncs are asked once each, within a day of connecting.
  contacts_sync_requested_at timestamptz,
  history_sync_requested_at timestamptz,
  history_progress integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  -- Never a cascade: the conversations of a firm hang on its number, and no
  -- removal of a connection may take them with it.
  foreign key (connection_id, org_id) references public.connections (id, org_id) on delete set null (connection_id),
  constraint wa_numbers_connection_check check (status = 'disconnected' or connection_id is not null),
  constraint wa_numbers_provider_check check (provider in ('meta', 'simulator')),
  constraint wa_numbers_ids_check check (
    phone_number_id ~ '^[A-Za-z0-9_.-]{3,64}$' and waba_id ~ '^[A-Za-z0-9_.-]{3,64}$'
  ),
  constraint wa_numbers_phone_check check (display_phone_number ~ '^[0-9]{8,15}$'),
  constraint wa_numbers_mode_check check (mode in ('cloud', 'coexistence')),
  constraint wa_numbers_status_check check (status in ('active', 'disconnected')),
  constraint wa_numbers_disconnected_check check ((status = 'disconnected') = (disconnected_at is not null)),
  constraint wa_numbers_progress_check check (history_progress is null or history_progress between 0 and 100)
);

-- A number is active in one firm at a time: a webhook must find exactly one.
create unique index wa_numbers_active_idx on public.wa_numbers (provider, phone_number_id) where status = 'active';
create index wa_numbers_org_idx on public.wa_numbers (org_id);

alter table public.wa_numbers enable row level security;

create policy "wa_numbers_select_member" on public.wa_numbers
  for select to authenticated
  using (public.is_org_member(org_id));

grant select on table public.wa_numbers to authenticated;

create trigger wa_numbers_updated_at
  before update on public.wa_numbers
  for each row execute function public.set_updated_at();

-- A number whose connection is removed is disconnected in the same breath: it
-- has no token to speak with, and it keeps everything else.
create or replace function public.wa_number_without_connection()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.connection_id is null and new.status = 'active' then
    new.status := 'disconnected';
    new.disconnect_reason := 'connection_removed';
    new.disconnected_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.wa_number_without_connection() from public, anon, authenticated;

create trigger wa_numbers_without_connection
  before update of connection_id on public.wa_numbers
  for each row execute function public.wa_number_without_connection();

create trigger guard_impersonation_wa_numbers
  after insert or update or delete on public.wa_numbers
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- The phone's contacts (coexistence) ----------

create table public.wa_contacts (
  number_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  contact_wa_id text not null,
  -- The name the firm saved on its phone.
  saved_name text not null,
  updated_at timestamptz not null default now(),
  primary key (number_id, contact_wa_id),
  foreign key (number_id, org_id) references public.wa_numbers (id, org_id) on delete cascade,
  constraint wa_contacts_wa_id_check check (contact_wa_id ~ '^[0-9]{8,15}$'),
  constraint wa_contacts_name_check check (char_length(btrim(saved_name)) between 1 and 200)
);

alter table public.wa_contacts enable row level security;

create policy "wa_contacts_select_member" on public.wa_contacts
  for select to authenticated
  using (public.is_org_member(org_id));

grant select on table public.wa_contacts to authenticated;

create trigger guard_impersonation_wa_contacts
  after insert or update or delete on public.wa_contacts
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- Conversations ----------

create table public.wa_conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  number_id uuid not null,
  -- The person's number, digits only.
  contact_wa_id text not null,
  -- The name WhatsApp shows for the person, and the one the firm's phone has.
  contact_name text,
  saved_name text,
  -- When the person last wrote THROUGH the Cloud API: what the 24-hour window
  -- counts from. History and what the firm typed on its phone do not open it.
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_direction text,
  unread_count integer not null default 0,
  status text not null default 'open',
  assigned_to uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (number_id, contact_wa_id),
  foreign key (number_id, org_id) references public.wa_numbers (id, org_id) on delete cascade,
  constraint wa_conversations_wa_id_check check (contact_wa_id ~ '^[0-9]{8,15}$'),
  constraint wa_conversations_status_check check (status in ('open', 'closed')),
  constraint wa_conversations_unread_check check (unread_count >= 0),
  constraint wa_conversations_direction_check check (last_message_direction is null or last_message_direction in ('in', 'out'))
);

create index wa_conversations_org_idx on public.wa_conversations (org_id, last_message_at desc nulls last);

alter table public.wa_conversations enable row level security;

create policy "wa_conversations_select_member" on public.wa_conversations
  for select to authenticated
  using (public.is_org_member(org_id));

grant select on table public.wa_conversations to authenticated;

create trigger wa_conversations_updated_at
  before update on public.wa_conversations
  for each row execute function public.set_updated_at();

create trigger guard_impersonation_wa_conversations
  after insert or update or delete on public.wa_conversations
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- Templates ----------

create table public.wa_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  waba_id text not null,
  name text not null,
  language text not null default 'pt_BR',
  category text not null,
  status text not null,
  -- The text of the body, with its placeholders: {{1}}, {{2}}.
  body text not null,
  header_text text,
  footer_text text,
  param_count integer not null default 0,
  -- The components as the vendor returned them, for what the columns above do not carry.
  components jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, waba_id, name, language),
  -- (A regular expression counts to 255 at most, so the length is checked apart.)
  constraint wa_templates_name_check check (name ~ '^[a-z0-9_]+$' and char_length(name) <= 512),
  constraint wa_templates_language_check check (language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  constraint wa_templates_category_check check (category in ('marketing', 'utility', 'authentication')),
  constraint wa_templates_status_check check (status in ('approved', 'pending', 'rejected', 'paused', 'disabled')),
  constraint wa_templates_body_check check (char_length(body) between 1 and 1024),
  constraint wa_templates_header_check check (header_text is null or char_length(header_text) <= 60),
  constraint wa_templates_footer_check check (footer_text is null or char_length(footer_text) <= 60),
  constraint wa_templates_params_check check (param_count between 0 and 50)
);

alter table public.wa_templates enable row level security;

create policy "wa_templates_select_member" on public.wa_templates
  for select to authenticated
  using (public.is_org_member(org_id));

grant select on table public.wa_templates to authenticated;

create trigger guard_impersonation_wa_templates
  after insert or update or delete on public.wa_templates
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- Opt-outs ----------

create table public.wa_optouts (
  org_id uuid not null references public.organizations (id) on delete cascade,
  contact_wa_id text not null,
  -- `keyword`: the person wrote one of the words. `manual`: somebody of the firm recorded it.
  source text not null,
  note text,
  recorded_by uuid references public.profiles (id) on delete set null,
  opted_out_at timestamptz not null default now(),
  primary key (org_id, contact_wa_id),
  constraint wa_optouts_wa_id_check check (contact_wa_id ~ '^[0-9]{8,15}$'),
  constraint wa_optouts_source_check check (source in ('keyword', 'manual')),
  constraint wa_optouts_note_check check (note is null or char_length(note) <= 500)
);

alter table public.wa_optouts enable row level security;

create policy "wa_optouts_select_member" on public.wa_optouts
  for select to authenticated
  using (public.is_org_member(org_id));

grant select on table public.wa_optouts to authenticated;

create trigger guard_impersonation_wa_optouts
  after insert or update or delete on public.wa_optouts
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- Messages ----------

create table public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  number_id uuid not null,
  direction text not null,
  -- `cloud`: came or went through the Cloud API. `app`: the firm typed it on
  -- its phone (an echo). `history`: imported when the number was connected.
  origin text not null default 'cloud',
  -- The vendor's id of the message. NULL until an outgoing one is accepted.
  wa_message_id text,
  kind text not null,
  body text,
  template_id uuid,
  template_name text,
  template_params jsonb,
  -- A media message: the vendor's id (good for 7 days), then the firm's file.
  media_wa_id text,
  media_mime text,
  media_filename text,
  media_file_id uuid,
  media_status text not null default 'none',
  media_claimed_at timestamptz,
  -- in: received. out: queued, sending, sent, delivered, read, failed.
  status text not null,
  error_code text,
  pricing_category text,
  pricing_type text,
  reply_to_wa_id text,
  -- Who of the firm wrote it here. NULL for what came in and for echoes.
  sent_by uuid references public.profiles (id) on delete set null,
  wa_timestamp timestamptz,
  attempts integer not null default 0,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (number_id, wa_message_id),
  foreign key (conversation_id, org_id) references public.wa_conversations (id, org_id) on delete cascade,
  foreign key (number_id, org_id) references public.wa_numbers (id, org_id) on delete cascade,
  foreign key (template_id, org_id) references public.wa_templates (id, org_id) on delete set null (template_id),
  foreign key (media_file_id, org_id) references public.files (id, org_id),
  constraint wa_messages_direction_check check (direction in ('in', 'out')),
  constraint wa_messages_origin_check check (origin in ('cloud', 'app', 'history')),
  constraint wa_messages_kind_check check (kind in (
    'text', 'template', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'contacts',
    'reaction', 'interactive', 'button', 'system', 'unsupported'
  )),
  constraint wa_messages_status_check check (
    (direction = 'in' and status = 'received')
    or (direction = 'out' and status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed'))
  ),
  constraint wa_messages_media_check check (media_status in ('none', 'pending', 'fetching', 'stored', 'failed')),
  constraint wa_messages_body_check check (body is null or char_length(body) <= 4096),
  constraint wa_messages_error_check check (error_code is null or error_code ~ '^[a-z0-9_]{1,63}$')
);

create index wa_messages_conversation_idx on public.wa_messages (conversation_id, created_at);
create index wa_messages_outbox_idx on public.wa_messages (created_at) where status = 'queued';
create index wa_messages_sending_idx on public.wa_messages (claimed_at) where status = 'sending';
create index wa_messages_media_idx on public.wa_messages (created_at) where media_status in ('pending', 'fetching');

alter table public.wa_messages enable row level security;

create policy "wa_messages_select_member" on public.wa_messages
  for select to authenticated
  using (public.is_org_member(org_id));

grant select on table public.wa_messages to authenticated;

create trigger guard_impersonation_wa_messages
  after insert or update or delete on public.wa_messages
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- Helpers ----------

create or replace function public.wa_setting(setting text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select s.value -> setting from public.platform_settings s where s.key = 'whatsapp';
$$;

revoke all on function public.wa_setting(text) from public, anon, authenticated;

/** What a person wrote, for comparing with a keyword: lower case, no accents, no punctuation around it. */
create or replace function public.wa_keyword(body text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(
    translate(
      lower(coalesce(body, '')),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    ),
    E' \t\n\r.!?,;:"''()'
  );
$$;

revoke all on function public.wa_keyword(text) from public, anon, authenticated;

/** True while free text may be sent: within the service window after the person's last message. */
create or replace function public.wa_window_open(last_inbound timestamptz)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select last_inbound is not null
     and last_inbound > now() - make_interval(hours => coalesce((public.wa_setting('service_window_hours') #>> '{}')::integer, 24));
$$;

revoke all on function public.wa_window_open(timestamptz) from public, anon;
grant execute on function public.wa_window_open(timestamptz) to authenticated;

/** When free text stops being allowed in a conversation; NULL when the person never wrote. */
create or replace function public.wa_window_closes_at(last_inbound timestamptz)
returns timestamptz
language sql
security definer
set search_path = public
stable
as $$
  select last_inbound + make_interval(hours => coalesce((public.wa_setting('service_window_hours') #>> '{}')::integer, 24));
$$;

revoke all on function public.wa_window_closes_at(timestamptz) from public, anon;
grant execute on function public.wa_window_closes_at(timestamptz) to authenticated;

/** What the list shows of a message: its text, or what kind of thing it is. Never more than a line. */
create or replace function public.wa_preview(kind text, body text)
returns text
language sql
immutable
set search_path = public
as $$
  select left(
    case
      when nullif(btrim(coalesce(body, '')), '') is not null then regexp_replace(btrim(body), '\s+', ' ', 'g')
      else '[' || kind || ']'
    end,
    120
  );
$$;

revoke all on function public.wa_preview(text, text) from public, anon, authenticated;

-- ---------- Connecting and routing (the backend) ----------

/**
 * Records a number of a firm after its token was sealed. A number is active in
 * one firm at a time; connecting again one the firm had brings it back.
 */
create or replace function public.register_wa_number(
  target_org uuid,
  target_connection uuid,
  target_provider text,
  target_phone_number_id text,
  target_waba_id text,
  target_display_phone_number text,
  target_verified_name text default null,
  target_mode text default 'cloud'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conn public.connections%rowtype;
  digits text := regexp_replace(coalesce(target_display_phone_number, ''), '\D', '', 'g');
  number_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into conn from public.connections where id = target_connection and org_id = target_org;
  if not found or conn.provider <> 'whatsapp' then
    return jsonb_build_object('ok', false, 'code', 'connection_not_found');
  end if;
  if conn.status <> 'connected' then
    return jsonb_build_object('ok', false, 'code', 'connection_not_connected');
  end if;
  if exists (
    select 1 from public.wa_numbers n
    where n.provider = target_provider and n.phone_number_id = target_phone_number_id
      and n.status = 'active' and n.org_id <> target_org
  ) then
    return jsonb_build_object('ok', false, 'code', 'number_in_use');
  end if;
  -- A firm's numbers are the vendor's or the simulator's, never both. An
  -- opt-out belongs to the firm, whatever number it was said to: with the two
  -- side by side, a simulated "voltar" would undo what a real person asked.
  if target_provider = 'simulator' and exists (
    select 1 from public.wa_numbers n where n.org_id = target_org and n.provider = 'meta'
  ) then
    return jsonb_build_object('ok', false, 'code', 'simulator_not_allowed');
  end if;

  select n.id into number_id from public.wa_numbers n
  where n.org_id = target_org and n.provider = target_provider and n.phone_number_id = target_phone_number_id
  order by n.created_at desc limit 1
  for update;

  if number_id is null then
    insert into public.wa_numbers (
      org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number, verified_name, mode
    ) values (
      target_org, target_connection, target_provider, target_phone_number_id, target_waba_id, digits,
      nullif(btrim(target_verified_name), ''), coalesce(target_mode, 'cloud')
    )
    returning id into number_id;
  else
    update public.wa_numbers set
      connection_id = target_connection,
      waba_id = target_waba_id,
      display_phone_number = digits,
      verified_name = nullif(btrim(target_verified_name), ''),
      mode = coalesce(target_mode, 'cloud'),
      status = 'active',
      disconnect_reason = null,
      disconnected_at = null,
      connected_at = now(),
      contacts_sync_requested_at = null,
      history_sync_requested_at = null,
      history_progress = null
    where id = number_id;
  end if;

  -- The firm's first real number ends its time on the simulator, for good.
  if target_provider = 'meta' then
    update public.wa_numbers set
      status = 'disconnected', disconnect_reason = 'replaced_by_real_number', disconnected_at = now()
    where org_id = target_org and provider = 'simulator' and status = 'active';
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, conn.connected_by, 'whatsapp.number.connected', 'wa_number', number_id::text,
          jsonb_build_object('provider', target_provider, 'mode', coalesce(target_mode, 'cloud')));

  return jsonb_build_object('ok', true, 'code', 'registered', 'number_id', number_id);
end;
$$;

revoke all on function public.register_wa_number(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;

/** The firm a webhook event belongs to, by the number it carries. Only an active number of that provider. */
create or replace function public.wa_route(target_provider text, target_phone_number_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  found_number public.wa_numbers%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into found_number from public.wa_numbers n
  where n.provider = target_provider and n.phone_number_id = target_phone_number_id and n.status = 'active';
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'org_id', found_number.org_id,
    'number_id', found_number.id,
    'connection_id', found_number.connection_id,
    'waba_id', found_number.waba_id,
    'mode', found_number.mode
  );
end;
$$;

revoke all on function public.wa_route(text, text) from public, anon, authenticated;

/**
 * The active numbers of an account at the vendor, for an event that names the
 * account and no number (the firm disconnected, the account was restricted).
 */
create or replace function public.wa_account_numbers(target_provider text, target_waba_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'org_id', n.org_id, 'number_id', n.id, 'connection_id', n.connection_id
    ) order by n.created_at), '[]'::jsonb)
    from public.wa_numbers n
    where n.provider = target_provider and n.waba_id = target_waba_id and n.status = 'active'
  );
end;
$$;

revoke all on function public.wa_account_numbers(text, text) from public, anon, authenticated;

/** A number stopped working for a firm: the vendor said so, or its connection was cut. */
create or replace function public.wa_disconnect_number(target_org uuid, target_number uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reason text := left(coalesce(nullif(regexp_replace(lower(coalesce(target_reason, '')), '[^a-z0-9_]', '_', 'g'), ''), 'unknown'), 60);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.wa_numbers set status = 'disconnected', disconnect_reason = reason, disconnected_at = now()
  where id = target_number and org_id = target_org and status = 'active';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, null, 'whatsapp.number.disconnected', 'wa_number', target_number::text,
          jsonb_build_object('reason', reason));
  return jsonb_build_object('ok', true, 'code', 'disconnected');
end;
$$;

revoke all on function public.wa_disconnect_number(uuid, uuid, text) from public, anon, authenticated;

-- A connection that is cut or expires takes its numbers with it: nothing may
-- be sent from a number whose token is gone.
create or replace function public.wa_follow_connection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.provider = 'whatsapp' and new.status in ('disconnected', 'expired') and old.status is distinct from new.status then
    update public.wa_numbers set
      status = 'disconnected',
      disconnect_reason = 'connection_' || new.status,
      disconnected_at = now()
    where connection_id = new.id and status = 'active';
  end if;
  return new;
end;
$$;

revoke all on function public.wa_follow_connection() from public, anon, authenticated;

create trigger connections_wa_follow
  after update of status on public.connections
  for each row execute function public.wa_follow_connection();

-- ---------- What arrives (the backend, from the webhook) ----------

/** Finds or opens the conversation of a number with a person. */
create or replace function public.wa_open_conversation(
  target_org uuid,
  target_number uuid,
  target_contact text,
  target_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation uuid;
  clean_name text := nullif(left(btrim(coalesce(target_name, '')), 200), '');
begin
  insert into public.wa_conversations (org_id, number_id, contact_wa_id, contact_name, saved_name)
  values (
    target_org, target_number, target_contact, clean_name,
    (select c.saved_name from public.wa_contacts c where c.number_id = target_number and c.contact_wa_id = target_contact)
  )
  on conflict (number_id, contact_wa_id) do update
    set contact_name = coalesce(excluded.contact_name, public.wa_conversations.contact_name)
  returning id into conversation;
  return conversation;
end;
$$;

revoke all on function public.wa_open_conversation(uuid, uuid, text, text) from public, anon, authenticated;

/**
 * A message a person sent to a firm's number. The same message delivered twice
 * (the vendor retries) is one row. It opens the 24-hour window, counts as
 * unread, and a message that is exactly one of the stop words records the
 * person's opt-out (one of the return words removes it).
 */
create or replace function public.wa_ingest_inbound(
  target_org uuid,
  target_number uuid,
  target_contact text,
  target_contact_name text,
  target_wa_message_id text,
  target_kind text,
  target_body text default null,
  target_media jsonb default null,
  target_reply_to text default null,
  target_wa_timestamp timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  contact text := regexp_replace(coalesce(target_contact, ''), '\D', '', 'g');
  conversation uuid;
  message uuid;
  moment timestamptz := coalesce(target_wa_timestamp, now());
  word text := public.wa_keyword(target_body);
  opted text := null;
  has_media boolean := target_media is not null and nullif(target_media ->> 'id', '') is not null;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.wa_numbers n where n.id = target_number and n.org_id = target_org and n.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'number_not_found');
  end if;
  if contact !~ '^[0-9]{8,15}$' or nullif(btrim(coalesce(target_wa_message_id, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_message');
  end if;

  select m.id, m.conversation_id into message, conversation
  from public.wa_messages m where m.number_id = target_number and m.wa_message_id = target_wa_message_id;
  if found then
    return jsonb_build_object('ok', true, 'code', 'duplicate', 'message_id', message, 'conversation_id', conversation);
  end if;

  conversation := public.wa_open_conversation(target_org, target_number, contact, target_contact_name);

  insert into public.wa_messages (
    org_id, conversation_id, number_id, direction, origin, wa_message_id, kind, body,
    media_wa_id, media_mime, media_filename, media_status, status, reply_to_wa_id, wa_timestamp
  ) values (
    target_org, conversation, target_number, 'in', 'cloud', target_wa_message_id, target_kind, left(target_body, 4096),
    case when has_media then target_media ->> 'id' end,
    case when has_media then target_media ->> 'mime_type' end,
    case when has_media then left(target_media ->> 'filename', 200) end,
    case when has_media then 'pending' else 'none' end,
    'received', target_reply_to, moment
  )
  on conflict (number_id, wa_message_id) do nothing
  returning id into message;

  if message is null then
    -- Lost a race with the same delivery: that one owns the message.
    select m.id into message from public.wa_messages m
    where m.number_id = target_number and m.wa_message_id = target_wa_message_id;
    return jsonb_build_object('ok', true, 'code', 'duplicate', 'message_id', message, 'conversation_id', conversation);
  end if;

  update public.wa_conversations set
    last_inbound_at = greatest(coalesce(last_inbound_at, moment), moment),
    last_message_at = greatest(coalesce(last_message_at, moment), moment),
    last_message_preview = public.wa_preview(target_kind, target_body),
    last_message_direction = 'in',
    unread_count = unread_count + 1,
    status = 'open'
  where id = conversation;

  if target_kind = 'text' and word <> '' then
    if public.wa_setting('optout_keywords') ? word then
      insert into public.wa_optouts (org_id, contact_wa_id, source)
      values (target_org, contact, 'keyword')
      on conflict (org_id, contact_wa_id) do nothing;
      if found then
        opted := 'out';
        insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
        values (target_org, null, 'client', 'whatsapp.optout.recorded', 'wa_conversation', conversation::text,
                jsonb_build_object('source', 'keyword'));
      end if;
    elsif public.wa_setting('optin_keywords') ? word then
      delete from public.wa_optouts where org_id = target_org and contact_wa_id = contact;
      if found then
        opted := 'in';
        insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
        values (target_org, null, 'client', 'whatsapp.optout.removed', 'wa_conversation', conversation::text,
                jsonb_build_object('source', 'keyword'));
      end if;
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'code', 'received', 'message_id', message, 'conversation_id', conversation,
    'media_pending', has_media, 'opted', opted
  ));
end;
$$;

revoke all on function public.wa_ingest_inbound(uuid, uuid, text, text, text, text, text, jsonb, text, timestamptz) from public, anon, authenticated;

/**
 * A message the firm sent from its own phone (coexistence), or one from the
 * history shared when the number was connected. Neither opens the 24-hour
 * window nor counts as unread: the window is the vendor's, and it only counts
 * what the person writes after the number is connected.
 */
create or replace function public.wa_ingest_mirrored(
  target_org uuid,
  target_number uuid,
  target_contact text,
  target_wa_message_id text,
  target_direction text,
  target_origin text,
  target_kind text,
  target_body text default null,
  target_wa_timestamp timestamptz default null,
  target_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  contact text := regexp_replace(coalesce(target_contact, ''), '\D', '', 'g');
  conversation uuid;
  message uuid;
  moment timestamptz := coalesce(target_wa_timestamp, now());
  final_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_origin not in ('app', 'history') or target_direction not in ('in', 'out') then
    raise exception 'invalid_origin' using errcode = '22023';
  end if;
  if not exists (select 1 from public.wa_numbers n where n.id = target_number and n.org_id = target_org) then
    return jsonb_build_object('ok', false, 'code', 'number_not_found');
  end if;
  if contact !~ '^[0-9]{8,15}$' or nullif(btrim(coalesce(target_wa_message_id, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_message');
  end if;

  final_status := case
    when target_direction = 'in' then 'received'
    when target_status in ('sent', 'delivered', 'read', 'failed') then target_status
    else 'sent'
  end;

  conversation := public.wa_open_conversation(target_org, target_number, contact, null);

  insert into public.wa_messages (
    org_id, conversation_id, number_id, direction, origin, wa_message_id, kind, body, status, wa_timestamp, created_at
  ) values (
    target_org, conversation, target_number, target_direction, target_origin, target_wa_message_id, target_kind,
    left(target_body, 4096), final_status, moment, moment
  )
  on conflict (number_id, wa_message_id) do nothing
  returning id into message;

  if message is null then
    return jsonb_build_object('ok', true, 'code', 'duplicate', 'conversation_id', conversation);
  end if;

  update public.wa_conversations set
    last_message_preview = case when last_message_at is null or moment >= last_message_at
                                then public.wa_preview(target_kind, target_body) else last_message_preview end,
    last_message_direction = case when last_message_at is null or moment >= last_message_at
                                  then target_direction else last_message_direction end,
    last_message_at = greatest(coalesce(last_message_at, moment), moment)
  where id = conversation;

  return jsonb_build_object('ok', true, 'code', 'mirrored', 'message_id', message, 'conversation_id', conversation);
end;
$$;

revoke all on function public.wa_ingest_mirrored(uuid, uuid, text, text, text, text, text, text, timestamptz, text) from public, anon, authenticated;

/** A contact of the firm's phone, added, renamed or removed (coexistence). */
create or replace function public.wa_sync_contact(
  target_org uuid,
  target_number uuid,
  target_contact text,
  target_saved_name text,
  target_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  contact text := regexp_replace(coalesce(target_contact, ''), '\D', '', 'g');
  clean_name text := nullif(left(btrim(coalesce(target_saved_name, '')), 200), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.wa_numbers n where n.id = target_number and n.org_id = target_org) then
    return jsonb_build_object('ok', false, 'code', 'number_not_found');
  end if;
  if contact !~ '^[0-9]{8,15}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_contact');
  end if;

  if target_action = 'remove' or clean_name is null then
    delete from public.wa_contacts where number_id = target_number and contact_wa_id = contact;
    update public.wa_conversations set saved_name = null where number_id = target_number and contact_wa_id = contact;
    return jsonb_build_object('ok', true, 'code', 'removed');
  end if;

  insert into public.wa_contacts (number_id, org_id, contact_wa_id, saved_name)
  values (target_number, target_org, contact, clean_name)
  on conflict (number_id, contact_wa_id) do update set saved_name = excluded.saved_name, updated_at = now();
  update public.wa_conversations set saved_name = clean_name where number_id = target_number and contact_wa_id = contact;
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.wa_sync_contact(uuid, uuid, text, text, text) from public, anon, authenticated;

/** What the backend records of the two coexistence syncs: that each was asked, and how far the history got. */
create or replace function public.wa_note_sync(
  target_org uuid,
  target_number uuid,
  target_sync text,
  target_progress integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.wa_numbers set
    contacts_sync_requested_at = case when target_sync = 'contacts' then coalesce(contacts_sync_requested_at, now()) else contacts_sync_requested_at end,
    history_sync_requested_at = case when target_sync = 'history' then coalesce(history_sync_requested_at, now()) else history_sync_requested_at end,
    history_progress = case
      when target_sync = 'history' and target_progress is not null
        then greatest(coalesce(history_progress, 0), least(greatest(target_progress, 0), 100))
      else history_progress
    end
  where id = target_number and org_id = target_org;
  return jsonb_build_object('ok', found);
end;
$$;

revoke all on function public.wa_note_sync(uuid, uuid, text, integer) from public, anon, authenticated;

/**
 * A piece of the history the firm shared when it connected a number that also
 * lives on the phone app: many messages in one call, each mirrored as
 * `wa_ingest_mirrored` does. One this code cannot read (a kind it does not
 * know, a moment that is no moment) is left out and counted, and the rest of
 * the piece still enters.
 */
create or replace function public.wa_ingest_history(
  target_org uuid,
  target_number uuid,
  target_messages jsonb,
  target_progress integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  answer jsonb;
  mirrored integer := 0;
  skipped integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(target_messages, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_messages' using errcode = '22023';
  end if;
  if not exists (select 1 from public.wa_numbers n where n.id = target_number and n.org_id = target_org) then
    return jsonb_build_object('ok', false, 'code', 'number_not_found');
  end if;

  for item in select * from jsonb_array_elements(coalesce(target_messages, '[]'::jsonb)) loop
    begin
      answer := public.wa_ingest_mirrored(
        target_org, target_number, item ->> 'contact', item ->> 'wa_message_id',
        item ->> 'direction', 'history', item ->> 'kind', item ->> 'body',
        (item ->> 'wa_timestamp')::timestamptz, item ->> 'status'
      );
      if answer ->> 'code' = 'mirrored' then
        mirrored := mirrored + 1;
      else
        skipped := skipped + 1;
      end if;
    exception when check_violation or not_null_violation or invalid_parameter_value
                or invalid_datetime_format or datetime_field_overflow then
      skipped := skipped + 1;
    end;
  end loop;

  perform public.wa_note_sync(target_org, target_number, 'history', target_progress);
  return jsonb_build_object('ok', true, 'mirrored', mirrored, 'skipped', skipped);
end;
$$;

revoke all on function public.wa_ingest_history(uuid, uuid, jsonb, integer) from public, anon, authenticated;

/**
 * What the vendor says became of a message the firm sent. A status never goes
 * back (a `delivered` that arrives after `read` changes nothing), and the
 * pricing it carries is kept the first time it comes.
 */
create or replace function public.wa_apply_status(
  target_org uuid,
  target_number uuid,
  target_wa_message_id text,
  target_status text,
  target_error_code text default null,
  target_pricing_category text default null,
  target_pricing_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  message public.wa_messages%rowtype;
  rank_of constant jsonb := '{"queued": 0, "sending": 1, "sent": 2, "delivered": 3, "read": 4}'::jsonb;
  code text := nullif(left(regexp_replace(lower(coalesce(target_error_code, '')), '[^a-z0-9_]', '_', 'g'), 63), '');
  moved boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_status not in ('sent', 'delivered', 'read', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'ignored');
  end if;

  select * into message from public.wa_messages m
  where m.number_id = target_number and m.org_id = target_org and m.wa_message_id = target_wa_message_id
    and m.direction = 'out'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if target_status = 'failed' then
    moved := message.status not in ('read', 'failed');
  else
    moved := message.status <> 'failed'
      and (rank_of ->> target_status)::integer > coalesce((rank_of ->> message.status)::integer, 0);
  end if;

  update public.wa_messages set
    status = case when moved then target_status else status end,
    error_code = case when moved and target_status = 'failed' then coalesce(code, 'failed') else error_code end,
    pricing_category = coalesce(pricing_category, nullif(target_pricing_category, '')),
    pricing_type = coalesce(pricing_type, nullif(target_pricing_type, ''))
  where id = message.id;

  return jsonb_build_object('ok', true, 'code', case when moved then 'updated' else 'kept' end, 'message_id', message.id);
end;
$$;

revoke all on function public.wa_apply_status(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

-- ---------- Sending (a person reserves, the backend sends) ----------

/**
 * Reserves a message to a person: the row is written as `queued`, and only
 * then does the backend send it. Every rule of what may be sent is here:
 *
 *   * a person of the firm, never from a support visit;
 *   * the number is active;
 *   * free text and media only inside the 24 hours after the person's last
 *     message (`window_closed` otherwise);
 *   * a template only when approved for the account of that number, with as
 *     many values as it has placeholders, and never to somebody who opted out.
 */
create or replace function public.reserve_wa_send(
  target_conversation uuid,
  target_kind text,
  target_body text default null,
  target_template uuid default null,
  target_template_params jsonb default null,
  target_media_file uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  conversation public.wa_conversations%rowtype;
  wa_number public.wa_numbers%rowtype;
  template public.wa_templates%rowtype;
  media public.files%rowtype;
  text_body text := nullif(btrim(coalesce(target_body, '')), '');
  params jsonb := coalesce(target_template_params, '[]'::jsonb);
  rendered text;
  message uuid;
  slot integer;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;

  select * into conversation from public.wa_conversations where id = target_conversation for update;
  -- The same answer for one that does not exist and one of another firm.
  if not found or not public.is_org_member(conversation.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into wa_number from public.wa_numbers where id = conversation.number_id;
  if wa_number.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'number_disconnected');
  end if;

  if target_kind = 'text' then
    if text_body is null then
      return jsonb_build_object('ok', false, 'code', 'empty');
    end if;
    if char_length(text_body) > 4096 then
      return jsonb_build_object('ok', false, 'code', 'too_long');
    end if;
    if not public.wa_window_open(conversation.last_inbound_at) then
      return jsonb_build_object('ok', false, 'code', 'window_closed');
    end if;
    rendered := text_body;

  elsif target_kind in ('image', 'document') then
    if not public.wa_window_open(conversation.last_inbound_at) then
      return jsonb_build_object('ok', false, 'code', 'window_closed');
    end if;
    -- A file of the firm, but never one the backend made for its own use (the PDF of a photo, a part
    -- cut for a filing package): those are forgotten by who made them, and a message must not name them.
    select * into media from public.files
    where id = target_media_file and org_id = conversation.org_id and status = 'stored'
      and purpose not in ('normalized', 'filing');
    if not found then
      return jsonb_build_object('ok', false, 'code', 'file_not_found');
    end if;
    if (target_kind = 'image' and media.detected_mime not in ('image/jpeg', 'image/png'))
       or (target_kind = 'document' and media.detected_mime <> 'application/pdf') then
      return jsonb_build_object('ok', false, 'code', 'type_not_allowed');
    end if;
    if media.bytes > coalesce((public.wa_setting('media_max_bytes') ->> target_kind)::bigint, media.bytes) then
      return jsonb_build_object('ok', false, 'code', 'too_large');
    end if;
    if text_body is not null and char_length(text_body) > 1024 then
      return jsonb_build_object('ok', false, 'code', 'too_long');
    end if;
    rendered := text_body;

  elsif target_kind = 'template' then
    select * into template from public.wa_templates
    where id = target_template and org_id = conversation.org_id and waba_id = wa_number.waba_id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'template_not_found');
    end if;
    if template.status <> 'approved' then
      return jsonb_build_object('ok', false, 'code', 'template_not_approved');
    end if;
    if jsonb_typeof(params) <> 'array' or jsonb_array_length(params) <> template.param_count
       or exists (
         select 1 from jsonb_array_elements(params) as value
         where jsonb_typeof(value) <> 'string' or btrim(value #>> '{}') = '' or char_length(value #>> '{}') > 500
       ) then
      return jsonb_build_object('ok', false, 'code', 'template_params_mismatch');
    end if;
    if exists (
      select 1 from public.wa_optouts o
      where o.org_id = conversation.org_id and o.contact_wa_id = conversation.contact_wa_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'opted_out');
    end if;
    -- What the thread shows: the template's text with the values in place.
    rendered := template.body;
    for slot in 1..template.param_count loop
      rendered := replace(rendered, '{{' || slot || '}}', params ->> (slot - 1));
    end loop;
    rendered := left(rendered, 4096);

  else
    return jsonb_build_object('ok', false, 'code', 'invalid_kind');
  end if;

  insert into public.wa_messages (
    org_id, conversation_id, number_id, direction, origin, kind, body,
    template_id, template_name, template_params, media_file_id, media_mime, media_filename, media_status,
    status, sent_by
  ) values (
    conversation.org_id, conversation.id, conversation.number_id, 'out', 'cloud', target_kind, rendered,
    template.id, template.name, case when target_kind = 'template' then params end,
    media.id, media.detected_mime, media.name, case when media.id is not null then 'stored' else 'none' end,
    'queued', caller
  )
  returning id into message;

  update public.wa_conversations set
    last_message_at = now(),
    last_message_preview = public.wa_preview(target_kind, rendered),
    last_message_direction = 'out',
    unread_count = 0
  where id = conversation.id;

  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message, 'org_id', conversation.org_id);
end;
$$;

revoke all on function public.reserve_wa_send(uuid, text, text, uuid, jsonb, uuid) from public, anon;
grant execute on function public.reserve_wa_send(uuid, text, text, uuid, jsonb, uuid) to authenticated;

/**
 * Takes queued messages for sending: one in particular (the one a person
 * just reserved), or the oldest ones (the sweep). A message taken is
 * `sending` and is never taken again. One taken long ago and never confirmed
 * is closed as failed, `unconfirmed`: it may or may not have gone out, and
 * sending it again could deliver it twice, so a person decides.
 */
create or replace function public.claim_wa_outbox(target_message uuid default null, target_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  minutes integer := coalesce((public.wa_setting('unconfirmed_after_minutes') #>> '{}')::integer, 10);
  claimed jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.wa_messages set status = 'failed', error_code = 'unconfirmed'
  where status = 'sending' and claimed_at < now() - make_interval(mins => greatest(minutes, 1));

  with picked as (
    select m.id from public.wa_messages m
    where m.status = 'queued' and (target_message is null or m.id = target_message)
    order by m.created_at
    limit least(greatest(coalesce(target_limit, 20), 1), 200)
    for update skip locked
  ),
  taken as (
    update public.wa_messages m set status = 'sending', claimed_at = now(), attempts = m.attempts + 1
    from picked where m.id = picked.id
    returning m.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'message_id', t.id,
    'org_id', t.org_id,
    'number_id', t.number_id,
    'kind', t.kind,
    'body', t.body,
    'template_name', t.template_name,
    'template_language', (select w.language from public.wa_templates w where w.id = t.template_id),
    'template_params', t.template_params,
    'media_path', (select f.storage_path from public.files f where f.id = t.media_file_id),
    'media_mime', t.media_mime,
    'media_filename', t.media_filename,
    'to', c.contact_wa_id,
    'provider', n.provider,
    'phone_number_id', n.phone_number_id,
    'waba_id', n.waba_id,
    'connection_id', n.connection_id,
    'number_status', n.status
  ) order by t.created_at), '[]'::jsonb) into claimed
  from taken t
  join public.wa_conversations c on c.id = t.conversation_id
  join public.wa_numbers n on n.id = t.number_id;

  return claimed;
end;
$$;

revoke all on function public.claim_wa_outbox(uuid, integer) from public, anon, authenticated;

/** What came of a send the backend claimed: accepted by the vendor (with its id), or refused (with a code). */
create or replace function public.mark_wa_send(
  target_org uuid,
  target_message uuid,
  target_ok boolean,
  target_wa_message_id text default null,
  target_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  code text := nullif(left(regexp_replace(lower(coalesce(target_error_code, '')), '[^a-z0-9_]', '_', 'g'), 63), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  -- An answer that is neither yes nor no is no answer: recording it as a failure would be a guess.
  if target_ok is null then
    raise exception 'invalid_result' using errcode = '22023';
  end if;
  update public.wa_messages set
    status = case when target_ok then 'sent' else 'failed' end,
    wa_message_id = case when target_ok then nullif(target_wa_message_id, '') else wa_message_id end,
    error_code = case when target_ok then null else coalesce(code, 'failed') end,
    wa_timestamp = case when target_ok then now() else wa_timestamp end
  where id = target_message and org_id = target_org and status = 'sending';
  return jsonb_build_object('ok', found, 'code', case when found then 'marked' else 'not_sending' end);
end;
$$;

revoke all on function public.mark_wa_send(uuid, uuid, boolean, text, text) from public, anon, authenticated;

-- ---------- Media that arrived ----------

/** Takes messages whose media still has to be brought into the firm's files. One left half-way is taken again. */
create or replace function public.claim_wa_media(target_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- The vendor keeps a received media for 7 days: after that there is nothing to fetch.
  update public.wa_messages set media_status = 'failed', error_code = coalesce(error_code, 'media_expired')
  where media_status in ('pending', 'fetching') and created_at < now() - interval '7 days';

  with picked as (
    select m.id from public.wa_messages m
    where m.media_status = 'pending'
       or (m.media_status = 'fetching' and m.media_claimed_at < now() - interval '10 minutes')
    order by m.created_at
    limit least(greatest(coalesce(target_limit, 10), 1), 50)
    for update skip locked
  ),
  taken as (
    update public.wa_messages m set media_status = 'fetching', media_claimed_at = now()
    from picked where m.id = picked.id
    returning m.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'message_id', t.id,
    'org_id', t.org_id,
    'number_id', t.number_id,
    'media_wa_id', t.media_wa_id,
    'media_mime', t.media_mime,
    'media_filename', t.media_filename,
    'kind', t.kind,
    'provider', n.provider,
    'phone_number_id', n.phone_number_id,
    'connection_id', n.connection_id
  )), '[]'::jsonb) into claimed
  from taken t join public.wa_numbers n on n.id = t.number_id;

  return claimed;
end;
$$;

revoke all on function public.claim_wa_media(integer) from public, anon, authenticated;

/** The media of a message is in the firm's files now, or could not be brought. */
create or replace function public.set_wa_media(
  target_org uuid,
  target_message uuid,
  target_file uuid default null,
  target_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  code text := nullif(left(regexp_replace(lower(coalesce(target_error_code, '')), '[^a-z0-9_]', '_', 'g'), 63), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_file is not null and not exists (
    select 1 from public.files f where f.id = target_file and f.org_id = target_org and f.status = 'stored'
  ) then
    return jsonb_build_object('ok', false, 'code', 'file_not_found');
  end if;
  update public.wa_messages set
    media_file_id = target_file,
    media_status = case when target_file is not null then 'stored' else 'failed' end,
    error_code = case when target_file is null then coalesce(code, 'media_failed') else error_code end
  where id = target_message and org_id = target_org and media_status in ('pending', 'fetching');
  return jsonb_build_object('ok', found);
end;
$$;

revoke all on function public.set_wa_media(uuid, uuid, uuid, text) from public, anon, authenticated;

-- ---------- Templates (the backend syncs them from the account) ----------

/**
 * Replaces what ONE knows of an account's templates with what the vendor
 * returned. One the vendor no longer lists is kept as `disabled`, so the
 * messages sent with it still say what they were.
 */
create or replace function public.sync_wa_templates(target_org uuid, target_waba text, target_templates jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  kept integer := 0;
  skipped integer := 0;
  names text[] := '{}';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.wa_numbers n where n.org_id = target_org and n.waba_id = target_waba) then
    return jsonb_build_object('ok', false, 'code', 'account_not_found');
  end if;
  if jsonb_typeof(coalesce(target_templates, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_templates' using errcode = '22023';
  end if;

  for item in select * from jsonb_array_elements(coalesce(target_templates, '[]'::jsonb)) loop
    begin
      insert into public.wa_templates (
        org_id, waba_id, name, language, category, status, body, header_text, footer_text, param_count, components
      ) values (
        target_org, target_waba, item ->> 'name', coalesce(item ->> 'language', 'pt_BR'),
        lower(item ->> 'category'), lower(item ->> 'status'), item ->> 'body',
        nullif(item ->> 'header_text', ''), nullif(item ->> 'footer_text', ''),
        coalesce((item ->> 'param_count')::integer, 0), coalesce(item -> 'components', '[]'::jsonb)
      )
      on conflict (org_id, waba_id, name, language) do update set
        category = excluded.category,
        status = excluded.status,
        body = excluded.body,
        header_text = excluded.header_text,
        footer_text = excluded.footer_text,
        param_count = excluded.param_count,
        components = excluded.components,
        synced_at = now();
      kept := kept + 1;
      names := names || ((item ->> 'name') || '/' || coalesce(item ->> 'language', 'pt_BR'));
    exception when check_violation or not_null_violation or invalid_text_representation then
      -- A template this code cannot represent (a status or category it does
      -- not know, a body over the limit) is left out, and counted.
      skipped := skipped + 1;
    end;
  end loop;

  update public.wa_templates set status = 'disabled', synced_at = now()
  where org_id = target_org and waba_id = target_waba and status <> 'disabled'
    and not ((name || '/' || language) = any (names));

  return jsonb_build_object('ok', true, 'kept', kept, 'skipped', skipped);
end;
$$;

revoke all on function public.sync_wa_templates(uuid, text, jsonb) from public, anon, authenticated;

/**
 * The vendor changed what a template is: approved, rejected, paused. Only a
 * template ONE already knows is touched, in the firms that have a number of
 * that provider in the account; a new one arrives with the next sync, which
 * brings its text. A word this code does not know changes nothing.
 */
create or replace function public.wa_set_template_status(
  target_provider text,
  target_waba_id text,
  target_name text,
  target_language text,
  target_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  word text := lower(btrim(coalesce(target_status, '')));
  new_status text;
  changed integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  new_status := case
    when word in ('approved', 'pending', 'rejected', 'paused', 'disabled') then word
    when word = 'reinstated' then 'approved'
    when word = 'in_appeal' then 'pending'
    when word in ('pending_deletion', 'deleted', 'archived') then 'disabled'
  end;
  if new_status is null then
    return jsonb_build_object('ok', false, 'code', 'ignored');
  end if;

  update public.wa_templates t set status = new_status, synced_at = now()
  where t.waba_id = target_waba_id and t.name = target_name
    and (target_language is null or t.language = target_language)
    and t.status <> new_status
    and exists (
      select 1 from public.wa_numbers n
      where n.org_id = t.org_id and n.provider = target_provider and n.waba_id = target_waba_id
    );
  get diagnostics changed = row_count;
  return jsonb_build_object('ok', true, 'changed', changed);
end;
$$;

revoke all on function public.wa_set_template_status(text, text, text, text, text) from public, anon, authenticated;

-- ---------- What a person of the firm does in a conversation ----------

/** The person opened the conversation: nothing in it is unread. */
create or replace function public.wa_mark_read(target_conversation uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- A support visit reads the conversation and leaves it as it found it.
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'not_allowed_in_support_session');
  end if;
  select * into conversation from public.wa_conversations where id = target_conversation;
  if not found or not public.is_org_member(conversation.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  update public.wa_conversations set unread_count = 0 where id = conversation.id and unread_count > 0;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.wa_mark_read(uuid) from public, anon;
grant execute on function public.wa_mark_read(uuid) to authenticated;

/**
 * Records that a person asked the firm to stop, when they said it somewhere
 * else (a call, the office), or removes it. Recording is anybody's of the
 * firm; removing is for who manages the firm or works its cases, because it
 * states that the person agreed to be written to again. Both take a note,
 * and both are audited.
 */
create or replace function public.set_wa_optout(
  target_conversation uuid,
  target_opted_out boolean,
  target_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  conversation public.wa_conversations%rowtype;
  note text := nullif(btrim(coalesce(target_note, '')), '');
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into conversation from public.wa_conversations where id = target_conversation;
  if not found or not public.is_org_member(conversation.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if note is null or char_length(note) < 8 then
    return jsonb_build_object('ok', false, 'code', 'note_required');
  end if;

  if target_opted_out then
    insert into public.wa_optouts (org_id, contact_wa_id, source, note, recorded_by)
    values (conversation.org_id, conversation.contact_wa_id, 'manual', left(note, 500), caller)
    on conflict (org_id, contact_wa_id) do nothing;
    if not found then
      return jsonb_build_object('ok', true, 'code', 'already_opted_out');
    end if;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (conversation.org_id, caller, 'whatsapp.optout.recorded', 'wa_conversation', conversation.id::text,
            jsonb_build_object('source', 'manual', 'note', left(note, 500)));
    return jsonb_build_object('ok', true, 'code', 'opted_out');
  end if;

  if not (
    public.has_org_role(conversation.org_id, array['owner', 'admin']::public.org_role[])
    or public.has_firm_function(conversation.org_id, array['socio', 'advogado']::public.firm_function[])
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.wa_optouts where org_id = conversation.org_id and contact_wa_id = conversation.contact_wa_id;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'not_opted_out');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (conversation.org_id, caller, 'whatsapp.optout.removed', 'wa_conversation', conversation.id::text,
          jsonb_build_object('source', 'manual', 'note', left(note, 500)));
  return jsonb_build_object('ok', true, 'code', 'opted_in');
end;
$$;

revoke all on function public.set_wa_optout(uuid, boolean, text) from public, anon;
grant execute on function public.set_wa_optout(uuid, boolean, text) to authenticated;
