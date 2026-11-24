-- ============================================================
-- 0286_lawsuits_from_the_past: a lawsuit filed before its case was in ONE, and its history read from the DJEN.
--
-- The owner's test of 2026-11-24: the firm runs through ONE the cases of lawsuits it already filed (closed ones, to
-- test what ONE reads of a lawsuit, and ones still going), and the receipt of the filing is a year old. The database
-- took no filing day before the case existed in ONE (0027), and once filed a lawsuit was followed only by what the
-- DJEN made available from then on, by the lawyer's registration: a closed lawsuit would wait for ever, and one still
-- going would be followed from today with nothing of what came before. The owner: "pode fazer as duas partes".
--
-- 1. The receipt of a lawsuit filed before its case was in ONE (`attach_filing_receipt`, a fifth argument): taken
--    when the lawyer says it was, and kept as said (`filing_receipts.filed_before_one`); never a day still to come,
--    nor one before the trip of the case. Each refusal says which (`filed_on_future`, `filed_before_case` with the day
--    the case was opened, `filed_before_trip`), where 0027 said `invalid_date` for all three.
-- 2. Its history read from the DJEN by the lawsuit's number, once (`proceeding_history_reads`, claimed by the sweep
--    `djen-history` and right after the receipt): each communication kept as a publication of the lawsuit, marked
--    `from_history`, which ONE triages and reads as any other.
-- 3. What had already passed comes in settled, with no alarm and no word to the client: a publication of the history
--    owes no lawyer's awareness (0104); a deadline counted from one whose day passed is done, with why; a hearing read
--    from one whose time passed is held, with why, and owes no fee per hearing (0159); and its payment owes the
--    client no warning against the scam (0248, `payment_alert`). What is still ahead (a deadline running, a hearing to
--    come, in a lawsuit still going) is as any other.
--
-- The client is told of the filing only when it was of late, as before (0248: never a lawsuit filed long before).
-- ============================================================

-- ---------- 1. The receipt of a lawsuit filed before its case was in ONE ----------

alter table public.filing_receipts add column filed_before_one boolean not null default false;
comment on column public.filing_receipts.filed_before_one is
  'The lawyer said the lawsuit was filed before its case was in ONE (0286): the day of the receipt is before the case was opened.';

-- ---------- 2. The history of a lawsuit, read from the DJEN ----------

alter table public.publications add column from_history boolean not null default false;
comment on column public.publications.from_history is
  'Read from the lawsuit''s history in the DJEN by its number (0286), not from what the DJEN made available to the firm''s lawyers.';
grant select (from_history) on table public.publications to authenticated;

create table public.proceeding_history_reads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  proceeding_id uuid not null,
  case_id uuid,
  -- due     waits for the sweep (or the work right after the receipt);
  -- done    read: what the DJEN had of the lawsuit is kept as its publications;
  -- failed  could not be read, after its attempts (`error`).
  status text not null default 'due',
  claims integer not null default 0,
  claimed_at timestamptz,
  attempts integer not null default 0,
  retry_after timestamptz,
  error text,
  -- What the DJEN had of the lawsuit, what became a publication of it, and what was already one or could not be kept.
  seen integer,
  kept integer,
  left_out integer,
  asked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (proceeding_id),
  unique (id, org_id),
  foreign key (proceeding_id, org_id) references public.proceedings (id, org_id) on delete cascade,
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete set null (case_id),
  constraint proceeding_history_reads_status_check check (status in ('due', 'done', 'failed')),
  constraint proceeding_history_reads_error_check check (error is null or error ~ '^[a-z][a-z0-9_]{1,59}$'),
  constraint proceeding_history_reads_counts_check check (
    coalesce(seen, 0) >= 0 and coalesce(kept, 0) >= 0 and coalesce(left_out, 0) >= 0)
);

create index proceeding_history_reads_due_idx on public.proceeding_history_reads (created_at) where status = 'due';
create index proceeding_history_reads_case_idx on public.proceeding_history_reads (case_id);

alter table public.proceeding_history_reads enable row level security;
create policy "proceeding_history_reads_select_member" on public.proceeding_history_reads
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.proceeding_history_reads to authenticated;
create trigger guard_impersonation_proceeding_history_reads after insert or update or delete
  on public.proceeding_history_reads
  for each statement execute function public.guard_impersonation_readonly();

/**
 * The history of a lawsuit filed before its case was in ONE, owed to the DJEN's reading by its number (0286): once
 * per lawsuit; asked again, a read that failed is owed again and one done stays as it is. Internal.
 */
create or replace function public.queue_proceeding_history(target_proceeding uuid, target_by uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.proceeding_history_reads (org_id, proceeding_id, case_id, asked_by)
  select p.org_id, p.id, p.case_id, target_by
  from public.proceedings p
  where p.id = target_proceeding and p.cnj ~ '^[0-9]{20}$'
  on conflict (proceeding_id) do update
    set status = 'due', attempts = 0, retry_after = null, error = null, claimed_at = null,
        asked_by = coalesce(excluded.asked_by, proceeding_history_reads.asked_by)
    where proceeding_history_reads.status = 'failed';
end;
$$;

revoke all on function public.queue_proceeding_history(uuid, uuid) from public, anon, authenticated;

/**
 * The histories due, the oldest first (one named, when one is), claimed under a new number: one whose claim is older
 * than ten minutes was left by a worker that stopped, and is due again. Answers the read, its claim and the lawsuit's
 * number. Service role.
 */
create or replace function public.claim_proceeding_history_reads(
  target_limit integer default 1,
  target_read uuid default null
)
returns table (read_id uuid, claim integer, cnj text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  with picked as (
    select r.id from public.proceeding_history_reads r
    where r.status = 'due'
      and (target_read is null or r.id = target_read)
      and (r.retry_after is null or r.retry_after <= now())
      and (r.claimed_at is null or r.claimed_at < now() - interval '10 minutes')
    order by r.created_at
    limit greatest(least(coalesce(target_limit, 1), 20), 1)
    for update skip locked
  )
  update public.proceeding_history_reads r
  set claimed_at = now(), claims = r.claims + 1, attempts = r.attempts + 1
  from picked, public.proceedings p
  where r.id = picked.id and p.id = r.proceeding_id
  returning r.id, r.claims, p.cnj;
end;
$$;

revoke all on function public.claim_proceeding_history_reads(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_proceeding_history_reads(integer, uuid) to service_role;

/**
 * What the DJEN answered of a claimed history (0286), kept as it came:
 *   partial  a part of what was read, kept (a long history goes in several calls);
 *   done     the last part, kept, and the read is over: the case's trail says how many came;
 *   retry    a passing failure (the DJEN limited the calls, or did not answer): tried again after a wait, until the
 *            attempts are spent;
 *   failed   the history cannot be read (`target_code`).
 * Each communication of the lawsuit becomes a publication of it, marked `from_history`, addressed to the lawsuit's
 * lawyers; one the firm already has (read by a lawyer's registration) is left as it is; one of another number, with no
 * hash or no day, is not kept, and counted. Service role.
 */
create or replace function public.record_proceeding_history(
  target_read uuid,
  target_claim integer,
  target_outcome text,
  target_items jsonb default '[]'::jsonb,
  target_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  history public.proceeding_history_reads%rowtype;
  lawsuit public.proceedings%rowtype;
  tries integer := greatest(public.publications_setting('max_attempts', 3), 1);
  pause integer := greatest(public.publications_setting('retry_minutes', 20), 1);
  longest integer := greatest(public.publications_setting('max_text_chars', 100000), 1000);
  code text := coalesce(substring(lower(coalesce(target_code, '')) from '^[a-z][a-z0-9_]{1,59}'), 'failed');
  outcome text := target_outcome;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  lawyers uuid[];
  item jsonb;
  item_hash text;
  item_court text;
  item_day date;
  item_text text;
  item_link text;
  item_active boolean;
  item_reason text;
  publication uuid;
  n_found integer := 0;
  n_added integer := 0;
  n_skipped integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_outcome is null or target_outcome not in ('partial', 'done', 'retry', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;
  select * into history from public.proceeding_history_reads where id = target_read for update;
  if not found or history.status <> 'due' or history.claimed_at is null or history.claims is distinct from target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into lawsuit from public.proceedings where id = history.proceeding_id;

  if outcome in ('partial', 'done') then
    if jsonb_typeof(coalesce(target_items, '[]'::jsonb)) <> 'array' then
      return jsonb_build_object('ok', false, 'code', 'invalid_items');
    end if;
    select coalesce(array_agg(pl.user_id order by pl.user_id), '{}'::uuid[]) into lawyers
    from public.proceeding_lawyers pl where pl.proceeding_id = lawsuit.id;
    for item in select value from jsonb_array_elements(coalesce(target_items, '[]'::jsonb)) loop
      n_found := n_found + 1;
      publication := null;
      begin
        item_hash := item ->> 'hash';
        item_court := item ->> 'court';
        item_day := case when coalesce(item ->> 'available_on', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          then (item ->> 'available_on')::date end;
        item_text := coalesce(item ->> 'text', '');
        item_link := nullif(btrim(coalesce(item ->> 'link', '')), '');
        item_active := coalesce((item ->> 'active')::boolean, true);
        item_reason := nullif(left(btrim(coalesce(item ->> 'cancel_reason', '')), 1000), '');
        if item_hash ~ '^[A-Za-z0-9_-]{8,80}$'
           and regexp_replace(coalesce(item ->> 'cnj', ''), '\D', '', 'g') = lawsuit.cnj
           and item_day between date '2000-01-01' and today + 1
           and coalesce(item_court, '') ~ '^[A-Z0-9-]{2,12}$' then
          insert into public.publications (
            org_id, hash, court, cnj, available_on, kind, document_type, body, truncated, head, tail, link, unit,
            class_name, active, cancel_reason, cancelled_at, lawyer_ids, proceeding_id, case_id, from_history
          ) values (
            history.org_id, item_hash, item_court, lawsuit.cnj, item_day,
            left(coalesce(item ->> 'kind', ''), 80),
            nullif(left(btrim(coalesce(item ->> 'document_type', '')), 80), ''),
            left(item_text, longest), char_length(item_text) > longest,
            left(btrim(coalesce(item ->> 'head', '')), 1200),
            nullif(left(btrim(coalesce(item ->> 'tail', '')), 1200), ''),
            case when item_link ~* '^https?://' then left(item_link, 500) end,
            nullif(left(btrim(coalesce(item ->> 'unit', '')), 200), ''),
            nullif(left(btrim(coalesce(item ->> 'class_name', '')), 200), ''),
            item_active,
            case when not item_active then item_reason end,
            case when not item_active then now() end,
            lawyers, lawsuit.id, lawsuit.case_id, true
          )
          on conflict (org_id, hash) do nothing
          returning id into publication;
        end if;
      exception
        when deadlock_detected or serialization_failure or lock_not_available then
          raise;
        when others then
          publication := null;
      end;
      if publication is null then
        n_skipped := n_skipped + 1;
      else
        n_added := n_added + 1;
      end if;
    end loop;

    if outcome = 'partial' then
      update public.proceeding_history_reads
      set seen = coalesce(proceeding_history_reads.seen, 0) + n_found,
          kept = coalesce(proceeding_history_reads.kept, 0) + n_added,
          left_out = coalesce(proceeding_history_reads.left_out, 0) + n_skipped,
          claimed_at = now()
      where id = history.id;
      return jsonb_build_object('ok', true, 'code', 'partial', 'new', n_added, 'skipped', n_skipped);
    end if;

    update public.proceeding_history_reads
    set status = 'done', read_at = now(), claimed_at = null, retry_after = null, error = null,
        seen = coalesce(proceeding_history_reads.seen, 0) + n_found,
        kept = coalesce(proceeding_history_reads.kept, 0) + n_added,
        left_out = coalesce(proceeding_history_reads.left_out, 0) + n_skipped
    where id = history.id
    returning * into history;
    if history.case_id is not null then
      perform public.record_case_event(history.org_id, history.case_id, 'proceeding_history_read', 'system',
        jsonb_build_object('proceeding', history.proceeding_id, 'seen', history.seen, 'kept', history.kept));
    end if;
    return jsonb_build_object('ok', true, 'code', 'done', 'seen', history.seen, 'new', history.kept);
  end if;

  if outcome = 'retry' and history.attempts >= tries then
    outcome := 'failed';
  end if;
  update public.proceeding_history_reads
  set claimed_at = null, error = code,
      status = case when outcome = 'failed' then 'failed' else 'due' end,
      retry_after = case when outcome = 'failed' then null else now() + make_interval(mins => pause * history.attempts) end
  where id = history.id;
  return jsonb_build_object('ok', true, 'code', outcome);
end;
$$;

revoke all on function public.record_proceeding_history(uuid, integer, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_proceeding_history(uuid, integer, text, jsonb, text) to service_role;

/**
 * A lawyer of the firm asks ONE to read the history of a lawsuit filed (0286): one recorded as filed by hand with a day
 * before its case was in ONE, or one whose reading failed (the DJEN out for longer than the attempts last). One read,
 * or being read, stays as it is.
 */
create or replace function public.ask_proceeding_history(target_proceeding uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  existing text;
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(lawsuit.case_id);
  if not public.has_firm_function(lawsuit.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_a_lawyer');
  end if;
  if lawsuit.status <> 'filed' or coalesce(lawsuit.cnj, '') !~ '^[0-9]{20}$' then
    return jsonb_build_object('ok', false, 'code', 'not_filed');
  end if;
  select r.status into existing from public.proceeding_history_reads r where r.proceeding_id = lawsuit.id;
  if existing in ('due', 'done') then
    return jsonb_build_object('ok', true, 'code', 'already');
  end if;
  perform public.queue_proceeding_history(lawsuit.id, auth.uid());
  perform public.record_case_event(lawsuit.org_id, lawsuit.case_id, 'proceeding_history_asked', 'person',
    jsonb_build_object('proceeding', lawsuit.id));
  return jsonb_build_object('ok', true, 'code', 'queued');
end;
$$;

revoke all on function public.ask_proceeding_history(uuid) from public, anon;
grant execute on function public.ask_proceeding_history(uuid) to authenticated;

-- ---------- 1. The receipt, again ----------

drop function public.attach_filing_receipt(uuid, uuid, text, date);

/**
 * A lawyer attaches the receipt of a lawsuit's filing (0027), with its number and its day. The day is one that has
 * come, not before the trip of the case, and not before the case was in ONE unless the lawyer says the lawsuit was
 * filed before (`target_before_one`, 0286): then the receipt says so, and ONE reads the lawsuit's history from the
 * DJEN (`queue_proceeding_history`).
 */
create or replace function public.attach_filing_receipt(
  target_package uuid,
  target_file uuid,
  target_cnj text,
  target_filed_on date,
  target_before_one boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  package public.filing_packages%rowtype;
  proceeding public.proceedings%rowtype;
  current_case public.cases%rowtype;
  saved jsonb;
  cnj_value text := regexp_replace(coalesce(target_cnj, ''), '\D', '', 'g');
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  opened date;
  trip date;
  before_one boolean := false;
begin
  select * into package from public.filing_packages where id = target_package;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(package.case_id);
  select * into package from public.filing_packages where id = target_package for update;
  if not public.has_firm_function(package.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_a_lawyer');
  end if;
  if package.status <> 'ready' then
    return jsonb_build_object('ok', false, 'code', 'package_not_ready');
  end if;
  select * into proceeding from public.proceedings where id = package.proceeding_id;
  if proceeding.status <> 'planned' then
    return jsonb_build_object('ok', false, 'code', 'already_filed');
  end if;
  -- The package is of the lawsuit as it was when it was built: one that moved to another court or
  -- system since, or whose documents are no longer all accepted, is built again before it is filed.
  if public.filing_package_outdated(package) then
    return jsonb_build_object('ok', false, 'code', 'package_outdated');
  end if;
  -- What blocks a filing is asked again (0025): a claimant added since, a guardian changed, a word taken
  -- back, or a minor joined to a family whose adults were planned in the small-claims court.
  if public.filing_blocker(proceeding.id) is not null then
    return jsonb_build_object('ok', false, 'code', public.filing_blocker(proceeding.id));
  end if;
  -- The day the court's system says: one that has come; not before the case existed in ONE, unless the lawyer says
  -- the lawsuit was filed before (0286); and never before the trip the lawsuit is of. (A package built again after the
  -- filing does not push the day forward.)
  if target_filed_on is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_date', 'field', 'filed_on');
  end if;
  if target_filed_on > today then
    return jsonb_build_object('ok', false, 'code', 'filed_on_future', 'field', 'filed_on');
  end if;
  opened := (current_case.created_at at time zone 'America/Sao_Paulo')::date;
  if target_filed_on < opened then
    if not coalesce(target_before_one, false) then
      return jsonb_build_object('ok', false, 'code', 'filed_before_case', 'field', 'filed_on', 'opened_on', opened);
    end if;
    before_one := true;
  end if;
  select coalesce(min(fs.scheduled_departure_local)::date, current_case.flight_date) into trip
  from public.flight_segments fs where fs.case_id = current_case.id;
  if trip is not null and target_filed_on < trip then
    return jsonb_build_object('ok', false, 'code', 'filed_before_trip', 'field', 'filed_on');
  end if;
  if not exists (
    select 1 from public.files f
    where f.id = target_file and f.org_id = package.org_id and f.status = 'stored' and f.purpose = 'upload'
      and f.uploaded_by = auth.uid()
      and f.detected_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  ) or exists (select 1 from public.case_documents d where d.file_id = target_file)
    or exists (select 1 from public.filing_receipts r where r.file_id = target_file) then
    return jsonb_build_object('ok', false, 'code', 'file_not_found', 'field', 'file');
  end if;

  -- The lawsuit becomes filed through the one function that writes a lawsuit: the number is checked
  -- against its court, and against every other lawsuit of the firm.
  -- The package is closed first: a lawsuit that becomes filed gives up whatever package it still has
  -- in course (`proceedings_close_filing_packages`), and this one is not in course any more.
  update public.filing_packages set status = 'filed' where id = package.id;
  saved := public.save_proceeding(package.case_id, proceeding.id, jsonb_build_object(
    'kind', proceeding.kind, 'court', proceeding.court, 'comarca', proceeding.comarca, 'unit', proceeding.unit,
    'system', proceeding.system, 'forum_basis', proceeding.forum_basis, 'forum_reason', proceeding.forum_reason,
    'forum_city', proceeding.forum_city, 'status', 'filed', 'cnj', cnj_value, 'filed_at', target_filed_on::text));
  if not coalesce((saved ->> 'ok')::boolean, false) then
    update public.filing_packages set status = 'ready' where id = package.id;
    return saved;
  end if;

  insert into public.filing_receipts (org_id, package_id, proceeding_id, file_id, cnj, filed_on, recorded_by,
                                      filed_before_one)
  values (package.org_id, package.id, package.proceeding_id, target_file, cnj_value, target_filed_on, auth.uid(),
          before_one);
  perform public.record_case_event(package.org_id, package.case_id, 'filing_receipt_attached', 'person',
    jsonb_build_object('package', package.id, 'proceeding', package.proceeding_id, 'before_one', before_one));
  if before_one then
    perform public.queue_proceeding_history(package.proceeding_id, auth.uid());
  end if;
  return jsonb_build_object('ok', true, 'code', 'filed', 'history', before_one);
end;
$$;
revoke all on function public.attach_filing_receipt(uuid, uuid, text, date, boolean) from public, anon;
grant execute on function public.attach_filing_receipt(uuid, uuid, text, date, boolean) to authenticated;

-- ---------- 3. What had already passed comes in settled ----------

/** Whether a publication was read from a lawsuit's history (0286). */
create or replace function public.publication_from_history(target_publication uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.from_history from public.publications p where p.id = target_publication), false);
$$;

revoke all on function public.publication_from_history(uuid) from public, anon, authenticated;

/** A publication of a lawsuit's history owes no lawyer's awareness of ONE's triage (0104): it is past. */
create or replace function public.publications_history_owes_no_ack()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.from_history and new.ack_owed then
    new.ack_owed := false;
  end if;
  return new;
end;
$$;

revoke all on function public.publications_history_owes_no_ack() from public, anon, authenticated;
create trigger publications_history_owes_no_ack before insert or update of ack_owed, from_history on public.publications
  for each row execute function public.publications_history_owes_no_ack();

/**
 * A deadline counted from a publication of a lawsuit's history whose day had passed when ONE read it is done, with
 * why: nobody of the firm can meet it now. One whose day is still ahead is as any other.
 */
create or replace function public.deadlines_history_settled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  day date := coalesce(new.due_on, new.computed_due_on);
begin
  if new.status in ('proposed', 'confirmed') and new.publication_id is not null and day is not null
     and day < (now() at time zone 'America/Sao_Paulo')::date
     and public.publication_from_history(new.publication_id) then
    new.status := 'done';
    new.done_at := now();
    new.done_by := null;
    new.done_note := 'Prazo lido do histórico do processo: o dia já tinha passado quando o caso entrou no ONE.';
  end if;
  return new;
end;
$$;

revoke all on function public.deadlines_history_settled() from public, anon, authenticated;
create trigger deadlines_history_settled before insert or update on public.deadlines
  for each row execute function public.deadlines_history_settled();

/**
 * A hearing read from a publication of a lawsuit's history whose time had passed when ONE read it is held, with why
 * (the result was not read): nobody of the firm is asked a word on it. One still to come is as any other.
 */
create or replace function public.hearings_history_settled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'scheduled' and new.starts_at < now() and new.publication_id is not null
     and public.publication_from_history(new.publication_id) then
    new.status := 'held';
    new.outcome := null;
    new.outcome_note := 'Audiência lida do histórico do processo: já tinha passado quando o caso entrou no ONE, e o resultado não foi lido.';
  end if;
  return new;
end;
$$;

revoke all on function public.hearings_history_settled() from public, anon, authenticated;
create trigger hearings_history_settled before insert or update of starts_at, status, publication_id on public.hearings
  for each row execute function public.hearings_history_settled();

/** A hearing held owes the case's fee per hearing (0159); one of a lawsuit's history, held before ONE, owes none. */
create or replace function public.case_fee_acts_hearing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'held' and old.status is distinct from 'held' and new.case_id is not null
     and not (new.publication_id is not null and public.publication_from_history(new.publication_id)) then
    perform public.case_fee_act_bill(new.case_id, 'hearing:' || new.id::text,
      (select f.hearing_cents from public.case_fees f where f.case_id = new.case_id), 'Honorários por audiência');
  end if;
  return new;
end;
$$;

revoke all on function public.case_fee_acts_hearing() from public, anon, authenticated;

-- ---------- The client's notices: never the warning of a payment of a lawsuit's history ----------

-- 0248's candidates, unchanged but for the warning against the scam: a publication of a lawsuit's history triaged as a
-- payment is a payment made long before the case was in ONE, and the client is not warned of it now.
create or replace function public.notice_candidates(target_org uuid, target_case uuid default null)
returns table (
  kind text,
  occurrence text,
  priority integer,
  case_id uuid,
  person_id uuid,
  phone text,
  proceeding_id uuid,
  hearing_id uuid,
  publication_id uuid,
  document_id uuid,
  about_at timestamptz,
  opens timestamptz,
  closes timestamptz,
  zone text,
  early boolean,
  since timestamptz,
  params text[],
  notice_id uuid,
  attempts integer,
  blocker text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  steps jsonb := coalesce(public.notices_setting_json('hearing_steps'), '[]'::jsonb);
  day_lead interval := make_interval(mins => greatest(public.notices_setting('day_lead_minutes', 60), 0));
  update_days integer := greatest(public.notices_setting('update_days', 15), 1);
  pay_days integer := greatest(public.notices_setting('payment_alert_days', 5), 1);
  document_days integer := greatest(public.notices_setting('document_days', 7), 1);
  received_days integer := greatest(public.notices_setting('received_days', 3), 1);
  filed_days integer := greatest(public.notices_setting('filed_days', 7), 1);
  tries integer := greatest(public.notices_setting('max_attempts', 5), 1);
  retry_wait integer := greatest(public.notices_setting('retry_minutes', 30), 1);
  settle interval := make_interval(mins => greatest(public.notices_setting('settle_minutes', 15), 0));
  firm text := (select o.name from public.organizations o where o.id = target_org);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  return query
  with due as (
    -- The reminders of each hearing to come, by step.
    select 'hearing_reminder'::text as kind,
           'h:' || h.id || ':' || to_char(h.starts_at at time zone 'UTC', 'YYYYMMDDHH24MI') || ':' || st.step as occurrence,
           2 as priority, h.case_id, r.person_id, h.proceeding_id, h.id as hearing_id, null::uuid as publication_id,
           null::uuid as document_id, h.starts_at as about_at, st.opens, st.closes, h.time_zone as zone,
           -- The reminder of the day of a hearing of the morning may go from the earlier hour.
           st.days = 0 and public.notice_early(h.starts_at, h.time_zone) as early, null::timestamptz as since,
           array[
             initcap(lower(split_part(btrim(p.full_name), ' ', 1))), firm, public.notice_hearing_words(h.kind),
             public.cnj_formatted(pr.cnj),
             public.notice_moment(h.starts_at, h.time_zone,
               case st.days when 0 then 'hoje, ' when 1 then 'amanhã, ' else '' end),
             public.notice_how_words(h.mode, h.place, h.link)
           ] as params
    from public.hearings h
    join public.proceedings pr on pr.id = h.proceeding_id
    join public.cases c on c.id = h.case_id and c.status not in ('closed', 'declined')
    cross join lateral (
      select s.step, s.days, s.opens,
             coalesce(lead(s.opens) over (order by s.days desc), h.starts_at - case when c.is_test then interval '0' else day_lead end) as closes
      from (
        select item ->> 'step' as step, (item ->> 'days')::integer as days,
               ((((h.starts_at at time zone h.time_zone)::date - (item ->> 'days')::integer)::timestamp) at time zone h.time_zone) as opens
        from jsonb_array_elements(steps) item
        where item ->> 'step' ~ '^[a-z]{2,12}$' and item ->> 'days' ~ '^[0-9]{1,3}$'
      ) s
    ) st
    cross join lateral public.notice_recipients(h.proceeding_id) r
    join public.people p on p.id = r.person_id
    where h.org_id = target_org and h.status = 'scheduled' and h.starts_at > now()
      and (target_case is null or h.case_id = target_case)
      and h.changed_at <= now() - case when c.is_test then interval '0' else settle end
      and now() >= st.opens and now() < st.closes
      -- The court took back the publication the hearing came from, and nobody said they saw it: no reminder yet.
      and not public.hearing_publication_cancelled(h.id, h.publication_id)

    union all

    -- What changed of a hearing somebody of the lawsuit was told of (they, or the phone they share): what they
    -- believe is the latest notice of it that went, or may have gone.
    select 'hearing_change',
           'h:' || h.id || ':' ||
             case
               when h.status = 'cancelled' then 'cancelled'
               when told.cancelled then 'back:' || to_char(h.starts_at at time zone 'UTC', 'YYYYMMDDHH24MI')
               else 'moved:' || to_char(h.starts_at at time zone 'UTC', 'YYYYMMDDHH24MI')
             end || ':' || told.notice,
           1, h.case_id, r.person_id, h.proceeding_id, h.id, null::uuid, null::uuid,
           h.starts_at, now() - interval '1 minute',
           case when h.status = 'cancelled' then h.starts_at else h.starts_at - case when c.is_test then interval '0' else day_lead end end,
           h.time_zone,
           -- About a hearing of the morning of this very day: it may go from the earlier hour.
           public.notice_early(h.starts_at, h.time_zone) or public.notice_early(told.about_at, h.time_zone),
           h.changed_at,
           array[
             initcap(lower(split_part(btrim(p.full_name), ' ', 1))), firm, public.notice_hearing_words(h.kind),
             public.cnj_formatted(pr.cnj),
             case
               when h.status = 'cancelled' then 'ela foi cancelada. Se uma nova data for marcada, você receberá um novo aviso'
               when told.cancelled then 'ela foi marcada novamente para ' || public.notice_moment(h.starts_at, h.time_zone)
               else 'ela foi remarcada para ' || public.notice_moment(h.starts_at, h.time_zone)
             end
           ]
    from public.hearings h
    join public.proceedings pr on pr.id = h.proceeding_id
    join public.cases c on c.id = h.case_id and c.status not in ('closed', 'declined')
    cross join lateral public.notice_recipients(h.proceeding_id) r
    join public.people p on p.id = r.person_id
    cross join lateral (
      select n.id as notice, n.about_at,
             (n.kind = 'hearing_change' and n.occurrence like '%:cancelled:%') as cancelled
      from public.client_notices n
      join public.wa_messages m on m.id = n.message_id
      where n.org_id = target_org and n.hearing_id = h.id
        and n.kind in ('hearing_reminder', 'hearing_change', 'lawsuit_update')
        and (n.person_id = r.person_id or n.phone = any (public.wa_phone_variants(p.phone)))
        -- What went or may have gone: a try that failed told nothing, and is tried again as itself.
        and (m.status is distinct from 'failed' or m.error_code = 'unconfirmed')
      order by n.reserved_at desc
      limit 1
    ) told
    where h.org_id = target_org
      and (target_case is null or h.case_id = target_case)
      and h.changed_at <= now() - case when c.is_test then interval '0' else settle end
      and (
        (h.status = 'scheduled' and h.starts_at > now() + case when c.is_test then interval '0' else day_lead end)
        or (h.status = 'cancelled' and exists (
          select 1 from public.client_notices n where n.org_id = target_org and n.hearing_id = h.id and n.about_at > now()
        ))
      )
      and (
        (h.status = 'scheduled' and (told.cancelled or told.about_at <> h.starts_at))
        -- Cancelled while what they were told of is still to come: they would go to it.
        or (h.status = 'cancelled' and not told.cancelled and told.about_at > now())
      )

    union all

    -- The word on each lawsuit the court has, every few days from its filing, naming its next hearing. It waits
    -- while a hearing of the lawsuit was written a moment ago, so it never names one about to be corrected.
    select 'lawsuit_update', 'u:' || pr.id || ':' || per.n, 4, pr.case_id, r.person_id, pr.id, next.id, null::uuid,
           null::uuid, next.starts_at, per.opens, per.opens + make_interval(days => update_days),
           coalesce(court.time_zone, 'America/Sao_Paulo'), false, null::timestamptz,
           array[
             initcap(lower(split_part(btrim(p.full_name), ' ', 1))), firm, public.cnj_formatted(pr.cnj),
             case when moved.at is not null
               then 'a última movimentação registrada pelo tribunal foi em '
                    || to_char(moved.at at time zone coalesce(court.time_zone, 'America/Sao_Paulo'), 'DD/MM/YYYY')
               else 'o processo segue em andamento no tribunal' end
             || coalesce(', e a próxima ' || public.notice_hearing_words(next.kind) || ' está marcada para '
                  || public.notice_moment(next.starts_at, next.time_zone), '')
           ]
    from public.proceedings pr
    join public.cases c on c.id = pr.case_id and c.status not in ('closed', 'declined')
    left join public.courts court on court.acronym = pr.court
    cross join lateral (
      select ((today - pr.filed_at) / update_days) as n,
             (((pr.filed_at + ((today - pr.filed_at) / update_days) * update_days)::timestamp)
               at time zone 'America/Sao_Paulo') as opens
    ) per
    cross join lateral public.notice_recipients(pr.id) r
    join public.people p on p.id = r.person_id
    left join lateral (
      select max(mv.occurred_at) as at from public.movements mv where mv.proceeding_id = pr.id
    ) moved on true
    left join lateral (
      select h.id, h.kind, h.starts_at, h.time_zone from public.hearings h
      where h.proceeding_id = pr.id and h.status = 'scheduled' and h.starts_at > now()
        -- The court took back the publication it came from, and nobody said they saw it: not told yet.
        and not public.hearing_publication_cancelled(h.id, h.publication_id)
      order by h.starts_at limit 1
    ) next on true
    where pr.org_id = target_org and pr.status = 'filed' and pr.filed_at is not null and pr.cnj is not null
      and per.n >= 1
      and (target_case is null or pr.case_id = target_case)
      and not exists (
        select 1 from public.hearings h where h.proceeding_id = pr.id and h.changed_at > now() - case when c.is_test then interval '0' else settle end
      )

    union all

    -- The warning against the scam, the days after a publication of the lawsuit was triaged as a payment.
    select 'payment_alert', 'p:' || pub.id, 3, pr.case_id, r.person_id, pr.id, null::uuid, pub.id, null::uuid,
           null::timestamptz, pub.triaged_at, pub.triaged_at + make_interval(days => pay_days),
           coalesce(court.time_zone, 'America/Sao_Paulo'), false, null::timestamptz,
           array[initcap(lower(split_part(btrim(p.full_name), ' ', 1))), firm, public.cnj_formatted(pr.cnj)]
    from public.publications pub
    join public.proceedings pr on pr.id = pub.proceeding_id
    join public.cases c on c.id = pr.case_id and c.status not in ('closed', 'declined')
    left join public.courts court on court.acronym = pr.court
    cross join lateral public.notice_recipients(pr.id) r
    join public.people p on p.id = r.person_id
    where pub.org_id = target_org and pub.active and pub.category = 'pagamento'
      -- Never of a lawsuit's history (0286): a payment made long before the case was in ONE.
      and not pub.from_history
      -- Triaged by a person, or by ONE itself (0104).
      and (pub.triaged_by is not null or pub.ai_applied)
      and pub.triaged_at <= now() - case when c.is_test then interval '0' else settle end
      and now() < pub.triaged_at + make_interval(days => pay_days)
      and (target_case is null or pr.case_id = target_case)

    union all

    -- A document of the client's the firm refused, still owed, of a case that still takes papers on the client's
    -- link: asked for again with the reason, once per refusal, in the hours of the day of the person's own state.
    select 'document_refused', 'd:' || d.id || ':' || to_char(d.decided_at at time zone 'UTC', 'YYYYMMDDHH24MISS'),
           3, d.case_id, r.person_id, null::uuid, null::uuid, null::uuid, d.id,
           null::timestamptz, d.decided_at, d.decided_at + make_interval(days => document_days),
           z.zone, false, d.decided_at,
           array[
             initcap(lower(split_part(btrim(p.full_name), ' ', 1))), firm,
             -- Which paper: of somebody else than who is asked (a child's), whose; the day it was sent; and, for a
             -- client of another case still going at the firm, the trip it is of.
             public.notice_document_words(d.kind) || coalesce((
               select ' de ' || initcap(lower(split_part(btrim(owner.full_name), ' ', 1)))
               from public.case_parties cp join public.people owner on owner.id = cp.person_id
               where cp.id = d.party_id and cp.person_id <> r.person_id
             ), '')
             || case when d.kind = 'evidence' then ', enviada em ' else ', enviado em ' end
             || to_char(d.created_at at time zone z.zone, 'DD/MM/YYYY')
             || case when exists (
                  select 1 from public.case_parties op join public.cases oc on oc.id = op.case_id
                  where op.person_id = r.person_id and oc.id <> d.case_id and oc.status not in ('closed', 'declined')
                ) then coalesce(', do caso da viagem de ' || to_char(c.flight_date, 'DD/MM/YYYY'), '') else '' end,
             -- The reason as written, in the plain words a message to a client keeps: no dash, no exclamation.
             rtrim(btrim(regexp_replace(regexp_replace(d.rejected_reason, '!+', '.', 'g'), '\s*[—–]+\s*', ', ', 'g')),
                   ' .;:,')
           ]
    from public.case_documents d
    join public.cases c on c.id = d.case_id and c.status in ('intake', 'documents', 'signature')
    cross join lateral (select public.document_recipient(d.id) as person_id) r
    join public.people p on p.id = r.person_id
    -- The day of the person's own state.
    cross join lateral (
      select coalesce((select ct.time_zone from public.courts ct where ct.uf = upper(p.uf)), 'America/Sao_Paulo') as zone
    ) z
    where d.org_id = target_org and d.status = 'rejected' and d.decided_at is not null
      and d.kind in ('identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'other')
      -- A person's own paper left with no party (the person was taken out of the case) asks nobody else for it.
      and (d.party_id is not null or d.kind not in ('identity', 'address_proof'))
      and d.decided_at <= now() - settle
      and now() < d.decided_at + make_interval(days => document_days)
      and (target_case is null or d.case_id = target_case)
      -- An older refusal of the same paper is answered by a newer one sent after it (refused in its turn, that one is
      -- asked for itself); a file refused on its bytes answers nothing, and papers of a kind a client sends several of
      -- (receipts) that came before the refusal are other papers.
      and not exists (
        select 1 from public.case_documents n
        where n.case_id = d.case_id and n.kind = d.kind and n.party_id is not distinct from d.party_id
          and n.id <> d.id and n.created_at > d.decided_at
          and (n.status <> 'rejected' or n.decided_at is not null)
      )
      and public.case_document_owed(d.id)

    union all

    -- A client said, on their own link, that they sent everything: the firm got it, and what comes next. ONE says it
    -- in the conversation at once where it can (`advance_say_received`, recorded as this very notice); the template
    -- is for when it could not, and waits the setting's minutes for it.
    select 'case_received', 'r:' || l.case_id, 4, l.case_id, l.person_id, null::uuid, null::uuid, null::uuid,
           null::uuid, null::timestamptz, l.finished_at, l.finished_at + make_interval(days => received_days),
           z.zone, false, null::timestamptz,
           array[
             initcap(lower(split_part(btrim(p.full_name), ' ', 1))), firm,
             public.notice_next_words(l.case_id, l.person_id)
           ]
    from public.client_links l
    join public.cases c on c.id = l.case_id and c.status in ('intake', 'documents', 'signature', 'drafting', 'ready')
    join public.people p on p.id = l.person_id
    -- The day of the person's own state.
    cross join lateral (
      select coalesce((select ct.time_zone from public.courts ct where ct.uf = upper(p.uf)), 'America/Sao_Paulo') as zone
    ) z
    where l.org_id = target_org and l.finished_at is not null and l.revoked_at is null
      and l.finished_at <= now() - settle
      and now() < l.finished_at + make_interval(days => received_days)
      and (target_case is null or l.case_id = target_case)
      and exists (select 1 from public.case_parties cp where cp.case_id = l.case_id and cp.person_id = l.person_id)
      and not (p.birth_date is not null and p.birth_date > (today - interval '18 years')::date)

    union all

    -- A lawsuit recorded filed, the days after, when it was filed of late: its number and where it runs. Never one
    -- filed long before (what a spreadsheet brings of the firm's portfolio).
    select 'lawsuit_filed', 'f:' || pr.id, 3, pr.case_id, r.person_id, pr.id, null::uuid, null::uuid, null::uuid,
           null::timestamptz, pr.filed_marked_at, pr.filed_marked_at + make_interval(days => filed_days),
           coalesce(court.time_zone, 'America/Sao_Paulo'), false, null::timestamptz,
           array[
             initcap(lower(split_part(btrim(p.full_name), ' ', 1))), firm, public.cnj_formatted(pr.cnj),
             public.notice_court_words(pr.kind, pr.comarca, pr.forum_city, pr.court)
           ]
    from public.proceedings pr
    join public.cases c on c.id = pr.case_id and c.status not in ('closed', 'declined')
    left join public.courts court on court.acronym = pr.court
    cross join lateral public.notice_recipients(pr.id) r
    join public.people p on p.id = r.person_id
    where pr.org_id = target_org and pr.status = 'filed' and pr.cnj is not null and pr.filed_marked_at is not null
      and pr.filed_at is not null and pr.filed_at >= today - filed_days
      and pr.filed_marked_at <= now() - case when c.is_test then interval '0' else settle end
      and now() < pr.filed_marked_at + make_interval(days => filed_days)
      and (target_case is null or pr.case_id = target_case)

    union all

    -- What came of a hearing of the lawsuit, once somebody of the firm said it (0248): the result and what comes next,
    -- in words (`hearing_outcome_words`), never a settlement's value; the setting's minutes after it was said, so a
    -- correction comes first; a new word on it (a correction) is told again.
    select 'hearing_outcome', 'o:' || h.id || ':' || coalesce(h.outcome, rep.result, h.status), 2, h.case_id,
           r.person_id, h.proceeding_id, h.id, null::uuid, null::uuid, h.starts_at,
           said.at + case when c.is_test then interval '0' else settle end, said.at + interval '3 days',
           h.time_zone, false, null::timestamptz,
           array[
             initcap(lower(split_part(btrim(p.full_name), ' ', 1))), firm, public.notice_hearing_words(h.kind),
             public.cnj_formatted(pr.cnj), public.hearing_outcome_words(h.id)
           ]
    from public.hearings h
    join public.proceedings pr on pr.id = h.proceeding_id
    join public.cases c on c.id = h.case_id and c.status not in ('closed', 'declined')
    left join lateral (
      select rp.result from public.hearing_reports rp where rp.hearing_id = h.id order by rp.created_at desc limit 1
    ) rep on true
    cross join lateral (
      select max(e.at) as at from public.case_events e
      where e.case_id = h.case_id and e.kind in ('hearing_held', 'hearing_reported') and e.data ->> 'hearing' = h.id::text
    ) said
    cross join lateral public.notice_recipients(pr.id) r
    join public.people p on p.id = r.person_id
    where h.org_id = target_org and pr.cnj is not null and said.at is not null
      and (h.status = 'held' or (h.status = 'scheduled' and rep.result = 'nao_realizada'))
      and public.hearing_outcome_words(h.id) is not null
      and said.at <= now() - case when c.is_test then interval '0' else settle end
      and now() < said.at + interval '3 days'
      and (target_case is null or h.case_id = target_case)
  )
  select d.kind, d.occurrence, d.priority, d.case_id, d.person_id, person.phone, d.proceeding_id, d.hearing_id,
         d.publication_id, d.document_id, d.about_at, d.opens, d.closes, d.zone, d.early, d.since,
         array(select public.notice_value(value) from unnest(d.params) as value),
         prior.id, prior.attempts,
         coalesce(route.blocker, public.notice_person_blocker(target_org, d.person_id))
  from due d
  join public.people person on person.id = d.person_id
  cross join lateral public.notice_kind_route(target_org, d.kind) route
  left join lateral (
    select n.id, n.attempts, n.reserved_at, m.status as message_status, m.error_code
    from public.client_notices n
    join public.wa_messages m on m.id = n.message_id
    where n.org_id = target_org and n.person_id = d.person_id and n.kind = d.kind and n.occurrence = d.occurrence
  ) prior on true
  where (
      prior.id is null
      or (
        prior.message_status = 'failed' and public.notice_retryable(prior.error_code) and prior.attempts < tries
        -- Each try waits twice as long as the one before: a cause that lasts hours does not spend them all.
        and prior.reserved_at <= now() - make_interval(mins => (retry_wait * power(2, prior.attempts - 1))::integer)
      )
    )
    and not public.notice_already_told(target_org, d.kind, d.occurrence, d.person_id, person.phone, d.hearing_id,
      d.proceeding_id, d.about_at, d.opens, d.since);
end;
$$;

revoke all on function public.notice_candidates(uuid, uuid) from public, anon, authenticated;
