-- ============================================================
-- 0304_filing_access_asks: ONE asks a lawyer for their access where a lawsuit of theirs goes to a court's screen they
-- never said how to file at, and the PJe of the TJRJ joins, by the extension alone.
--
-- On 2026-11-25 the owner looked at the test case 19 (a passenger of the city of Rio de Janeiro, so the VI Juizado
-- Especial Cível of the Capital of the TJRJ): its package was ready, and ONE neither filed it from its own browser nor
-- by the extension. Its lawyer had said how they file at the eproc of the TJSP only, the court the firm had worked in;
-- the case went to another one. The owner: "Eu quero que identifique quando for um tribunal diferente do cadastrado
-- e o ONE dentro do próprio caso solicite o acesso ao advogado, dando assim acesso ao ONE para distribuir automático."
-- The case's card already asked it in place (`FilingChoiceDialog`, the owner's test of 2026-11-23), but only to who
-- opened the case, and only at a system the platform had turned a way on at. So:
--
--   * `filing_access_owed` answers each lawyer ONE needs the access of now: a package ready at a court's screen where
--     the firm's way leaves an automated way, no channel of the court (ONE would file by it), nothing filed of it yet,
--     no lawyer of its lawsuit already handing it to ONE there, and this lawyer of it never having said how they file
--     at that system (by hand is a choice: never asked again), still of the firm, and nothing keeping them from filing
--     it on that screen (`filing_screen_blocker`); never one already asked. The limit comes after that, and one
--     package and one lawyer can be asked for (the reservation reads it again);
--   * `reserve_filing_access_ask` keeps the ask once per lawsuit, system and lawyer (`filing_access_asks`), and writes
--     it to the lawyer's WhatsApp as the firm's template of `filing_batch_waits` (0284: "O protocolo do ONE no {{2}}
--     precisa de você: {{3}}. Abra Protocolo no ONE para seguir.", where /protocolo asks it too); what cannot go there
--     is kept as skipped with why, and the bell rings all the same, opening the case with the choice in front;
--   * the PJe of the TJRJ (`tjrj.pje.jus.br/1g`), where the juizados of the Capital take new cases until the eproc
--     comes on 10/12/2026 (the court's schedule, and the OAB-RJ's news of 26/10/2026), joins the systems ONE files on,
--     by the extension alone: the PJe signs every document with the lawyer's certificate (Res. CNJ 185/2013, art. 4º,
--     § 3º, and art. 6º, § 4º, I: login and password sign nothing), and ONE never holds a certificate (CLAUDE.md,
--     Safety), so ONE's own browser could fill but never sign. A system that signs in by certificate never offers ONE's
--     browser (`court_screen_systems_certificate_check`). Its written rules, read on 2026-11-25: the Res. CNJ 185/2013
--     forbids no tool in the lawyer's own session (its art. 29 blocks a use that reduces the system's availability and
--     sends the automation of queries to the MNI), and the TJRJ's Ato Normativo TJ 9/2010 keeps the credentials
--     personal, which the extension keeps (the lawyer signs in and signs themself). The owner accepted the risk in the
--     TJRJ on 2026-11-20.
-- ============================================================

-- ---------- The PJe of the TJRJ, by the extension alone ----------

alter table public.court_screen_systems drop constraint court_screen_systems_login_check;
alter table public.court_screen_systems add constraint court_screen_systems_login_check
  check (login_kind in ('password_app', 'password_email', 'certificate'));
-- certificate  the lawyer signs in and signs with their own certificate: ONE's own browser never works there.
alter table public.court_screen_systems add constraint court_screen_systems_certificate_check
  check (login_kind <> 'certificate' or not ('browser' = any (ways)));

insert into public.court_screen_systems (key, court, system, host, name, login_kind, ways, rule_note, rule_read_on,
                                         start_path) values
  ('pje-tjrj', 'TJRJ', 'pje', 'tjrj.pje.jus.br', 'PJe do TJRJ', 'certificate', array['extension'],
   'Res. CNJ 185/2013: o usuário responde pela "guarda, sigilo e utilização da assinatura digital" (art. 4º, § 2º); login e senha não assinam documentos (art. 6º, § 4º, I); o uso que reduza a disponibilidade do sistema pode levar ao "bloqueio total, preventivo e temporário" do usuário, comunicado à OAB, e a automatização de consultas vai pelo MNI (art. 29). Ato Normativo TJ 9/2010 do TJRJ: as credenciais são pessoais e intransferíveis. Só pela extensão, na sessão do advogado, que assina com o próprio certificado.',
   '2026-11-25', '/1g/')
on conflict (key) do nothing;

-- ---------- The asks kept ----------

create table public.filing_access_asks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  proceeding_id uuid not null references public.proceedings (id) on delete cascade,
  system_key text not null references public.court_screen_systems (key) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  phone text,
  status text not null,
  reason text,
  message_id uuid references public.wa_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (proceeding_id, system_key, user_id),
  constraint filing_access_asks_phone_check check (phone is null or phone ~ '^[0-9]{12,15}$'),
  constraint filing_access_asks_status_check check (status in ('sent', 'skipped')),
  constraint filing_access_asks_reason_check check ((status = 'skipped') = (reason is not null)
    and (reason is null or reason ~ '^[a-z][a-z_]{2,40}$'))
);

create index filing_access_asks_org_idx on public.filing_access_asks (org_id, created_at desc);
create index filing_access_asks_case_idx on public.filing_access_asks (case_id);
create index filing_access_asks_user_idx on public.filing_access_asks (user_id);

alter table public.filing_access_asks enable row level security;
create policy "filing_access_asks_select_member" on public.filing_access_asks
  for select to authenticated using (public.is_org_member(org_id));
revoke all on table public.filing_access_asks from public, anon, authenticated;
grant select on table public.filing_access_asks to authenticated;
create trigger guard_impersonation_filing_access_asks after insert or update or delete on public.filing_access_asks
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- Whose access ONE needs ----------

/**
 * Each lawyer whose access ONE needs to file a package on its court's screen, as said above; the oldest package
 * first, the limit after the filter, and one package and one lawyer when asked for. Service role.
 */
create or replace function public.filing_access_owed(
  target_limit integer default 50,
  target_package uuid default null,
  target_user uuid default null
)
returns table (package_id uuid, org_id uuid, case_id uuid, seq integer, proceeding_id uuid, system_key text,
               system_name text, user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select fp.id, fp.org_id, fp.case_id, k.seq, fp.proceeding_id, s.key, s.name, pl.user_id
  from public.filing_packages fp
  join public.cases k on k.id = fp.case_id
  join public.court_screen_systems s on s.court = fp.court and s.system = fp.system
  join public.firm_filing_ways fw on fw.org_id = fp.org_id
  join public.proceeding_lawyers pl on pl.proceeding_id = fp.proceeding_id
  where auth.role() = 'service_role'
    and fp.status = 'ready'
    and (target_package is null or fp.id = target_package)
    and (target_user is null or pl.user_id = target_user)
    -- An automated way the firm's way leaves at this system.
    and exists (
      select 1 from unnest(s.ways) as w (way)
      where public.filing_way_rank(w.way) <= public.filing_way_rank(fw.way)
    )
    -- The court's own channel files it, where there is one; and nothing of it went yet.
    and public.filing_channel_of(fp) is null
    and not exists (select 1 from public.filing_submissions sub where sub.package_id = fp.id)
    -- No lawyer of the lawsuit already hands it to ONE there.
    and not exists (
      select 1 from public.proceeding_lawyers other
      join public.lawyer_filing_ways lw
        on lw.org_id = fp.org_id and lw.user_id = other.user_id and lw.system_key = s.key
      where other.proceeding_id = fp.proceeding_id
        and lw.way <> 'hand' and lw.way = any (s.ways)
        and public.filing_way_rank(lw.way) <= public.filing_way_rank(fw.way)
    )
    -- This lawyer never said how they file there, is of the firm, and may file it there.
    and not exists (
      select 1 from public.lawyer_filing_ways lw
      where lw.org_id = fp.org_id and lw.user_id = pl.user_id and lw.system_key = s.key
    )
    and exists (select 1 from public.memberships m where m.org_id = fp.org_id and m.user_id = pl.user_id)
    and public.filing_screen_blocker(fp, pl.user_id) is null
    and not exists (
      select 1 from public.filing_access_asks a
      where a.proceeding_id = fp.proceeding_id and a.system_key = s.key and a.user_id = pl.user_id
    )
  order by fp.built_at nulls last, fp.id, pl.user_id
  limit greatest(least(coalesce(target_limit, 50), 500), 1);
$$;

revoke all on function public.filing_access_owed(integer, uuid, uuid) from public, anon, authenticated;
grant execute on function public.filing_access_owed(integer, uuid, uuid) to service_role;

/**
 * Keeps ONE's ask of a lawyer's access for a package (0304), once per lawsuit, system and lawyer, while it is still
 * owed, and writes it to their WhatsApp as the firm's template of `filing_batch_waits`; what cannot go there is kept as
 * skipped with why, and the bell rings all the same. Answers the lawyer, the case, the system and the message queued,
 * for the outbox. Service role.
 */
create or replace function public.reserve_filing_access_ask(
  target_package uuid,
  target_user uuid,
  target_params text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owed record;
  notice public.notice_kinds%rowtype;
  template public.wa_templates%rowtype;
  sender public.wa_numbers%rowtype;
  phone text;
  conversation uuid;
  message uuid;
  kept uuid;
  rendered text;
  skip text;
  answer jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_package is null or target_user is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  -- One ask at a time per package: two rounds never both write it.
  perform 1 from public.filing_packages where id = target_package for update;
  select * into owed from public.filing_access_owed(1, target_package, target_user);
  if owed.package_id is null then
    return jsonb_build_object('ok', true, 'code', 'not_owed');
  end if;
  answer := jsonb_build_object('ok', true, 'user_id', owed.user_id, 'case_id', owed.case_id,
                               'proceeding_id', owed.proceeding_id, 'system_key', owed.system_key);

  select p.whatsapp into phone from public.profiles p where p.id = owed.user_id;
  select * into notice from public.notice_kinds k where k.kind = 'filing_batch_waits';
  select t.* into template from public.wa_templates t
  join public.firm_notice_kinds k on k.template_id = t.id
  where k.org_id = owed.org_id and k.kind = 'filing_batch_waits' and k.enabled
    and t.status = 'approved' and t.category = 'utility';
  if found then
    -- A test case never reaches here (`filing_screen_blocker`): the firm's real number.
    select n.* into sender from public.wa_numbers n
    join public.connections cn on cn.id = n.connection_id and cn.status = 'connected'
    where n.org_id = owed.org_id and n.waba_id = template.waba_id and n.status = 'active' and n.provider <> 'test'
    order by n.connected_at
    limit 1;
  end if;

  skip := case
    when phone is null then 'no_phone'
    when exists (
      select 1 from public.wa_optouts o
      where o.org_id = owed.org_id and o.contact_wa_id = any (public.wa_phone_variants(phone))
    ) then 'opted_out'
    when template.id is null then 'no_template'
    when sender.id is null then 'no_number'
    when target_params is null or cardinality(target_params) <> cardinality(notice.params)
         or template.param_count <> cardinality(target_params)
         or array_position(target_params, null) is not null
         or exists (select 1 from unnest(target_params) as v(value)
                    where public.notice_value(v.value) is null or public.notice_value(v.value) <> v.value)
      then 'invalid_values'
  end;
  if skip is not null then
    insert into public.filing_access_asks (org_id, case_id, proceeding_id, system_key, user_id, phone, status, reason)
    values (owed.org_id, owed.case_id, owed.proceeding_id, owed.system_key, owed.user_id, phone, 'skipped', skip)
    on conflict (proceeding_id, system_key, user_id) do nothing
    returning id into kept;
    if kept is null then
      return jsonb_build_object('ok', true, 'code', 'already');
    end if;
    insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
    values (owed.org_id, null, 'system', 'filing_access.asked', 'proceeding', owed.proceeding_id::text,
            jsonb_build_object('system', owed.system_key, 'whatsapp', skip));
    return answer || jsonb_build_object('code', 'skipped', 'reason', skip);
  end if;

  select wc.id into conversation from public.wa_conversations wc
  where wc.number_id = sender.id and wc.contact_wa_id = any (public.wa_phone_variants(phone))
  order by wc.last_inbound_at desc nulls last
  limit 1;
  if conversation is null then
    conversation := public.wa_open_conversation(owed.org_id, sender.id, phone, null);
  end if;

  rendered := public.notice_rendered(template.body, target_params);
  insert into public.wa_messages (
    org_id, conversation_id, number_id, direction, origin, kind, body, template_id, template_name, template_params, status
  ) values (
    owed.org_id, conversation, sender.id, 'out', 'cloud', 'template', rendered, template.id, template.name,
    to_jsonb(target_params), 'queued'
  )
  returning id into message;
  update public.wa_conversations set
    last_message_at = now(),
    last_message_preview = public.wa_preview('template', rendered),
    last_message_direction = 'out'
  where id = conversation
    and not (last_message_direction = 'in' and last_inbound_at is not null and last_inbound_at >= last_message_at);

  insert into public.filing_access_asks (org_id, case_id, proceeding_id, system_key, user_id, phone, status, message_id)
  values (owed.org_id, owed.case_id, owed.proceeding_id, owed.system_key, owed.user_id, phone, 'sent', message);
  insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (owed.org_id, null, 'system', 'filing_access.asked', 'proceeding', owed.proceeding_id::text,
          jsonb_build_object('system', owed.system_key, 'whatsapp', 'sent'));
  return answer || jsonb_build_object('code', 'queued', 'message_id', message);
end;
$$;

revoke all on function public.reserve_filing_access_ask(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.reserve_filing_access_ask(uuid, uuid, text[]) to service_role;
