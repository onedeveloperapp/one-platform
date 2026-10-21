-- ============================================================
-- 0039_case_advance: ONE carries a case from one step to the next by
-- itself, where its firm lets it (0016, `autonomy_decisions` and
-- `firm_autonomy`: the owner's decision of 2026-10-14, automation first).
--
--   create_lawsuits   once a case that never had lawsuits has what they
--                     need (each person's data, the documents the setting
--                     names, the trip, what each claimant asks, no document
--                     waiting for the firm), the lawsuits the rules plan,
--                     each signed by the firm's signers registered at the bar
--                     in its state;
--   start_piece       the first text of a lawsuit's piece, asked of the AI
--                     from the firm's model of its kind, naming the firm's
--                     signers first when nobody ever signed it;
--   request_package   the filing package of a lawsuit whose piece became its
--                     petition, with the documents the firm accepted of its
--                     claimants (and of who answers for them) and of the
--                     case, when the case has what it needs, the lawsuit
--                     names its court's system (ONE names the one the
--                     platform confirmed), nothing blocks its filing and the
--                     firm did not hold the case.
--
--   firm_signers    the lawyers a partner named to sign what ONE prepares;
--                   ONE names, for a lawsuit, those registered at the bar in
--                   its court's state;
--   case_advances   the backend's own record of each case: when to look at it
--                   again, the claim of the worker that looks at it, its
--                   failed tries, whether the case ever had lawsuits, and
--                   what ONE waits for to go on (`waiting`, which the case
--                   screen shows);
--   proceeding_signers_seen  the lawsuits that ever had somebody to sign them.
--
-- The work is the backend's (`one-case-advance`): it claims a case under a
-- number, does what is due under the case's own lock and records what it
-- waits for. ONE writes through the very functions a person writes through
-- (`case_for_writer` lets the backend's own functions in,
-- `case_system_writer`, 0022), so every check of a lawsuit, a piece and a
-- package is made for ONE as for anybody, and the timeline says it was ONE.
-- What a person did is never undone: lawsuits a person removed are not made
-- again, a piece a person turned down or gave up is not asked again, signers
-- a person took off are not named again, a package a person cancelled is not
-- asked again and one that failed waits for a person, and a petition the
-- firm added by hand keeps ONE from asking for a piece of that case.
-- ============================================================

insert into public.autonomy_decisions (key, position, modes) values
  ('create_lawsuits', 60, array['auto', 'approval']),
  ('start_piece', 70, array['auto', 'approval']),
  ('request_package', 80, array['auto', 'approval'])
on conflict (key) do nothing;

insert into public.platform_settings (key, value, is_public) values
  ('case_advance', jsonb_build_object(
    -- How long a case ONE could not carry on waits before it is looked at again by the sweep (what the database
    -- watches wakes it at once).
    'wait_minutes', 360,
    -- After a failure of the moment, the first wait; each failure after it waits twice as long, to the wait above.
    'retry_minutes', 15,
    -- After this many failures in a row, ONE says it needs a person (and still looks again after the long wait).
    'max_attempts', 4,
    -- A claim older than this is of a worker that stopped.
    'stale_minutes', 15,
    -- How many cases one claim looks at, at most.
    'scan', 200,
    -- The kinds of document that go to the court with the petition: a person's own papers only when they are of
    -- somebody of the lawsuit; the papers of the trip also when they are of nobody in particular. Never the
    -- firm's contract with its client, nor what nobody said what it is.
    'package_kinds', jsonb_build_object(
      'person', jsonb_build_array('identity', 'address_proof', 'power_of_attorney'),
      'case', jsonb_build_array('ticket', 'boarding_pass', 'receipt', 'evidence')
    )
  ), false)
on conflict (key) do nothing;

/** A whole number of the setting `case_advance` (a fraction is taken down), or the fallback. */
create or replace function public.case_advance_setting(setting text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when jsonb_typeof(s.value -> setting) = 'number'
                 then least(greatest(floor((s.value ->> setting)::numeric), -2147483648), 2147483647)::integer end
     from public.platform_settings s where s.key = 'case_advance'),
    fallback
  );
$$;

revoke all on function public.case_advance_setting(text, integer) from public, anon, authenticated;

/** The kinds of document of a scope (`person` or `case`) that go with a petition, as the setting names them. */
create or replace function public.case_advance_kinds(scope text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select array(select jsonb_array_elements_text(s.value #> array['package_kinds', scope]))
     from public.platform_settings s
     where s.key = 'case_advance' and jsonb_typeof(s.value #> array['package_kinds', scope]) = 'array'),
    case scope
      when 'person' then array['identity', 'address_proof', 'power_of_attorney']
      else array['ticket', 'boarding_pass', 'receipt', 'evidence']
    end
  );
$$;

revoke all on function public.case_advance_kinds(text) from public, anon, authenticated;

-- ---------- The backend's record of each case ----------

create table public.case_advances (
  case_id uuid primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Not looked at by the sweep before this ('infinity' for a case that ended or is with the court).
  after timestamptz,
  claimed_at timestamptz,
  claims integer not null default 0,
  -- Failed looks in a row (a failure of the moment), set back by a look that went through.
  attempts integer not null default 0,
  -- What ONE waits for to go on, as a code the screen has words for; null when it waits for nothing of the firm.
  waiting text,
  checked_at timestamptz,
  -- Something ONE reads of the case changed (`wake_case_advance`): looked at again at the next sweep, also when
  -- it changed while a worker was looking.
  woken_at timestamptz,
  -- When the case first had a lawsuit (by anybody): ONE creates the lawsuits only of a case that never had one,
  -- so lawsuits a person removed are never made again.
  lawsuits_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  constraint case_advances_waiting_check check (waiting is null or waiting ~ '^[a-z][a-z_]{2,40}$'),
  constraint case_advances_attempts_check check (attempts >= 0)
);

-- The sweep reads the cases whose wait is over, the longest first; one set aside for good is past every now.
create index case_advances_due_idx on public.case_advances ((coalesce(after, created_at)), case_id);
create index case_advances_waiting_idx on public.case_advances (org_id, waiting) where waiting is not null;

alter table public.case_advances enable row level security;
create policy "case_advances_select_member" on public.case_advances
  for select to authenticated using (public.is_org_member(org_id));
-- What ONE waits for in a case, and when it last looked, is the firm's to read; the claim is the backend's.
grant select (case_id, org_id, waiting, checked_at) on table public.case_advances to authenticated;
create trigger guard_impersonation_case_advances after insert or update or delete on public.case_advances
  for each statement execute function public.guard_impersonation_readonly();

insert into public.case_advances (case_id, org_id, created_at)
select k.id, k.org_id, k.created_at from public.cases k
on conflict (case_id) do nothing;

-- A case that ended, or is with the court, has nothing for ONE to carry on: the sweep never reads it.
update public.case_advances a set after = 'infinity'
from public.cases k
where k.id = a.case_id and k.status in ('filed', 'closed', 'declined');

-- A case that had lawsuits had them.
update public.case_advances a set lawsuits_at = now()
where exists (select 1 from public.proceedings p where p.case_id = a.case_id);

-- The lawsuits that ever had somebody to sign them (by anybody): ONE names signers only of one that never had any,
-- so signers a person took off are never named again. A table of its own, so ONE marks a lawsuit it names signers of
-- without holding the record of its case. The backend's: no member reads it.
create table public.proceeding_signers_seen (
  proceeding_id uuid primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  seen_at timestamptz not null default now(),
  foreign key (proceeding_id, org_id) references public.proceedings (id, org_id) on delete cascade
);

alter table public.proceeding_signers_seen enable row level security;
create trigger guard_impersonation_proceeding_signers_seen after insert or update or delete
  on public.proceeding_signers_seen for each statement execute function public.guard_impersonation_readonly();

insert into public.proceeding_signers_seen (proceeding_id, org_id)
select distinct pl.proceeding_id, pl.org_id from public.proceeding_lawyers pl
on conflict (proceeding_id) do nothing;

/** Every case has its record; one that ended, or is with the court, is set aside for good, and one reopened comes back. */
create or replace function public.cases_track_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.case_advances (case_id, org_id, after)
    values (new.id, new.org_id, case when new.status in ('filed', 'closed', 'declined') then 'infinity'::timestamptz end)
    on conflict (case_id) do nothing;
  elsif (new.status in ('filed', 'closed', 'declined')) is distinct from (old.status in ('filed', 'closed', 'declined')) then
    update public.case_advances
    set after = case when new.status in ('filed', 'closed', 'declined') then 'infinity'::timestamptz end,
        woken_at = clock_timestamp(),
        waiting = null
    where case_id = new.id;
  end if;
  return null;
end;
$$;

revoke all on function public.cases_track_advance() from public, anon, authenticated;

create trigger cases_track_advance after insert or update of status on public.cases
  for each row execute function public.cases_track_advance();

/**
 * Something ONE reads of a case changed: the sweep looks at it again at its
 * next pass, whatever it was waiting for (a case set aside for good, which
 * ended or is with the court, stays so). What ONE itself writes while it
 * looks at the case wakes nothing: the record of its look says when to look
 * again, and ONE holds no record of a case while it writes to it.
 */
create or replace function public.wake_case_advance(target_case uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.case_advances
  set after = null, woken_at = clock_timestamp()
  where case_id = target_case and after is distinct from 'infinity'::timestamptz
    and not public.case_system_writer(target_case)
    -- Nothing of a case being removed: its record goes with it.
    and exists (select 1 from public.cases k where k.id = target_case);
$$;

revoke all on function public.wake_case_advance(uuid) from public, anon, authenticated;

/**
 * Something of a firm changed that a lawsuit's next step may have waited
 * for: who signs (`signer`: a registration at the bar, a person's work in
 * the firm, a signer named) or the model ONE writes from (`piece`). The
 * firm's cases that wait for something and have a planned lawsuit with no
 * signer, or with no piece, are looked at again (a case says only the first
 * thing it waits for, and another of its lawsuits may wait for this one),
 * taken in the order of their ids so two such changes never wait for each
 * other.
 */
create or replace function public.wake_firm_advance(target_org uuid, target_need text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.case_advances a
  set after = null, woken_at = clock_timestamp()
  where a.case_id in (
    select b.case_id from public.case_advances b
    where b.org_id = target_org and b.waiting is not null and b.after is distinct from 'infinity'::timestamptz
      and exists (
        select 1 from public.proceedings p
        where p.case_id = b.case_id and p.status = 'planned'
          and case target_need
            when 'signer' then not exists (select 1 from public.proceeding_lawyers pl where pl.proceeding_id = p.id)
            else not exists (select 1 from public.case_drafts d where d.proceeding_id = p.id)
          end
      )
    order by b.case_id
    for update
  );
$$;

revoke all on function public.wake_firm_advance(uuid, text) from public, anon, authenticated;

/** The trigger behind every change ONE reads of a case: the row's own `case_id`. */
create or replace function public.case_row_wakes_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.wake_case_advance(new.case_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and (tg_op = 'DELETE' or old.case_id is distinct from new.case_id) then
    perform public.wake_case_advance(old.case_id);
  end if;
  return null;
end;
$$;

revoke all on function public.case_row_wakes_advance() from public, anon, authenticated;

-- What creating the lawsuits reads: the documents and their decisions, what each claimant asks and who is in the
-- case, the legs of the trip. What the piece and the package read: the lawsuits, who signs them, their pieces and
-- packages, and the client's word on the civil court.
create trigger case_documents_wake_advance after insert or update of status, kind, party_id or delete
  on public.case_documents for each row execute function public.case_row_wakes_advance();
create trigger case_parties_wake_advance after insert or update of claim_cents, role, guardian_id or delete
  on public.case_parties for each row execute function public.case_row_wakes_advance();
create trigger flight_segments_wake_advance after insert or delete
  on public.flight_segments for each row execute function public.case_row_wakes_advance();
create trigger proceedings_wake_advance after insert or update of status, court, system, kind or delete
  on public.proceedings for each row execute function public.case_row_wakes_advance();
create trigger case_drafts_wake_advance after insert or update of status, document_id
  on public.case_drafts for each row execute function public.case_row_wakes_advance();
create trigger filing_packages_wake_advance after update of status
  on public.filing_packages for each row execute function public.case_row_wakes_advance();
create trigger civil_court_answers_wake_advance after insert
  on public.civil_court_answers for each row execute function public.case_row_wakes_advance();

/** A case had a lawsuit: ONE never creates its lawsuits again, whoever removes them later. */
create or replace function public.proceedings_mark_case_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.case_advances set lawsuits_at = coalesce(lawsuits_at, now()) where case_id = new.case_id;
  return null;
end;
$$;

revoke all on function public.proceedings_mark_case_advance() from public, anon, authenticated;

create trigger proceedings_mark_case_advance after insert on public.proceedings
  for each row execute function public.proceedings_mark_case_advance();

/**
 * A person's data changed: the cases they are in are looked at again, in the
 * order of their ids. (A person added to a case wakes their other cases here
 * and the new one by its party after: two such writes at once on the same
 * cases may be refused by the database as a deadlock, and are tried again by
 * the person.)
 */
create or replace function public.people_wake_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  touched uuid;
begin
  for touched in
    select distinct cp.case_id from public.case_parties cp where cp.person_id = new.id order by cp.case_id
  loop
    perform public.wake_case_advance(touched);
  end loop;
  return null;
end;
$$;

revoke all on function public.people_wake_advance() from public, anon, authenticated;

create trigger people_wake_advance after update on public.people
  for each row execute function public.people_wake_advance();

/** Who signs a lawsuit changed: its case is looked at again, and a lawsuit signed is marked as one that had signers. */
create or replace function public.proceeding_lawyers_wake_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit_case uuid := (
    select p.case_id from public.proceedings p where p.id = coalesce(new.proceeding_id, old.proceeding_id)
  );
begin
  if lawsuit_case is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into public.proceeding_signers_seen (proceeding_id, org_id) values (new.proceeding_id, new.org_id)
    on conflict (proceeding_id) do nothing;
  end if;
  perform public.wake_case_advance(lawsuit_case);
  return null;
end;
$$;

revoke all on function public.proceeding_lawyers_wake_advance() from public, anon, authenticated;

create trigger proceeding_lawyers_wake_advance after insert or delete on public.proceeding_lawyers
  for each row execute function public.proceeding_lawyers_wake_advance();

/** The firm's decision on the Tema 1.417, or how the family goes to court, changed. */
create or replace function public.cases_wake_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.wake_case_advance(new.id);
  return null;
end;
$$;

revoke all on function public.cases_wake_advance() from public, anon, authenticated;

create trigger cases_wake_advance after update of suspension_decision, family_choice on public.cases
  for each row execute function public.cases_wake_advance();

/**
 * The firm changed what ONE decides alone: its cases are looked at again,
 * and what the screen said ONE waited for is forgotten until ONE says it
 * again under the firm's new choice.
 */
create or replace function public.firm_autonomy_wakes_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.decision in ('create_lawsuits', 'start_piece', 'request_package', 'file_or_hold') then
    update public.case_advances a
    set after = null, woken_at = clock_timestamp(), waiting = null
    where a.case_id in (
      select b.case_id from public.case_advances b
      where b.org_id = new.org_id and b.after is distinct from 'infinity'::timestamptz
      order by b.case_id
      for update
    );
  end if;
  return null;
end;
$$;

revoke all on function public.firm_autonomy_wakes_advance() from public, anon, authenticated;

create trigger firm_autonomy_wakes_advance after insert or update of mode on public.firm_autonomy
  for each row execute function public.firm_autonomy_wakes_advance();

/** A model added, changed or removed may now be, or no longer be, the one ONE writes from. */
create or replace function public.draft_templates_wake_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.wake_firm_advance(coalesce(new.org_id, old.org_id), 'piece');
  return null;
end;
$$;

revoke all on function public.draft_templates_wake_advance() from public, anon, authenticated;

create trigger draft_templates_wake_advance after insert or delete
  on public.draft_templates for each row execute function public.draft_templates_wake_advance();
-- A model saved as it was (its text, its name) changes nothing ONE reads.
create trigger draft_templates_wake_advance_changed after update of is_default, proceeding_kind
  on public.draft_templates for each row
  when (old.is_default is distinct from new.is_default or old.proceeding_kind is distinct from new.proceeding_kind)
  execute function public.draft_templates_wake_advance();

/** A minimum wage on record may be what the ceiling of the small-claims court waited for. */
create or replace function public.minimum_wages_wake_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.case_advances a
  set after = null, woken_at = clock_timestamp()
  where a.case_id in (
    select b.case_id from public.case_advances b
    where b.waiting = 'ceiling_unknown' and b.after is distinct from 'infinity'::timestamptz
    order by b.case_id
    for update
  );
  return null;
end;
$$;

revoke all on function public.minimum_wages_wake_advance() from public, anon, authenticated;

create trigger minimum_wages_wake_advance after insert or update on public.minimum_wages
  for each statement execute function public.minimum_wages_wake_advance();

/** A court's system the platform confirmed may be what a lawsuit of that court waited for. */
create or replace function public.court_systems_wake_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.confirmed then
    update public.case_advances a
    set after = null, woken_at = clock_timestamp()
    where a.case_id in (
      select b.case_id from public.case_advances b
      where b.waiting is not null and b.after is distinct from 'infinity'::timestamptz
        and exists (
          select 1 from public.proceedings p
          where p.case_id = b.case_id and p.status = 'planned' and p.court = new.court and p.kind = new.proceeding_kind
            and p.system is null
        )
      order by b.case_id
      for update
    );
  end if;
  return null;
end;
$$;

revoke all on function public.court_systems_wake_advance() from public, anon, authenticated;

create trigger court_systems_wake_advance after insert or update of confirmed, system on public.court_systems
  for each row execute function public.court_systems_wake_advance();

-- ---------- Who signs what ONE prepares ----------

create table public.firm_signers (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (org_id, user_id),
  -- Who leaves the firm stops signing for it.
  foreign key (org_id, user_id) references public.memberships (org_id, user_id) on delete cascade
);

alter table public.firm_signers enable row level security;
create policy "firm_signers_select_member" on public.firm_signers
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.firm_signers to authenticated;
create trigger guard_impersonation_firm_signers after insert or update or delete on public.firm_signers
  for each statement execute function public.guard_impersonation_readonly();

/**
 * A partner names a partner or a lawyer of the firm to sign what ONE
 * prepares, or stops naming them. With the second factor, never a support
 * visit, on the record. The cases that waited for somebody to sign are looked
 * at again.
 */
create or replace function public.set_firm_signer(target_org uuid, target_user uuid, target_signs boolean)
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
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.has_firm_function(target_org, array['socio']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_a_partner');
  end if;
  if target_signs is null or target_user is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  if target_signs and not exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = target_user and m.firm_function in ('socio', 'advogado')
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_a_lawyer');
  end if;
  perform public.require_aal2();
  if target_signs then
    insert into public.firm_signers (org_id, user_id, added_by) values (target_org, target_user, auth.uid())
    on conflict (org_id, user_id) do nothing;
  else
    delete from public.firm_signers where org_id = target_org and user_id = target_user;
  end if;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'firm.signer_set', 'profile', target_user::text,
    jsonb_build_object('signs', target_signs));
  if target_signs then
    perform public.wake_firm_advance(target_org, 'signer');
  end if;
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_firm_signer(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_firm_signer(uuid, uuid, boolean) to authenticated;

/**
 * Who ONE names to sign a lawsuit in a state: the firm's signers who are
 * still its partners or lawyers and hold a registration at the bar there
 * (principal or supplementary), in the order they were named.
 */
create or replace function public.firm_signers_for(target_org uuid, target_uf text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(s.user_id order by s.added_at, s.user_id), '{}'::uuid[])
  from public.firm_signers s
  join public.memberships m on m.org_id = s.org_id and m.user_id = s.user_id
  where s.org_id = target_org and m.firm_function in ('socio', 'advogado')
    and exists (select 1 from public.oab_registrations r where r.user_id = s.user_id and r.uf = target_uf);
$$;

revoke all on function public.firm_signers_for(uuid, text) from public, anon, authenticated;

/**
 * A person's work in the firm changed: who is no longer a partner or a
 * lawyer stops signing what ONE prepares (named again by a partner, if ever),
 * and the firm's cases that waited for a signer are looked at again.
 */
create or replace function public.memberships_track_signers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.firm_function not in ('socio', 'advogado') then
    delete from public.firm_signers where org_id = new.org_id and user_id = new.user_id;
  end if;
  perform public.wake_firm_advance(new.org_id, 'signer');
  return null;
end;
$$;

revoke all on function public.memberships_track_signers() from public, anon, authenticated;

create trigger memberships_track_signers after update of firm_function on public.memberships
  for each row when (old.firm_function is distinct from new.firm_function)
  execute function public.memberships_track_signers();

/** A registration at the bar added, changed or removed may be what a lawsuit in that state waited for to be signed. */
create or replace function public.oab_registrations_wake_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  firm uuid;
begin
  for firm in
    select m.org_id from public.memberships m where m.user_id = coalesce(new.user_id, old.user_id) order by m.org_id
  loop
    perform public.wake_firm_advance(firm, 'signer');
  end loop;
  return null;
end;
$$;

revoke all on function public.oab_registrations_wake_advance() from public, anon, authenticated;

create trigger oab_registrations_wake_advance after insert or update of uf or delete on public.oab_registrations
  for each row execute function public.oab_registrations_wake_advance();

-- ---------- The model ONE writes from ----------

/**
 * The model of the firm ONE writes the piece of a lawsuit of a kind from:
 * the default of that kind, else the default of both kinds, else the only
 * model that serves the kind. Null when there is none, or more than one and
 * no default.
 */
create or replace function public.draft_template_for(target_org uuid, target_kind text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select t.id from public.draft_templates t
     where t.org_id = target_org and t.is_default and t.proceeding_kind = target_kind),
    (select t.id from public.draft_templates t
     where t.org_id = target_org and t.is_default and t.proceeding_kind is null),
    (select (array_agg(t.id))[1] from public.draft_templates t
     where t.org_id = target_org and (t.proceeding_kind = target_kind or t.proceeding_kind is null)
     having count(*) = 1)
  );
$$;

revoke all on function public.draft_template_for(uuid, text) from public, anon, authenticated;

-- ---------- What is due ----------

/**
 * Whether a paper of a case waits for the firm's word: one received, or one
 * a client is still sending (its file only reserved). A file kept whose
 * document never left `uploading` is no paper anybody can decide, and holds
 * nothing back.
 */
create or replace function public.case_papers_waiting(target_case uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.case_documents d
    join public.files f on f.id = d.file_id
    where d.case_id = target_case
      and (d.status = 'received' or (d.status = 'uploading' and f.status = 'reserved'))
  );
$$;

revoke all on function public.case_papers_waiting(uuid) from public, anon, authenticated;

/**
 * Whether the firm added a petition of its own to a case: one received or
 * accepted that is no piece a draft became (those are kept under the
 * purpose `petition`, also after their lawsuit is removed).
 */
create or replace function public.case_hand_petition(target_case uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.case_documents cd
    join public.files f on f.id = cd.file_id
    where cd.case_id = target_case and cd.kind = 'petition' and cd.status in ('received', 'accepted')
      and f.purpose <> 'petition'
  );
$$;

revoke all on function public.case_hand_petition(uuid) from public, anon, authenticated;

/**
 * Whether ONE may look at creating the lawsuits of a case: the firm lets it,
 * the case goes on and never had a lawsuit, and the cheap signs that it has
 * what they need are there (a claimant, each claimant's CPF and birth date,
 * a leg of the trip, no document waiting for the firm). The app checks the
 * rest (every field, the documents the setting names, what each claimant
 * asks) with the same rules the case screen shows.
 */
create or replace function public.case_advance_lawsuits_due(target_case uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.cases k
    join public.case_advances a on a.case_id = k.id
    where k.id = target_case and k.status not in ('filed', 'closed', 'declined')
      and a.lawsuits_at is null
      and public.firm_autonomy_mode(k.org_id, 'create_lawsuits') = 'auto'
      and not exists (select 1 from public.proceedings p where p.case_id = k.id)
      and exists (select 1 from public.case_parties cp where cp.case_id = k.id and cp.role = 'claimant')
      and not exists (
        select 1 from public.case_parties cp
        join public.people p on p.id = cp.person_id
        where cp.case_id = k.id and cp.role = 'claimant' and (p.cpf is null or p.birth_date is null)
      )
      and exists (select 1 from public.flight_segments s where s.case_id = k.id)
      and not public.case_papers_waiting(k.id)
  );
$$;

revoke all on function public.case_advance_lawsuits_due(uuid) from public, anon, authenticated;

/**
 * Whether ONE may ask for the piece of a lawsuit: nobody asked for one yet
 * (a piece a person turned down or gave up is never asked again), and the
 * firm added no petition of its own to the case.
 */
create or replace function public.advance_piece_due(target_proceeding uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.case_drafts d where d.proceeding_id = target_proceeding)
    and not public.case_hand_petition((select p.case_id from public.proceedings p where p.id = target_proceeding));
$$;

revoke all on function public.advance_piece_due(uuid) from public, anon, authenticated;

/** The petition a lawsuit's piece became last, while the firm keeps it accepted; null otherwise. */
create or replace function public.advance_petition(target_proceeding uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cd.id from public.case_drafts d
  join public.case_documents cd on cd.id = d.document_id
  where d.proceeding_id = target_proceeding and d.status = 'issued' and cd.status = 'accepted' and cd.kind = 'petition'
  order by cd.created_at desc, cd.id
  limit 1;
$$;

revoke all on function public.advance_petition(uuid) from public, anon, authenticated;

/**
 * Whether ONE may ask for the filing package of a lawsuit: its piece became
 * its petition, no package of it is in course, ready, failed (that one waits
 * for a person) or filed, a person never cancelled one of it, and the firm
 * added no petition of its own to the case (that one is the firm's to file).
 */
create or replace function public.advance_package_due(target_proceeding uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.advance_petition(target_proceeding) is not null
    and not exists (
      select 1 from public.filing_packages f
      where f.proceeding_id = target_proceeding
        and (f.status in ('requested', 'ready', 'failed', 'filed') or f.cancelled_by_person)
    )
    and not public.case_hand_petition((select p.case_id from public.proceedings p where p.id = target_proceeding));
$$;

revoke all on function public.advance_package_due(uuid) from public, anon, authenticated;

/** Whether ONE may ask for a filing package of a lawsuit of a case, where the firm lets it. */
create or replace function public.case_advance_package_due(target_case uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.proceedings p
    join public.cases k on k.id = p.case_id
    where p.case_id = target_case and p.status = 'planned' and k.status not in ('filed', 'closed', 'declined')
      and public.firm_autonomy_mode(k.org_id, 'request_package') = 'auto' and public.advance_package_due(p.id)
  );
$$;

revoke all on function public.case_advance_package_due(uuid) from public, anon, authenticated;

/** Whether ONE may do something for a lawsuit of a case: its piece, or its package, where the firm lets it. */
create or replace function public.case_advance_steps_due(target_case uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.case_advance_package_due(target_case) or exists (
    select 1 from public.proceedings p
    join public.cases k on k.id = p.case_id
    where p.case_id = target_case and p.status = 'planned' and k.status not in ('filed', 'closed', 'declined')
      and public.firm_autonomy_mode(k.org_id, 'start_piece') = 'auto' and public.advance_piece_due(p.id)
  );
$$;

revoke all on function public.case_advance_steps_due(uuid) from public, anon, authenticated;

-- ---------- The worker ----------

/**
 * Claims the cases ONE may carry on now, under a number each, the one that
 * waits the longest first: one named (`target_case`, what the app tells of)
 * whatever its wait, the others once their wait is over. Each case is locked
 * on its own as it is looked at, and one with nothing for ONE to do is set
 * aside for the setting's wait, and what it waited for is forgotten (nothing
 * for ONE to do is nothing to wait for). Answers the cases claimed, each
 * with whether creating its lawsuits or asking for a package is what to
 * look at, and how many were set aside (more may be due behind them).
 * Service role only.
 */
create or replace function public.claim_case_advances(target_limit integer default 10, target_case uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stale integer := greatest(public.case_advance_setting('stale_minutes', 15), 1);
  wait integer := greatest(public.case_advance_setting('wait_minutes', 360), 1);
  scan integer := least(greatest(public.case_advance_setting('scan', 200), 1), 2000);
  wanted integer := greatest(least(coalesce(target_limit, 10), 50), 1);
  claimed jsonb := '[]'::jsonb;
  parked integer := 0;
  candidate uuid;
  lawsuits boolean;
  package boolean;
  claims_now integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  for candidate in
    select a.case_id from public.case_advances a
    where (target_case is null or a.case_id = target_case)
      and (target_case is not null or coalesce(a.after, a.created_at) <= now())
      and (a.claimed_at is null or a.claimed_at < now() - make_interval(mins => stale))
    order by coalesce(a.after, a.created_at), a.case_id
    limit case when target_case is null then scan else 1 end
  loop
    -- Locked one at a time, and read again under the lock: another worker may have taken it meanwhile.
    perform 1 from public.case_advances a
    where a.case_id = candidate
      and (target_case is not null or coalesce(a.after, a.created_at) <= now())
      and (a.claimed_at is null or a.claimed_at < now() - make_interval(mins => stale))
    for update skip locked;
    if not found then
      continue;
    end if;
    lawsuits := public.case_advance_lawsuits_due(candidate);
    package := public.case_advance_package_due(candidate);
    if lawsuits or package or public.case_advance_steps_due(candidate) then
      update public.case_advances a set claimed_at = clock_timestamp(), claims = a.claims + 1
      where a.case_id = candidate
      returning a.claims into claims_now;
      claimed := claimed || jsonb_build_array(jsonb_build_object(
        'case_id', candidate, 'claim', claims_now, 'lawsuits_due', lawsuits, 'package_due', package));
      exit when jsonb_array_length(claimed) >= wanted;
    else
      -- A case set aside for good (it ended, or is with the court) stays so.
      update public.case_advances a
      set after = greatest(coalesce(a.after, '-infinity'::timestamptz), now() + make_interval(mins => wait)),
          waiting = null, checked_at = now(), claimed_at = null, attempts = 0
      where a.case_id = candidate;
      parked := parked + 1;
    end if;
  end loop;
  return jsonb_build_object('claimed', claimed, 'parked', parked);
end;
$$;

revoke all on function public.claim_case_advances(integer, uuid) from public, anon, authenticated;

/** The case a worker holds under `target_claim`, or nothing. */
create or replace function public.case_advance_held(target_case uuid, target_claim integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.case_advances a
    where a.case_id = target_case and a.claimed_at is not null and a.claims = target_claim
  );
$$;

revoke all on function public.case_advance_held(uuid, integer) from public, anon, authenticated;

/**
 * ONE creates the lawsuits of a case (decision `create_lawsuits`) as the
 * rules plan them (`@flyee/rules/proceedings` and `forum`, run by the
 * worker on what the case holds, as the case screen runs them), each signed
 * by the firm's signers registered in its court's state, through
 * `create_planned_proceedings` and every check of a lawsuit. Everything is
 * decided under the case's own lock: a plan read before something it reads
 * changed is refused (`changed`: the case is looked at again), and so is one
 * that leaves out a claimant of the case or names one twice. A case that was
 * still being gathered is moved to drafting (one waiting for signatures
 * stays where it is). For the worker that holds the claim; service role
 * only.
 */
create or replace function public.advance_create_lawsuits(target_case uuid, target_claim integer, target_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  advance public.case_advances%rowtype;
  planned jsonb;
  signed jsonb := '[]'::jsonb;
  court_uf text;
  signers uuid[];
  unsigned integer := 0;
  answer jsonb;
  stage text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(target_plan) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  perform set_config('one.system_case', target_case::text, true);
  -- The case's lock first: a person's write waits for ONE, or ONE for it, and every check below is made under it.
  current_case := public.case_for_writer(target_case);
  -- Read, never held: a change that lands after this is said by its wake, and the case is looked at again.
  select * into advance from public.case_advances a where a.case_id = target_case;
  if not found or advance.claimed_at is null or advance.claims is distinct from target_claim then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  -- Something the plan was made from changed after the claim: it is made again at the next look.
  if advance.woken_at is not null and advance.woken_at >= advance.claimed_at then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'changed');
  end if;
  if public.firm_autonomy_mode(current_case.org_id, 'create_lawsuits') is distinct from 'auto' then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_auto');
  end if;
  if not public.case_advance_lawsuits_due(target_case) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_due');
  end if;
  -- Every claimant of the case in one lawsuit, once.
  if exists (select 1 from jsonb_array_elements(target_plan) item where jsonb_typeof(item) is distinct from 'object'
             or jsonb_typeof(item -> 'parties') is distinct from 'array')
     or (select coalesce(array_agg(party order by party), '{}') from (
           select jsonb_array_elements_text(item -> 'parties') as party from jsonb_array_elements(target_plan) item
         ) given)
        is distinct from
        (select coalesce(array_agg(cp.id::text order by cp.id::text), '{}') from public.case_parties cp
         where cp.case_id = target_case and cp.role = 'claimant') then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'plan_incomplete');
  end if;
  for planned in select value from jsonb_array_elements(target_plan) loop
    court_uf := (select c.uf from public.courts c where c.acronym = upper(coalesce(planned #>> '{fields,court}', '')));
    signers := case when court_uf is null then '{}'::uuid[] else public.firm_signers_for(current_case.org_id, court_uf) end;
    if cardinality(signers) = 0 then
      unsigned := unsigned + 1;
    end if;
    signed := signed || jsonb_build_array(planned || jsonb_build_object('lawyers', to_jsonb(signers)));
  end loop;

  answer := public.create_planned_proceedings(target_case, signed);
  if coalesce((answer ->> 'ok')::boolean, false) then
    select k.status into stage from public.cases k where k.id = target_case;
    if stage in ('intake', 'documents') then
      update public.cases set status = 'drafting', status_changed_at = now() where id = target_case;
      perform public.record_case_event(current_case.org_id, target_case, 'status_changed', 'system',
        jsonb_build_object('from', stage, 'to', 'drafting'));
    end if;
  end if;
  perform set_config('one.system_case', '', true);
  return answer || jsonb_build_object('unsigned', unsigned);
end;
$$;

revoke all on function public.advance_create_lawsuits(uuid, integer, jsonb) from public, anon, authenticated;

/**
 * ONE does what is due for the lawsuits of a case still planned, where the
 * firm lets it, under the case's own lock and each lawsuit on its own (a step
 * that fails leaves the others as they went):
 *
 *   start_piece      a lawsuit nobody asked a piece for: the firm's signers
 *                    registered in its state are named when nobody ever
 *                    signed it (`proceeding_signers_seen`: signers a person took off
 *                    are not named again, and the piece waits for a person
 *                    to name them), and its first text is asked of the AI
 *                    from the firm's model of its kind (`request_case_draft`);
 *   request_package  a lawsuit whose piece became its petition: when the
 *                    lawsuit names no system and the platform confirmed its
 *                    court's, ONE names it; then its package is asked for
 *                    (`request_filing_package`) with the documents the firm
 *                    accepted (a person's own papers only of somebody of the
 *                    lawsuit or who answers for them, the papers of the trip
 *                    also of nobody in particular, of the kinds the setting
 *                    names), when the case has what it needs with every
 *                    paper accepted (the app says, `target_complete`; with
 *                    no answer, nothing is asked now and the case is looked
 *                    at again), no paper waits for the firm, the firm did
 *                    not hold the case (Tema 1.417; where a person decides
 *                    that, once a person decided to file), and nothing blocks
 *                    its filing.
 *
 * Answers the pieces and packages asked for, and the first thing ONE waits
 * for, as a code the screen has words for. For the worker that holds the
 * claim; service role only.
 */
create or replace function public.advance_case_steps(
  target_case uuid,
  target_claim integer,
  target_complete boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  lawsuit public.proceedings%rowtype;
  piece_mode text;
  package_mode text;
  hold_mode text;
  person_kinds text[] := public.case_advance_kinds('person');
  case_kinds text[] := public.case_advance_kinds('case');
  court_uf text;
  signers uuid[];
  template uuid;
  petition uuid;
  confirmed_system text;
  documents uuid[];
  blocker text;
  answer jsonb;
  drafts jsonb := '[]'::jsonb;
  packages jsonb := '[]'::jsonb;
  waiting text;
  failed boolean := false;
  complete boolean := target_complete;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform set_config('one.system_case', target_case::text, true);
  -- The case's lock first: what is due is read under it, so a person's request made at the same moment is either
  -- seen here or comes after ONE's, and wins.
  current_case := public.case_for_writer(target_case);
  if not public.case_advance_held(target_case, target_claim) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  -- What the app said of the case was read before it changed: no package on it now, and the case is looked at again.
  if exists (
    select 1 from public.case_advances a
    where a.case_id = target_case and a.woken_at is not null and a.woken_at >= a.claimed_at
  ) then
    complete := null;
  end if;
  if current_case.status in ('filed', 'closed', 'declined') then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', true, 'code', 'done', 'drafts', drafts, 'packages', packages);
  end if;
  piece_mode := public.firm_autonomy_mode(current_case.org_id, 'start_piece');
  package_mode := public.firm_autonomy_mode(current_case.org_id, 'request_package');
  hold_mode := public.firm_autonomy_mode(current_case.org_id, 'file_or_hold');

  for lawsuit in
    select * from public.proceedings p
    where p.case_id = target_case and p.status = 'planned'
    order by p.created_at, p.id
  loop
    begin
      -- The piece.
      if piece_mode = 'auto' and public.advance_piece_due(lawsuit.id) then
        court_uf := (select c.uf from public.courts c where c.acronym = lawsuit.court);
        if court_uf is null then
          waiting := coalesce(waiting, 'court_unknown');
        else
          -- Named only of a lawsuit that never had signers: ones a person took off are theirs to put back.
          if not exists (select 1 from public.proceeding_lawyers pl where pl.proceeding_id = lawsuit.id)
             and not exists (select 1 from public.proceeding_signers_seen s where s.proceeding_id = lawsuit.id) then
            signers := public.firm_signers_for(current_case.org_id, court_uf);
            if cardinality(signers) > 0 then
              insert into public.proceeding_lawyers (proceeding_id, user_id, org_id)
              select lawsuit.id, signer, current_case.org_id from unnest(signers) as signer
              on conflict do nothing;
              perform public.record_case_event(current_case.org_id, target_case, 'signers_named', 'system',
                jsonb_build_object('proceeding', lawsuit.id, 'count', cardinality(signers)));
            end if;
          end if;
          template := public.draft_template_for(current_case.org_id, lawsuit.kind);
          if not exists (select 1 from public.proceeding_lawyers pl where pl.proceeding_id = lawsuit.id) then
            -- A person took who signed it off, or nobody of the firm is at the bar in the state.
            if exists (select 1 from public.proceeding_signers_seen s where s.proceeding_id = lawsuit.id) then
              waiting := coalesce(waiting, 'signers_removed');
            else
              waiting := coalesce(waiting, 'no_signer');
            end if;
          elsif template is null then
            waiting := coalesce(waiting, 'no_model');
          else
            begin
              answer := public.request_case_draft(lawsuit.id, template, 'ai');
            exception when sqlstate 'P0001' then
              answer := jsonb_build_object('ok', false, 'code', sqlerrm);
            end;
            if coalesce((answer ->> 'ok')::boolean, false) then
              drafts := drafts || jsonb_build_array(answer ->> 'draft_id');
            else
              waiting := coalesce(waiting, answer ->> 'code');
            end if;
          end if;
        end if;
      end if;

      -- The package.
      if package_mode = 'auto' and public.advance_package_due(lawsuit.id) then
        -- The court's system the platform confirmed, for a lawsuit that names none: a fact of the court.
        if lawsuit.court is not null and lawsuit.system is null then
          select cs.system into confirmed_system from public.court_systems cs
          where cs.court = lawsuit.court and cs.proceeding_kind = lawsuit.kind and cs.confirmed;
          if found then
            update public.proceedings set system = confirmed_system where id = lawsuit.id and system is null;
            lawsuit.system := confirmed_system;
            perform public.record_case_event(current_case.org_id, target_case, 'proceeding_saved', 'system',
              jsonb_build_object('proceeding', lawsuit.id, 'kind', lawsuit.kind, 'status', lawsuit.status,
                'system', confirmed_system));
          end if;
        end if;
        petition := public.advance_petition(lawsuit.id);
        blocker := public.filing_blocker(lawsuit.id);
        if complete is null then
          -- The app did not read the case for a package (it was not due when claimed, or the case changed since):
          -- looked at again soon.
          null;
        elsif public.case_papers_waiting(target_case) then
          waiting := coalesce(waiting, 'documents_waiting');
        elsif not complete then
          waiting := coalesce(waiting, 'case_incomplete');
        elsif lawsuit.court is null then
          waiting := coalesce(waiting, 'court_unknown');
        elsif lawsuit.system is null then
          waiting := coalesce(waiting, 'system_unknown');
        elsif current_case.suspension_decision = 'hold' then
          waiting := coalesce(waiting, 'held');
        elsif hold_mode is distinct from 'auto'
              and (current_case.suspension_decision is distinct from 'file' or current_case.suspension_decided_auto) then
          -- Left to a person: their own decision to file, never one ONE made before the firm said so.
          waiting := coalesce(waiting, 'suspension_pending');
        elsif blocker is not null then
          waiting := coalesce(waiting, blocker);
        else
          documents := array(
            select d.id from public.case_documents d
            left join public.case_parties dp on dp.id = d.party_id
            where d.case_id = target_case and d.status = 'accepted' and d.kind <> 'petition'
              and (d.kind = any (person_kinds) or d.kind = any (case_kinds))
              and (
                (d.party_id is null and d.kind = any (case_kinds))
                or dp.person_id in (
                  select cp.person_id from public.proceeding_parties pp
                  join public.case_parties cp on cp.id = pp.party_id
                  where pp.proceeding_id = lawsuit.id
                  union
                  select gp.person_id from public.proceeding_parties pp
                  join public.case_parties cp on cp.id = pp.party_id
                  join public.case_parties gp on gp.id = cp.guardian_id
                  where pp.proceeding_id = lawsuit.id
                )
              )
            order by d.created_at, d.id
          );
          answer := public.request_filing_package(lawsuit.id, petition, documents);
          if coalesce((answer ->> 'ok')::boolean, false) then
            packages := packages || jsonb_build_array(answer ->> 'package_id');
          else
            waiting := coalesce(waiting, answer ->> 'code');
          end if;
        end if;
      end if;
    exception when others then
      -- What failed of this lawsuit is undone with it, and said; the other lawsuits go on.
      waiting := coalesce(waiting, 'step_failed');
      failed := true;
    end;
  end loop;
  perform set_config('one.system_case', '', true);
  return jsonb_build_object('ok', true, 'code', 'done', 'drafts', drafts, 'packages', packages, 'waiting', waiting,
    'failed', failed);
end;
$$;

revoke all on function public.advance_case_steps(uuid, integer, boolean) from public, anon, authenticated;

/**
 * What came of a worker's look at a case: what ONE waits for to go on (a
 * code, or null when it waits for nothing of the firm), and when the sweep
 * looks at it again. A look that failed for a moment is looked at again
 * sooner, each time twice as late, and after the setting's tries ONE says it
 * needs a person (`stuck`); what it found it waits for before the failure is
 * still said. A case changed while the worker looked is looked at again at
 * once, and one that ended meanwhile stays set aside. Releases the claim.
 * Service role only.
 */
create or replace function public.record_case_advance(
  target_case uuid,
  target_claim integer,
  target_waiting text,
  target_failed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  advance public.case_advances%rowtype;
  code text := nullif(btrim(coalesce(target_waiting, '')), '');
  failed boolean := coalesce(target_failed, false);
  tries integer;
  wait integer := greatest(public.case_advance_setting('wait_minutes', 360), 1);
  retry integer := greatest(public.case_advance_setting('retry_minutes', 15), 1);
  most integer := greatest(public.case_advance_setting('max_attempts', 4), 1);
  next_look timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if code is not null and code !~ '^[a-z][a-z_]{2,40}$' then
    code := 'step_failed';
  end if;
  select * into advance from public.case_advances a
  where a.case_id = target_case and a.claimed_at is not null and a.claims = target_claim
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  tries := case when failed then advance.attempts + 1 else 0 end;
  if failed then
    code := case when tries >= most then 'stuck' else coalesce(code, 'unavailable') end;
  end if;
  next_look := case
    when advance.after = 'infinity'::timestamptz then 'infinity'::timestamptz
    when advance.woken_at is not null and advance.woken_at >= advance.claimed_at then null
    when failed and tries < most
      then now() + make_interval(mins => least(retry::numeric * power(2::numeric, tries - 1), wait::numeric)::integer)
    when code is null then null
    else now() + make_interval(mins => wait)
  end;
  update public.case_advances set
    claimed_at = null,
    checked_at = now(),
    attempts = tries,
    waiting = case when next_look = 'infinity'::timestamptz then null else code end,
    after = next_look
  where case_id = target_case;
  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.record_case_advance(uuid, integer, text, boolean) from public, anon, authenticated;
