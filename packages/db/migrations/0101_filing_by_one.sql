-- ============================================================
-- 0101_filing_by_one: ONE files the lawsuit itself, through the court's own
-- machine channel (the owner's decision of 2026-11-05).
--
-- The filing was the lawyer's: with the package built and signed by ONE,
-- they still logged in to the court's system, filled the lawsuit's data,
-- attached each file, sent it and brought the receipt back, which the owner
-- named one of the crucial steps to automate (forgetting, delays, a court
-- out of the air, a person's difficulty). A robot on the court's screen is
-- not built: the TJGO writes that a lawyer's password and key are "de uso
-- pessoal e intransferível" (Resolução TJGO 59/2016, art. 11), and by the
-- owner's decision of 2026-10-15 nothing is automated over such a rule. The
-- court's own machine channel is the CNJ's MNI (`entregarManifestacaoProcessual`),
-- which the Projudi of TJGO exposes, authenticated by the court's grant and
-- never by a lawyer's login; until a court grants it, a test case is filed
-- in the test court of 0061, which stands where the court stands.
--
--   - `court_filing_channels`: each court's channel as data (the operator's):
--     its address, whether it was confirmed in the court's homologation,
--     whether ONE files through it, and the court's codes (the class of each
--     kind of lawsuit, the type of each document, the subject of each
--     problem, and the codes of each comarca: locality, competence, judging
--     body). Seeded with the TJGO's Projudi, off and unconfirmed, with the
--     national codes and no comarca's (`packages/courts/README.md` says what
--     to obtain).
--   - `file_lawsuit`, a decision of the catalog: ONE files alone (the
--     default), or a lawyer of the lawsuit asks for each filing.
--   - `filing_submissions`: one per package ONE files, reserved, claimed and
--     then sent (`claimed`, `sending`), so a lawsuit is never filed twice:
--     one sent whose answer nobody could read is `unknown` and is sent again
--     only once a lawyer says the court's system does not have it. A court
--     that could not be reached is tried again after a growing wait; one
--     that refused says why. A lawsuit filed comes back with its number and
--     receipt, and is marked filed as a receipt a lawyer attached marks it.
-- ============================================================

-- ---------- The settings ----------

insert into public.platform_settings (key, value, is_public) values
  ('filing_submit', jsonb_build_object(
    -- A claim not sent after these minutes is claimed again (nothing was sent); one sending this long is unknown.
    'stale_minutes', 10,
    -- How many times a court that could not be reached is tried, and the waits between (minutes).
    'max_attempts', 6,
    'retry_minutes', jsonb_build_array(5, 15, 60, 180, 360)
  ), false)
on conflict (key) do nothing;

/** An integer of the `filing_submit` setting, or the fallback. Internal. */
create or replace function public.filing_submit_setting(setting text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when jsonb_typeof(s.value -> setting) = 'number' then (s.value ->> setting)::integer end
    from public.platform_settings s where s.key = 'filing_submit'
  ), fallback);
$$;

revoke all on function public.filing_submit_setting(text, integer) from public, anon, authenticated;

-- The receipt a court's channel gives back is kept under its own purpose, written by the backend only.
update public.platform_settings
set value = jsonb_set(value, '{purposes,filing_receipt}', jsonb_build_object(
  'people', false,
  'max_bytes', 31457280,
  'mimes', jsonb_build_array('application/pdf')
))
where key = 'files' and not (value -> 'purposes') ? 'filing_receipt';

-- ---------- Each court's channel, as data ----------

create table public.court_filing_channels (
  court text not null references public.courts (acronym) on delete cascade,
  system text not null,
  channel text not null default 'mni',
  version text not null default '2.2.2',
  endpoint text not null,
  homologation_endpoint text,
  -- Tried in the court's homologation, with what it takes (the signature form, the codes, the answer).
  confirmed boolean not null default false,
  -- ONE files through it: the court granted the platform its credential, and the codes are there.
  enabled boolean not null default false,
  -- The court's codes: `classes` by kind of lawsuit, `document_types` by kind of document, `subjects` by kind of
  -- problem (and `moral`, added to every lawsuit), and by comarca `localities`, `competences` ("comarca|kind")
  -- and `judging_bodies` ("comarca|kind": code, name, ibge).
  codes jsonb not null default '{}'::jsonb,
  note text,
  checked_on date,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (court, system),
  constraint court_filing_channels_channel_check check (channel in ('mni')),
  constraint court_filing_channels_system_check check (system in ('projudi', 'eproc', 'pje', 'esaj')),
  constraint court_filing_channels_endpoint_check check (endpoint ~ '^https://\S+$' and char_length(endpoint) <= 300),
  constraint court_filing_channels_codes_check check (jsonb_typeof(codes) = 'object' and octet_length(codes::text) <= 200000),
  constraint court_filing_channels_note_check check (note is null or char_length(note) <= 2000)
);

alter table public.court_filing_channels enable row level security;
revoke all on table public.court_filing_channels from public, anon, authenticated;

insert into public.court_filing_channels (court, system, endpoint, codes, note) values
  ('TJGO', 'projudi', 'https://projudi.tjgo.jus.br/IntercomunicacaoService',
   jsonb_build_object(
     'classes', jsonb_build_object('juizado', 436, 'comum', 7),
     'document_types', jsonb_build_object('petition', '202', 'power_of_attorney', '99', 'identity', '65',
                                           'address_proof', '277'),
     'subjects', jsonb_build_object('delay', jsonb_build_array(4829), 'cancellation', jsonb_build_array(4830),
                                    'overbooking', jsonb_build_array(4831), 'baggage_lost', jsonb_build_array(4832),
                                    'moral', jsonb_build_array(7779)),
     'localities', '{}'::jsonb,
     'competences', '{}'::jsonb,
     'judging_bodies', '{}'::jsonb),
   'MNI 2.2.2 do Projudi do TJGO (o WSDL respondeu em 2026-10-14). Códigos nacionais das TPU lidos no SGT do CNJ em 2026-10-14; os códigos de cada comarca e a liberação do canal esperam o tribunal.')
on conflict (court, system) do nothing;

-- ---------- The decision ----------

insert into public.autonomy_decisions (key, position, modes) values
  ('file_lawsuit', 87, array['auto', 'approval'])
on conflict (key) do nothing;

-- ---------- What ONE files ----------

create table public.filing_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  proceeding_id uuid not null,
  package_id uuid not null unique,
  -- `mni`, the court's channel; `test_court`, the test court that stands where a court stands (0061).
  channel text not null,
  -- owed     waits to be sent (again, after `retry_after`);
  -- claimed  a worker holds it and sends nothing yet;
  -- sending  it went, or may have gone, to the court;
  -- filed    the court received it;
  -- refused  the court answered it does not take it, and why;
  -- unknown  it went and no answer could be read: a lawyer looks in the court's system before it goes again;
  -- failed   the court could not be reached for the setting's tries.
  status text not null default 'owed',
  claims integer not null default 0,
  claimed_at timestamptz,
  attempts integer not null default 0,
  retry_after timestamptz,
  sent_at timestamptz,
  protocol text,
  case_number text,
  message text,
  error text,
  receipt_file_id uuid,
  filed_at timestamptz,
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (proceeding_id, org_id) references public.proceedings (id, org_id) on delete cascade,
  foreign key (package_id, org_id) references public.filing_packages (id, org_id) on delete cascade,
  foreign key (receipt_file_id, org_id) references public.files (id, org_id),
  constraint filing_submissions_channel_check check (channel in ('mni', 'test_court')),
  constraint filing_submissions_status_check check (
    status in ('owed', 'claimed', 'sending', 'filed', 'refused', 'unknown', 'failed')),
  constraint filing_submissions_text_check check (
    (protocol is null or char_length(protocol) <= 120) and (message is null or char_length(message) <= 1000)
    and (error is null or error ~ '^[a-z][a-z0-9_]{1,59}$')
    and (case_number is null or case_number ~ '^\d{20}$')),
  constraint filing_submissions_counts_check check (claims >= 0 and attempts >= 0)
);

create index filing_submissions_due_idx on public.filing_submissions (retry_after) where status in ('owed', 'claimed', 'sending');

alter table public.filing_submissions enable row level security;
create policy "filing_submissions_select_member" on public.filing_submissions
  for select to authenticated using (public.is_org_member(org_id));
revoke all on table public.filing_submissions from public, anon, authenticated;
grant select on table public.filing_submissions to authenticated;
create trigger guard_impersonation_filing_submissions after insert or update or delete on public.filing_submissions
  for each statement execute function public.guard_impersonation_readonly();

/** The channel ONE files a package through: the test court for a test case, else the court's channel ONE files through. Internal. */
create or replace function public.filing_channel_of(target_package public.filing_packages)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.cases k where k.id = target_package.case_id and k.is_test) then 'test_court'
    when exists (
      select 1 from public.court_filing_channels c
      where c.court = target_package.court and c.system = target_package.system and c.enabled
    ) then 'mni'
  end;
$$;

revoke all on function public.filing_channel_of(public.filing_packages) from public, anon, authenticated;

/**
 * Why ONE cannot file a package now, or null when it can: the package not
 * ready or outdated, the lawsuit filed or blocked (0025), no channel, the
 * court's codes of its comarca missing, the files not signed where the
 * court takes them signed, or the firm keeping the filing to a lawyer who
 * has not asked. Internal.
 */
create or replace function public.filing_submission_blocker(target_package public.filing_packages)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  channel text := public.filing_channel_of(target_package);
  codes jsonb;
  comarca text;
begin
  if target_package.status <> 'ready' then
    return 'package_not_ready';
  end if;
  select * into lawsuit from public.proceedings where id = target_package.proceeding_id;
  if not found or lawsuit.status <> 'planned' then
    return 'already_filed';
  end if;
  if public.filing_package_outdated(target_package) then
    return 'package_outdated';
  end if;
  if public.filing_blocker(lawsuit.id) is not null then
    return public.filing_blocker(lawsuit.id);
  end if;
  if channel is null then
    return 'no_channel';
  end if;
  -- A lawsuit goes signed by a lawyer of it with a registration at the bar, against the company of the case.
  if not exists (
    select 1 from public.proceeding_lawyers pl join public.oab_registrations r on r.user_id = pl.user_id
    where pl.proceeding_id = lawsuit.id
  ) then
    return 'no_signer';
  end if;
  if not exists (
    select 1 from public.cases k join public.airlines a on a.iata = k.airline_iata where k.id = target_package.case_id
  ) then
    return 'no_airline';
  end if;
  if channel = 'mni' then
    select c.codes into codes from public.court_filing_channels c
    where c.court = target_package.court and c.system = target_package.system;
    comarca := coalesce(lawsuit.comarca, '');
    if not ((codes -> 'classes') ? target_package.kind)
       or not ((codes -> 'localities') ? comarca)
       or not ((codes -> 'judging_bodies') ? (comarca || '|' || target_package.kind)) then
      return 'court_codes_missing';
    end if;
    -- Every file goes under the court's code of its kind of document.
    if exists (
      select 1 from public.filing_package_items i
      left join public.case_documents d on d.id = i.document_id
      where i.package_id = target_package.id
        and not ((codes -> 'document_types') ? (
          case when i.document_id = target_package.petition_document_id then 'petition' else coalesce(d.kind, 'other') end))
    ) then
      return 'court_codes_missing';
    end if;
    if public.package_takes_signed_files(target_package) and target_package.signature_status is distinct from 'signed' then
      return 'not_signed';
    end if;
  end if;
  if public.firm_autonomy_mode(target_package.org_id, 'file_lawsuit') <> 'auto'
     and not exists (
       select 1 from public.filing_submissions s where s.package_id = target_package.id and s.requested_by is not null
     ) then
    return 'awaits_lawyer';
  end if;
  return null;
end;
$$;

revoke all on function public.filing_submission_blocker(public.filing_packages) from public, anon, authenticated;

/**
 * Claims what ONE files now, under a number each: the packages ready that
 * nothing keeps from being filed (a submission is made for each the first
 * time), the ones owed again once their wait is over, and claims nobody sent
 * that are older than the setting's minutes. A submission sending longer
 * than that is unknown: it may have reached the court, and is never sent
 * again by itself. Service role.
 */
create or replace function public.claim_filing_submissions(target_limit integer default 3, target_package uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stale integer := greatest(public.filing_submit_setting('stale_minutes', 10), 1);
  wanted integer := greatest(least(coalesce(target_limit, 3), 20), 1);
  claimed jsonb := '[]'::jsonb;
  lost record;
  candidate record;
  package public.filing_packages%rowtype;
  submission public.filing_submissions%rowtype;
  route text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- What went and never came back is not sent again by itself.
  for lost in
    select s.id, s.org_id, s.case_id, s.package_id from public.filing_submissions s
    where s.status = 'sending' and s.sent_at < now() - make_interval(mins => stale)
    for update skip locked
  loop
    update public.filing_submissions
    set status = 'unknown', error = 'no_answer', claimed_at = null, updated_at = now()
    where id = lost.id;
    perform public.record_case_event(lost.org_id, lost.case_id, 'filing_unknown', 'system',
      jsonb_build_object('package', lost.package_id, 'submission', lost.id));
  end loop;

  for candidate in
    select p.id from public.filing_packages p
    left join public.filing_submissions s on s.package_id = p.id
    where p.status = 'ready'
      and (target_package is null or p.id = target_package)
      and (
        s.id is null
        or (s.status = 'owed' and (s.retry_after is null or s.retry_after <= now()))
        or (s.status = 'claimed' and s.claimed_at < now() - make_interval(mins => stale))
      )
    order by coalesce(s.retry_after, p.built_at, p.requested_at), p.id
    limit 50
  loop
    select * into package from public.filing_packages where id = candidate.id for update skip locked;
    continue when not found;
    continue when public.filing_submission_blocker(package) is not null;
    route := public.filing_channel_of(package);
    select * into submission from public.filing_submissions where package_id = package.id for update skip locked;
    if submission.id is null then
      if exists (select 1 from public.filing_submissions where package_id = package.id) then
        continue;
      end if;
      insert into public.filing_submissions (org_id, case_id, proceeding_id, package_id, channel)
      values (package.org_id, package.case_id, package.proceeding_id, package.id, route)
      returning * into submission;
    end if;
    continue when submission.status not in ('owed', 'claimed');
    update public.filing_submissions
    set status = 'claimed', claims = claims + 1, claimed_at = now(), channel = route,
        updated_at = now()
    where id = submission.id
    returning * into submission;
    claimed := claimed || jsonb_build_array(jsonb_build_object(
      'submission_id', submission.id, 'claim', submission.claims, 'channel', submission.channel,
      'package_id', package.id, 'case_id', package.case_id));
    exit when jsonb_array_length(claimed) >= wanted;
  end loop;
  return jsonb_build_object('claimed', claimed);
end;
$$;

revoke all on function public.claim_filing_submissions(integer, uuid) from public, anon, authenticated;

/**
 * What a worker holding a submission sends: the lawsuit, its claimants and
 * who answers for a minor (the names, the CPF and the address on record),
 * the company it is against, the lawyers who sign it (the registration in
 * the court's state, and the CPF a lawyer proved), the files of the package
 * in order (each with its kind of document and its signed copy), the
 * value of the cause, the court's codes, and, for the test court, the
 * number it gives. Null when the claim is not held. Service role.
 */
create or replace function public.filing_submission_to_send(target_submission uuid, target_claim integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  submission public.filing_submissions%rowtype;
  package public.filing_packages%rowtype;
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  court_row public.courts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into submission from public.filing_submissions where id = target_submission;
  if not found or submission.status <> 'claimed' or submission.claims <> target_claim then
    return null;
  end if;
  select * into package from public.filing_packages where id = submission.package_id;
  select * into lawsuit from public.proceedings where id = submission.proceeding_id;
  select * into current_case from public.cases where id = submission.case_id;
  select * into court_row from public.courts where acronym = package.court;
  return jsonb_build_object(
    'submission_id', submission.id,
    'claim', submission.claims,
    'channel', submission.channel,
    'org_id', submission.org_id,
    'firm', (select o.name from public.organizations o where o.id = submission.org_id),
    'case_id', current_case.id,
    'case_seq', current_case.seq,
    'incident', current_case.incident,
    'package_id', package.id,
    'proceeding_id', lawsuit.id,
    'kind', package.kind,
    'court', package.court,
    'court_state', court_row.uf,
    'system', package.system,
    'comarca', lawsuit.comarca,
    'test_number', case when submission.channel = 'test_court' then public.test_court_number(lawsuit.id) end,
    'codes', (select c.codes from public.court_filing_channels c where c.court = package.court and c.system = package.system),
    'endpoint', (select c.endpoint from public.court_filing_channels c where c.court = package.court and c.system = package.system),
    'value_cents', (
      select sum(cp.claim_cents) from public.proceeding_parties pp
      join public.case_parties cp on cp.id = pp.party_id
      where pp.proceeding_id = lawsuit.id and cp.claim_cents is not null),
    'claimants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', p.full_name, 'cpf', p.cpf, 'birth_date', p.birth_date,
        'street', p.street, 'number', p.address_number, 'complement', p.complement, 'district', p.district,
        'city', p.city, 'state', p.uf, 'zip', p.postal_code,
        'guardian', (
          select jsonb_build_object('name', gp.full_name, 'cpf', gp.cpf)
          from public.case_parties g join public.people gp on gp.id = g.person_id
          where g.id = cp.guardian_id)
      ) order by cp.created_at, cp.id)
      from public.proceeding_parties pp
      join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
      join public.people p on p.id = cp.person_id
      where pp.proceeding_id = lawsuit.id
    ), '[]'::jsonb),
    'defendant', (
      select jsonb_build_object('name', coalesce(a.legal_name, a.name), 'cnpj', a.cnpj, 'airline', a.iata)
      from public.airlines a where a.iata = current_case.airline_iata),
    'lawyers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(pr.display_name, ''),
        'cpf', (select lc.cpf from public.lawyer_cpfs lc where lc.user_id = pl.user_id and lc.proven_at is not null),
        'oab', (
          select jsonb_build_object('uf', r.uf, 'number', r.number) from public.oab_registrations r
          where r.user_id = pl.user_id
          order by (r.uf = court_row.uf) desc, (r.kind = 'principal') desc, r.id
          limit 1)
      ) order by pr.display_name, pl.user_id)
      from public.proceeding_lawyers pl join public.profiles pr on pr.id = pl.user_id
      where pl.proceeding_id = lawsuit.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', i.position, 'name', i.name, 'file_id', i.file_id, 'signed_file_id', i.signed_file_id,
        'part', i.part, 'parts', i.parts,
        'document_kind', case when i.document_id = package.petition_document_id then 'petition' else d.kind end,
        'storage_path', f.storage_path, 'signed_storage_path', sf.storage_path
      ) order by i.position)
      from public.filing_package_items i
      join public.files f on f.id = i.file_id
      left join public.files sf on sf.id = i.signed_file_id
      left join public.case_documents d on d.id = i.document_id
      where i.package_id = package.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.filing_submission_to_send(uuid, integer) from public, anon, authenticated;

/**
 * The worker is about to send: from here on the submission may reach the
 * court, so a claim that does not come back is unknown, never sent again by
 * itself. Only of a claim held, of a package still ready that nothing keeps
 * from being filed. Service role.
 */
create or replace function public.filing_submission_sending(target_submission uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.filing_submissions%rowtype;
  package public.filing_packages%rowtype;
  blocker text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into submission from public.filing_submissions where id = target_submission for update;
  if not found or submission.status <> 'claimed' or submission.claims <> target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into package from public.filing_packages where id = submission.package_id for update;
  blocker := public.filing_submission_blocker(package);
  if blocker is not null then
    update public.filing_submissions set status = 'owed', claimed_at = null, updated_at = now() where id = submission.id;
    return jsonb_build_object('ok', false, 'code', blocker);
  end if;
  update public.filing_submissions
  set status = 'sending', sent_at = now(), attempts = attempts + 1, updated_at = now()
  where id = submission.id;
  return jsonb_build_object('ok', true, 'code', 'sending');
end;
$$;

revoke all on function public.filing_submission_sending(uuid, integer) from public, anon, authenticated;

/**
 * What came of a submission ONE sent, recorded by the worker that holds it:
 * - `filed`: the court received it. With the lawsuit's number (one that
 *   checks against its court) the lawsuit is filed as a receipt a lawyer
 *   attaches files it (0027), the receipt the court gave kept as its
 *   receipt; with no number, the submission is filed and a lawyer attaches
 *   the number (`number_missing`).
 * - `refused`: the court does not take it, and why.
 * - `unavailable`: the court could not be reached and nothing went: owed
 *   again after the setting's growing wait, failed after its tries.
 * - `unknown`: it went and no answer could be read.
 * Told in the case's timeline as ONE's. Service role.
 */
create or replace function public.record_filing_submission(
  target_submission uuid,
  target_claim integer,
  target_outcome text,
  target_protocol text default null,
  target_case_number text default null,
  target_message text default null,
  target_receipt_file uuid default null,
  target_filed_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.filing_submissions%rowtype;
  package public.filing_packages%rowtype;
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  saved jsonb;
  given_number text := nullif(regexp_replace(coalesce(target_case_number, ''), '\D', '', 'g'), '');
  said text := left(nullif(btrim(regexp_replace(coalesce(target_message, ''), '[[:cntrl:]]+', ' ', 'g')), ''), 1000);
  given_protocol text := left(nullif(btrim(coalesce(target_protocol, '')), ''), 120);
  day date := coalesce(target_filed_on, (now() at time zone 'America/Sao_Paulo')::date);
  waits integer[];
  most integer := greatest(public.filing_submit_setting('max_attempts', 6), 1);
  receipt uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_outcome is null or target_outcome not in ('filed', 'refused', 'unavailable', 'unknown') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;
  select * into submission from public.filing_submissions where id = target_submission;
  if not found or submission.claims <> target_claim
     or submission.status not in ('sending', 'claimed') or (target_outcome <> 'unavailable' and submission.status <> 'sending') then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  perform set_config('one.system_case', submission.case_id::text, true);
  current_case := public.case_for_writer(submission.case_id);
  select * into submission from public.filing_submissions where id = target_submission for update;
  select * into package from public.filing_packages where id = submission.package_id for update;
  select * into lawsuit from public.proceedings where id = submission.proceeding_id;

  if target_outcome = 'unavailable' then
    select coalesce(array_agg(w::integer order by n), array[5, 15, 60, 180, 360]) into waits
    from platform_settings s,
         lateral jsonb_array_elements_text(case when jsonb_typeof(s.value -> 'retry_minutes') = 'array'
                                                then s.value -> 'retry_minutes' end) with ordinality as x(w, n)
    where s.key = 'filing_submit';
    if submission.attempts >= most then
      update public.filing_submissions
      set status = 'failed', error = 'court_unavailable', message = said, claimed_at = null, updated_at = now()
      where id = submission.id;
      perform public.record_case_event(submission.org_id, submission.case_id, 'filing_failed', 'system',
        jsonb_build_object('package', package.id, 'submission', submission.id, 'attempts', submission.attempts));
      perform set_config('one.system_case', '', true);
      return jsonb_build_object('ok', true, 'code', 'failed');
    end if;
    update public.filing_submissions
    set status = 'owed', claimed_at = null, error = 'court_unavailable', message = said,
        retry_after = now() + make_interval(mins => coalesce(
          waits[least(greatest(submission.attempts, 1), cardinality(waits))], 60)),
        updated_at = now()
    where id = submission.id;
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', true, 'code', 'retry');
  end if;

  if target_outcome = 'refused' then
    update public.filing_submissions
    set status = 'refused', protocol = given_protocol, message = coalesce(said, 'O tribunal não aceitou o envio.'),
        error = 'court_refused', claimed_at = null, updated_at = now()
    where id = submission.id;
    perform public.record_case_event(submission.org_id, submission.case_id, 'filing_refused', 'system',
      jsonb_build_object('package', package.id, 'submission', submission.id));
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', true, 'code', 'refused');
  end if;

  if target_outcome = 'unknown' then
    update public.filing_submissions
    set status = 'unknown', message = said, error = 'no_answer', claimed_at = null, updated_at = now()
    where id = submission.id;
    perform public.record_case_event(submission.org_id, submission.case_id, 'filing_unknown', 'system',
      jsonb_build_object('package', package.id, 'submission', submission.id));
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', true, 'code', 'unknown');
  end if;

  -- Filed: the court has it. What follows never undoes that.
  if target_receipt_file is not null and exists (
    select 1 from public.files f
    where f.id = target_receipt_file and f.org_id = submission.org_id and f.purpose = 'filing_receipt'
      and f.status = 'stored'
  ) and not exists (select 1 from public.filing_receipts r where r.file_id = target_receipt_file) then
    receipt := target_receipt_file;
  end if;
  update public.filing_submissions
  set status = 'filed', protocol = given_protocol, message = said,
      case_number = case when given_number ~ '^\d{20}$' then given_number end,
      receipt_file_id = receipt, filed_at = now(), claimed_at = null, error = null, updated_at = now()
  where id = submission.id;

  if given_number is null or not public.cnj_is_valid(given_number) then
    update public.filing_submissions set error = 'number_missing' where id = submission.id;
    perform public.record_case_event(submission.org_id, submission.case_id, 'filed_by_one', 'system',
      jsonb_build_object('package', package.id, 'submission', submission.id, 'numbered', false));
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', true, 'code', 'filed_unnumbered');
  end if;

  if lawsuit.status = 'planned' and package.status = 'ready' then
    update public.filing_packages set status = 'filed' where id = package.id;
    saved := public.save_proceeding(package.case_id, lawsuit.id, jsonb_build_object(
      'kind', lawsuit.kind, 'court', lawsuit.court, 'comarca', lawsuit.comarca, 'unit', lawsuit.unit,
      'system', lawsuit.system, 'forum_basis', lawsuit.forum_basis, 'forum_reason', lawsuit.forum_reason,
      'forum_city', lawsuit.forum_city, 'status', 'filed', 'cnj', given_number, 'filed_at', day::text));
    if not coalesce((saved ->> 'ok')::boolean, false) then
      update public.filing_packages set status = 'ready' where id = package.id;
      update public.filing_submissions set error = 'number_refused' where id = submission.id;
      perform public.record_case_event(submission.org_id, submission.case_id, 'filed_by_one', 'system',
        jsonb_build_object('package', package.id, 'submission', submission.id, 'numbered', false));
      perform set_config('one.system_case', '', true);
      return jsonb_build_object('ok', true, 'code', 'filed_unnumbered', 'saved', saved ->> 'code');
    end if;
    if receipt is not null then
      insert into public.filing_receipts (org_id, package_id, proceeding_id, file_id, cnj, filed_on, recorded_by)
      values (package.org_id, package.id, package.proceeding_id, receipt, given_number, day, null)
      on conflict (package_id) do nothing;
    end if;
  end if;
  perform public.record_case_event(submission.org_id, submission.case_id, 'filed_by_one', 'system',
    jsonb_build_object('package', package.id, 'submission', submission.id, 'numbered', true,
                       'channel', submission.channel));
  perform set_config('one.system_case', '', true);
  return jsonb_build_object('ok', true, 'code', 'filed');
end;
$$;

revoke all on function public.record_filing_submission(uuid, integer, text, text, text, text, uuid, date)
  from public, anon, authenticated;

-- ---------- A lawyer asks, or sends again ----------

/**
 * A partner or a lawyer of the firm asks ONE to file a package, where the
 * firm keeps the filing to a lawyer (`file_lawsuit` at approval): with the
 * second factor, never a support visit. Answers why ONE cannot, when it
 * cannot.
 */
create or replace function public.request_filing_submission(target_package uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  package public.filing_packages%rowtype;
  current_case public.cases%rowtype;
  blocker text;
begin
  select * into package from public.filing_packages where id = target_package;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(package.case_id);
  if not public.has_firm_function(package.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_a_lawyer');
  end if;
  perform public.require_aal2();
  select * into package from public.filing_packages where id = target_package for update;
  if exists (select 1 from public.filing_submissions s where s.package_id = package.id) then
    return jsonb_build_object('ok', false, 'code', 'already_asked');
  end if;
  blocker := public.filing_submission_blocker(package);
  if blocker is not null and blocker <> 'awaits_lawyer' then
    return jsonb_build_object('ok', false, 'code', blocker);
  end if;
  insert into public.filing_submissions (org_id, case_id, proceeding_id, package_id, channel, requested_by)
  values (package.org_id, package.case_id, package.proceeding_id, package.id, public.filing_channel_of(package), auth.uid());
  perform public.record_case_event(package.org_id, package.case_id, 'filing_requested', 'person',
    jsonb_build_object('package', package.id));
  return jsonb_build_object('ok', true, 'code', 'requested');
end;
$$;

revoke all on function public.request_filing_submission(uuid) from public, anon;
grant execute on function public.request_filing_submission(uuid) to authenticated;

/**
 * A partner or a lawyer has ONE send again a filing the court refused, or
 * that failed for the court being out of reach, or whose answer nobody
 * could read, this one only once they say the court's system does not have
 * the lawsuit: with the second factor, never a support visit.
 */
create or replace function public.retry_filing_submission(target_submission uuid, target_not_in_court boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.filing_submissions%rowtype;
  current_case public.cases%rowtype;
begin
  select * into submission from public.filing_submissions where id = target_submission;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(submission.case_id);
  if not public.has_firm_function(submission.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_a_lawyer');
  end if;
  perform public.require_aal2();
  select * into submission from public.filing_submissions where id = target_submission for update;
  if submission.status not in ('refused', 'failed', 'unknown') then
    return jsonb_build_object('ok', false, 'code', 'not_retryable');
  end if;
  if submission.status = 'unknown' and not coalesce(target_not_in_court, false) then
    return jsonb_build_object('ok', false, 'code', 'confirm_not_in_court');
  end if;
  update public.filing_submissions
  set status = 'owed', attempts = 0, retry_after = null, error = null, message = null, protocol = null,
      requested_by = coalesce(requested_by, auth.uid()), updated_at = now()
  where id = submission.id;
  perform public.record_case_event(submission.org_id, submission.case_id, 'filing_retried', 'person',
    jsonb_build_object('package', submission.package_id, 'submission', submission.id,
                       'not_in_court', coalesce(target_not_in_court, false)));
  return jsonb_build_object('ok', true, 'code', 'owed');
end;
$$;

revoke all on function public.retry_filing_submission(uuid, boolean) from public, anon;
grant execute on function public.retry_filing_submission(uuid, boolean) to authenticated;

-- ---------- What the case screen reads ----------

/**
 * For each package of a case still to be filed or filed by ONE: through
 * which channel ONE files it, what keeps it from doing so now, how the firm
 * has the decision, and what came of its submission. Anybody of the firm.
 */
create or replace function public.case_filing_by_one(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'package_id', p.id,
      'channel', public.filing_channel_of(p),
      'blocker', case when p.status = 'ready' then public.filing_submission_blocker(p) end,
      'mode', public.firm_autonomy_mode(p.org_id, 'file_lawsuit'),
      'submission', (
        select jsonb_build_object(
          'id', s.id, 'status', s.status, 'channel', s.channel, 'protocol', s.protocol, 'case_number', s.case_number,
          'message', s.message, 'error', s.error, 'attempts', s.attempts, 'retry_after', s.retry_after,
          'sent_at', s.sent_at, 'filed_at', s.filed_at, 'requested', s.requested_by is not null,
          'receipt_file_id', s.receipt_file_id)
        from public.filing_submissions s where s.package_id = p.id)
    ) order by p.requested_at desc)
    from public.filing_packages p
    where p.case_id = current_case.id
      and (p.status = 'ready' or exists (select 1 from public.filing_submissions s where s.package_id = p.id))
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.case_filing_by_one(uuid) from public, anon;
grant execute on function public.case_filing_by_one(uuid) to authenticated;

-- ---------- A receipt ONE kept is never forgotten under it ----------

/** 0070, redefined: a file a submission names as the court's receipt is in use too. */
create or replace function public.discard_file(target_file uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  file public.files%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into file from public.files where id = target_file for update;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'not_found');
  end if;
  if exists (select 1 from public.issued_documents d where d.file_id = file.id)
     or exists (select 1 from public.case_documents d where d.file_id = file.id or d.normalized_file_id = file.id)
     or exists (select 1 from public.case_statements s where s.audio_file_id = file.id)
     or exists (select 1 from public.wa_messages m where m.media_file_id = file.id)
     or exists (select 1 from public.filing_package_items i where i.file_id = file.id or i.signed_file_id = file.id)
     or exists (select 1 from public.filing_receipts r where r.file_id = file.id)
     or exists (select 1 from public.filing_submissions s where s.receipt_file_id = file.id)
     or exists (select 1 from public.template_imports i where i.file_id = file.id)
     or exists (select 1 from public.pax_documents d where d.file_id = file.id) then
    return jsonb_build_object('ok', false, 'code', 'in_use');
  end if;

  delete from public.files where id = file.id;
  -- A file a partner held is none of the firm's trail (`confirm_file`, 0070).
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (case when file.partner_id is null then file.org_id end, null, 'file.discarded', 'file', file.id::text,
          jsonb_strip_nulls(jsonb_build_object('purpose', file.purpose, 'status', file.status, 'partner', file.partner_id)));
  return jsonb_build_object('ok', true, 'code', 'discarded');
end;
$$;

revoke all on function public.discard_file(uuid) from public, anon, authenticated;
