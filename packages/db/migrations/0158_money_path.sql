-- ============================================================
-- 0158 · O caminho do dinheiro: na conta do escritório, por padrão
--
-- The owner's decision of 2026-11-10, replacing the plan's of 2026-11-07
-- (which made the court paying the client straight the default wherever the
-- court accepts it): the money a court releases goes to the firm's account
-- by default, and the firm passes the client's part on; the court paying
-- the client directly, the fees set apart to the firm (Estatuto, art. 22,
-- § 4º), is the second way, taken only where the firm, or the case, chose
-- it and the court accepts it.
--
-- `court_payment_paths.direct` says only that the court accepts paying the
-- client directly; it no longer chooses the way by itself. The firm says its
-- way (`organizations.money_path`, `firm` by default) and a case may say
-- another (`cases.money_path`); a release takes `direct` only when the way
-- chosen is direct and its court accepts it.
--
--   set_money_path        who configures the books says the firm's way;
--   set_case_money_path   who operates the books says a case's way;
--   case_money_path       what the case's card reads: the way chosen,
--                         whose, and whether its court accepts the direct one.
-- ============================================================

comment on column public.court_payment_paths.direct is
  'The court accepts paying the client''s part straight to them, the fees set apart to the firm (0158: it no longer chooses the way by itself).';

alter table public.organizations add column money_path text not null default 'firm';
alter table public.organizations add constraint organizations_money_path_check check (money_path in ('firm', 'direct'));
alter table public.cases add column money_path text;
alter table public.cases add constraint cases_money_path_check check (money_path is null or money_path in ('firm', 'direct'));

/**
 * A release the firm registered as received owes its split (0135, redefined): by the way the case or the firm chose,
 * the court's direct one only where the court accepts it; the firm's account otherwise. Once per release.
 */
create or replace function public.lawsuit_facts_money_release()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  court_of text;
  accepts boolean;
  chosen text;
begin
  if new.kind <> 'alvara' or new.received_on is null or old.received_on is not null or coalesce(new.received_cents, 0) <= 0
     or new.corrected_at is not null then
    return new;
  end if;
  select p.court into court_of from public.proceedings p where p.id = new.proceeding_id;
  select c.direct into accepts from public.court_payment_paths c where c.court = court_of;
  select coalesce(k.money_path, o.money_path, 'firm') into chosen
  from public.cases k join public.organizations o on o.id = k.org_id where k.id = new.case_id;
  insert into public.money_releases (org_id, case_id, proceeding_id, fact_id, path, received_cents, received_on)
  values (new.org_id, new.case_id, new.proceeding_id, new.id,
    case when chosen = 'direct' and coalesce(accepts, false) then 'direct' else 'firm' end,
    new.received_cents, new.received_on)
  on conflict (fact_id) do nothing;
  return new;
end;
$$;

revoke all on function public.lawsuit_facts_money_release() from public, anon, authenticated;

/** Who configures the books says the firm's way of receiving released money (the second factor, on the record). */
create or replace function public.set_money_path(target_org uuid, target_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'configure', false);
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if target_path is null or target_path not in ('firm', 'direct') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'path');
  end if;
  update public.organizations set money_path = target_path where id = target_org;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'money.path_set', 'firm', target_org::text, jsonb_build_object('path', target_path));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_money_path(uuid, text) from public, anon;
grant execute on function public.set_money_path(uuid, text) to authenticated;

/**
 * Who operates the books says a case's way (the second factor, on the record): `direct`, `firm`, or none to follow
 * the firm's. A release already registered keeps the way it took.
 */
create or replace function public.set_case_money_path(target_case uuid, target_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  refusal text;
begin
  select * into current_case from public.cases where id = target_case;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  refusal := public.finance_write_refusal(current_case.org_id, 'operate', false);
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if target_path is not null and target_path not in ('firm', 'direct') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'path');
  end if;
  update public.cases set money_path = target_path where id = current_case.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'money.case_path_set', 'case', current_case.id::text,
    jsonb_build_object('path', target_path));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_case_money_path(uuid, text) from public, anon;
grant execute on function public.set_case_money_path(uuid, text) to authenticated;

/**
 * The way a case's released money takes, for who reads the books: the case's own choice or the firm's, and whether the
 * court of its lawsuits accepts paying the client directly (`accepts`: null when no court of it is on record).
 */
create or replace function public.case_money_path(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
begin
  select * into current_case from public.cases where id = target_case;
  if not found or auth.uid() is null or not public.is_org_member(current_case.org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.finance_reads(current_case.org_id) then
    return null;
  end if;
  return jsonb_build_object(
    'case', current_case.money_path,
    'firm', (select o.money_path from public.organizations o where o.id = current_case.org_id),
    'accepts', (select bool_and(coalesce(c.direct, false)) from public.proceedings p
                left join public.court_payment_paths c on c.court = p.court
                where p.case_id = current_case.id and p.court is not null)
  );
end;
$$;

revoke all on function public.case_money_path(uuid) from public, anon;
grant execute on function public.case_money_path(uuid) to authenticated;
