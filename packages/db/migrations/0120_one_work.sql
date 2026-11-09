-- ============================================================
-- 0120 · O trabalho do ONE
--
-- Phase 2 of the plan of the controladoria, the outcome of the cases and the
-- firm's finance: every month the firm sees what ONE did for it, by kind of
-- task, and how many hours a person would have taken, by the firm's own
-- estimates. It is the argument of the renewal and never measures a person.
--
-- The count reads the records ONE already keeps, so the months before show on
-- the first day: no table of events is written for it. Each kind of ONE's work
-- (`one_work_kinds`, the platform's catalog, with its family, the minutes ONE
-- proposes and the decision of `autonomy_decisions` it belongs to) is counted
-- once per act that ONE did and that stands: never the mirror of the audit
-- trail, never a failure, nothing undone. What ONE prepared and a person
-- approved after reading it is counted too, apart (`assisted`); the test cases
-- apart again. A month is a month of Brasília. The flight alerts and the
-- readings of a partner agency are not the firm's work, and never count.
--
-- Who decides for the firm (`decides_for_firm`) sets the firm's minutes of a
-- kind, or goes back to ONE's (`firm_one_work_minutes`), and the average cost
-- of an hour (`firm_one_work_cost`), which only they read: the tasks and the
-- hours are the whole firm's, the money only theirs, and nothing is ever said
-- per person.
-- ============================================================

-- ---------- The catalog ----------

create table public.one_work_kinds (
  key text primary key,
  -- atendimento, documentos, relato, acoes, pecas, protocolo, tribunal, prazos, avisos, biblioteca.
  family text not null,
  position integer not null,
  -- The minutes ONE proposes: conservative, from 1 to 15 for a small act, 30 for the text of a piece, 60 for a model.
  minutes integer not null,
  -- The decision of what ONE decides alone this work belongs to, where it is one.
  decision text references public.autonomy_decisions (key) on delete set null,
  constraint one_work_kinds_key_check check (key ~ '^[a-z][a-z0-9_]{2,40}$'),
  constraint one_work_kinds_family_check check (family in (
    'atendimento', 'documentos', 'relato', 'acoes', 'pecas', 'protocolo', 'tribunal', 'prazos', 'avisos', 'biblioteca'
  )),
  constraint one_work_kinds_minutes_check check (minutes between 0 and 600)
);

alter table public.one_work_kinds enable row level security;
create policy "one_work_kinds_select_all" on public.one_work_kinds for select to authenticated using (true);
revoke all on table public.one_work_kinds from public, anon, authenticated;
grant select on table public.one_work_kinds to authenticated;

insert into public.one_work_kinds (key, family, position, minutes, decision) values
  -- The conversation with the client.
  ('caso_aberto_conversa', 'atendimento', 10, 10, 'open_case_from_chat'),
  ('resposta_conversa', 'atendimento', 20, 3, 'reply_client'),
  ('link_cliente', 'atendimento', 30, 2, 'send_client_link'),
  ('arquivo_conversa', 'atendimento', 40, 2, null),
  ('resposta_entrevista', 'atendimento', 50, 2, null),
  -- The client's papers.
  ('documento_conferido', 'documentos', 110, 3, 'document_check'),
  ('dados_lidos', 'documentos', 120, 3, null),
  ('foto_pdf', 'documentos', 130, 1, null),
  -- What the client told.
  ('audio_transcrito', 'relato', 210, 10, null),
  ('ordem_dos_fatos', 'relato', 220, 15, 'chronology'),
  -- The lawsuits.
  ('acoes_criadas', 'acoes', 310, 10, 'create_lawsuits'),
  ('sistema_tribunal', 'acoes', 320, 5, null),
  ('voo_conferido', 'acoes', 330, 5, null),
  ('clima_lido', 'acoes', 340, 5, null),
  ('tema_1417', 'acoes', 350, 5, 'file_or_hold'),
  -- The pieces and the papers a client signs.
  ('texto_peca', 'pecas', 410, 30, 'start_piece'),
  ('peca_aprovada', 'pecas', 420, 15, 'piece_text'),
  ('procuracao', 'pecas', 430, 10, 'send_signature_papers'),
  ('dossie', 'pecas', 440, 15, null),
  -- The filing.
  ('pacote_protocolo', 'protocolo', 510, 15, 'request_package'),
  ('arquivos_assinados', 'protocolo', 520, 5, 'sign_package'),
  ('acao_protocolada', 'protocolo', 530, 15, 'file_lawsuit'),
  -- The court and the gazette.
  ('publicacao_capturada', 'tribunal', 610, 1, null),
  ('publicacao_triada', 'tribunal', 620, 2, 'publication_triage'),
  ('prazo_lido', 'tribunal', 630, 5, 'publication_deadline'),
  ('audiencia_lida', 'tribunal', 640, 5, 'publication_hearing'),
  ('andamento_lido', 'tribunal', 650, 1, null),
  -- The deadlines and the hearings.
  ('prazo_contado', 'prazos', 710, 5, null),
  ('prazo_confirmado', 'prazos', 720, 5, 'deadline_confirm'),
  ('audiencia_agenda', 'prazos', 730, 2, null),
  -- What the client is told.
  ('aviso_audiencia', 'avisos', 810, 2, null),
  ('aviso_andamento', 'avisos', 820, 2, null),
  ('aviso_golpe', 'avisos', 830, 2, null),
  ('pedido_documento', 'avisos', 840, 2, null),
  -- The firm's library.
  ('modelo_documento', 'biblioteca', 910, 60, 'model_from_document');

-- ---------- The firm's estimates ----------

create table public.firm_one_work_minutes (
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null references public.one_work_kinds (key) on delete cascade,
  minutes integer not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, kind),
  constraint firm_one_work_minutes_check check (minutes between 0 and 600)
);

alter table public.firm_one_work_minutes enable row level security;
create policy "firm_one_work_minutes_select_decider" on public.firm_one_work_minutes
  for select to authenticated using (public.decides_for_firm(org_id));
revoke all on table public.firm_one_work_minutes from public, anon, authenticated;
grant select on table public.firm_one_work_minutes to authenticated;
create trigger guard_impersonation_firm_one_work_minutes after insert or update or delete on public.firm_one_work_minutes
  for each statement execute function public.guard_impersonation_readonly();

create table public.firm_one_work_cost (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- The average cost of an hour of the firm's people, in centavos.
  hour_cents integer not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint firm_one_work_cost_check check (hour_cents between 1 and 10000000)
);

alter table public.firm_one_work_cost enable row level security;
create policy "firm_one_work_cost_select_decider" on public.firm_one_work_cost
  for select to authenticated using (public.decides_for_firm(org_id));
revoke all on table public.firm_one_work_cost from public, anon, authenticated;
grant select on table public.firm_one_work_cost to authenticated;
create trigger guard_impersonation_firm_one_work_cost after insert or update or delete on public.firm_one_work_cost
  for each statement execute function public.guard_impersonation_readonly();

/**
 * Who decides for the firm sets its minutes of each kind named (`target_minutes`: {kind: minutes}, null to go back
 * to ONE's) and, when `target_set_cost`, the average cost of an hour (null to say none). Never a support visit; on the
 * record with what changed. Answers `{ok}`, or `{ok: false, code}`: `support_visit`, `not_allowed`, `kind`,
 * `minutes`, `cost`.
 */
create or replace function public.set_one_work_estimates(
  target_org uuid,
  target_minutes jsonb,
  target_set_cost boolean default false,
  target_hour_cents integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  entry record;
  wanted integer;
  changed jsonb := '{}'::jsonb;
  prior_cost integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.decides_for_firm(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if target_minutes is not null and jsonb_typeof(target_minutes) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'minutes');
  end if;
  for entry in select e.key, e.value from jsonb_each(coalesce(target_minutes, '{}'::jsonb)) e loop
    if not exists (select 1 from public.one_work_kinds k where k.key = entry.key) then
      return jsonb_build_object('ok', false, 'code', 'kind');
    end if;
    if jsonb_typeof(entry.value) not in ('number', 'null')
       or (jsonb_typeof(entry.value) = 'number' and (
         entry.value::text !~ '^[0-9]{1,3}$' or entry.value::text::integer > 600)) then
      return jsonb_build_object('ok', false, 'code', 'minutes');
    end if;
  end loop;
  if target_set_cost and target_hour_cents is not null and target_hour_cents not between 1 and 10000000 then
    return jsonb_build_object('ok', false, 'code', 'cost');
  end if;

  for entry in select e.key, e.value from jsonb_each(coalesce(target_minutes, '{}'::jsonb)) e loop
    if jsonb_typeof(entry.value) = 'null' then
      delete from public.firm_one_work_minutes where org_id = target_org and kind = entry.key;
      changed := changed || jsonb_build_object(entry.key, null);
    else
      wanted := entry.value::text::integer;
      insert into public.firm_one_work_minutes (org_id, kind, minutes, updated_by, updated_at)
      values (target_org, entry.key, wanted, auth.uid(), now())
      on conflict (org_id, kind) do update
        set minutes = excluded.minutes, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
      changed := changed || jsonb_build_object(entry.key, wanted);
    end if;
  end loop;
  if target_set_cost then
    select c.hour_cents into prior_cost from public.firm_one_work_cost c where c.org_id = target_org;
    if target_hour_cents is null then
      delete from public.firm_one_work_cost where org_id = target_org;
    else
      insert into public.firm_one_work_cost (org_id, hour_cents, updated_by, updated_at)
      values (target_org, target_hour_cents, auth.uid(), now())
      on conflict (org_id) do update
        set hour_cents = excluded.hour_cents, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    end if;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'one_work.estimates_changed', 'firm', target_org::text,
          jsonb_strip_nulls(jsonb_build_object(
            'minutes', case when changed = '{}'::jsonb then null else changed end,
            'cost_changed', case when target_set_cost then true end)));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_one_work_estimates(uuid, jsonb, boolean, integer) from public, anon;
grant execute on function public.set_one_work_estimates(uuid, jsonb, boolean, integer) to authenticated;

