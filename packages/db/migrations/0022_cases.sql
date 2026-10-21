-- ============================================================
-- 0022_cases: the core of the domain, and the client's folder.
--
--   people            a firm's clients: passengers and the ones who answer
--                     for a minor. Personal data, the firm's to keep;
--   cases             one claim against an airline: the incident, the flight
--                     day, where it stands. Numbered per firm;
--   case_parties      who is in a case: each claimant (an adult, or a minor
--                     with the party who answers for them) and each guardian;
--   flight_segments   the legs of the trip, with the times as the ticket and
--                     the airport print them (local time, no zone);
--   proceedings       the lawsuits of a case: a small-claims one for the
--                     adults, a civil one for a minor, with their parties and
--                     lawyers, the court and the number once filed;
--   case_events       the timeline of a case. Append-only;
--   case_documents    the files of a case: who sent them, of what kind,
--                     whether a person of the firm accepted them;
--   client_links      the client's way in, with no account: a link by token,
--                     for one person of one case, with an end.
--
-- The firm is on everything, and every write is a function that takes the
-- case (and through it the firm) and records an event. The client reaches
-- only the functions named `client_link_*`, by the token, which the database
-- keeps only as its SHA-256.
-- ============================================================

insert into public.platform_settings (key, value, is_public) values
  ('cases', jsonb_build_object(
    -- How long a client's link works.
    'client_link_days', 30,
    -- How many files one link may send: a link that leaks cannot fill the bucket.
    'client_link_uploads', 60,
    -- How many people a client may add to a case (the children on the same flight).
    'client_link_dependents', 8,
    -- How many CPFs one link may write or have refused as another client's: a
    -- CPF already in the firm is refused, so the ceiling keeps a link from
    -- testing who the firm's clients are. Above the people a link may add.
    'client_link_cpf_attempts', 12,
    -- How many CPF lookups a firm may make in 24 hours.
    'cpf_checks_per_day', 200,
    -- What a case needs before it can be prepared: every claimant's identity,
    -- the proof of address of whoever answers for the case, and the ticket or
    -- the boarding pass. The module's own list arrives as data in M6.
    'required_documents', jsonb_build_array(
      jsonb_build_object('kind', 'identity', 'per', 'claimant'),
      jsonb_build_object('kind', 'address_proof', 'per', 'holder'),
      jsonb_build_object('kind', 'ticket', 'per', 'case', 'or', jsonb_build_array('boarding_pass'))
    )
  -- Public: the screens of the firm read what a case needs, and nothing here is a secret.
  ), true)
on conflict (key) do nothing;

-- What a client sends through a link is kept in the firm's files under its own
-- purpose: only the backend reserves it, for the link that asked.
update public.platform_settings
set value = jsonb_set(value, '{purposes,client}', jsonb_build_object(
  'people', false,
  'max_bytes', 31457280,
  'mimes', jsonb_build_array('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
))
where key = 'files' and not (value -> 'purposes') ? 'client';

-- ---------- Checks the tables and the functions share ----------

/** True when the 11 digits pass the two check digits of the CPF (and are not one digit repeated). */
create or replace function public.cpf_is_valid(value text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  total integer;
  digit integer;
  position integer;
begin
  if value is null or value !~ '^[0-9]{11}$' or value ~ '^(.)\1{10}$' then
    return false;
  end if;
  total := 0;
  for position in 1..9 loop
    total := total + substr(value, position, 1)::integer * (11 - position);
  end loop;
  digit := case when total % 11 < 2 then 0 else 11 - total % 11 end;
  if digit <> substr(value, 10, 1)::integer then
    return false;
  end if;
  total := 0;
  for position in 1..10 loop
    total := total + substr(value, position, 1)::integer * (12 - position);
  end loop;
  digit := case when total % 11 < 2 then 0 else 11 - total % 11 end;
  return digit = substr(value, 11, 1)::integer;
end;
$$;

revoke all on function public.cpf_is_valid(text) from public, anon;
grant execute on function public.cpf_is_valid(text) to authenticated;

/**
 * True when the 20 digits are a unique case number whose check digits match
 * (Resolução CNJ 65/2008, Annex VIII, VI): NNNNNNN AAAA J TR OOOO DD, modulo
 * 97, is 1. The same rule as `@flyee/rules/cnj`.
 */
create or replace function public.cnj_is_valid(value text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(
    value ~ '^[0-9]{20}$'
    and ((substr(value, 1, 7) || substr(value, 10, 11) || substr(value, 8, 2))::numeric % 97) = 1,
    false
  );
$$;

revoke all on function public.cnj_is_valid(text) from public, anon;
grant execute on function public.cnj_is_valid(text) to authenticated;

/** A name compared as people write it: no accents, no case, single spaces. */
create or replace function public.plain_name(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
    btrim(translate(upper(coalesce(value, '')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')),
    '\s+', ' ', 'g'
  );
$$;

revoke all on function public.plain_name(text) from public, anon, authenticated;

-- ---------- People ----------

create table public.people (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null,
  cpf text,
  birth_date date,
  nationality text,
  marital_status text,
  profession text,
  email text,
  -- Digits, with the country code: what WhatsApp names the person by.
  phone text,
  postal_code text,
  street text,
  address_number text,
  complement text,
  district text,
  city text,
  uf text,
  -- What the federal registry said of the CPF with this birth date, and when:
  -- `found`, `not_found`, `birth_date_mismatch` or `minor`. Cleared when the
  -- CPF or the birth date changes (the registry answers for the pair).
  cpf_registry_result text,
  cpf_checked_at timestamptz,
  cpf_registry_name text,
  cpf_registry_birth_date date,
  cpf_registry_situation text,
  cpf_registry_regular boolean,
  cpf_name_matches boolean,
  -- Who wrote last: somebody of the firm, or the client through their link.
  updated_via text not null default 'firm',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  constraint people_name_check check (char_length(full_name) between 3 and 200 and full_name !~ '[[:cntrl:]]'),
  constraint people_cpf_check check (cpf is null or public.cpf_is_valid(cpf)),
  constraint people_marital_check check (marital_status is null or marital_status in (
    'solteiro', 'casado', 'uniao_estavel', 'divorciado', 'separado', 'viuvo'
  )),
  constraint people_email_check check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  constraint people_phone_check check (phone is null or phone ~ '^[0-9]{12,15}$'),
  constraint people_postal_check check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
  constraint people_uf_check check (uf is null or uf in (
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
    'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
  )),
  constraint people_text_check check (
    coalesce(char_length(nationality), 0) <= 60 and coalesce(char_length(profession), 0) <= 120
    and coalesce(char_length(street), 0) <= 200 and coalesce(char_length(address_number), 0) <= 20
    and coalesce(char_length(complement), 0) <= 120 and coalesce(char_length(district), 0) <= 120
    and coalesce(char_length(city), 0) <= 120
  ),
  constraint people_birth_check check (birth_date is null or birth_date between date '1900-01-01' and date '2100-01-01'),
  constraint people_via_check check (updated_via in ('firm', 'client')),
  constraint people_registry_check check (
    cpf_registry_result is null or cpf_registry_result in ('found', 'not_found', 'birth_date_mismatch', 'minor')
  )
);

-- One person per CPF in a firm.
create unique index people_cpf_idx on public.people (org_id, cpf) where cpf is not null;
create index people_org_idx on public.people (org_id, created_at desc);
create index people_phone_idx on public.people (org_id, phone) where phone is not null;

alter table public.people enable row level security;
create policy "people_select_member" on public.people
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.people to authenticated;

create trigger people_updated_at before update on public.people
  for each row execute function public.set_updated_at();
create trigger guard_impersonation_people after insert or update or delete on public.people
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- Cases ----------

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The number the firm calls the case by: #1, #2, per firm.
  seq integer not null,
  incident text not null,
  airline_iata text references public.airlines (iata) on update cascade,
  flight_date date,
  -- Why it happened, as far as is known: the airline's own (internal), a fact
  -- outside it (external: weather, the airport), or not known yet.
  cause text not null default 'undetermined',
  -- intake       the client is being heard;
  -- documents    waiting for the client's data and documents;
  -- signature    waiting for the power of attorney and the contract;
  -- drafting     the firm prepares the petition;
  -- ready         the filing package is ready;
  -- filed        filed in court;
  -- closed       ended (paid, settled, lost);
  -- declined     it did not go ahead (no right, the client gave up).
  status text not null default 'intake',
  origin text,
  -- The firm's own note on the case. Never shown to the client.
  summary text,
  responsible_id uuid references public.profiles (id) on delete set null,
  status_changed_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, seq),
  constraint cases_seq_check check (seq > 0),
  constraint cases_incident_check check (incident in (
    'delay', 'cancellation', 'overbooking', 'missed_connection', 'downgrade',
    'baggage_lost', 'baggage_damaged', 'baggage_delayed', 'other'
  )),
  constraint cases_cause_check check (cause in ('internal', 'external', 'undetermined')),
  constraint cases_status_check check (status in (
    'intake', 'documents', 'signature', 'drafting', 'ready', 'filed', 'closed', 'declined'
  )),
  constraint cases_origin_check check (origin is null or origin in (
    'agency', 'referral', 'ads', 'organic', 'returning_client', 'other'
  )),
  constraint cases_summary_check check (summary is null or char_length(summary) <= 4000),
  constraint cases_closed_check check ((status in ('closed', 'declined')) = (closed_at is not null)),
  constraint cases_reason_check check (close_reason is null or char_length(close_reason) <= 1000),
  constraint cases_flight_date_check check (flight_date is null or flight_date between date '2000-01-01' and date '2100-01-01')
);

create index cases_org_idx on public.cases (org_id, status, updated_at desc);

alter table public.cases enable row level security;
create policy "cases_select_member" on public.cases
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.cases to authenticated;

create trigger cases_updated_at before update on public.cases
  for each row execute function public.set_updated_at();
create trigger guard_impersonation_cases after insert or update or delete on public.cases
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- Who is in a case ----------

create table public.case_parties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  person_id uuid not null,
  -- claimant: asks for compensation (an adult, or a minor). guardian: answers for a minor claimant.
  role text not null,
  -- For a minor claimant: the guardian party of the same case who answers for them.
  guardian_id uuid,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  unique (case_id, person_id, role),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (person_id, org_id) references public.people (id, org_id) on delete cascade,
  foreign key (guardian_id, org_id) references public.case_parties (id, org_id) on delete set null (guardian_id),
  constraint case_parties_role_check check (role in ('claimant', 'guardian')),
  constraint case_parties_guardian_check check (role = 'claimant' or guardian_id is null)
);

create index case_parties_case_idx on public.case_parties (case_id);
create index case_parties_person_idx on public.case_parties (person_id);

alter table public.case_parties enable row level security;
create policy "case_parties_select_member" on public.case_parties
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.case_parties to authenticated;

create trigger guard_impersonation_case_parties after insert or update or delete on public.case_parties
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- The legs of the trip ----------

create table public.flight_segments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  position smallint not null default 1,
  -- The airline's designator and the number, normalized: `G31234`.
  flight_number text,
  origin_iata text references public.airports (iata),
  destination_iata text references public.airports (iata),
  -- As the ticket and the airport print them: local time of that airport.
  scheduled_departure_local timestamp,
  scheduled_arrival_local timestamp,
  actual_departure_local timestamp,
  actual_arrival_local timestamp,
  booking_reference text,
  -- The leg where the problem happened.
  affected boolean not null default false,
  source text not null default 'firm',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  constraint flight_segments_position_check check (position between 1 and 20),
  constraint flight_segments_number_check check (
    flight_number is null or (flight_number ~ '^[A-Z0-9]{2}[1-9][0-9]{0,3}[A-Z]?$' and flight_number !~ '^[0-9]{2}')
  ),
  constraint flight_segments_route_check check (origin_iata is null or destination_iata is null or origin_iata <> destination_iata),
  constraint flight_segments_booking_check check (booking_reference is null or booking_reference ~ '^[A-Z0-9]{5,8}$'),
  constraint flight_segments_source_check check (source in ('firm', 'client'))
);

create index flight_segments_case_idx on public.flight_segments (case_id, position);

alter table public.flight_segments enable row level security;
create policy "flight_segments_select_member" on public.flight_segments
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.flight_segments to authenticated;

create trigger flight_segments_updated_at before update on public.flight_segments
  for each row execute function public.set_updated_at();
create trigger guard_impersonation_flight_segments after insert or update or delete on public.flight_segments
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- Lawsuits ----------

create table public.proceedings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  -- juizado: the small-claims court, for the adults. comum: the civil court, for a minor.
  kind text not null,
  court text references public.courts (acronym),
  comarca text,
  -- The unit that judges it (the "juízo"), once known.
  unit text,
  system text,
  -- The unique case number, 20 digits, once filed.
  cnj text,
  -- Why this forum: the client's domicile by default; any other needs a link to
  -- the flight (`forum_city`, a city of an airport of the trip) and a reason.
  forum_basis text,
  forum_reason text,
  -- The city the forum is in, as people write it. The comarca may bear
  -- another name (a city belongs to a neighbouring one): it is the court's.
  forum_city text,
  status text not null default 'planned',
  filed_at date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  constraint proceedings_kind_check check (kind in ('juizado', 'comum')),
  constraint proceedings_system_check check (system is null or system in ('projudi', 'eproc', 'pje', 'esaj', 'outro')),
  constraint proceedings_cnj_check check (cnj is null or public.cnj_is_valid(cnj)),
  constraint proceedings_basis_check check (forum_basis is null or forum_basis in ('domicile', 'event_place', 'defendant_seat', 'other')),
  constraint proceedings_reason_check check (
    forum_basis is null or forum_basis = 'domicile'
    or char_length(btrim(coalesce(forum_reason, ''))) >= 8
  ),
  constraint proceedings_status_check check (status in ('planned', 'filed', 'closed')),
  constraint proceedings_filed_check check (status = 'planned' or cnj is not null),
  constraint proceedings_text_check check (
    coalesce(char_length(comarca), 0) <= 120 and coalesce(char_length(unit), 0) <= 200
    and coalesce(char_length(forum_reason), 0) <= 1000 and coalesce(char_length(forum_city), 0) <= 120
  )
);

create unique index proceedings_cnj_idx on public.proceedings (org_id, cnj) where cnj is not null;
create index proceedings_case_idx on public.proceedings (case_id);

alter table public.proceedings enable row level security;
create policy "proceedings_select_member" on public.proceedings
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.proceedings to authenticated;

create trigger proceedings_updated_at before update on public.proceedings
  for each row execute function public.set_updated_at();
create trigger guard_impersonation_proceedings after insert or update or delete on public.proceedings
  for each statement execute function public.guard_impersonation_readonly();

create table public.proceeding_parties (
  proceeding_id uuid not null,
  party_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  primary key (proceeding_id, party_id),
  foreign key (proceeding_id, org_id) references public.proceedings (id, org_id) on delete cascade,
  foreign key (party_id, org_id) references public.case_parties (id, org_id) on delete cascade
);

alter table public.proceeding_parties enable row level security;
create policy "proceeding_parties_select_member" on public.proceeding_parties
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.proceeding_parties to authenticated;
create trigger guard_impersonation_proceeding_parties after insert or update or delete on public.proceeding_parties
  for each statement execute function public.guard_impersonation_readonly();

-- The lawyers who sign a lawsuit: what the count of cases per state is made of.
create table public.proceeding_lawyers (
  proceeding_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  primary key (proceeding_id, user_id),
  foreign key (proceeding_id, org_id) references public.proceedings (id, org_id) on delete cascade
);

alter table public.proceeding_lawyers enable row level security;
create policy "proceeding_lawyers_select_member" on public.proceeding_lawyers
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.proceeding_lawyers to authenticated;
create trigger guard_impersonation_proceeding_lawyers after insert or update or delete on public.proceeding_lawyers
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- The timeline of a case ----------

create table public.case_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  at timestamptz not null default now(),
  -- What happened, as a slug the screen has words for: `case.created`, `client.document_sent`.
  kind text not null,
  actor_type text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  -- Ids and the names of what changed: never the values a person typed.
  data jsonb not null default '{}'::jsonb,
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  constraint case_events_kind_check check (kind ~ '^[a-z][a-z0-9_.]{2,63}$'),
  constraint case_events_actor_check check (actor_type in ('person', 'support', 'client', 'system', 'ai')),
  constraint case_events_data_check check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 4000)
);

create index case_events_case_idx on public.case_events (case_id, at desc);

alter table public.case_events enable row level security;
create policy "case_events_select_member" on public.case_events
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.case_events to authenticated;
create trigger guard_impersonation_case_events after insert or update or delete on public.case_events
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- The client's links ----------

create table public.client_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  -- The person the link is for: an adult claimant or a guardian of the case.
  person_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  -- Visits: openings more than half an hour apart.
  opened_count integer not null default 0,
  last_opened_at timestamptz,
  -- How many files it reserved: the ceiling counts every attempt.
  upload_count integer not null default 0,
  -- How many different CPFs it wrote: the ceiling counts every attempt.
  cpf_attempts integer not null default 0,
  -- The client said they sent everything.
  finished_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (person_id, org_id) references public.people (id, org_id) on delete cascade,
  constraint client_links_token_check check (token_hash ~ '^[0-9a-f]{64}$')
);

create index client_links_case_idx on public.client_links (case_id, created_at desc);

alter table public.client_links enable row level security;
create policy "client_links_select_member" on public.client_links
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.client_links to authenticated;
create trigger guard_impersonation_client_links after insert or update or delete on public.client_links
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- The documents of a case ----------

create table public.case_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  -- Whose document it is, when it is one person's (an identity, a proof of address).
  party_id uuid,
  file_id uuid not null,
  kind text not null,
  -- client: sent through a link. firm: added by somebody of the firm. whatsapp: came in a conversation.
  source text not null,
  link_id uuid,
  -- uploading  reserved by a client, the bytes not measured yet;
  -- received   kept, waiting for a person of the firm;
  -- accepted   a person of the firm accepted it;
  -- rejected   refused, with the reason the client reads.
  status text not null,
  rejected_reason text,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  unique (file_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (party_id, org_id) references public.case_parties (id, org_id) on delete set null (party_id),
  foreign key (file_id, org_id) references public.files (id, org_id) on delete cascade,
  foreign key (link_id, org_id) references public.client_links (id, org_id) on delete set null (link_id),
  constraint case_documents_kind_check check (kind in (
    'identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence',
    'power_of_attorney', 'contract', 'petition', 'other'
  )),
  constraint case_documents_source_check check (source in ('client', 'firm', 'whatsapp')),
  constraint case_documents_status_check check (status in ('uploading', 'received', 'accepted', 'rejected')),
  constraint case_documents_reason_check check ((status = 'rejected') = (rejected_reason is not null) and coalesce(char_length(rejected_reason), 0) <= 500)
);

create index case_documents_case_idx on public.case_documents (case_id, created_at);
create index case_documents_review_idx on public.case_documents (org_id) where status = 'received';

alter table public.case_documents enable row level security;
create policy "case_documents_select_member" on public.case_documents
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.case_documents to authenticated;
create trigger guard_impersonation_case_documents after insert or update or delete on public.case_documents
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- Helpers (not reachable by any API role) ----------

create or replace function public.cases_setting(setting text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select s.value -> setting from public.platform_settings s where s.key = 'cases';
$$;

revoke all on function public.cases_setting(text) from public, anon, authenticated;

/**
 * Whether ONE itself writes to a case now: the backend, inside one of its
 * own functions that carries a case forward where the firm lets it (0039,
 * `advance_*`), which names the case for the length of its transaction. No
 * API role can name it: `set_config` is not reachable through PostgREST,
 * and the service role alone is let through.
 */
create or replace function public.case_system_writer(target_case uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is null and auth.role() = 'service_role' and target_case is not null
    and coalesce(current_setting('one.system_case', true), '') = target_case::text;
$$;

revoke all on function public.case_system_writer(uuid) from public, anon, authenticated;

/** Who a case's timeline says wrote now: ONE, inside its own functions (`case_system_writer`), or a person. */
create or replace function public.case_actor(target_case uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when public.case_system_writer(target_case) then 'system' else 'person' end;
$$;

revoke all on function public.case_actor(uuid) from public, anon, authenticated;

/**
 * The case a person of the firm is writing to. Refuses a support visit and a
 * case of another firm (the same answer as one that does not exist). ONE
 * writes to the case its own function named (`case_system_writer`), with
 * the same lock.
 */
create or replace function public.case_for_writer(target_case uuid)
returns public.cases
language plpgsql
security definer
set search_path = public
as $$
declare
  found_case public.cases%rowtype;
begin
  if public.case_system_writer(target_case) then
    select * into found_case from public.cases where id = target_case for no key update;
    if not found then
      raise exception 'case_not_found' using errcode = 'P0002';
    end if;
    return found_case;
  end if;
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  -- `no key update`: two writers of a case still wait for each other, while a row that only points at
  -- the case (an event of its timeline written by the queue or the backend) is never held behind it.
  select * into found_case from public.cases where id = target_case for no key update;
  if not found or not public.is_org_member(found_case.org_id) then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  return found_case;
end;
$$;

revoke all on function public.case_for_writer(uuid) from public, anon, authenticated;

/**
 * Writes what happened to a case: in its timeline, and in the audit trail
 * (`case.<kind>`), so the firm reads the story and the platform keeps the
 * record. `data` carries ids and the names of what changed, never values.
 */
create or replace function public.record_case_event(
  target_org uuid,
  target_case uuid,
  target_kind text,
  target_actor_type text,
  target_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.case_events (org_id, case_id, kind, actor_type, actor_id, data)
  values (target_org, target_case, target_kind, target_actor_type, auth.uid(), coalesce(target_data, '{}'::jsonb));
  insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), target_actor_type, 'case.' || target_kind, 'case', target_case::text,
          coalesce(target_data, '{}'::jsonb));
end;
$$;

revoke all on function public.record_case_event(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

/**
 * Writes the fields of a person that `target_fields` names, after checking
 * each one: the same checks for the firm and for the client's link. Answers
 * `{ok, changed}` or `{ok: false, code, field}`; writes nothing on a refusal.
 */
create or replace function public.apply_person_fields(target_person uuid, target_fields jsonb, target_via text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed constant text[] := array[
    'full_name', 'cpf', 'birth_date', 'nationality', 'marital_status', 'profession', 'email', 'phone',
    'postal_code', 'street', 'address_number', 'complement', 'district', 'city', 'uf'
  ];
  free_text constant text[] := array['nationality', 'profession', 'street', 'address_number', 'complement', 'district', 'city'];
  limits constant integer[] := array[60, 120, 200, 20, 120, 120, 120];
  fields jsonb := coalesce(target_fields, '{}'::jsonb);
  before_row public.people%rowtype;
  after_row public.people%rowtype;
  field text;
  value text;
  slot integer;
  changed text[];
begin
  if jsonb_typeof(fields) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  for field in select jsonb_object_keys(fields) loop
    if not field = any (allowed) then
      return jsonb_build_object('ok', false, 'code', 'unknown_field', 'field', left(field, 40));
    end if;
    if jsonb_typeof(fields -> field) not in ('string', 'null') then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', field);
    end if;
  end loop;

  select * into before_row from public.people where id = target_person for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'person_not_found');
  end if;
  after_row := before_row;

  if fields ? 'full_name' then
    value := regexp_replace(btrim(coalesce(fields ->> 'full_name', '')), '\s+', ' ', 'g');
    if char_length(value) < 3 or char_length(value) > 200 or value ~ '[[:cntrl:]]' or value !~ '[[:alpha:]]' then
      return jsonb_build_object('ok', false, 'code', 'invalid_name', 'field', 'full_name');
    end if;
    after_row.full_name := value;
  end if;

  if fields ? 'cpf' then
    value := nullif(regexp_replace(coalesce(fields ->> 'cpf', ''), '\D', '', 'g'), '');
    if value is not null and not public.cpf_is_valid(value) then
      return jsonb_build_object('ok', false, 'code', 'invalid_cpf', 'field', 'cpf');
    end if;
    if value is not null and exists (
      select 1 from public.people p where p.org_id = before_row.org_id and p.cpf = value and p.id <> before_row.id
    ) then
      return jsonb_build_object('ok', false, 'code', 'cpf_in_use', 'field', 'cpf');
    end if;
    after_row.cpf := value;
  end if;

  if fields ? 'birth_date' then
    value := nullif(btrim(coalesce(fields ->> 'birth_date', '')), '');
    if value is null then
      after_row.birth_date := null;
    else
      begin
        if value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          raise exception 'bad' using errcode = '22007';
        end if;
        after_row.birth_date := value::date;
      exception when invalid_datetime_format or datetime_field_overflow then
        return jsonb_build_object('ok', false, 'code', 'invalid_birth_date', 'field', 'birth_date');
      end;
      if after_row.birth_date > current_date or after_row.birth_date < date '1900-01-01' then
        return jsonb_build_object('ok', false, 'code', 'invalid_birth_date', 'field', 'birth_date');
      end if;
    end if;
  end if;

  if fields ? 'marital_status' then
    value := nullif(btrim(coalesce(fields ->> 'marital_status', '')), '');
    if value is not null and value not in ('solteiro', 'casado', 'uniao_estavel', 'divorciado', 'separado', 'viuvo') then
      return jsonb_build_object('ok', false, 'code', 'invalid_marital_status', 'field', 'marital_status');
    end if;
    after_row.marital_status := value;
  end if;

  if fields ? 'email' then
    value := nullif(lower(btrim(coalesce(fields ->> 'email', ''))), '');
    if value is not null and (char_length(value) > 254 or value !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
      return jsonb_build_object('ok', false, 'code', 'invalid_email', 'field', 'email');
    end if;
    after_row.email := value;
  end if;

  if fields ? 'phone' then
    value := nullif(regexp_replace(coalesce(fields ->> 'phone', ''), '\D', '', 'g'), '');
    -- A Brazilian number typed with its area code and no country code gets the country.
    if value is not null and char_length(value) in (10, 11) then
      value := '55' || value;
    end if;
    if value is not null and value !~ '^[0-9]{12,15}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_phone', 'field', 'phone');
    end if;
    after_row.phone := value;
  end if;

  if fields ? 'postal_code' then
    value := nullif(regexp_replace(coalesce(fields ->> 'postal_code', ''), '\D', '', 'g'), '');
    if value is not null and value !~ '^[0-9]{8}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_postal_code', 'field', 'postal_code');
    end if;
    after_row.postal_code := value;
  end if;

  if fields ? 'uf' then
    value := nullif(upper(btrim(coalesce(fields ->> 'uf', ''))), '');
    if value is not null and value not in (
      'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
      'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
    ) then
      return jsonb_build_object('ok', false, 'code', 'invalid_uf', 'field', 'uf');
    end if;
    after_row.uf := value;
  end if;

  for slot in 1..array_length(free_text, 1) loop
    field := free_text[slot];
    if fields ? field then
      value := nullif(regexp_replace(btrim(coalesce(fields ->> field, '')), '\s+', ' ', 'g'), '');
      if value is not null and (char_length(value) > limits[slot] or value ~ '[[:cntrl:]]') then
        return jsonb_build_object('ok', false, 'code', 'invalid_' || field, 'field', field);
      end if;
      case field
        when 'nationality' then after_row.nationality := value;
        when 'profession' then after_row.profession := value;
        when 'street' then after_row.street := value;
        when 'address_number' then after_row.address_number := value;
        when 'complement' then after_row.complement := value;
        when 'district' then after_row.district := value;
        when 'city' then after_row.city := value;
      end case;
    end if;
  end loop;

  -- The registry answers for a CPF with its birth date: what it said of the
  -- old pair says nothing of a new one. A new name is compared again with the
  -- name the registry gave.
  if after_row.cpf is distinct from before_row.cpf or after_row.birth_date is distinct from before_row.birth_date then
    after_row.cpf_registry_result := null;
    after_row.cpf_checked_at := null;
    after_row.cpf_registry_name := null;
    after_row.cpf_registry_birth_date := null;
    after_row.cpf_registry_situation := null;
    after_row.cpf_registry_regular := null;
    after_row.cpf_name_matches := null;
  elsif after_row.full_name is distinct from before_row.full_name and after_row.cpf_registry_name is not null then
    after_row.cpf_name_matches := public.plain_name(after_row.cpf_registry_name) = public.plain_name(after_row.full_name);
  end if;

  select coalesce(array_agg(key order by key), '{}') into changed
  from jsonb_each(to_jsonb(after_row)) as next_value (key, value)
  join jsonb_each(to_jsonb(before_row)) as previous_value (key, value) using (key)
  where next_value.value is distinct from previous_value.value and key = any (allowed);

  if cardinality(changed) = 0 then
    return jsonb_build_object('ok', true, 'changed', '[]'::jsonb);
  end if;

  update public.people set
    full_name = after_row.full_name, cpf = after_row.cpf, birth_date = after_row.birth_date,
    nationality = after_row.nationality, marital_status = after_row.marital_status, profession = after_row.profession,
    email = after_row.email, phone = after_row.phone, postal_code = after_row.postal_code, street = after_row.street,
    address_number = after_row.address_number, complement = after_row.complement, district = after_row.district,
    city = after_row.city, uf = after_row.uf,
    cpf_registry_result = after_row.cpf_registry_result,
    cpf_checked_at = after_row.cpf_checked_at, cpf_registry_name = after_row.cpf_registry_name,
    cpf_registry_birth_date = after_row.cpf_registry_birth_date, cpf_registry_situation = after_row.cpf_registry_situation,
    cpf_registry_regular = after_row.cpf_registry_regular, cpf_name_matches = after_row.cpf_name_matches,
    updated_via = target_via
  where id = before_row.id;

  return jsonb_build_object('ok', true, 'changed', to_jsonb(changed));
end;
$$;

revoke all on function public.apply_person_fields(uuid, jsonb, text) from public, anon, authenticated;

/**
 * Writes the fields of a leg of the trip `target_fields` names. Times are
 * local (`YYYY-MM-DDTHH:MM`), as the ticket prints them; an airport is a code
 * of the `airports` table; a flight number is normalized (`G3 01234` is
 * `G31234`). Answers `{ok, changed}` or `{ok: false, code, field}`.
 */
create or replace function public.apply_segment_fields(target_segment uuid, target_fields jsonb, target_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed constant text[] := array[
    'position', 'flight_number', 'origin_iata', 'destination_iata', 'scheduled_departure_local',
    'scheduled_arrival_local', 'actual_departure_local', 'actual_arrival_local', 'booking_reference', 'affected'
  ];
  times constant text[] := array[
    'scheduled_departure_local', 'scheduled_arrival_local', 'actual_departure_local', 'actual_arrival_local'
  ];
  fields jsonb := coalesce(target_fields, '{}'::jsonb);
  before_row public.flight_segments%rowtype;
  after_row public.flight_segments%rowtype;
  field text;
  value text;
  moment timestamp;
  parts text[];
  changed text[];
begin
  if jsonb_typeof(fields) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  for field in select jsonb_object_keys(fields) loop
    if not field = any (allowed) then
      return jsonb_build_object('ok', false, 'code', 'unknown_field', 'field', left(field, 40));
    end if;
  end loop;

  select * into before_row from public.flight_segments where id = target_segment for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'segment_not_found');
  end if;
  after_row := before_row;

  if fields ? 'position' then
    begin
      after_row.position := (fields ->> 'position')::smallint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      return jsonb_build_object('ok', false, 'code', 'invalid_position', 'field', 'position');
    end;
    if after_row.position is null or after_row.position not between 1 and 20 then
      return jsonb_build_object('ok', false, 'code', 'invalid_position', 'field', 'position');
    end if;
  end if;

  if fields ? 'flight_number' then
    value := nullif(upper(regexp_replace(coalesce(fields ->> 'flight_number', ''), '[[:space:]-]', '', 'g')), '');
    if value is not null then
      parts := regexp_match(value, '^([A-Z0-9]{2})0*([1-9][0-9]{0,3})([A-Z]?)$');
      if parts is null or parts[1] ~ '^[0-9]{2}$' then
        return jsonb_build_object('ok', false, 'code', 'invalid_flight_number', 'field', 'flight_number');
      end if;
      value := parts[1] || parts[2] || parts[3];
    end if;
    after_row.flight_number := value;
  end if;

  if fields ? 'origin_iata' then
    value := nullif(upper(btrim(coalesce(fields ->> 'origin_iata', ''))), '');
    if value is not null and not exists (select 1 from public.airports a where a.iata = value) then
      return jsonb_build_object('ok', false, 'code', 'unknown_airport', 'field', 'origin_iata');
    end if;
    after_row.origin_iata := value;
  end if;

  if fields ? 'destination_iata' then
    value := nullif(upper(btrim(coalesce(fields ->> 'destination_iata', ''))), '');
    if value is not null and not exists (select 1 from public.airports a where a.iata = value) then
      return jsonb_build_object('ok', false, 'code', 'unknown_airport', 'field', 'destination_iata');
    end if;
    after_row.destination_iata := value;
  end if;

  if after_row.origin_iata is not null and after_row.origin_iata = after_row.destination_iata then
    return jsonb_build_object('ok', false, 'code', 'same_airport', 'field', 'destination_iata');
  end if;

  foreach field in array times loop
    if fields ? field then
      value := nullif(btrim(coalesce(fields ->> field, '')), '');
      moment := null;
      if value is not null then
        begin
          if value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}' then
            raise exception 'bad' using errcode = '22007';
          end if;
          moment := left(replace(value, 'T', ' '), 16)::timestamp;
        exception when invalid_datetime_format or datetime_field_overflow then
          return jsonb_build_object('ok', false, 'code', 'invalid_time', 'field', field);
        end;
        if moment < timestamp '2000-01-01' or moment > timestamp '2100-01-01' then
          return jsonb_build_object('ok', false, 'code', 'invalid_time', 'field', field);
        end if;
      end if;
      case field
        when 'scheduled_departure_local' then after_row.scheduled_departure_local := moment;
        when 'scheduled_arrival_local' then after_row.scheduled_arrival_local := moment;
        when 'actual_departure_local' then after_row.actual_departure_local := moment;
        when 'actual_arrival_local' then after_row.actual_arrival_local := moment;
      end case;
    end if;
  end loop;

  if fields ? 'booking_reference' then
    value := nullif(upper(regexp_replace(coalesce(fields ->> 'booking_reference', ''), '[[:space:]]', '', 'g')), '');
    if value is not null and value !~ '^[A-Z0-9]{5,8}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_booking_reference', 'field', 'booking_reference');
    end if;
    after_row.booking_reference := value;
  end if;

  if fields ? 'affected' then
    if jsonb_typeof(fields -> 'affected') <> 'boolean' then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'affected');
    end if;
    after_row.affected := (fields ->> 'affected')::boolean;
  end if;

  select coalesce(array_agg(key order by key), '{}') into changed
  from jsonb_each(to_jsonb(after_row)) as next_value (key, value)
  join jsonb_each(to_jsonb(before_row)) as previous_value (key, value) using (key)
  where next_value.value is distinct from previous_value.value and key = any (allowed);

  if cardinality(changed) > 0 then
    update public.flight_segments set
      position = after_row.position, flight_number = after_row.flight_number,
      origin_iata = after_row.origin_iata, destination_iata = after_row.destination_iata,
      scheduled_departure_local = after_row.scheduled_departure_local,
      scheduled_arrival_local = after_row.scheduled_arrival_local,
      actual_departure_local = after_row.actual_departure_local,
      actual_arrival_local = after_row.actual_arrival_local,
      booking_reference = after_row.booking_reference, affected = after_row.affected,
      -- A leg the firm wrote stays the firm's whoever corrects it; one the
      -- client wrote becomes the firm's when the firm corrects it.
      source = case when target_source = 'firm' then 'firm' else source end
    where id = before_row.id;
  end if;
  return jsonb_build_object('ok', true, 'changed', to_jsonb(changed));
end;
$$;

revoke all on function public.apply_segment_fields(uuid, jsonb, text) from public, anon, authenticated;

-- ---------- What a person of the firm does ----------

/**
 * Opens a case with its first client. Anybody of the firm may, never from a
 * support visit. The case gets the next number of the firm; the client is a
 * new person unless the firm already has one with the same CPF.
 */
create or replace function public.create_case(
  target_org uuid,
  target_incident text,
  target_airline text,
  target_flight_date date,
  target_client jsonb,
  target_origin text default null,
  target_summary text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  next_seq integer;
  new_case uuid;
  person uuid;
  party uuid;
  client jsonb := coalesce(target_client, '{}'::jsonb);
  existing_cpf text := nullif(regexp_replace(coalesce(client ->> 'cpf', ''), '\D', '', 'g'), '');
  applied jsonb;
  failed_field text;
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
  if target_incident is null or target_incident not in (
    'delay', 'cancellation', 'overbooking', 'missed_connection', 'downgrade',
    'baggage_lost', 'baggage_damaged', 'baggage_delayed', 'other'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_incident', 'field', 'incident');
  end if;
  if target_airline is not null and not exists (select 1 from public.airlines a where a.iata = target_airline and a.active) then
    return jsonb_build_object('ok', false, 'code', 'unknown_airline', 'field', 'airline');
  end if;
  if target_flight_date is not null and (target_flight_date < date '2000-01-01' or target_flight_date > current_date + 400) then
    return jsonb_build_object('ok', false, 'code', 'invalid_flight_date', 'field', 'flight_date');
  end if;
  if target_origin is not null and target_origin not in ('agency', 'referral', 'ads', 'organic', 'returning_client', 'other') then
    return jsonb_build_object('ok', false, 'code', 'invalid_origin', 'field', 'origin');
  end if;
  if jsonb_typeof(client) <> 'object' or char_length(btrim(coalesce(client ->> 'full_name', ''))) < 3 then
    return jsonb_build_object('ok', false, 'code', 'invalid_name', 'field', 'full_name');
  end if;

  begin
    -- One number at a time per firm. `no key update`: two cases being opened still wait for each other,
    -- while a row that only points at the firm (a message that arrives, an event of another case) is
    -- never held behind them, however many cases one call opens (the import of a portfolio, 0032).
    perform 1 from public.organizations where id = target_org for no key update;
    select coalesce(max(c.seq), 0) + 1 into next_seq from public.cases c where c.org_id = target_org;

    insert into public.cases (org_id, seq, incident, airline_iata, flight_date, origin, summary, created_by)
    values (target_org, next_seq, target_incident, target_airline, target_flight_date, target_origin,
            nullif(left(btrim(coalesce(target_summary, '')), 4000), ''), caller)
    returning id into new_case;

    -- A client the firm already has, by CPF, is the same person.
    if existing_cpf is not null then
      select p.id into person from public.people p where p.org_id = target_org and p.cpf = existing_cpf;
    end if;
    if person is null then
      insert into public.people (org_id, full_name, created_by)
      values (target_org, left(regexp_replace(btrim(client ->> 'full_name'), '\s+', ' ', 'g'), 200), caller)
      returning id into person;
    end if;

    applied := public.apply_person_fields(person, client, 'firm');
    if not (applied ->> 'ok')::boolean then
      raise exception using errcode = 'P0001', message = applied ->> 'code', detail = coalesce(applied ->> 'field', '');
    end if;

    insert into public.case_parties (org_id, case_id, person_id, role)
    values (target_org, new_case, person, 'claimant')
    returning id into party;

    perform public.record_case_event(target_org, new_case, 'created', 'person',
      jsonb_build_object('seq', next_seq, 'incident', target_incident));
  exception when sqlstate 'P0001' then
    get stacked diagnostics failed_field = pg_exception_detail;
    return jsonb_build_object('ok', false, 'code', sqlerrm, 'field', nullif(failed_field, ''));
  end;

  return jsonb_build_object('ok', true, 'code', 'created', 'case_id', new_case, 'seq', next_seq,
                            'person_id', person, 'party_id', party);
end;
$$;

revoke all on function public.create_case(uuid, text, text, date, jsonb, text, text) from public, anon;
grant execute on function public.create_case(uuid, text, text, date, jsonb, text, text) to authenticated;

/** Changes what a case is about: the incident, the airline, the flight day, its origin, the firm's note, who is responsible. */
create or replace function public.update_case(target_case uuid, target_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  fields jsonb := coalesce(target_fields, '{}'::jsonb);
  allowed constant text[] := array['incident', 'airline_iata', 'flight_date', 'origin', 'summary', 'responsible_id', 'cause'];
  field text;
  value text;
  changed text[] := '{}';
begin
  if jsonb_typeof(fields) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  for field in select jsonb_object_keys(fields) loop
    if not field = any (allowed) then
      return jsonb_build_object('ok', false, 'code', 'unknown_field', 'field', left(field, 40));
    end if;
    value := nullif(btrim(coalesce(fields ->> field, '')), '');
    case field
      when 'incident' then
        if value is null or value not in ('delay', 'cancellation', 'overbooking', 'missed_connection', 'downgrade',
                                           'baggage_lost', 'baggage_damaged', 'baggage_delayed', 'other') then
          return jsonb_build_object('ok', false, 'code', 'invalid_incident', 'field', field);
        end if;
      when 'airline_iata' then
        if value is not null and not exists (select 1 from public.airlines a where a.iata = value) then
          return jsonb_build_object('ok', false, 'code', 'unknown_airline', 'field', field);
        end if;
      when 'flight_date' then
        begin
          if value is not null and (value::date < date '2000-01-01' or value::date > current_date + 400) then
            return jsonb_build_object('ok', false, 'code', 'invalid_flight_date', 'field', field);
          end if;
        exception when invalid_datetime_format or datetime_field_overflow then
          return jsonb_build_object('ok', false, 'code', 'invalid_flight_date', 'field', field);
        end;
      when 'origin' then
        if value is not null and value not in ('agency', 'referral', 'ads', 'organic', 'returning_client', 'other') then
          return jsonb_build_object('ok', false, 'code', 'invalid_origin', 'field', field);
        end if;
      when 'summary' then
        if value is not null and char_length(value) > 4000 then
          return jsonb_build_object('ok', false, 'code', 'invalid_summary', 'field', field);
        end if;
      when 'cause' then
        if value is null or value not in ('internal', 'external', 'undetermined') then
          return jsonb_build_object('ok', false, 'code', 'invalid_cause', 'field', field);
        end if;
      when 'responsible_id' then
        if value is not null and not exists (
          select 1 from public.memberships m where m.org_id = current_case.org_id and m.user_id::text = value
        ) then
          return jsonb_build_object('ok', false, 'code', 'not_a_member', 'field', field);
        end if;
    end case;
  end loop;

  update public.cases set
    incident = case when fields ? 'incident' then fields ->> 'incident' else incident end,
    airline_iata = case when fields ? 'airline_iata' then nullif(btrim(coalesce(fields ->> 'airline_iata', '')), '') else airline_iata end,
    flight_date = case when fields ? 'flight_date' then nullif(btrim(coalesce(fields ->> 'flight_date', '')), '')::date else flight_date end,
    origin = case when fields ? 'origin' then nullif(btrim(coalesce(fields ->> 'origin', '')), '') else origin end,
    summary = case when fields ? 'summary' then nullif(btrim(coalesce(fields ->> 'summary', '')), '') else summary end,
    cause = case when fields ? 'cause' then fields ->> 'cause' else cause end,
    responsible_id = case when fields ? 'responsible_id' then nullif(btrim(coalesce(fields ->> 'responsible_id', '')), '')::uuid else responsible_id end
  where id = current_case.id;

  select coalesce(array_agg(key order by key), '{}') into changed
  from jsonb_object_keys(fields) as key;
  if cardinality(changed) > 0 then
    perform public.record_case_event(current_case.org_id, current_case.id, 'updated', 'person',
      jsonb_build_object('fields', to_jsonb(changed)));
  end if;
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.update_case(uuid, jsonb) from public, anon;
grant execute on function public.update_case(uuid, jsonb) to authenticated;

/** Moves a case to another stage. Closing or declining it takes a reason, which the timeline keeps. */
create or replace function public.set_case_status(target_case uuid, target_status text, target_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
begin
  if target_status is null or target_status not in (
    'intake', 'documents', 'signature', 'drafting', 'ready', 'filed', 'closed', 'declined'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;
  if current_case.status = target_status then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  if target_status in ('closed', 'declined') and (reason is null or char_length(reason) < 8) then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;

  update public.cases set
    status = target_status,
    status_changed_at = now(),
    closed_at = case when target_status in ('closed', 'declined') then now() end,
    close_reason = case when target_status in ('closed', 'declined') then left(reason, 1000) end
  where id = current_case.id;

  perform public.record_case_event(current_case.org_id, current_case.id, 'status_changed', 'person',
    jsonb_build_object('from', current_case.status, 'to', target_status));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_case_status(uuid, text, text) from public, anon;
grant execute on function public.set_case_status(uuid, text, text) to authenticated;

/**
 * Writes a person of a case: an existing party's data, or a new person with
 * the role they take in the case (a claimant, or a guardian; a minor
 * claimant names the guardian party who answers for them).
 */
create or replace function public.save_case_person(
  target_case uuid,
  target_person uuid,
  target_fields jsonb,
  target_role text default null,
  target_guardian uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  person uuid := target_person;
  party uuid;
  applied jsonb;
  failed_field text;
  fields jsonb := coalesce(target_fields, '{}'::jsonb);
begin
  if target_guardian is not null and not exists (
    select 1 from public.case_parties g where g.id = target_guardian and g.case_id = current_case.id and g.role = 'guardian'
  ) then
    return jsonb_build_object('ok', false, 'code', 'guardian_not_found');
  end if;

  if person is null then
    if target_role is null or target_role not in ('claimant', 'guardian') then
      return jsonb_build_object('ok', false, 'code', 'invalid_role');
    end if;
    if target_role = 'guardian' and target_guardian is not null then
      return jsonb_build_object('ok', false, 'code', 'invalid_role');
    end if;
    if jsonb_typeof(fields) <> 'object' or char_length(btrim(coalesce(fields ->> 'full_name', ''))) < 3 then
      return jsonb_build_object('ok', false, 'code', 'invalid_name', 'field', 'full_name');
    end if;
  elsif not exists (
    select 1 from public.case_parties cp where cp.case_id = current_case.id and cp.person_id = person
  ) then
    return jsonb_build_object('ok', false, 'code', 'person_not_found');
  end if;

  begin
    if person is null then
      insert into public.people (org_id, full_name, created_by)
      values (current_case.org_id, left(regexp_replace(btrim(fields ->> 'full_name'), '\s+', ' ', 'g'), 200), auth.uid())
      returning id into person;
    end if;

    applied := public.apply_person_fields(person, fields, 'firm');
    if not (applied ->> 'ok')::boolean then
      raise exception using errcode = 'P0001', message = applied ->> 'code', detail = coalesce(applied ->> 'field', '');
    end if;

    if target_role is not null then
      insert into public.case_parties (org_id, case_id, person_id, role, guardian_id)
      values (current_case.org_id, current_case.id, person, target_role,
              case when target_role = 'claimant' then target_guardian end)
      on conflict (case_id, person_id, role) do update set guardian_id = excluded.guardian_id
      returning id into party;
    elsif target_guardian is not null then
      update public.case_parties set guardian_id = target_guardian
      where case_id = current_case.id and person_id = person and role = 'claimant'
      returning id into party;
    end if;

    perform public.record_case_event(current_case.org_id, current_case.id, 'person_saved', 'person',
      jsonb_build_object('person', person, 'fields', coalesce(applied -> 'changed', '[]'::jsonb),
                         'role', target_role));
  exception when sqlstate 'P0001' then
    get stacked diagnostics failed_field = pg_exception_detail;
    return jsonb_build_object('ok', false, 'code', sqlerrm, 'field', nullif(failed_field, ''));
  end;

  return jsonb_build_object('ok', true, 'code', 'saved', 'person_id', person, 'party_id', party);
end;
$$;

revoke all on function public.save_case_person(uuid, uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.save_case_person(uuid, uuid, jsonb, text, uuid) to authenticated;

/** Takes a person out of a case (the person stays with the firm). A case keeps at least one claimant. */
create or replace function public.remove_case_party(target_party uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  party public.case_parties%rowtype;
  current_case public.cases%rowtype;
  ended uuid;
begin
  select * into party from public.case_parties where id = target_party;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(party.case_id);
  if party.role = 'claimant' and not exists (
    select 1 from public.case_parties other
    where other.case_id = party.case_id and other.role = 'claimant' and other.id <> party.id
  ) then
    return jsonb_build_object('ok', false, 'code', 'last_claimant');
  end if;
  delete from public.case_parties where id = party.id;
  -- Out of the case altogether: their link ends with it.
  if not exists (
    select 1 from public.case_parties other where other.case_id = party.case_id and other.person_id = party.person_id
  ) then
    for ended in
      update public.client_links set revoked_at = now(), revoked_by = auth.uid()
      where case_id = party.case_id and person_id = party.person_id and revoked_at is null
      returning id
    loop
      perform public.record_case_event(current_case.org_id, current_case.id, 'client_link_revoked', 'person',
        jsonb_build_object('link', ended, 'why', 'party_removed'));
    end loop;
  end if;
  perform public.record_case_event(current_case.org_id, current_case.id, 'party_removed', 'person',
    jsonb_build_object('person', party.person_id, 'role', party.role));
  return jsonb_build_object('ok', true, 'code', 'removed');
end;
$$;

revoke all on function public.remove_case_party(uuid) from public, anon;
grant execute on function public.remove_case_party(uuid) to authenticated;

/** Adds a leg of the trip to a case, or changes one. */
create or replace function public.save_flight_segment(target_case uuid, target_segment uuid, target_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  segment uuid := target_segment;
  applied jsonb;
  failed_field text;
begin
  if segment is not null and not exists (
    select 1 from public.flight_segments s where s.id = segment and s.case_id = current_case.id
  ) then
    return jsonb_build_object('ok', false, 'code', 'segment_not_found');
  end if;
  if segment is null and (select count(*) from public.flight_segments s where s.case_id = current_case.id) >= 20 then
    return jsonb_build_object('ok', false, 'code', 'too_many_segments');
  end if;

  begin
    if segment is null then
      insert into public.flight_segments (org_id, case_id, position, source)
      values (current_case.org_id, current_case.id,
              coalesce((select max(s.position) + 1 from public.flight_segments s where s.case_id = current_case.id), 1),
              'firm')
      returning id into segment;
    end if;
    applied := public.apply_segment_fields(segment, target_fields, 'firm');
    if not (applied ->> 'ok')::boolean then
      raise exception using errcode = 'P0001', message = applied ->> 'code', detail = coalesce(applied ->> 'field', '');
    end if;
    perform public.record_case_event(current_case.org_id, current_case.id, 'segment_saved', 'person',
      jsonb_build_object('segment', segment, 'fields', coalesce(applied -> 'changed', '[]'::jsonb)));
  exception when sqlstate 'P0001' then
    get stacked diagnostics failed_field = pg_exception_detail;
    return jsonb_build_object('ok', false, 'code', sqlerrm, 'field', nullif(failed_field, ''));
  end;
  return jsonb_build_object('ok', true, 'code', 'saved', 'segment_id', segment);
end;
$$;

revoke all on function public.save_flight_segment(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_flight_segment(uuid, uuid, jsonb) to authenticated;

create or replace function public.remove_flight_segment(target_segment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  segment public.flight_segments%rowtype;
  current_case public.cases%rowtype;
begin
  select * into segment from public.flight_segments where id = target_segment;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(segment.case_id);
  delete from public.flight_segments where id = segment.id;
  perform public.record_case_event(current_case.org_id, current_case.id, 'segment_removed', 'person',
    jsonb_build_object('segment', segment.id));
  return jsonb_build_object('ok', true, 'code', 'removed');
end;
$$;

revoke all on function public.remove_flight_segment(uuid) from public, anon;
grant execute on function public.remove_flight_segment(uuid) to authenticated;

/**
 * Where each claimant of a lawsuit lives, for its forum: their own city and
 * state; for a minor (by the birth date, or with a guardian and none
 * written), those of who answers for them. Only claimants of the case named.
 */
create or replace function public.proceeding_claimant_homes(target_case uuid, target_parties uuid[])
returns table (party_id uuid, city text, uf text)
language sql
stable
security definer
set search_path = public
as $$
  select cp.id, home.city, home.uf
  from unnest(target_parties) as given (party)
  join public.case_parties cp on cp.id = given.party and cp.case_id = target_case
  join public.people own on own.id = cp.person_id
  left join public.case_parties gp on gp.id = cp.guardian_id
    and (own.birth_date is null or own.birth_date > (now() at time zone 'America/Sao_Paulo')::date - interval '18 years')
  join public.people home on home.id = coalesce(gp.person_id, cp.person_id);
$$;

revoke all on function public.proceeding_claimant_homes(uuid, uuid[]) from public, anon, authenticated;

/**
 * Plans a lawsuit of a case, or changes one: the kind, the court, the forum
 * and its basis (another forum than the client's domicile takes a reason),
 * the number once filed, its claimants and its lawyers. A number must be
 * valid, of the state courts' segment and of the court named.
 */
create or replace function public.save_proceeding(
  target_case uuid,
  target_proceeding uuid,
  target_fields jsonb,
  target_parties uuid[] default null,
  target_lawyers uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  fields jsonb := coalesce(target_fields, '{}'::jsonb);
  proceeding uuid := target_proceeding;
  kind_value text := nullif(btrim(coalesce(fields ->> 'kind', '')), '');
  court_code text := nullif(upper(btrim(coalesce(fields ->> 'court', ''))), '');
  cnj_value text := nullif(regexp_replace(coalesce(fields ->> 'cnj', ''), '\D', '', 'g'), '');
  basis text := nullif(btrim(coalesce(fields ->> 'forum_basis', '')), '');
  reason text := nullif(btrim(coalesce(fields ->> 'forum_reason', '')), '');
  forum_city_value text := nullif(btrim(coalesce(fields ->> 'forum_city', '')), '');
  status_value text := coalesce(nullif(btrim(coalesce(fields ->> 'status', '')), ''), 'planned');
  claimants uuid[];
  system_name text := nullif(btrim(coalesce(fields ->> 'system', '')), '');
  court_row public.courts%rowtype;
  filed date;
begin
  if kind_value is null or kind_value not in ('juizado', 'comum') then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind', 'field', 'kind');
  end if;
  if proceeding is not null and not exists (
    select 1 from public.proceedings p where p.id = proceeding and p.case_id = current_case.id
  ) then
    return jsonb_build_object('ok', false, 'code', 'proceeding_not_found');
  end if;
  if court_code is not null then
    select * into court_row from public.courts c where c.acronym = court_code;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'unknown_court', 'field', 'court');
    end if;
  end if;
  if cnj_value is not null then
    if not public.cnj_is_valid(cnj_value) then
      return jsonb_build_object('ok', false, 'code', 'invalid_cnj', 'field', 'cnj');
    end if;
    if court_row.acronym is null or substr(cnj_value, 14, 1) <> court_row.cnj_segment or substr(cnj_value, 15, 2) <> court_row.cnj_code then
      return jsonb_build_object('ok', false, 'code', 'cnj_of_another_court', 'field', 'cnj');
    end if;
    if exists (
      select 1 from public.proceedings p
      where p.org_id = current_case.org_id and p.cnj = cnj_value and p.id is distinct from proceeding
    ) then
      return jsonb_build_object('ok', false, 'code', 'cnj_in_use', 'field', 'cnj');
    end if;
  end if;
  if basis is not null and basis not in ('domicile', 'event_place', 'defendant_seat', 'other') then
    return jsonb_build_object('ok', false, 'code', 'invalid_forum_basis', 'field', 'forum_basis');
  end if;
  if basis is not null and basis <> 'domicile' and (reason is null or char_length(reason) < 8) then
    return jsonb_build_object('ok', false, 'code', 'forum_reason_required', 'field', 'forum_reason');
  end if;
  if status_value not in ('planned', 'filed', 'closed') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status', 'field', 'status');
  end if;
  if status_value <> 'planned' and cnj_value is null then
    return jsonb_build_object('ok', false, 'code', 'cnj_required', 'field', 'cnj');
  end if;
  if system_name is not null and system_name not in ('projudi', 'eproc', 'pje', 'esaj', 'outro') then
    return jsonb_build_object('ok', false, 'code', 'invalid_system', 'field', 'system');
  end if;
  begin
    filed := nullif(btrim(coalesce(fields ->> 'filed_at', '')), '')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('ok', false, 'code', 'invalid_filed_at', 'field', 'filed_at');
  end;
  if char_length(coalesce(fields ->> 'comarca', '')) > 120 or char_length(coalesce(fields ->> 'unit', '')) > 200
     or char_length(coalesce(reason, '')) > 1000 or char_length(coalesce(forum_city_value, '')) > 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  -- The rules of the forum and of the kind say what may be filed, so they are asked of a lawsuit
  -- still planned. One the court already has (filed, or filed before ONE) is recorded as it is: a
  -- client who moved, or a leg corrected since, never locks its number, its unit or its end.
  --
  -- The rule of the forum (`@flyee/rules/forum`): another forum than the domicile is a city of an
  -- airport of the trip (the city it serves, or the municipality it sits in: 0025), in the state of
  -- the court.
  if status_value = 'planned' and basis is not null and basis <> 'domicile' and (forum_city_value is null or not exists (
    select 1 from public.flight_segments s
    join public.airports a on a.iata in (s.origin_iata, s.destination_iata)
    where s.case_id = current_case.id and a.country = 'BR'
      and public.slugify(forum_city_value) in (public.slugify(a.city), public.slugify(coalesce(a.municipality, a.city)))
      and (court_row.uf is null or a.uf = court_row.uf)
  )) then
    return jsonb_build_object('ok', false, 'code', 'forum_not_linked_to_flight', 'field', 'forum_city');
  end if;

  -- The claimants of a lawsuit are claimants of the case, and its lawyers sign: partners and lawyers of the firm.
  if target_parties is not null and exists (
    select 1 from unnest(target_parties) as given (party)
    where not exists (
      select 1 from public.case_parties cp where cp.id = given.party and cp.case_id = current_case.id and cp.role = 'claimant'
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'party_not_found', 'field', 'parties');
  end if;
  if target_lawyers is not null and exists (
    select 1 from unnest(target_lawyers) as given (person)
    where not exists (
      select 1 from public.memberships m
      where m.org_id = current_case.org_id and m.user_id = given.person and m.firm_function in ('socio', 'advogado')
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_a_lawyer', 'field', 'lawyers');
  end if;

  -- From here on the claimants are known to be of this case (checked above, or already in the lawsuit).
  claimants := coalesce(target_parties, array(
    select pp.party_id from public.proceeding_parties pp where pp.proceeding_id = proceeding
  ));
  -- The rule of the kind (`@flyee/rules/proceedings`): a minor is never a party in the small-claims
  -- court (Lei 9.099/1995, art. 8). Somebody a guardian answers for is one, birth date written or not.
  if status_value = 'planned' and kind_value = 'juizado' and exists (
    select 1 from unnest(claimants) as given (party)
    join public.case_parties cp on cp.id = given.party and cp.case_id = current_case.id
    join public.people p on p.id = cp.person_id
    where p.birth_date > (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
       or (p.birth_date is null and cp.guardian_id is not null)
  ) then
    return jsonb_build_object('ok', false, 'code', 'minor_in_small_claims', 'field', 'parties');
  end if;
  -- A family with a minor goes to the civil court together, in one lawsuit, unless a lawyer chose to split
  -- it (`cases.family_choice`, 0025): a planned small-claims lawsuit beside a minor of the case is a split.
  if status_value = 'planned' and kind_value = 'juizado' and current_case.family_choice = 'together' and exists (
    select 1 from public.case_parties cp
    join public.people p on p.id = cp.person_id
    where cp.case_id = current_case.id and cp.role = 'claimant'
      and (p.birth_date > (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
           or (p.birth_date is null and cp.guardian_id is not null))
  ) then
    return jsonb_build_object('ok', false, 'code', 'family_split_unchosen', 'field', 'kind');
  end if;
  -- The rule of the forum, at the domicile: the court is of the state where a claimant of the lawsuit
  -- lives (for a minor, who answers for them; an adult who once had a guardian lives where they
  -- live), when anybody's state is known.
  if status_value = 'planned' and coalesce(basis, 'domicile') = 'domicile' and court_row.acronym is not null and exists (
    select 1 from public.proceeding_claimant_homes(current_case.id, claimants) home where home.uf is not null
  ) and not exists (
    select 1 from public.proceeding_claimant_homes(current_case.id, claimants) home where home.uf = court_row.uf
  ) then
    return jsonb_build_object('ok', false, 'code', 'forum_not_domicile', 'field', 'court');
  end if;

  if proceeding is null then
    insert into public.proceedings (org_id, case_id, kind, created_by)
    values (current_case.org_id, current_case.id, kind_value, auth.uid())
    returning id into proceeding;
  end if;

  update public.proceedings set
    kind = kind_value,
    court = court_code,
    comarca = nullif(btrim(coalesce(fields ->> 'comarca', '')), ''),
    unit = nullif(btrim(coalesce(fields ->> 'unit', '')), ''),
    system = system_name,
    cnj = cnj_value,
    forum_basis = basis,
    forum_reason = reason,
    forum_city = forum_city_value,
    status = status_value,
    filed_at = filed
  where id = proceeding;

  if target_parties is not null then
    delete from public.proceeding_parties where proceeding_id = proceeding;
    insert into public.proceeding_parties (proceeding_id, party_id, org_id)
    select proceeding, given.party, current_case.org_id from unnest(target_parties) as given (party)
    on conflict do nothing;
  end if;
  if target_lawyers is not null then
    delete from public.proceeding_lawyers where proceeding_id = proceeding;
    insert into public.proceeding_lawyers (proceeding_id, user_id, org_id)
    select proceeding, given.person, current_case.org_id from unnest(target_lawyers) as given (person)
    on conflict do nothing;
  end if;

  perform public.record_case_event(current_case.org_id, current_case.id, 'proceeding_saved',
    public.case_actor(current_case.id),
    jsonb_build_object('proceeding', proceeding, 'kind', kind_value, 'status', status_value));
  return jsonb_build_object('ok', true, 'code', 'saved', 'proceeding_id', proceeding);
end;
$$;

revoke all on function public.save_proceeding(uuid, uuid, jsonb, uuid[], uuid[]) from public, anon;
grant execute on function public.save_proceeding(uuid, uuid, jsonb, uuid[], uuid[]) to authenticated;

/** Removes a lawsuit that was only planned. One that was filed stays: the court has it. */
create or replace function public.remove_proceeding(target_proceeding uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proceeding public.proceedings%rowtype;
  current_case public.cases%rowtype;
begin
  select * into proceeding from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(proceeding.case_id);
  if proceeding.status <> 'planned' then
    return jsonb_build_object('ok', false, 'code', 'already_filed');
  end if;
  delete from public.proceedings where id = proceeding.id;
  perform public.record_case_event(current_case.org_id, current_case.id, 'proceeding_removed', 'person',
    jsonb_build_object('proceeding', proceeding.id));
  return jsonb_build_object('ok', true, 'code', 'removed');
end;
$$;

revoke all on function public.remove_proceeding(uuid) from public, anon;
grant execute on function public.remove_proceeding(uuid) to authenticated;

/**
 * Gives a client their way in: a link for one person of one case. The app
 * mints the token and hands only its SHA-256 here. A new link for the same
 * person and case ends the ones before it. Never for a minor: the person who
 * answers for them gets it.
 */
create or replace function public.create_client_link(target_case uuid, target_person uuid, target_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  person public.people%rowtype;
  link uuid;
  ends timestamptz := now() + make_interval(days => greatest(coalesce((public.cases_setting('client_link_days') #>> '{}')::integer, 30), 1));
begin
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  select * into person from public.people p
  where p.id = target_person and p.org_id = current_case.org_id
    and exists (select 1 from public.case_parties cp where cp.case_id = current_case.id and cp.person_id = p.id);
  if not found then
    return jsonb_build_object('ok', false, 'code', 'person_not_found');
  end if;
  if person.birth_date is not null and person.birth_date > (current_date - interval '18 years')::date then
    return jsonb_build_object('ok', false, 'code', 'minor_cannot_receive');
  end if;
  if current_case.status in ('closed', 'declined') then
    return jsonb_build_object('ok', false, 'code', 'case_closed');
  end if;

  update public.client_links set revoked_at = now(), revoked_by = auth.uid()
  where case_id = current_case.id and person_id = person.id and revoked_at is null and expires_at > now();

  insert into public.client_links (org_id, case_id, person_id, token_hash, expires_at, created_by)
  values (current_case.org_id, current_case.id, person.id, target_token_hash, ends, auth.uid())
  returning id into link;

  perform public.record_case_event(current_case.org_id, current_case.id, 'client_link_created', 'person',
    jsonb_build_object('link', link, 'person', person.id));
  return jsonb_build_object('ok', true, 'code', 'created', 'link_id', link, 'expires_at', ends);
end;
$$;

revoke all on function public.create_client_link(uuid, uuid, text) from public, anon;
grant execute on function public.create_client_link(uuid, uuid, text) to authenticated;

create or replace function public.revoke_client_link(target_link uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype;
  current_case public.cases%rowtype;
begin
  select * into link from public.client_links where id = target_link;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(link.case_id);
  if link.revoked_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_revoked');
  end if;
  update public.client_links set revoked_at = now(), revoked_by = auth.uid() where id = link.id;
  perform public.record_case_event(current_case.org_id, current_case.id, 'client_link_revoked', 'person',
    jsonb_build_object('link', link.id));
  return jsonb_build_object('ok', true, 'code', 'revoked');
end;
$$;

revoke all on function public.revoke_client_link(uuid) from public, anon;
grant execute on function public.revoke_client_link(uuid) to authenticated;

/** Adds to a case a file of the firm (one somebody uploaded, or one that came in a conversation). */
create or replace function public.attach_case_document(
  target_case uuid,
  target_file uuid,
  target_kind text,
  target_party uuid default null,
  target_source text default 'firm'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  document uuid;
begin
  if target_kind is null or target_kind not in (
    'identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'power_of_attorney', 'contract',
    'petition', 'other'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind');
  end if;
  if target_source not in ('firm', 'whatsapp') then
    return jsonb_build_object('ok', false, 'code', 'invalid_source');
  end if;
  -- A file somebody uploaded or that came in a conversation: never one the backend made for its own
  -- use (the PDF of a photo, a part cut for a filing package), which is somebody else's to forget.
  if not exists (
    select 1 from public.files f
    where f.id = target_file and f.org_id = current_case.org_id and f.status = 'stored'
      and f.purpose in ('upload', 'whatsapp')
  ) then
    return jsonb_build_object('ok', false, 'code', 'file_not_found');
  end if;
  if exists (select 1 from public.case_documents d where d.file_id = target_file) then
    return jsonb_build_object('ok', false, 'code', 'already_attached');
  end if;
  if target_party is not null and not exists (
    select 1 from public.case_parties cp where cp.id = target_party and cp.case_id = current_case.id
  ) then
    return jsonb_build_object('ok', false, 'code', 'party_not_found');
  end if;

  insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, status)
  values (current_case.org_id, current_case.id, target_party, target_file, target_kind, target_source, 'received')
  returning id into document;

  perform public.record_case_event(current_case.org_id, current_case.id, 'document_added', 'person',
    jsonb_build_object('document', document, 'kind', target_kind, 'source', target_source));
  return jsonb_build_object('ok', true, 'code', 'attached', 'document_id', document);
end;
$$;

revoke all on function public.attach_case_document(uuid, uuid, text, uuid, text) from public, anon;
grant execute on function public.attach_case_document(uuid, uuid, text, uuid, text) to authenticated;

/** A person of the firm accepts a document, or refuses it with a reason the client reads on their link. */
create or replace function public.decide_case_document(target_document uuid, target_decision text, target_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  document public.case_documents%rowtype;
  current_case public.cases%rowtype;
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
begin
  select * into document from public.case_documents where id = target_document;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(document.case_id);
  if target_decision not in ('accepted', 'rejected') then
    return jsonb_build_object('ok', false, 'code', 'invalid_decision');
  end if;
  if document.status = 'uploading' then
    return jsonb_build_object('ok', false, 'code', 'not_uploaded');
  end if;
  if target_decision = 'rejected' and (reason is null or char_length(reason) < 4) then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;

  update public.case_documents set
    status = target_decision,
    rejected_reason = case when target_decision = 'rejected' then left(reason, 500) end,
    decided_by = auth.uid(),
    decided_at = now()
  where id = document.id;

  perform public.record_case_event(current_case.org_id, current_case.id, 'document_' || target_decision, 'person',
    jsonb_build_object('document', document.id, 'kind', document.kind));
  return jsonb_build_object('ok', true, 'code', target_decision);
end;
$$;

revoke all on function public.decide_case_document(uuid, text, text) from public, anon;
grant execute on function public.decide_case_document(uuid, text, text) to authenticated;

-- ---------- The CPF lookup ----------

/**
 * A person of the firm asks for the registry's answer about a client's CPF.
 * The registry answers for a CPF and the birth date that goes with it, never
 * for a minor; the backend makes the lookup. This says whether it may, within
 * the firm's daily ceiling, and hands the pair to the backend that asked
 * under this person's session.
 */
create or replace function public.begin_cpf_check(target_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  person public.people%rowtype;
  ceiling integer := greatest(coalesce((public.cases_setting('cpf_checks_per_day') #>> '{}')::integer, 200), 0);
  used integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into person from public.people where id = target_person;
  if not found or not public.is_org_member(person.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if person.cpf is null then
    return jsonb_build_object('ok', false, 'code', 'cpf_missing');
  end if;
  if person.birth_date is null then
    return jsonb_build_object('ok', false, 'code', 'birth_date_missing');
  end if;
  if person.birth_date > (current_date - interval '18 years')::date then
    return jsonb_build_object('ok', false, 'code', 'minor');
  end if;
  select count(*) into used from public.audit_events a
  where a.org_id = person.org_id and a.action = 'identity.cpf_checked' and a.created_at > now() - interval '24 hours';
  if used >= ceiling then
    return jsonb_build_object('ok', false, 'code', 'daily_limit');
  end if;
  return jsonb_build_object('ok', true, 'org_id', person.org_id, 'person_id', person.id, 'cpf', person.cpf,
                            'birth_date', person.birth_date);
end;
$$;

revoke all on function public.begin_cpf_check(uuid) from public, anon;
grant execute on function public.begin_cpf_check(uuid) to authenticated;

/**
 * What the registry answered (the backend writes it): `found`, `not_found`,
 * `birth_date_mismatch` or `minor`. Kept only if the person still has the
 * CPF and the birth date that were asked. The audit event says what came
 * back and whether the name matches; never the CPF or a name.
 */
create or replace function public.record_cpf_check(
  target_org uuid,
  target_person uuid,
  target_cpf text,
  target_birth_date date,
  target_result text,
  target_name text default null,
  target_situation text default null,
  target_regular boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  person public.people%rowtype;
  found_it boolean := target_result = 'found';
  matches boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_result is null or target_result not in ('found', 'not_found', 'birth_date_mismatch', 'minor') then
    return jsonb_build_object('ok', false, 'code', 'invalid_result');
  end if;
  select * into person from public.people where id = target_person and org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if person.cpf is distinct from target_cpf or person.birth_date is distinct from target_birth_date then
    return jsonb_build_object('ok', false, 'code', 'data_changed');
  end if;
  matches := case when found_it then public.plain_name(target_name) = public.plain_name(person.full_name) end;

  update public.people set
    cpf_registry_result = target_result,
    cpf_checked_at = now(),
    cpf_registry_name = case when found_it then left(btrim(target_name), 200) end,
    cpf_registry_birth_date = case when found_it then target_birth_date end,
    cpf_registry_situation = case when found_it then nullif(left(btrim(coalesce(target_situation, '')), 60), '') end,
    cpf_registry_regular = case when found_it then target_regular end,
    cpf_name_matches = matches
  where id = person.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, null, 'identity.cpf_checked', 'person', person.id::text,
          jsonb_strip_nulls(jsonb_build_object('result', target_result, 'regular', target_regular, 'name_matches', matches)));
  return jsonb_build_object('ok', true, 'code', 'recorded', 'result', target_result, 'name_matches', matches);
end;
$$;

revoke all on function public.record_cpf_check(uuid, uuid, text, date, text, text, text, boolean) from public, anon, authenticated;

-- ---------- What the client does, through their link ----------

/** The link a token opens, whatever its state; null when the token opens nothing. */
create or replace function public.client_link_by_token(target_token text)
returns public.client_links
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  link public.client_links%rowtype;
begin
  if coalesce(target_token, '') = '' or char_length(target_token) > 200 then
    return null;
  end if;
  select * into link from public.client_links
  where token_hash = encode(sha256(convert_to(target_token, 'UTF8')), 'hex');
  if not found then
    return null;
  end if;
  return link;
end;
$$;

revoke all on function public.client_link_by_token(text) from public, anon, authenticated;

/** The link a client is writing through: open, and its case still taking what the client sends. */
create or replace function public.client_link_for_writer(target_token text)
returns public.client_links
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now()
     or not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id) then
    raise exception 'link_not_open' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.cases c
    where c.id = link.case_id and c.status in ('intake', 'documents', 'signature')
  ) then
    raise exception 'case_not_editable' using errcode = 'P0002';
  end if;
  return link;
end;
$$;

revoke all on function public.client_link_for_writer(text) from public, anon, authenticated;

/** The guardian party the link's person takes in the case, created when they had none. */
create or replace function public.client_link_guardian_party(link public.client_links)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  party uuid;
begin
  select cp.id into party from public.case_parties cp
  where cp.case_id = link.case_id and cp.person_id = link.person_id and cp.role = 'guardian';
  if party is null then
    insert into public.case_parties (org_id, case_id, person_id, role)
    values (link.org_id, link.case_id, link.person_id, 'guardian')
    returning id into party;
  end if;
  return party;
end;
$$;

revoke all on function public.client_link_guardian_party(public.client_links) from public, anon, authenticated;

/** The people a link may write about: its own person, and the minors whose guardian that person is in the case. */
create or replace function public.client_link_people(link public.client_links)
returns table (person_id uuid, party_id uuid, role text, guardian_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select cp.person_id, cp.id, cp.role, cp.guardian_id
  from public.case_parties cp
  where cp.case_id = link.case_id
    and (
      cp.person_id = link.person_id
      or cp.guardian_id in (
        select g.id from public.case_parties g
        where g.case_id = link.case_id and g.person_id = link.person_id and g.role = 'guardian'
      )
    );
$$;

revoke all on function public.client_link_people(public.client_links) from public, anon, authenticated;

/**
 * What a client sees on their link: the firm, the case, their own data and
 * the data of the minors they answer for, the legs of the trip, the files
 * they sent and what the firm said of each, and what is still missing. Only
 * the firm's name when the link ended. Records that it was opened.
 */
create or replace function public.client_link_open(target_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  current_case public.cases%rowtype;
  firm text;
  person_json jsonb;
  dependents jsonb;
  segments jsonb;
  documents jsonb;
  parties jsonb;
  state text;
begin
  if link.id is null then
    return jsonb_build_object('found', false);
  end if;
  select o.name into firm from public.organizations o where o.id = link.org_id;
  state := case
    when link.revoked_at is not null then 'revoked'
    when link.expires_at <= now() then 'expired'
    when not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id)
      then 'revoked'
    else 'open'
  end;
  if state <> 'open' then
    return jsonb_build_object('found', true, 'status', state, 'firm', firm);
  end if;

  select * into current_case from public.cases where id = link.case_id;
  -- A visit: the page reads the link again after each thing the client saves,
  -- so openings within half an hour of the last are the same visit.
  update public.client_links
  set opened_count = opened_count + case
        when last_opened_at is null or last_opened_at < now() - interval '30 minutes' then 1 else 0 end,
      last_opened_at = now()
  where id = link.id;

  -- One entry per person. A person who is both a claimant and a guardian (a
  -- parent who flew with a child) is named by the claimant party: their own
  -- documents are theirs as a claimant.
  select jsonb_agg(jsonb_build_object(
    'person_id', p.id, 'party_id', roles.party_id, 'party_ids', roles.party_ids, 'roles', roles.names,
    'is_holder', p.id = link.person_id,
    'full_name', p.full_name, 'cpf', p.cpf, 'birth_date', p.birth_date, 'nationality', p.nationality,
    'marital_status', p.marital_status, 'profession', p.profession, 'email', p.email, 'phone', p.phone,
    'postal_code', p.postal_code, 'street', p.street, 'address_number', p.address_number,
    'complement', p.complement, 'district', p.district, 'city', p.city, 'uf', p.uf
  ) order by (p.id = link.person_id) desc, p.full_name)
  into parties
  from (
    select lp.person_id,
           (array_agg(lp.party_id order by (lp.role = 'claimant') desc))[1] as party_id,
           to_jsonb(array_agg(lp.party_id order by (lp.role = 'claimant') desc, lp.party_id)) as party_ids,
           to_jsonb(array_agg(lp.role order by lp.role)) as names
    from public.client_link_people(link) lp
    group by lp.person_id
  ) as roles
  join public.people p on p.id = roles.person_id;

  select jsonb_agg(jsonb_build_object(
    'id', s.id, 'position', s.position, 'flight_number', s.flight_number,
    'origin_iata', s.origin_iata, 'destination_iata', s.destination_iata,
    'scheduled_departure_local', s.scheduled_departure_local, 'scheduled_arrival_local', s.scheduled_arrival_local,
    'actual_departure_local', s.actual_departure_local, 'actual_arrival_local', s.actual_arrival_local,
    'booking_reference', s.booking_reference, 'affected', s.affected, 'source', s.source
  ) order by s.position)
  into segments
  from public.flight_segments s where s.case_id = link.case_id;

  select jsonb_agg(jsonb_build_object(
    'id', d.id, 'kind', d.kind, 'party_id', d.party_id, 'status', d.status,
    'rejected_reason', d.rejected_reason, 'name', f.name, 'created_at', d.created_at
  ) order by d.created_at)
  into documents
  from public.case_documents d
  join public.files f on f.id = d.file_id
  where d.case_id = link.case_id and d.status <> 'uploading'
    -- What a client sends, never the firm's own papers.
    and d.kind in ('identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'other')
    -- Of the people this link answers for; of the whole case, the trip's papers
    -- (the same trip for everybody in it) and what this link itself sent.
    and (
      d.party_id in (select lp.party_id from public.client_link_people(link) lp)
      or (d.party_id is null and (d.kind in ('ticket', 'boarding_pass') or d.link_id = link.id))
    );

  return jsonb_build_object(
    'found', true,
    'status', 'open',
    'firm', firm,
    'link', jsonb_build_object('person_id', link.person_id, 'expires_at', link.expires_at, 'finished_at', link.finished_at,
      'uploads_left', greatest(coalesce((public.cases_setting('client_link_uploads') #>> '{}')::integer, 60) - link.upload_count, 0)),
    'case', jsonb_build_object(
      'seq', current_case.seq, 'incident', current_case.incident, 'flight_date', current_case.flight_date,
      'airline', (select jsonb_build_object('iata', a.iata, 'name', a.name) from public.airlines a where a.iata = current_case.airline_iata),
      'editable', current_case.status in ('intake', 'documents', 'signature')
    ),
    'people', coalesce(parties, '[]'::jsonb),
    'segments', coalesce(segments, '[]'::jsonb),
    'documents', coalesce(documents, '[]'::jsonb),
    'required_documents', coalesce(public.cases_setting('required_documents'), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.client_link_open(text) from public;
grant execute on function public.client_link_open(text) to anon, authenticated;

/**
 * The CPF a link is about to write for a person, when it is a new one (none
 * yet, or a different one); null otherwise. Only a new CPF counts against the
 * link's ceiling.
 */
create or replace function public.client_link_new_cpf(target_person uuid, target_fields jsonb)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  value text;
begin
  if jsonb_typeof(target_fields) <> 'object' or not target_fields ? 'cpf' then
    return null;
  end if;
  value := nullif(regexp_replace(coalesce(target_fields ->> 'cpf', ''), '\D', '', 'g'), '');
  if value is null then
    return null;
  end if;
  if target_person is not null and exists (select 1 from public.people p where p.id = target_person and p.cpf = value) then
    return null;
  end if;
  return value;
end;
$$;

revoke all on function public.client_link_new_cpf(uuid, jsonb) from public, anon, authenticated;

/** True when a link already wrote (or had refused as another client's) as many CPFs as the setting allows. */
create or replace function public.client_link_cpf_spent(link public.client_links)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select link.cpf_attempts >= coalesce((public.cases_setting('client_link_cpf_attempts') #>> '{}')::integer, 12);
$$;

revoke all on function public.client_link_cpf_spent(public.client_links) from public, anon, authenticated;

/** The client writes their own data, or the data of a minor they answer for. */
create or replace function public.client_link_save_person(target_token text, target_person uuid, target_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype;
  applied jsonb;
  new_cpf text;
begin
  begin
    link := public.client_link_for_writer(target_token);
  exception when sqlstate 'P0002' then
    return jsonb_build_object('ok', false, 'code', sqlerrm);
  end;
  if not exists (select 1 from public.client_link_people(link) lp where lp.person_id = target_person) then
    return jsonb_build_object('ok', false, 'code', 'person_not_found');
  end if;
  new_cpf := public.client_link_new_cpf(target_person, coalesce(target_fields, '{}'::jsonb));
  if new_cpf is not null and public.client_link_cpf_spent(link) then
    return jsonb_build_object('ok', false, 'code', 'too_many_attempts', 'field', 'cpf');
  end if;
  applied := public.apply_person_fields(target_person, target_fields, 'client');
  if new_cpf is not null and ((applied ->> 'ok')::boolean or applied ->> 'code' = 'cpf_in_use') then
    update public.client_links set cpf_attempts = cpf_attempts + 1 where id = link.id;
  end if;
  if not (applied ->> 'ok')::boolean then
    return applied;
  end if;
  if jsonb_array_length(applied -> 'changed') > 0 then
    perform public.record_case_event(link.org_id, link.case_id, 'client_person_saved', 'client',
      jsonb_build_object('person', target_person, 'fields', applied -> 'changed'));
  end if;
  return jsonb_build_object('ok', true, 'code', 'saved', 'changed', applied -> 'changed');
end;
$$;

revoke all on function public.client_link_save_person(text, uuid, jsonb) from public;
grant execute on function public.client_link_save_person(text, uuid, jsonb) to anon, authenticated;

/** The client adds a minor who flew with them: a claimant of the case, with the client as the guardian. */
create or replace function public.client_link_add_dependent(target_token text, target_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype;
  guardian uuid;
  person uuid;
  party uuid;
  applied jsonb;
  failed_field text;
  new_cpf text;
  fields jsonb := coalesce(target_fields, '{}'::jsonb);
  ceiling integer := coalesce((public.cases_setting('client_link_dependents') #>> '{}')::integer, 8);
begin
  begin
    link := public.client_link_for_writer(target_token);
  exception when sqlstate 'P0002' then
    return jsonb_build_object('ok', false, 'code', sqlerrm);
  end;
  if jsonb_typeof(fields) <> 'object' or char_length(btrim(coalesce(fields ->> 'full_name', ''))) < 3 then
    return jsonb_build_object('ok', false, 'code', 'invalid_name', 'field', 'full_name');
  end if;
  if (select count(*) from public.client_link_people(link) lp where lp.person_id <> link.person_id) >= ceiling then
    return jsonb_build_object('ok', false, 'code', 'too_many_people');
  end if;
  new_cpf := public.client_link_new_cpf(null, fields);
  if new_cpf is not null and public.client_link_cpf_spent(link) then
    return jsonb_build_object('ok', false, 'code', 'too_many_attempts', 'field', 'cpf');
  end if;

  begin
    guardian := public.client_link_guardian_party(link);
    insert into public.people (org_id, full_name, updated_via)
    values (link.org_id, left(regexp_replace(btrim(fields ->> 'full_name'), '\s+', ' ', 'g'), 200), 'client')
    returning id into person;
    applied := public.apply_person_fields(person, fields, 'client');
    if not (applied ->> 'ok')::boolean then
      raise exception using errcode = 'P0001', message = applied ->> 'code', detail = coalesce(applied ->> 'field', '');
    end if;
    insert into public.case_parties (org_id, case_id, person_id, role, guardian_id)
    values (link.org_id, link.case_id, person, 'claimant', guardian)
    returning id into party;
    perform public.record_case_event(link.org_id, link.case_id, 'client_dependent_added', 'client',
      jsonb_build_object('person', person));
  exception when sqlstate 'P0001' then
    get stacked diagnostics failed_field = pg_exception_detail;
    if new_cpf is not null and sqlerrm = 'cpf_in_use' then
      update public.client_links set cpf_attempts = cpf_attempts + 1 where id = link.id;
    end if;
    return jsonb_build_object('ok', false, 'code', sqlerrm, 'field', nullif(failed_field, ''));
  end;
  if new_cpf is not null then
    update public.client_links set cpf_attempts = cpf_attempts + 1 where id = link.id;
  end if;
  return jsonb_build_object('ok', true, 'code', 'added', 'person_id', person, 'party_id', party);
end;
$$;

revoke all on function public.client_link_add_dependent(text, jsonb) from public;
grant execute on function public.client_link_add_dependent(text, jsonb) to anon, authenticated;

/** The client adds a leg of the trip, or corrects one. */
create or replace function public.client_link_save_segment(target_token text, target_segment uuid, target_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype;
  segment uuid := target_segment;
  applied jsonb;
  failed_field text;
begin
  begin
    link := public.client_link_for_writer(target_token);
  exception when sqlstate 'P0002' then
    return jsonb_build_object('ok', false, 'code', sqlerrm);
  end;
  if segment is not null and not exists (
    select 1 from public.flight_segments s where s.id = segment and s.case_id = link.case_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'segment_not_found');
  end if;
  if segment is null and (select count(*) from public.flight_segments s where s.case_id = link.case_id) >= 8 then
    return jsonb_build_object('ok', false, 'code', 'too_many_segments');
  end if;

  begin
    if segment is null then
      insert into public.flight_segments (org_id, case_id, position, source)
      values (link.org_id, link.case_id,
              coalesce((select max(s.position) + 1 from public.flight_segments s where s.case_id = link.case_id), 1),
              'client')
      returning id into segment;
    end if;
    applied := public.apply_segment_fields(segment, target_fields, 'client');
    if not (applied ->> 'ok')::boolean then
      raise exception using errcode = 'P0001', message = applied ->> 'code', detail = coalesce(applied ->> 'field', '');
    end if;
    perform public.record_case_event(link.org_id, link.case_id, 'client_segment_saved', 'client',
      jsonb_build_object('segment', segment, 'fields', coalesce(applied -> 'changed', '[]'::jsonb)));
  exception when sqlstate 'P0001' then
    get stacked diagnostics failed_field = pg_exception_detail;
    return jsonb_build_object('ok', false, 'code', sqlerrm, 'field', nullif(failed_field, ''));
  end;
  return jsonb_build_object('ok', true, 'code', 'saved', 'segment_id', segment);
end;
$$;

revoke all on function public.client_link_save_segment(text, uuid, jsonb) from public;
grant execute on function public.client_link_save_segment(text, uuid, jsonb) to anon, authenticated;

/** The client removes a leg they added. One the firm wrote is the firm's to change. */
create or replace function public.client_link_remove_segment(target_token text, target_segment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype;
begin
  begin
    link := public.client_link_for_writer(target_token);
  exception when sqlstate 'P0002' then
    return jsonb_build_object('ok', false, 'code', sqlerrm);
  end;
  delete from public.flight_segments where id = target_segment and case_id = link.case_id and source = 'client';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'segment_not_found');
  end if;
  perform public.record_case_event(link.org_id, link.case_id, 'client_segment_removed', 'client',
    jsonb_build_object('segment', target_segment));
  return jsonb_build_object('ok', true, 'code', 'removed');
end;
$$;

revoke all on function public.client_link_remove_segment(text, uuid) from public;
grant execute on function public.client_link_remove_segment(text, uuid) to anon, authenticated;

/**
 * The client asks to send a file: the reservation is made in the firm's files
 * under the `client` purpose (the same checks of type and size as any other
 * file), with a document of the case waiting for it. A link sends at most the
 * configured number of files, every attempt counted.
 */
create or replace function public.client_link_reserve_upload(
  target_token text,
  target_kind text,
  target_party uuid,
  target_name text,
  target_mime text,
  target_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype;
  rule jsonb := public.file_purpose_rule('client');
  problem text;
  reserved jsonb;
  document uuid;
  ceiling integer := coalesce((public.cases_setting('client_link_uploads') #>> '{}')::integer, 60);
begin
  begin
    link := public.client_link_for_writer(target_token);
  exception when sqlstate 'P0002' then
    return jsonb_build_object('ok', false, 'code', sqlerrm);
  end;
  if target_kind is null or target_kind not in ('identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'other') then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind');
  end if;
  if target_party is not null and not exists (
    select 1 from public.client_link_people(link) lp where lp.party_id = target_party
  ) then
    return jsonb_build_object('ok', false, 'code', 'party_not_found');
  end if;
  if link.upload_count >= ceiling then
    return jsonb_build_object('ok', false, 'code', 'upload_limit');
  end if;
  problem := public.file_reservation_problem(rule, target_name, target_mime, target_bytes);
  if problem is not null then
    return jsonb_build_object('ok', false, 'code', problem);
  end if;

  reserved := public.insert_file_reservation(link.org_id, 'client', target_name, target_mime, target_bytes, null);
  if not coalesce((reserved ->> 'ok')::boolean, false) then
    return reserved;
  end if;

  insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, link_id, status)
  values (link.org_id, link.case_id, target_party, (reserved ->> 'file_id')::uuid, target_kind, 'client', link.id, 'uploading')
  returning id into document;

  update public.client_links set upload_count = upload_count + 1 where id = link.id;

  return jsonb_build_object(
    'ok', true, 'code', 'reserved', 'document_id', document,
    'file_id', reserved ->> 'file_id', 'storage_path', reserved ->> 'storage_path', 'org_id', link.org_id
  );
end;
$$;

revoke all on function public.client_link_reserve_upload(text, text, uuid, text, text, bigint) from public;
grant execute on function public.client_link_reserve_upload(text, text, uuid, text, text, bigint) to anon, authenticated;

/**
 * After the backend measured what arrived: a file it kept becomes a document
 * the firm receives; one it refused tells the client why. A file reserved
 * while the link was open is finished even if the link ended or the case
 * moved on meanwhile: the firm sees it, instead of a stored file nobody sees.
 */
create or replace function public.client_link_finish_upload(target_token text, target_document uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  document public.case_documents%rowtype;
  file public.files%rowtype;
begin
  if link.id is null then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  select * into document from public.case_documents
  where id = target_document and link_id = link.id and case_id = link.case_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if document.status <> 'uploading' then
    return jsonb_build_object('ok', document.status <> 'rejected', 'code', document.status);
  end if;
  select * into file from public.files where id = document.file_id;
  if file.status = 'reserved' then
    return jsonb_build_object('ok', false, 'code', 'not_uploaded');
  end if;
  if file.status = 'rejected' then
    update public.case_documents set status = 'rejected', rejected_reason = coalesce(file.rejected_reason, 'rejected')
    where id = document.id;
    return jsonb_build_object('ok', false, 'code', coalesce(file.rejected_reason, 'rejected'));
  end if;

  update public.case_documents set status = 'received' where id = document.id;
  perform public.record_case_event(link.org_id, link.case_id, 'client_document_sent', 'client',
    jsonb_build_object('document', document.id, 'kind', document.kind));
  return jsonb_build_object('ok', true, 'code', 'received');
end;
$$;

revoke all on function public.client_link_finish_upload(text, uuid) from public;
grant execute on function public.client_link_finish_upload(text, uuid) to anon, authenticated;

/** The client says they sent everything they had. */
create or replace function public.client_link_finish(target_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype;
begin
  begin
    link := public.client_link_for_writer(target_token);
  exception when sqlstate 'P0002' then
    return jsonb_build_object('ok', false, 'code', sqlerrm);
  end;
  update public.client_links set finished_at = now() where id = link.id;
  perform public.record_case_event(link.org_id, link.case_id, 'client_finished', 'client', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'code', 'finished');
end;
$$;

revoke all on function public.client_link_finish(text) from public;
grant execute on function public.client_link_finish(text) to anon, authenticated;

-- ---------- What needs somebody today, with the cases ----------

-- `firm_today` (0020) also counts what the cases wait for.
/**
 * What needs somebody of the firm today, counted for the person who asks:
 *
 *   approvals_mine         answers of the AI waiting for a decision that this
 *                          person's function may make;
 *   approvals_waiting      every answer waiting in the firm's queue;
 *   conversations_waiting  conversations where the person wrote last, through
 *                          the platform, and nobody of the firm answered, on a
 *                          connected number. What came with the history of a
 *                          number, from before it was connected, waits for
 *                          nobody: it never opened a window to answer in;
 *   conversations_closing  of those, the ones whose 24-hour window is open
 *                          and ends within the configured hours;
 *   sends_failed           messages of the last day that did not go out;
 *   whatsapp               `active`, `disconnected` (the firm had a number and
 *                          has none connected now) or `none`;
 *   documents_to_review    files a client or a colleague added to a case that
 *                          nobody of the firm accepted or refused yet;
 *   clients_finished       cases still waiting for the client whose client
 *                          said, on their link, that they sent everything.
 */
create or replace function public.firm_today(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  my_function public.firm_function;
  closing_hours integer := greatest(coalesce((public.wa_setting('closing_soon_hours') #>> '{}')::integer, 4), 1);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select m.firm_function into my_function
  from public.memberships m where m.org_id = target_org and m.user_id = auth.uid();
  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'approvals_mine', (
      select count(*) from public.approvals a
      where a.org_id = target_org and a.status = 'pending' and my_function = any (a.approver_functions)
    ),
    'approvals_waiting', (
      select count(*) from public.approvals a where a.org_id = target_org and a.status = 'pending'
    ),
    'conversations_waiting', (
      select count(*) from public.wa_conversations c
      join public.wa_numbers n on n.id = c.number_id
      where c.org_id = target_org and c.status = 'open' and c.last_message_direction = 'in' and n.status = 'active'
        and c.last_inbound_at is not null and c.last_inbound_at >= c.last_message_at
    ),
    'conversations_closing', (
      select count(*) from public.wa_conversations c
      join public.wa_numbers n on n.id = c.number_id
      where c.org_id = target_org and c.status = 'open' and c.last_message_direction = 'in' and n.status = 'active'
        and c.last_inbound_at is not null and c.last_inbound_at >= c.last_message_at
        and public.wa_window_open(c.last_inbound_at)
        and public.wa_window_closes_at(c.last_inbound_at) < now() + make_interval(hours => closing_hours)
    ),
    'sends_failed', (
      select count(*) from public.wa_messages m
      where m.org_id = target_org and m.direction = 'out' and m.status = 'failed'
        and m.created_at > now() - interval '24 hours'
    ),
    'documents_to_review', (
      select count(*) from public.case_documents d where d.org_id = target_org and d.status = 'received'
    ),
    'clients_finished', (
      select count(distinct l.case_id) from public.client_links l
      join public.cases c on c.id = l.case_id
      where l.org_id = target_org and l.finished_at is not null and l.revoked_at is null
        and c.status in ('intake', 'documents', 'signature')
    ),
    'whatsapp', case
      when exists (select 1 from public.wa_numbers n where n.org_id = target_org and n.status = 'active') then 'active'
      when exists (select 1 from public.wa_numbers n where n.org_id = target_org) then 'disconnected'
      else 'none'
    end
  );
end;
$$;

revoke all on function public.firm_today(uuid) from public, anon;
grant execute on function public.firm_today(uuid) to authenticated;
