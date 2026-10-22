-- ============================================================
-- 0047_test_chat: the firm's test chat, the trips ONE follows, and ONE's
-- first word when a flight it follows has a problem.
--
-- The adjustments before the tests, phase 3 (the plan of 2026-10-22,
-- approved by the owner the same day): the conversation with a passenger
-- starts with ONE, when a flight it follows is cancelled, changed or late
-- at its destination by the setting's hours, and the passenger decides
-- whether the firm looks at the case. ONE writes only to who registered the
-- trip with the firm and agreed to be told of it, in words of their own
-- kept with the trip (`tracked_trips`); no list of passengers exists
-- anywhere, so with no registration ONE has nobody to write to.
--
-- Until a firm has its WhatsApp at the vendor, it tests the journey in a
-- chat of its own (`test_chats`): a third kind of number (`wa_numbers`
-- provider `test`) beside the vendor's and the simulator's, which is
-- honoured in production, sends nothing out of ONE and reaches nobody at
-- the vendor. Its page, opened by a link with no account, stands where the
-- passenger's phone stands, through the same functions a real delivery goes
-- through; it comes with four trips ready (an adult alone whose flight is
-- cancelled, a family with a child whose flight lands six hours late, a
-- connection lost, an international flight), each with its tools to make
-- the problem happen. A firm's numbers are the vendor's, or the simulator's
-- and the test chat's, never both: its first real number ends the test chat.
--
-- What is a problem is a rule (`flight-problem-v1`, `@flyee/rules`), run by
-- the app on what a source says of each leg (the test chat's tools now,
-- FlightAware later); the database keeps one alert per trip and fact
-- (`flight_alerts`) and sends it once, as a template of the firm's own
-- (the notice kind `flight_problem`), never to who asked to stop.
-- ============================================================

-- ---------- A third kind of number ----------

alter table public.wa_numbers drop constraint wa_numbers_provider_check;
alter table public.wa_numbers add constraint wa_numbers_provider_check
  check (provider in ('meta', 'simulator', 'test'));

insert into public.platform_settings (key, value, is_public) values
  ('flight_alerts', jsonb_build_object(
    -- A flight that lands this late at the trip's destination is told: four hours, where Resolução 400 of
    -- ANAC (art. 21) gives the passenger another flight, the refund or another way to travel.
    'delay_minutes', 240,
    -- How long a claim of an alert holds before the sweep takes it again.
    'stale_minutes', 10,
    -- What a test chat takes from its tester in a minute: what the page sends, and the problems it makes happen.
    'test_messages_per_minute', 30
  ), false)
on conflict (key) do nothing;

create or replace function public.flight_alerts_setting(setting text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select (ps.value ->> setting)::integer from public.platform_settings ps
    where ps.key = 'flight_alerts' and coalesce(ps.value ->> setting, '') ~ '^[0-9]{1,6}$'
  ), fallback);
$$;

revoke all on function public.flight_alerts_setting(text, integer) from public, anon, authenticated;

-- ---------- The test chat ----------

/**
 * A firm's test chat: its number, and the secret of the link its page opens
 * by. The secret is read only through `test_chat_link`, by who manages the
 * firm or a partner; no member reads the column, and the backup leaves the
 * table out (a firm turns its chat on again). One in use per firm.
 */
create table public.test_chats (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  number_id uuid not null,
  token text not null unique,
  status text not null default 'active',
  started_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text,
  unique (id, org_id),
  foreign key (number_id, org_id) references public.wa_numbers (id, org_id) on delete cascade,
  constraint test_chats_token_check check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  constraint test_chats_status_check check (status in ('active', 'ended')),
  constraint test_chats_ended_check check ((status = 'ended') = (ended_at is not null)),
  constraint test_chats_reason_check check (
    ended_reason is null or ended_reason in ('turned_off', 'replaced_by_real_number')
  )
);

create unique index test_chats_active_idx on public.test_chats (org_id) where status = 'active';

alter table public.test_chats enable row level security;
create policy "test_chats_select_member" on public.test_chats
  for select to authenticated using (public.is_org_member(org_id));
grant select (id, org_id, number_id, status, started_by, started_at, ended_at, ended_reason)
  on table public.test_chats to authenticated;
create trigger guard_impersonation_test_chats after insert or update or delete on public.test_chats
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- The trips ONE follows ----------

/**
 * A trip somebody registered with the firm to be told of it: who travels,
 * the mobile ONE writes to, who goes along, and the passenger's agreement in
 * the words they read. A trip of the test chat is invented (`is_test`, with
 * the name of its scenario) and is told only through the test chat.
 */
create table public.tracked_trips (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  passenger_name text not null,
  phone text not null,
  -- Who else travels, as the registration says: each name, and a birth date for a child.
  companions jsonb not null default '[]'::jsonb,
  airline_iata text not null,
  is_test boolean not null default false,
  label text,
  consent_wording text not null,
  consent_at timestamptz not null,
  consent_channel text not null,
  -- watching: nothing to tell; alerted: told of a problem; case_opened: the passenger said yes and the case
  -- opened; declined: the passenger said no; stopped: the passenger asked to stop.
  status text not null default 'watching',
  case_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete set null (case_id),
  constraint tracked_trips_name_check check (char_length(btrim(passenger_name)) between 2 and 200),
  constraint tracked_trips_phone_check check (phone ~ '^[0-9]{12,15}$'),
  constraint tracked_trips_airline_check check (airline_iata ~ '^[A-Z0-9]{2}$'),
  constraint tracked_trips_companions_check check (
    jsonb_typeof(companions) = 'array' and jsonb_array_length(companions) <= 9
  ),
  constraint tracked_trips_test_check check (is_test = (label is not null)),
  constraint tracked_trips_label_check check (label is null or label ~ '^[a-z][a-z_]{2,40}$'),
  constraint tracked_trips_consent_check check (
    char_length(consent_wording) between 20 and 2000 and consent_channel in ('test', 'page', 'whatsapp', 'firm')
  ),
  constraint tracked_trips_status_check check (
    status in ('watching', 'alerted', 'case_opened', 'declined', 'stopped')
  )
);

create unique index tracked_trips_test_label_idx on public.tracked_trips (org_id, label) where is_test;
create index tracked_trips_phone_idx on public.tracked_trips (org_id, phone);

alter table public.tracked_trips enable row level security;
create policy "tracked_trips_select_member" on public.tracked_trips
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.tracked_trips to authenticated;
create trigger tracked_trips_updated_at before update on public.tracked_trips
  for each row execute function public.set_updated_at();
create trigger guard_impersonation_tracked_trips after insert or update or delete on public.tracked_trips
  for each statement execute function public.guard_impersonation_readonly();

/**
 * Each leg of a trip, in the local times of its airports (as tickets print
 * them), and what a source says of it now: the test chat's tools
 * (`simulated`) or, later, FlightAware.
 */
create table public.tracked_legs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  trip_id uuid not null,
  position integer not null,
  flight_number text not null,
  origin_iata text not null,
  destination_iata text not null,
  scheduled_departure_local timestamp not null,
  scheduled_arrival_local timestamp not null,
  status text not null default 'scheduled',
  estimated_arrival_local timestamp,
  status_source text,
  status_at timestamptz,
  unique (id, org_id),
  unique (trip_id, position),
  foreign key (trip_id, org_id) references public.tracked_trips (id, org_id) on delete cascade,
  constraint tracked_legs_position_check check (position between 1 and 6),
  constraint tracked_legs_flight_check check (flight_number ~ '^[A-Z0-9]{2}[0-9]{1,4}[A-Z]?$'),
  constraint tracked_legs_airports_check check (
    origin_iata ~ '^[A-Z]{3}$' and destination_iata ~ '^[A-Z]{3}$' and origin_iata <> destination_iata
  ),
  constraint tracked_legs_status_check check (status in ('scheduled', 'delayed', 'cancelled', 'changed', 'landed')),
  constraint tracked_legs_source_check check (status_source is null or status_source in ('simulated', 'flightaware')),
  constraint tracked_legs_estimate_check check (status <> 'delayed' or estimated_arrival_local is not null)
);

create index tracked_legs_trip_idx on public.tracked_legs (trip_id, position);

alter table public.tracked_legs enable row level security;
create policy "tracked_legs_select_member" on public.tracked_legs
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.tracked_legs to authenticated;
create trigger guard_impersonation_tracked_legs after insert or update or delete on public.tracked_legs
  for each statement execute function public.guard_impersonation_readonly();

/**
 * What ONE found wrong with a trip, once per trip and fact (a delay and then
 * a cancellation are two), and what came of telling it: the template that
 * went (`sent`), or why none could (`skipped`, with the reason), and the
 * passenger's answer.
 */
create table public.flight_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  trip_id uuid not null,
  kind text not null,
  leg_position integer,
  delay_minutes integer,
  rule_version text not null,
  status text not null default 'due',
  reason text,
  claims integer not null default 0,
  claimed_at timestamptz,
  message_id uuid references public.wa_messages (id) on delete set null,
  sent_at timestamptz,
  answer text,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  unique (trip_id, kind),
  foreign key (trip_id, org_id) references public.tracked_trips (id, org_id) on delete cascade,
  constraint flight_alerts_kind_check check (kind in ('cancelled', 'changed', 'delayed')),
  constraint flight_alerts_status_check check (status in ('due', 'sent', 'skipped')),
  constraint flight_alerts_sent_check check ((status = 'sent') = (message_id is not null or sent_at is not null)),
  constraint flight_alerts_reason_check check ((status = 'skipped') = (reason is not null)),
  constraint flight_alerts_reason_shape_check check (reason is null or reason ~ '^[a-z][a-z_]{2,40}$'),
  constraint flight_alerts_delay_check check (delay_minutes is null or delay_minutes between 0 and 20160),
  constraint flight_alerts_answer_check check (answer is null or answer in ('yes', 'no', 'stop')),
  constraint flight_alerts_rule_check check (rule_version ~ '^[a-z][a-z0-9-]{2,40}$')
);

create index flight_alerts_due_idx on public.flight_alerts (created_at) where status = 'due';

alter table public.flight_alerts enable row level security;
create policy "flight_alerts_select_member" on public.flight_alerts
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.flight_alerts to authenticated;
create trigger guard_impersonation_flight_alerts after insert or update or delete on public.flight_alerts
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- ONE's first word: a template of the firm's own ----------

alter table public.notice_kinds drop constraint notice_kinds_kind_check;
alter table public.notice_kinds add constraint notice_kinds_kind_check check (kind in (
  'hearing_reminder', 'hearing_change', 'lawsuit_update', 'payment_alert', 'document_refused', 'flight_problem'
));
alter table public.notice_kinds drop constraint notice_kinds_params_check;
alter table public.notice_kinds add constraint notice_kinds_params_check check (
  cardinality(params) between 1 and 9 and cardinality(examples) = cardinality(params)
  and params <@ array['first_name', 'firm', 'hearing', 'lawsuit', 'moment', 'how', 'change', 'status', 'document', 'reason',
                      'flight', 'what', 'assistance']
);

-- What ONE says first: what happened, what the airline owes by ANAC's rules, and the choice. It names the
-- firm and says it is the firm's automatic assistant; it promises nothing.
insert into public.notice_kinds (kind, position, template_base, body, footer, params, examples) values
  ('flight_problem', 6, 'one_aviso_voo',
   'Olá, {{1}}. Aqui é o assistente automático do escritório {{2}}. O seu voo {{3}} {{4}}. Pelas regras da ANAC, a companhia aérea deve {{5}}. Quer que o escritório avalie o seu caso? Responda SIM para seguir ou NÃO se não quiser.',
   'Para não receber estes avisos, responda SAIR.',
   array['first_name', 'firm', 'flight', 'what', 'assistance'],
   array['Mariana', 'Souza Advogados', 'LA 3456 de São Paulo (GRU) para Recife (REC), de 22/10/2099', 'foi cancelado',
         'oferecer outro voo, o reembolso ou outro meio de transporte, e dar comunicação, alimentação e, se for preciso passar a noite, hospedagem com o transporte até ela'])
on conflict (kind) do nothing;

-- ---------- Connecting: a test chat never beside a real number ----------

/**
 * Records a number of a firm after its token was sealed (replaces the one of
 * 0019, adding the test chat): a number is active in one firm at a time, and
 * connecting again one the firm had brings it back. A firm's numbers are
 * the vendor's, or the simulator's and the test chat's, never both: its first
 * real number ends the simulator and the test chat, for good.
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
  -- A firm's numbers are the vendor's or the simulator's and the test chat's, never both. An opt-out belongs
  -- to the firm, whatever number it was said to: with the two side by side, a simulated "voltar" would undo
  -- what a real person asked.
  if target_provider in ('simulator', 'test') and exists (
    select 1 from public.wa_numbers n where n.org_id = target_org and n.provider = 'meta'
  ) then
    return jsonb_build_object('ok', false, 'code',
      case when target_provider = 'test' then 'test_chat_not_allowed' else 'simulator_not_allowed' end);
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

  -- The firm's first real number ends its time on the simulator and the test chat, for good.
  if target_provider = 'meta' then
    update public.wa_numbers set
      status = 'disconnected', disconnect_reason = 'replaced_by_real_number', disconnected_at = now()
    where org_id = target_org and provider in ('simulator', 'test') and status = 'active';
    update public.test_chats set status = 'ended', ended_at = now(), ended_reason = 'replaced_by_real_number'
    where org_id = target_org and status = 'active';
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, conn.connected_by, 'whatsapp.number.connected', 'wa_number', number_id::text,
          jsonb_build_object('provider', target_provider, 'mode', coalesce(target_mode, 'cloud')));

  return jsonb_build_object('ok', true, 'code', 'registered', 'number_id', number_id);
end;
$$;

revoke all on function public.register_wa_number(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;

-- ---------- Turning the test chat on and off ----------

/** Who may turn a firm's test chat on, change its link or turn it off, and read its link: who manages it, or a partner. */
create or replace function public.test_chat_keeper(target_org uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = target_user
      and (m.role in ('owner', 'admin') or m.firm_function = 'socio')
  );
$$;

revoke all on function public.test_chat_keeper(uuid, uuid) from public, anon, authenticated;

/**
 * The four trips of the test chat, ready (the owner asked for them so on
 * 2026-10-22), made once per firm and kept: an adult alone whose flight is
 * cancelled, a family with a child of seven whose flight lands six hours
 * late, a connection lost, and an international flight late by nine hours.
 * Each passenger is invented and agreed in the words a real one would read,
 * and their mobile is of an area code no carrier has. The flights are of the
 * day the tools are used: the tools move them there.
 */
create or replace function public.seed_test_trips(target_org uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  firm text := (select o.name from public.organizations o where o.id = target_org);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  wording text;
  trip uuid;
  made integer := 0;
begin
  wording := 'Concordo em receber, pelo WhatsApp do escritório ' || firm
    || ', avisos sobre a viagem que cadastrei, como atrasos e cancelamentos, e sei que posso parar quando quiser respondendo SAIR.';

  if not exists (select 1 from public.tracked_trips t where t.org_id = target_org and t.is_test and t.label = 'cancelamento') then
    insert into public.tracked_trips (org_id, passenger_name, phone, airline_iata, is_test, label, consent_wording, consent_at, consent_channel)
    values (target_org, 'Mariana Teste', '5500988880001', 'LA', true, 'cancelamento', wording, now(), 'test')
    returning id into trip;
    insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                     scheduled_departure_local, scheduled_arrival_local)
    values (target_org, trip, 1, 'LA3456', 'GRU', 'REC', today + time '08:10', today + time '11:25');
    made := made + 1;
  end if;

  if not exists (select 1 from public.tracked_trips t where t.org_id = target_org and t.is_test and t.label = 'familia') then
    insert into public.tracked_trips (org_id, passenger_name, phone, companions, airline_iata, is_test, label,
                                      consent_wording, consent_at, consent_channel)
    values (target_org, 'Rafael Teste', '5500988880002',
            jsonb_build_array(jsonb_build_object('name', 'Laura Teste',
              'birth_date', to_char(today - interval '7 years' - interval '120 days', 'YYYY-MM-DD'))),
            'G3', true, 'familia', wording, now(), 'test')
    returning id into trip;
    insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                     scheduled_departure_local, scheduled_arrival_local)
    values (target_org, trip, 1, 'G31450', 'BSB', 'GIG', today + time '14:00', today + time '15:45');
    made := made + 1;
  end if;

  if not exists (select 1 from public.tracked_trips t where t.org_id = target_org and t.is_test and t.label = 'conexao') then
    insert into public.tracked_trips (org_id, passenger_name, phone, airline_iata, is_test, label, consent_wording, consent_at, consent_channel)
    values (target_org, 'Lúcia Teste', '5500988880003', 'AD', true, 'conexao', wording, now(), 'test')
    returning id into trip;
    insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                     scheduled_departure_local, scheduled_arrival_local)
    values (target_org, trip, 1, 'AD4120', 'CNF', 'VCP', today + time '07:00', today + time '08:20'),
           (target_org, trip, 2, 'AD2735', 'VCP', 'POA', today + time '09:30', today + time '11:05');
    made := made + 1;
  end if;

  if not exists (select 1 from public.tracked_trips t where t.org_id = target_org and t.is_test and t.label = 'internacional') then
    insert into public.tracked_trips (org_id, passenger_name, phone, airline_iata, is_test, label, consent_wording, consent_at, consent_channel)
    values (target_org, 'Pedro Teste', '5500988880004', 'LA', true, 'internacional', wording, now(), 'test')
    returning id into trip;
    insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                     scheduled_departure_local, scheduled_arrival_local)
    values (target_org, trip, 1, 'LA8084', 'GRU', 'LIS', today + time '23:55', today + 1 + time '14:10');
    made := made + 1;
  end if;

  return made;
end;
$$;

revoke all on function public.seed_test_trips(uuid) from public, anon, authenticated;

/**
 * The template of ONE's first word on the test chat's account, approved as
 * the test chat approves everything, and the kind switched on for the firm:
 * nothing of it reaches the vendor. A firm that has its kind on another
 * account keeps it.
 */
create or replace function public.test_chat_templates(target_org uuid, target_number uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  waba text := (select n.waba_id from public.wa_numbers n where n.id = target_number and n.org_id = target_org);
  notice public.notice_kinds%rowtype;
  template uuid;
begin
  select * into notice from public.notice_kinds k where k.kind = 'flight_problem';
  insert into public.wa_templates (org_id, waba_id, name, language, category, status, body, footer_text, param_count)
  values (target_org, waba, notice.template_base || '_1', 'pt_BR', 'utility', 'approved', notice.body, notice.footer,
          cardinality(notice.params))
  on conflict (org_id, waba_id, name, language) do update
    set status = 'approved', category = 'utility', body = excluded.body, footer_text = excluded.footer_text,
        param_count = excluded.param_count, synced_at = now()
  returning id into template;

  insert into public.firm_notice_kinds (org_id, kind, template_id, body, enabled, submitted_at, changed_at)
  values (target_org, 'flight_problem', template, notice.body, true, now(), now())
  on conflict (org_id, kind) do update
    set template_id = excluded.template_id, body = excluded.body, enabled = true, changed_at = now()
  where public.firm_notice_kinds.template_id is null
     or exists (
       select 1 from public.wa_templates t
       join public.wa_numbers n on n.org_id = t.org_id and n.waba_id = t.waba_id
       where t.id = public.firm_notice_kinds.template_id and n.provider = 'test'
     );
end;
$$;

revoke all on function public.test_chat_templates(uuid, uuid) from public, anon, authenticated;

/**
 * Turns the test chat on, on the test number the app just connected (the
 * backend's half of "Ligar o chat de teste"): one in use per firm, with the
 * link's secret the app minted, the four trips made once and the template of
 * ONE's first word in place. For who manages the firm or a partner, named by
 * the app; never from a support visit (the app refuses one). Service role.
 */
create or replace function public.start_test_chat(target_org uuid, target_number uuid, target_token text, target_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chat uuid;
  trips integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.test_chat_keeper(target_org, target_by) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_token is null or target_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  if not exists (
    select 1 from public.wa_numbers n
    where n.id = target_number and n.org_id = target_org and n.provider = 'test' and n.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'number_not_found');
  end if;
  perform 1 from public.organizations o where o.id = target_org for no key update;
  if exists (select 1 from public.test_chats c where c.org_id = target_org and c.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'already_on');
  end if;

  insert into public.test_chats (org_id, number_id, token, started_by)
  values (target_org, target_number, target_token, target_by)
  returning id into chat;
  trips := public.seed_test_trips(target_org);
  perform public.test_chat_templates(target_org, target_number);

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, target_by, 'test_chat.started', 'test_chat', chat::text, jsonb_build_object('trips_made', trips));
  return jsonb_build_object('ok', true, 'code', 'started', 'chat_id', chat);
end;
$$;

revoke all on function public.start_test_chat(uuid, uuid, text, uuid) from public, anon, authenticated;

/** A new secret for the link of the test chat in use: the one before stops opening anything. Service role. */
create or replace function public.renew_test_chat(target_org uuid, target_token text, target_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chat uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.test_chat_keeper(target_org, target_by) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_token is null or target_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  update public.test_chats set token = target_token
  where org_id = target_org and status = 'active'
  returning id into chat;
  if chat is null then
    return jsonb_build_object('ok', false, 'code', 'not_on');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id)
  values (target_org, target_by, 'test_chat.link_renewed', 'test_chat', chat::text);
  return jsonb_build_object('ok', true, 'code', 'renewed', 'chat_id', chat);
end;
$$;

revoke all on function public.renew_test_chat(uuid, text, uuid) from public, anon, authenticated;

/**
 * Turns the test chat off: its link opens nothing more and its number is
 * disconnected. Its conversations stay, as a disconnected number's do, and
 * its trips stay for when it is turned on again. Who manages the firm or a
 * partner; never a support visit.
 */
create or replace function public.end_test_chat(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chat public.test_chats%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.test_chat_keeper(target_org, auth.uid()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.test_chats set status = 'ended', ended_at = now(), ended_reason = 'turned_off'
  where org_id = target_org and status = 'active'
  returning * into chat;
  if chat.id is null then
    return jsonb_build_object('ok', true, 'code', 'already_off');
  end if;
  update public.wa_numbers set status = 'disconnected', disconnect_reason = 'test_chat_ended', disconnected_at = now()
  where id = chat.number_id and status = 'active';
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id)
  values (target_org, auth.uid(), 'test_chat.ended', 'test_chat', chat.id::text);
  return jsonb_build_object('ok', true, 'code', 'ended');
end;
$$;

revoke all on function public.end_test_chat(uuid) from public, anon;
grant execute on function public.end_test_chat(uuid) to authenticated;

/**
 * The test chat of a firm as its connections screen shows it: whether it is
 * on, since when, and the link's secret for who may hand it out (who manages
 * the firm or a partner). Anybody of the firm reads whether it is on.
 */
create or replace function public.test_chat_link(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  chat public.test_chats%rowtype;
  keeper boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  keeper := public.test_chat_keeper(target_org, auth.uid()) and not public.is_impersonated();
  select * into chat from public.test_chats c where c.org_id = target_org and c.status = 'active';
  if not found then
    return jsonb_build_object(
      'on', false,
      'keeper', keeper,
      'real_number', exists (
        select 1 from public.wa_numbers n where n.org_id = target_org and n.provider = 'meta' and n.status = 'active'
      ),
      'ended_reason', (
        select c.ended_reason from public.test_chats c where c.org_id = target_org order by c.ended_at desc nulls last limit 1
      )
    );
  end if;
  return jsonb_build_object(
    'on', true,
    'keeper', keeper,
    'started_at', chat.started_at,
    'token', case when keeper then chat.token end
  );
end;
$$;

revoke all on function public.test_chat_link(uuid) from public, anon;
grant execute on function public.test_chat_link(uuid) to authenticated;

-- ---------- The test chat's page (the backend, by the link's secret) ----------

/** The test chat a link opens, with its firm and number; nothing for a secret that opens nothing. Service role. */
create or replace function public.test_chat_by_token(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  chat public.test_chats%rowtype;
  chat_number public.wa_numbers%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_token is null or target_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    return jsonb_build_object('found', false);
  end if;
  select * into chat from public.test_chats c where c.token = target_token and c.status = 'active';
  if not found then
    return jsonb_build_object('found', false);
  end if;
  select * into chat_number from public.wa_numbers n where n.id = chat.number_id and n.status = 'active';
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'chat_id', chat.id,
    'org_id', chat.org_id,
    'number_id', chat_number.id,
    'phone_number_id', chat_number.phone_number_id,
    'display_phone_number', chat_number.display_phone_number,
    'firm', (select o.name from public.organizations o where o.id = chat.org_id)
  );
end;
$$;

revoke all on function public.test_chat_by_token(text) from public, anon, authenticated;

/**
 * What the test chat's page shows: the firm, and each of its trips with its
 * legs, the last alert and its answer, and the conversation its passenger
 * has with the test number. Service role, by the link's secret.
 */
create or replace function public.test_chat_view(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  chat jsonb := public.test_chat_by_token(target_token);
  org uuid;
  chat_number uuid;
begin
  if not coalesce((chat ->> 'found')::boolean, false) then
    return chat;
  end if;
  org := (chat ->> 'org_id')::uuid;
  chat_number := (chat ->> 'number_id')::uuid;
  return chat || jsonb_build_object(
    'delay_minutes', public.flight_alerts_setting('delay_minutes', 240),
    'trips', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'label', t.label,
        'passenger_name', t.passenger_name,
        'phone', t.phone,
        'companions', t.companions,
        'airline', t.airline_iata,
        'status', t.status,
        'case_id', t.case_id,
        'legs', coalesce((
          select jsonb_agg(jsonb_build_object(
            'position', l.position,
            'flight_number', l.flight_number,
            'origin', l.origin_iata,
            'origin_city', (select a.city from public.airports a where a.iata = l.origin_iata),
            'destination', l.destination_iata,
            'destination_city', (select a.city from public.airports a where a.iata = l.destination_iata),
            'departure', l.scheduled_departure_local,
            'arrival', l.scheduled_arrival_local,
            'status', l.status,
            'estimated_arrival', l.estimated_arrival_local
          ) order by l.position)
          from public.tracked_legs l where l.trip_id = t.id
        ), '[]'::jsonb),
        'alert', (
          select jsonb_build_object('kind', a.kind, 'status', a.status, 'reason', a.reason, 'answer', a.answer,
                                    'delay_minutes', a.delay_minutes, 'created_at', a.created_at)
          from public.flight_alerts a where a.trip_id = t.id
          order by a.created_at desc limit 1
        ),
        'conversation_id', (
          select wc.id from public.wa_conversations wc
          where wc.number_id = chat_number and wc.contact_wa_id = any (public.wa_phone_variants(t.phone))
          order by wc.created_at limit 1
        )
      ) order by t.created_at, t.label)
      from public.tracked_trips t where t.org_id = org and t.is_test
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.test_chat_view(text) from public, anon, authenticated;

/**
 * The messages of one trip's conversation on the test chat, the newest last,
 * after a moment the page already has (or the latest hundred): what the page
 * draws and asks for again every few seconds. What the firm sent is read by
 * the passenger as it is drawn. Service role, by the link's secret.
 */
create or replace function public.test_chat_thread(target_token text, target_trip uuid, target_after timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chat jsonb := public.test_chat_by_token(target_token);
  trip public.tracked_trips%rowtype;
  conversation uuid;
begin
  if not coalesce((chat ->> 'found')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into trip from public.tracked_trips t
  where t.id = target_trip and t.org_id = (chat ->> 'org_id')::uuid and t.is_test;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'trip_not_found');
  end if;
  select wc.id into conversation from public.wa_conversations wc
  where wc.number_id = (chat ->> 'number_id')::uuid and wc.contact_wa_id = any (public.wa_phone_variants(trip.phone))
  order by wc.created_at limit 1;
  if conversation is null then
    return jsonb_build_object('ok', true, 'messages', '[]'::jsonb, 'conversation_id', null);
  end if;

  -- The passenger read what the firm sent: the screen of the firm says so, as the vendor's status would.
  update public.wa_messages set status = 'read'
  where conversation_id = conversation and direction = 'out' and status in ('sent', 'delivered');

  return jsonb_build_object(
    'ok', true,
    'conversation_id', conversation,
    'messages', coalesce((
      select jsonb_agg(m.item order by m.at, m.id)
      from (
        select x.created_at as at, x.id, jsonb_build_object(
          'id', x.id,
          'direction', x.direction,
          'kind', x.kind,
          'body', x.body,
          'template', x.template_name,
          'status', x.status,
          'media_filename', x.media_filename,
          'media_status', x.media_status,
          'at', x.created_at
        ) as item
        from public.wa_messages x
        where x.conversation_id = conversation and x.origin = 'cloud'
          and (target_after is null or x.created_at > target_after)
        order by x.created_at desc, x.id desc
        limit 100
      ) m
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.test_chat_thread(text, uuid, timestamptz) from public, anon, authenticated;

/**
 * Whether the test chat may take one more thing from its tester now (a
 * message, a problem made to happen): the setting's number a minute, counted
 * on what reached the test number. Service role.
 */
create or replace function public.test_chat_room(target_token text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select count(*) < public.flight_alerts_setting('test_messages_per_minute', 30)
    from public.wa_messages m
    join public.test_chats c on c.number_id = m.number_id
    where c.token = target_token and c.status = 'active' and m.direction = 'in'
      and m.created_at > now() - interval '1 minute'
  ), false);
$$;

revoke all on function public.test_chat_room(text) from public, anon, authenticated;

/**
 * The test chat's tools make a problem happen to a trip (or undo it): each
 * leg named gets the status and the estimated arrival the tool says, as a
 * source would say them, and the trip's legs move to today when they were of
 * a day gone. Undoing it puts every leg back as scheduled and forgets the
 * trip's alerts and their answers, so the same problem can be told again;
 * the messages stay in the conversation. Answers the legs as they are now
 * for the rule to read. Service role, by the link's secret.
 */
create or replace function public.test_chat_set_legs(target_token text, target_trip uuid, target_legs jsonb, target_reset boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chat jsonb := public.test_chat_by_token(target_token);
  trip public.tracked_trips%rowtype;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  first_day date;
  item jsonb;
  status text;
  late integer;
begin
  if not coalesce((chat ->> 'found')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into trip from public.tracked_trips t
  where t.id = target_trip and t.org_id = (chat ->> 'org_id')::uuid and t.is_test
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'trip_not_found');
  end if;

  -- The trip's flights are of today: a test run days after the chat was turned on is of its own day.
  select min(l.scheduled_departure_local)::date into first_day from public.tracked_legs l where l.trip_id = trip.id;
  if first_day is not null and first_day <> today then
    update public.tracked_legs set
      scheduled_departure_local = scheduled_departure_local + make_interval(days => today - first_day),
      scheduled_arrival_local = scheduled_arrival_local + make_interval(days => today - first_day)
    where trip_id = trip.id;
  end if;

  if coalesce(target_reset, false) then
    update public.tracked_legs set status = 'scheduled', estimated_arrival_local = null, status_source = null, status_at = null
    where trip_id = trip.id;
    delete from public.flight_alerts where trip_id = trip.id;
    update public.tracked_trips set status = 'watching', case_id = null where id = trip.id;
  else
    if jsonb_typeof(target_legs) <> 'array' or jsonb_array_length(target_legs) = 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid_legs');
    end if;
    for item in select value from jsonb_array_elements(target_legs) loop
      status := item ->> 'status';
      late := case when coalesce(item ->> 'late_minutes', '') ~ '^[0-9]{1,5}$' then (item ->> 'late_minutes')::integer end;
      if status is null or status not in ('scheduled', 'delayed', 'cancelled', 'changed', 'landed')
         or (status = 'delayed' and late is null)
         or not exists (
           select 1 from public.tracked_legs l
           where l.trip_id = trip.id and l.position::text = coalesce(item ->> 'position', '')
         ) then
        return jsonb_build_object('ok', false, 'code', 'invalid_legs');
      end if;
      update public.tracked_legs set
        status = item ->> 'status',
        estimated_arrival_local = case when late is not null then scheduled_arrival_local + make_interval(mins => late) end,
        status_source = 'simulated',
        status_at = now()
      where trip_id = trip.id and position = (item ->> 'position')::integer;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'org_id', trip.org_id,
    'trip_id', trip.id,
    'delay_minutes', public.flight_alerts_setting('delay_minutes', 240),
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', l.position,
        'departure', l.scheduled_departure_local,
        'arrival', l.scheduled_arrival_local,
        'status', l.status,
        'estimated_arrival', l.estimated_arrival_local
      ) order by l.position)
      from public.tracked_legs l where l.trip_id = trip.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.test_chat_set_legs(text, uuid, jsonb, boolean) from public, anon, authenticated;

-- ---------- The alerts ----------

/**
 * What the rule found wrong with a trip (`@flyee/rules`, run by the app on
 * what a source says of its legs): one alert per trip and fact, the second
 * time the same is found changing nothing. A trip whose passenger asked to
 * stop, said no or already has a case is told nothing more. Service role.
 */
create or replace function public.record_flight_alert(
  target_trip uuid,
  target_kind text,
  target_leg integer,
  target_delay integer,
  target_rule text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  trip public.tracked_trips%rowtype;
  alert uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into trip from public.tracked_trips t where t.id = target_trip for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'trip_not_found');
  end if;
  if trip.status in ('case_opened', 'declined', 'stopped') then
    return jsonb_build_object('ok', true, 'code', 'trip_closed');
  end if;
  if target_kind is null or target_kind not in ('cancelled', 'changed', 'delayed')
     or target_rule is null or target_rule !~ '^[a-z][a-z0-9-]{2,40}$'
     or (target_delay is not null and target_delay not between 0 and 20160) then
    return jsonb_build_object('ok', false, 'code', 'invalid_alert');
  end if;
  insert into public.flight_alerts (org_id, trip_id, kind, leg_position, delay_minutes, rule_version)
  values (trip.org_id, trip.id, target_kind, target_leg, target_delay, target_rule)
  on conflict (trip_id, kind) do nothing
  returning id into alert;
  if alert is null then
    return jsonb_build_object('ok', true, 'code', 'already_known');
  end if;
  return jsonb_build_object('ok', true, 'code', 'recorded', 'alert_id', alert);
end;
$$;

revoke all on function public.record_flight_alert(uuid, text, integer, integer, text) from public, anon, authenticated;

/**
 * Claims the alerts due (one named, or the oldest), under a number each,
 * with what their message says of the trip: the passenger, the firm, each
 * leg with its cities, the fact. A claim that never came back is taken again
 * after the setting's minutes. Service role.
 */
create or replace function public.claim_flight_alerts(target_limit integer default 10, target_alert uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stale integer := greatest(public.flight_alerts_setting('stale_minutes', 10), 1);
  claimed jsonb := '[]'::jsonb;
  candidate uuid;
  row_claims integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  for candidate in
    select a.id from public.flight_alerts a
    where a.status = 'due' and (target_alert is null or a.id = target_alert)
      and (a.claimed_at is null or a.claimed_at < now() - make_interval(mins => stale))
    order by a.created_at, a.id
    limit greatest(least(coalesce(target_limit, 10), 50), 1)
  loop
    update public.flight_alerts a set claimed_at = clock_timestamp(), claims = a.claims + 1
    where a.id = candidate and a.status = 'due'
      and (a.claimed_at is null or a.claimed_at < now() - make_interval(mins => stale))
    returning a.claims into row_claims;
    if row_claims is null then
      continue;
    end if;
    claimed := claimed || jsonb_build_array((
      select jsonb_build_object(
        'alert_id', a.id,
        'claim', row_claims,
        'org_id', a.org_id,
        'kind', a.kind,
        'delay_minutes', a.delay_minutes,
        'leg_position', a.leg_position,
        'passenger_name', t.passenger_name,
        'firm', (select o.name from public.organizations o where o.id = a.org_id),
        'international', exists (
          select 1 from public.tracked_legs l
          join public.airports o on o.iata = l.origin_iata
          join public.airports d on d.iata = l.destination_iata
          where l.trip_id = t.id and (o.country <> 'BR' or d.country <> 'BR')
        ),
        'legs', coalesce((
          select jsonb_agg(jsonb_build_object(
            'position', l.position,
            'flight_number', l.flight_number,
            'origin', l.origin_iata,
            'origin_city', (select ap.city from public.airports ap where ap.iata = l.origin_iata),
            'destination', l.destination_iata,
            'destination_city', (select ap.city from public.airports ap where ap.iata = l.destination_iata),
            'departure', l.scheduled_departure_local,
            'arrival', l.scheduled_arrival_local
          ) order by l.position)
          from public.tracked_legs l where l.trip_id = t.id
        ), '[]'::jsonb)
      )
      from public.flight_alerts a
      join public.tracked_trips t on t.id = a.trip_id
      where a.id = candidate
    ));
    row_claims := null;
  end loop;
  return claimed;
end;
$$;

revoke all on function public.claim_flight_alerts(integer, uuid) from public, anon, authenticated;

/**
 * Tells a claimed alert: ONE's first word, as the firm's template of the kind
 * `flight_problem` (switched on and approved as a utility message), with the
 * values the app wrote from the rule (the passenger's first name, the firm,
 * the flight, what happened, what the airline owes), in the conversation the
 * passenger has with the firm's number of that template's account (a trip
 * of the test chat, only on the test chat's number), opened when there is
 * none. Never to who asked to stop or never agreed; what cannot go is the
 * alert skipped with why. The message goes through the outbox of 0019, once.
 * Service role.
 */
create or replace function public.reserve_flight_alert(target_alert uuid, target_claim integer, target_params text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  alert public.flight_alerts%rowtype;
  trip public.tracked_trips%rowtype;
  notice public.notice_kinds%rowtype;
  template public.wa_templates%rowtype;
  sender public.wa_numbers%rowtype;
  conversation uuid;
  message uuid;
  rendered text;
  values_ok boolean;
  skip text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into alert from public.flight_alerts a
  where a.id = target_alert and a.status = 'due' and a.claims = target_claim and a.claimed_at is not null
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into trip from public.tracked_trips t where t.id = alert.trip_id;
  select * into notice from public.notice_kinds k where k.kind = 'flight_problem';
  values_ok := target_params is not null and cardinality(target_params) = cardinality(notice.params)
    and array_position(target_params, null) is null
    and not exists (
      select 1 from unnest(target_params) as v(value)
      where public.notice_value(v.value) is null or public.notice_value(v.value) <> v.value
    );

  select t.* into template from public.wa_templates t
  join public.firm_notice_kinds k on k.template_id = t.id
  where k.org_id = alert.org_id and k.kind = 'flight_problem' and k.enabled
    and t.status = 'approved' and t.category = 'utility';
  if found then
    select n.* into sender from public.wa_numbers n
    join public.connections cn on cn.id = n.connection_id and cn.status = 'connected'
    where n.org_id = alert.org_id and n.waba_id = template.waba_id and n.status = 'active'
      and (n.provider = 'test') = trip.is_test
    order by n.connected_at
    limit 1;
  end if;

  skip := case
    when trip.status in ('case_opened', 'declined', 'stopped') then 'trip_closed'
    when trip.consent_at is null then 'no_consent'
    when exists (
      select 1 from public.wa_optouts o
      where o.org_id = alert.org_id and o.contact_wa_id = any (public.wa_phone_variants(trip.phone))
    ) then 'opted_out'
    when template.id is null then 'no_template'
    when sender.id is null then 'no_number'
    when not values_ok or template.param_count <> cardinality(target_params) then 'invalid_values'
  end;
  if skip is not null then
    update public.flight_alerts set status = 'skipped', reason = skip, claimed_at = null where id = alert.id;
    return jsonb_build_object('ok', true, 'code', 'skipped', 'reason', skip);
  end if;

  select wc.id into conversation from public.wa_conversations wc
  where wc.number_id = sender.id and wc.contact_wa_id = any (public.wa_phone_variants(trip.phone))
  order by wc.last_inbound_at desc nulls last
  limit 1;
  if conversation is null then
    conversation := public.wa_open_conversation(alert.org_id, sender.id, trip.phone, trip.passenger_name);
  end if;

  rendered := public.notice_rendered(template.body, target_params);
  insert into public.wa_messages (
    org_id, conversation_id, number_id, direction, origin, kind, body, template_id, template_name, template_params, status
  ) values (
    alert.org_id, conversation, sender.id, 'out', 'cloud', 'template', rendered, template.id, template.name,
    to_jsonb(target_params), 'queued'
  )
  returning id into message;

  update public.wa_conversations set
    last_message_at = now(),
    last_message_preview = public.wa_preview('template', rendered),
    last_message_direction = 'out'
  where id = conversation
    and not (last_message_direction = 'in' and last_inbound_at is not null and last_inbound_at >= last_message_at);

  update public.flight_alerts set status = 'sent', message_id = message, sent_at = now(), claimed_at = null
  where id = alert.id;
  update public.tracked_trips set status = 'alerted' where id = trip.id and status = 'watching';

  insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (alert.org_id, null, 'system', 'flight_alert.sent', 'flight_alert', alert.id::text,
          jsonb_build_object('kind', alert.kind, 'test', trip.is_test));
  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message, 'conversation_id', conversation);
end;
$$;

revoke all on function public.reserve_flight_alert(uuid, integer, text[]) from public, anon, authenticated;

/** A claim given back: the alert is taken again by the next sweep, as one that failed for a moment. Service role. */
create or replace function public.release_flight_alert(target_alert uuid, target_claim integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.flight_alerts set claimed_at = null
  where id = target_alert and claims = target_claim and status = 'due' and auth.role() = 'service_role';
$$;

revoke all on function public.release_flight_alert(uuid, integer) from public, anon, authenticated;
