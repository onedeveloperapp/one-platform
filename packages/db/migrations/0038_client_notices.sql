-- ============================================================
-- 0038_client_notices: what a firm's clients are told on WhatsApp by
-- themselves, and what they read of their lawsuit on their link.
--
-- Four kinds of notice, each a template of the firm's own account at the
-- vendor, made from a text the platform proposes and the firm may change,
-- approved by the vendor as a utility message and switched on by who manages
-- the firm:
--
--   hearing_reminder  a hearing coming: a month, a week, the day before and
--                     the day itself (the setting's steps), with when in its
--                     zone and how to be there;
--   hearing_change    a hearing the client was told of moved, was cancelled
--                     or was put back;
--   lawsuit_update    every fifteen days from the filing, what the record says
--                     of the lawsuit: the last movement the court registered,
--                     and the next hearing;
--   payment_alert     the day a person of the firm triages a publication of
--                     the lawsuit as a payment: the warning against the scam
--                     of the fake lawyer (the firm never asks for money to
--                     release a value).
--
-- What a notice says is filled by the database from the case's own record,
-- never by a model, and goes only to a person who agreed to be told on
-- WhatsApp at the number the firm has for them (on their own link, in the
-- words they read; or as a person of the firm recorded it, saying how), and
-- who did not ask the firm to stop (`wa_optouts`). A phone is told a thing
-- once, whoever of a family shares it.
--
--   notice_kinds        the kinds, with the text the platform proposes and what
--                       each of its values is (global);
--   firm_notice_kinds   the firm's template for each kind, a new text waiting
--                       for the vendor, and whether the kind is on;
--   notice_optins       every agreement given, never rewritten: one in force
--                       per person, ended when taken back or replaced;
--   client_notices      each notice reserved: one per person, kind and
--                       occurrence, never two, with the phone it went to and
--                       the message it went as.
--
-- What is due is recomputed from the data on every sweep
-- (`notice_candidates`), and a notice is reserved in the statement that
-- writes its message to the outbox of migration 0019 (claim, then send: the
-- outbox claims it, sends it and records what the vendor said). A notice whose
-- message did not go out, for a reason that says it did not, is reserved again
-- as itself while it is still due, a few times and each time later; one whose
-- fate is not known is never sent again by itself, and counts as told.
-- ============================================================

insert into public.platform_settings (key, value, is_public) values
  ('notices', jsonb_build_object(
    -- The reminders of a hearing, by the days before its day (0: the day itself).
    'hearing_steps', jsonb_build_array(
      jsonb_build_object('step', 'month', 'days', 30),
      jsonb_build_object('step', 'week', 'days', 7),
      jsonb_build_object('step', 'eve', 'days', 1),
      jsonb_build_object('step', 'day', 'days', 0)
    ),
    -- The reminder of the day itself goes up to this long before the hearing.
    'day_lead_minutes', 60,
    -- The word on a filed lawsuit, every so many days from its filing; none to somebody told anything of it in
    -- the last days.
    'update_days', 15,
    'update_quiet_days', 7,
    -- The warning against the scam may go this long after the payment was triaged, and once in so many days per
    -- lawsuit and person.
    'payment_alert_days', 5,
    'payment_alert_quiet_days', 30,
    -- A document of the client's the firm refused (ONE's check or a person) is asked for again in the days after the
    -- refusal, while nothing newer answers for it.
    'document_days', 7,
    -- The hours of the place's own day a notice may go in. What is about a hearing of that very day (its reminder
    -- of the day, a change of it) may go from an earlier hour: a hearing of the morning would never be told.
    'send_from_hour', 8,
    'send_until_hour', 20,
    'same_day_from_hour', 6,
    -- A notice of a hearing, or of a payment, waits this long after a person last wrote what it tells: a mistake
    -- corrected at once never reaches the client.
    'settle_minutes', 15,
    -- How many notices a firm sends in 24 hours. A new account at the vendor starts at 250 people a day for the
    -- messages a business starts.
    'daily_max', 250,
    -- Of that room, what is kept for what is about a hearing (a change, a reminder): the word on a lawsuit and the
    -- warning against the scam go only while more than this is left.
    'urgent_room', 25,
    -- How many times a notice whose message was refused for a passing reason is reserved (one of these codes, or
    -- the platform's vault that could not open the firm's token): the next try after so many minutes, and each one
    -- after twice as long as the one before.
    'max_attempts', 5,
    'retry_minutes', 30,
    'retry_codes', jsonb_build_array('rate_limited', 'unavailable', 'not_attempted', 'number_disconnected', 'token_invalid'),
    -- How many times a client may agree or stop on their link in 24 hours: a link is no switch to flip without end.
    'optin_changes_per_day', 10
  ), false)
on conflict (key) do nothing;

create or replace function public.notices_setting(setting text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when s.value ->> setting ~ '^[0-9]{1,9}$' then (s.value ->> setting)::integer end
     from public.platform_settings s where s.key = 'notices'),
    fallback
  );
$$;

revoke all on function public.notices_setting(text, integer) from public, anon, authenticated;

create or replace function public.notices_setting_json(setting text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select s.value -> setting from public.platform_settings s where s.key = 'notices';
$$;

revoke all on function public.notices_setting_json(text) from public, anon, authenticated;

-- ---------- The kinds, and the texts the platform proposes ----------

create table public.notice_kinds (
  kind text primary key,
  -- The order the firm's screen lists them in, and the order of the line: what cannot wait first.
  position integer not null unique,
  -- What the template is named at the vendor: this, then a number.
  template_base text not null unique,
  -- The text the platform proposes, with its values {{1}}, {{2}}; the footer every one of them carries.
  body text not null,
  footer text not null,
  -- What each value is, in order: the database fills them.
  params text[] not null,
  -- A value of each, as the vendor asks when a template is submitted. Invented, the lawsuit of a year to come.
  examples text[] not null,
  updated_at timestamptz not null default now(),
  constraint notice_kinds_kind_check check (kind in ('hearing_reminder', 'hearing_change', 'lawsuit_update', 'payment_alert', 'document_refused')),
  constraint notice_kinds_base_check check (template_base ~ '^one_[a-z][a-z0-9_]{2,60}$'),
  constraint notice_kinds_params_check check (
    cardinality(params) between 1 and 9 and cardinality(examples) = cardinality(params)
    and params <@ array['first_name', 'firm', 'hearing', 'lawsuit', 'moment', 'how', 'change', 'status', 'document', 'reason']
  ),
  constraint notice_kinds_text_check check (char_length(body) between 20 and 1024 and char_length(footer) between 1 and 60)
);

alter table public.notice_kinds enable row level security;
create policy "notice_kinds_select_all" on public.notice_kinds for select to authenticated using (true);
grant select on table public.notice_kinds to authenticated;

insert into public.notice_kinds (kind, position, template_base, body, footer, params, examples) values
  ('hearing_change', 1, 'one_audiencia_alterada',
   'Olá, {{1}}. O escritório {{2}} informa uma mudança na {{3}} do seu processo nº {{4}}: {{5}}. Se tiver qualquer dúvida, responda a esta mensagem.',
   'Para não receber estes avisos, responda SAIR.',
   array['first_name', 'firm', 'hearing', 'lawsuit', 'change'],
   array['Maria', 'Souza Advogados', 'audiência de conciliação', '5000401-61.2099.8.09.0051',
         'ela foi remarcada para quarta-feira, 11/11/2099, às 14:00, horário de Brasília']),
  ('hearing_reminder', 2, 'one_lembrete_audiencia',
   'Olá, {{1}}. O escritório {{2}} lembra que a {{3}} do seu processo nº {{4}} está marcada para {{5}}. {{6}} A sua presença é importante. Se tiver qualquer dúvida, responda a esta mensagem.',
   'Para não receber estes avisos, responda SAIR.',
   array['first_name', 'firm', 'hearing', 'lawsuit', 'moment', 'how'],
   array['Maria', 'Souza Advogados', 'audiência de conciliação', '5000401-61.2099.8.09.0051',
         'terça-feira, 10/11/2099, às 14:00, horário de Brasília',
         'Ela será por videoconferência, pelo link https://videoconferencia.tribunal.example/sala-7.']),
  ('payment_alert', 3, 'one_alerta_seguranca',
   'Olá, {{1}}. Aviso de segurança do escritório {{2}} sobre o seu processo nº {{3}}: há golpistas usando dados públicos de processos para pedir dinheiro em nome de advogados. O escritório nunca pede PIX, depósito, boleto ou qualquer pagamento para liberar valores. Se alguém pedir, não pague e fale com o escritório por este número.',
   'Para não receber estes avisos, responda SAIR.',
   array['first_name', 'firm', 'lawsuit'],
   array['Maria', 'Souza Advogados', '5000401-61.2099.8.09.0051']),
  ('lawsuit_update', 4, 'one_andamento_processo',
   'Olá, {{1}}. Atualização do escritório {{2}} sobre o seu processo nº {{3}}: {{4}}. Se tiver qualquer dúvida, responda a esta mensagem.',
   'Para não receber estes avisos, responda SAIR.',
   array['first_name', 'firm', 'lawsuit', 'status'],
   array['Maria', 'Souza Advogados', '5000401-61.2099.8.09.0051',
         'a última movimentação registrada pelo tribunal foi em 03/10/2099']),
  ('document_refused', 5, 'one_documento_recusado',
   'Olá, {{1}}. O escritório {{2}} precisa que você envie de novo {{3}}. Motivo: {{4}}. Você pode enviar pelo link do seu caso ou responder a esta mensagem com o arquivo.',
   'Para não receber estes avisos, responda SAIR.',
   array['first_name', 'firm', 'document', 'reason'],
   array['Maria', 'Souza Advogados', 'o comprovante de endereço, enviado em 03/10/2099',
         'a foto ficou desfocada e o endereço não pode ser lido'])
on conflict (kind) do nothing;

-- ---------- The firm's kinds ----------

create table public.firm_notice_kinds (
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null references public.notice_kinds (kind),
  -- The firm's template at the vendor this kind goes as, once submitted.
  template_id uuid,
  -- The text the firm submitted (the platform's, or its own), as it went.
  body text,
  -- A new text of a kind that is on, still with the vendor: the template before it goes on being used until the
  -- vendor approves the new one, which then takes its place by itself.
  pending_template_id uuid,
  pending_body text,
  enabled boolean not null default false,
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz,
  primary key (org_id, kind),
  foreign key (template_id, org_id) references public.wa_templates (id, org_id) on delete set null (template_id),
  foreign key (pending_template_id, org_id) references public.wa_templates (id, org_id)
    on delete set null (pending_template_id),
  constraint firm_notice_kinds_enabled_check check (not enabled or template_id is not null),
  constraint firm_notice_kinds_body_check check (body is null or char_length(body) between 20 and 1024),
  constraint firm_notice_kinds_pending_check check (
    (pending_template_id is null or pending_body is not null)
    and (pending_body is null or char_length(pending_body) between 20 and 1024)
  )
);

alter table public.firm_notice_kinds enable row level security;
create policy "firm_notice_kinds_select_member" on public.firm_notice_kinds
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.firm_notice_kinds to authenticated;
create trigger guard_impersonation_firm_notice_kinds after insert or update or delete on public.firm_notice_kinds
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- Who agreed to be told ----------

/**
 * Each agreement to be told on WhatsApp, kept as it was given and never
 * rewritten: one in force per person at most (`ended_at` is null), for one
 * number. Taking it back, or agreeing for another number, ends it; the row
 * stays, with who ended it and how, so the firm can always show what was
 * agreed, for which number, when and in which words.
 */
create table public.notice_optins (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The number the person agreed for: another number is another agreement.
  phone text not null,
  -- client: on their own link; firm: a person of the firm recorded it, saying how.
  source text not null,
  -- What the person agreed to, word for word, as it was shown or recorded.
  wording text not null,
  note text,
  link_id uuid references public.client_links (id) on delete set null,
  -- What the server saw of the client's request (its browser, its address): never the caller's to write.
  evidence jsonb,
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  -- When it stopped holding, and how: the client stopped on their link, a person of the firm recorded that they
  -- asked (saying how), or an agreement for another number replaced it.
  ended_at timestamptz,
  ended_source text,
  ended_by uuid references public.profiles (id) on delete set null,
  ended_note text,
  foreign key (person_id, org_id) references public.people (id, org_id) on delete cascade,
  constraint notice_optins_phone_check check (phone ~ '^[0-9]{12,15}$'),
  constraint notice_optins_source_check check (source in ('client', 'firm')),
  constraint notice_optins_note_check check (
    (source = 'firm') = (note is not null) and (note is null or char_length(note) between 8 and 500)
  ),
  constraint notice_optins_wording_check check (char_length(wording) between 20 and 1000),
  constraint notice_optins_end_check check (
    (ended_at is null) = (ended_source is null)
    and (ended_source is null or ended_source in ('client', 'firm', 'replaced'))
    and (ended_source = 'firm') = (ended_note is not null)
    and (ended_note is null or char_length(ended_note) between 8 and 500)
  )
);

-- One agreement in force per person.
create unique index notice_optins_current_idx on public.notice_optins (person_id) where ended_at is null;
create index notice_optins_org_idx on public.notice_optins (org_id);

alter table public.notice_optins enable row level security;
create policy "notice_optins_select_member" on public.notice_optins
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.notice_optins to authenticated;
create trigger guard_impersonation_notice_optins after insert or update or delete on public.notice_optins
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- The notices ----------

-- A notice names the message it went as, of the same firm.
alter table public.wa_messages add constraint wa_messages_id_org_key unique (id, org_id);

create table public.client_notices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  person_id uuid not null,
  -- The number it went to, the person's then: a phone a family shares is told a thing once.
  phone text not null,
  proceeding_id uuid,
  hearing_id uuid,
  publication_id uuid,
  -- The document a notice asks for again.
  document_id uuid,
  kind text not null references public.notice_kinds (kind),
  -- What makes it this notice and no other within its kind: a hearing's step at its moment, a lawsuit's
  -- fortnight, a publication, a document's refusal.
  occurrence text not null,
  -- The moment of the hearing it spoke of, as it was then (a reminder, a change, a word on the lawsuit that named
  -- its next hearing).
  about_at timestamptz,
  -- The values the template was filled with.
  params jsonb not null,
  message_id uuid not null,
  attempts integer not null default 1,
  reserved_at timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, person_id, kind, occurrence),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (person_id, org_id) references public.people (id, org_id) on delete cascade,
  foreign key (proceeding_id, org_id) references public.proceedings (id, org_id) on delete set null (proceeding_id),
  foreign key (hearing_id, org_id) references public.hearings (id, org_id) on delete set null (hearing_id),
  foreign key (publication_id, org_id) references public.publications (id, org_id) on delete set null (publication_id),
  foreign key (document_id, org_id) references public.case_documents (id, org_id) on delete set null (document_id),
  foreign key (message_id, org_id) references public.wa_messages (id, org_id) on delete cascade,
  constraint client_notices_phone_check check (phone ~ '^[0-9]{12,15}$'),
  constraint client_notices_occurrence_check check (char_length(occurrence) between 3 and 200),
  constraint client_notices_params_check check (jsonb_typeof(params) = 'array'),
  constraint client_notices_attempts_check check (attempts >= 1)
);

create index client_notices_case_idx on public.client_notices (case_id, reserved_at desc);
create index client_notices_firm_idx on public.client_notices (org_id, reserved_at desc);
create index client_notices_person_idx on public.client_notices (person_id, reserved_at desc);
create index client_notices_phone_idx on public.client_notices (org_id, phone, reserved_at desc);
create index client_notices_hearing_idx on public.client_notices (hearing_id, person_id) where hearing_id is not null;
create index client_notices_lawsuit_idx on public.client_notices (proceeding_id, person_id, reserved_at desc)
  where proceeding_id is not null;
create index client_notices_document_idx on public.client_notices (document_id) where document_id is not null;

alter table public.client_notices enable row level security;
create policy "client_notices_select_member" on public.client_notices
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.client_notices to authenticated;
create trigger guard_impersonation_client_notices after insert or update or delete on public.client_notices
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- The words of a notice ----------

/** A lawsuit's number as people write it: 5000401-61.2099.8.09.0051. */
create or replace function public.cnj_formatted(cnj text)
returns text
language sql
immutable
as $$
  select case when cnj ~ '^[0-9]{20}$'
    then substr(cnj, 1, 7) || '-' || substr(cnj, 8, 2) || '.' || substr(cnj, 10, 4) || '.' || substr(cnj, 14, 1)
         || '.' || substr(cnj, 15, 2) || '.' || substr(cnj, 17, 4)
    else cnj end;
$$;

/** A Brazilian phone as people write it: (62) 99999-8888; any other as digits after a plus. */
create or replace function public.phone_formatted(phone text)
returns text
language sql
immutable
as $$
  select case
    when phone ~ '^55[0-9]{11}$' then '(' || substr(phone, 3, 2) || ') ' || substr(phone, 5, 5) || '-' || substr(phone, 10, 4)
    when phone ~ '^55[0-9]{10}$' then '(' || substr(phone, 3, 2) || ') ' || substr(phone, 5, 4) || '-' || substr(phone, 9, 4)
    else '+' || phone end;
$$;

/**
 * The ways WhatsApp may name a Brazilian mobile number: with the ninth digit
 * and without it (a number older than the ninth digit is still named without
 * it), so a person's conversation and opt-out are found however it was written.
 */
create or replace function public.wa_phone_variants(phone text)
returns text[]
language sql
immutable
as $$
  select case
    when phone ~ '^55[1-9][0-9]9[0-9]{8}$' then array[phone, substr(phone, 1, 4) || substr(phone, 6)]
    when phone ~ '^55[1-9][0-9][6-9][0-9]{7}$' then array[phone, substr(phone, 1, 4) || '9' || substr(phone, 5)]
    else array[phone] end;
$$;

/** A value of a template as the vendor takes it: one line, no run of spaces, never empty, at most 500 characters. */
create or replace function public.notice_value(value text)
returns text
language sql
immutable
as $$
  select nullif(left(btrim(regexp_replace(coalesce(value, ''), '\s+', ' ', 'g')), 500), '');
$$;

create or replace function public.notice_zone_words(zone text)
returns text
language sql
immutable
as $$
  select case zone
    when 'America/Sao_Paulo' then 'horário de Brasília'
    when 'America/Manaus' then 'horário de Manaus'
    when 'America/Boa_Vista' then 'horário de Roraima'
    when 'America/Porto_Velho' then 'horário de Rondônia'
    when 'America/Cuiaba' then 'horário de Mato Grosso'
    when 'America/Campo_Grande' then 'horário de Mato Grosso do Sul'
    when 'America/Rio_Branco' then 'horário do Acre'
    when 'America/Eirunepe' then 'horário do oeste do Amazonas'
    when 'America/Noronha' then 'horário de Fernando de Noronha'
    else 'horário local'
  end;
$$;

/** A moment as a notice says it, in the zone of the hearing: terça-feira, 10/11/2099, às 14:00, horário de Brasília. */
create or replace function public.notice_moment(at timestamptz, zone text, prefix text default '')
returns text
language sql
stable
as $$
  select coalesce(prefix, '')
    || (array['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'])
         [extract(dow from (at at time zone zone))::integer + 1]
    || ', ' || to_char(at at time zone zone, 'DD/MM/YYYY') || ', às ' || to_char(at at time zone zone, 'HH24:MI')
    || ', ' || public.notice_zone_words(zone);
$$;

create or replace function public.notice_hearing_words(kind text)
returns text
language sql
immutable
as $$
  select case kind
    when 'conciliacao' then 'audiência de conciliação'
    when 'instrucao' then 'audiência de instrução e julgamento'
    when 'una' then 'audiência de conciliação, instrução e julgamento'
    else 'audiência'
  end;
$$;

/**
 * How to be at a hearing, in a sentence of at most the 500 characters a value
 * of a template is given: by which link, at which place, or whom to ask. A
 * link too long to fit is never cut: the client is told to ask the firm.
 */
create or replace function public.notice_how_words(mode text, place text, link text)
returns text
language sql
immutable
as $$
  select coalesce(
    (
      select choice.sentence
      from (values
        (1, case
          when mode = 'videoconferencia' and link is not null
            then 'Ela será por videoconferência, pelo link ' || link || '.'
          when mode = 'presencial' and place is not null
            then 'Ela será presencial, em ' || rtrim(place, '. ') || '.'
          when mode = 'hibrida' and place is not null and link is not null
            then 'Ela será presencial, em ' || rtrim(place, '. ')
                 || ', com participação também por videoconferência, pelo link ' || link || '.'
          when mode = 'hibrida' and link is not null
            then 'Ela poderá ser acompanhada presencialmente ou por videoconferência, pelo link ' || link || '.'
          when mode = 'hibrida' and place is not null
            then 'Ela será presencial, em ' || rtrim(place, '. ')
                 || ', com participação também por videoconferência. Fale com o escritório para receber o link de acesso.'
        end),
        -- Both do not fit: the link, with the address asked of the firm; then the place, with the link asked.
        (2, case
          when mode = 'hibrida' and link is not null
            then 'Ela poderá ser acompanhada por videoconferência, pelo link ' || link
                 || '. Fale com o escritório para confirmar o endereço.'
        end),
        (3, case
          when mode = 'hibrida' and place is not null
            then 'Ela será presencial, em ' || rtrim(place, '. ')
                 || ', com participação também por videoconferência. Fale com o escritório para receber o link de acesso.'
        end)
      ) as choice (rank, sentence)
      where choice.sentence is not null and char_length(choice.sentence) <= 500
      order by choice.rank
      limit 1
    ),
    case mode
      when 'videoconferencia' then 'Ela será por videoconferência. Fale com o escritório para receber o link de acesso.'
      when 'presencial' then 'Ela será presencial. Fale com o escritório para confirmar o endereço.'
      else 'Ela poderá ser acompanhada presencialmente ou por videoconferência. Fale com o escritório para saber como participar.'
    end
  );
$$;

/** A template's text with its values in place, as the thread shows it. */
/** What a document is called in a notice, with its article: "o comprovante de endereço". */
create or replace function public.notice_document_words(kind text)
returns text
language sql
immutable
as $$
  select case kind
    when 'identity' then 'o documento de identidade'
    when 'address_proof' then 'o comprovante de endereço'
    when 'ticket' then 'o bilhete ou a reserva da passagem'
    when 'boarding_pass' then 'o cartão de embarque'
    when 'receipt' then 'o comprovante de gastos'
    when 'evidence' then 'a prova do problema'
    else 'o documento'
  end;
$$;

create or replace function public.notice_rendered(body text, params text[])
returns text
language plpgsql
immutable
as $$
declare
  rendered text := body;
  slot integer;
begin
  for slot in 1..coalesce(cardinality(params), 0) loop
    rendered := replace(rendered, '{{' || slot || '}}', params[slot]);
  end loop;
  return left(rendered, 4096);
end;
$$;

revoke all on function public.cnj_formatted(text) from public, anon, authenticated;
revoke all on function public.phone_formatted(text) from public, anon, authenticated;
revoke all on function public.wa_phone_variants(text) from public, anon, authenticated;
revoke all on function public.notice_value(text) from public, anon, authenticated;
revoke all on function public.notice_zone_words(text) from public, anon, authenticated;
revoke all on function public.notice_hearing_words(text) from public, anon, authenticated;
revoke all on function public.notice_moment(timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.notice_how_words(text, text, text) from public, anon, authenticated;
revoke all on function public.notice_document_words(text) from public, anon, authenticated;
revoke all on function public.notice_rendered(text, text[]) from public, anon, authenticated;

-- ---------- Who is told, and what keeps a notice from going ----------

/** The people told about a lawsuit: its adult claimants, and the guardians of its minor claimants. */
create or replace function public.notice_recipients(target_proceeding uuid)
returns table (person_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct coalesce(g.person_id, case
    when cp.guardian_id is null
     and (p.birth_date is null or p.birth_date <= ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date)
    then cp.person_id end) as person_id
  from public.proceeding_parties pp
  join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
  join public.people p on p.id = cp.person_id
  left join public.case_parties g on g.id = cp.guardian_id
  where pp.proceeding_id = target_proceeding
    and coalesce(g.person_id, case
      when cp.guardian_id is null
       and (p.birth_date is null or p.birth_date <= ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date)
      then cp.person_id end) is not null;
$$;

revoke all on function public.notice_recipients(uuid) from public, anon, authenticated;

/**
 * Who is asked again for a document the firm refused: the person it is of,
 * an adult, or who answers for them, a minor; one sent through a link, its
 * person, while they are still of the case (one taken out of it is asked
 * nothing, and nobody is asked in their place); a paper of the whole trip the
 * firm added, who holds the case as its screens read it (an adult claimant,
 * else who answers for a minor), one who agreed to be told first.
 */
create or replace function public.document_recipient(target_document uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when d.party_id is not null then (
      select coalesce(g.person_id, case
        when cp.guardian_id is null
         and (p.birth_date is null or p.birth_date <= ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date)
        then cp.person_id end)
      from public.case_parties cp
      join public.people p on p.id = cp.person_id
      left join public.case_parties g on g.id = cp.guardian_id
      where cp.id = d.party_id)
    when d.link_id is not null then (
      select l.person_id from public.client_links l
      where l.id = d.link_id
        and exists (select 1 from public.case_parties cp where cp.case_id = d.case_id and cp.person_id = l.person_id))
    else (
      select cp.person_id
      from public.case_parties cp
      join public.people p on p.id = cp.person_id
      where cp.case_id = d.case_id
        and ((cp.role = 'claimant' and cp.guardian_id is null
              and (p.birth_date is null
                   or p.birth_date <= ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date))
             or cp.role = 'guardian')
      order by exists (
                 select 1 from public.notice_optins o where o.person_id = p.id and o.ended_at is null and o.phone = p.phone
               ) desc,
               (cp.role = 'claimant') desc, cp.created_at, cp.id
      limit 1)
  end
  from public.case_documents d
  where d.id = target_document;
$$;

revoke all on function public.document_recipient(uuid) from public, anon, authenticated;

/**
 * Whether a document the firm refused is still owed: nothing else answers
 * for its paper. For a paper the setting asks of a case
 * (`cases.required_documents`), another of the kinds that answer for that
 * need (a ticket or a boarding pass of the whole case, an identity of the
 * same claimant, a proof of address of the same person), which the firm did
 * not refuse (one on its way or waiting for the firm counts), as the client's
 * page reads it; for any other paper, another of its kind and of the same
 * person sent after the refusal.
 */
create or replace function public.case_document_owed(target_document uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with doc as (
    select d.*, (select cp.person_id from public.case_parties cp where cp.id = d.party_id) as person_id
    from public.case_documents d where d.id = target_document
  ),
  needs as (
    select r ->> 'per' as per,
           array[r ->> 'kind'] || coalesce(array(select jsonb_array_elements_text(r -> 'or')), '{}'::text[]) as kinds
    from jsonb_array_elements(coalesce(public.cases_setting('required_documents'), '[]'::jsonb)) r
    where jsonb_typeof(r) = 'object' and jsonb_typeof(coalesce(r -> 'or', '[]'::jsonb)) = 'array'
  ),
  matching as (select n.per, n.kinds from needs n, doc where doc.kind = any (n.kinds))
  select case
    when exists (select 1 from matching) then not exists (
      select 1 from matching m, doc, public.case_documents o
      where o.case_id = doc.case_id and o.id <> doc.id and o.status <> 'rejected' and o.kind = any (m.kinds)
        and case m.per
              when 'case' then true
              when 'holder' then o.party_id in (
                select cp.id from public.case_parties cp where cp.case_id = doc.case_id and cp.person_id = doc.person_id)
              else o.party_id is not distinct from doc.party_id
            end
    )
    else not exists (
      select 1 from doc, public.case_documents o
      where o.case_id = doc.case_id and o.id <> doc.id and o.status <> 'rejected' and o.kind = doc.kind
        and o.party_id is not distinct from doc.party_id and o.created_at > doc.decided_at
    )
  end
  from doc;
$$;

revoke all on function public.case_document_owed(uuid) from public, anon, authenticated;

/** Why a person cannot be told on WhatsApp now, or null: no number, no agreement for that number, or they asked to stop. */
create or replace function public.notice_person_blocker(target_org uuid, target_person uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.phone is null then 'no_phone'
    when not exists (
      select 1 from public.notice_optins o
      where o.person_id = p.id and o.org_id = target_org and o.phone = p.phone and o.ended_at is null
    ) then 'no_optin'
    when exists (
      select 1 from public.wa_optouts w
      where w.org_id = target_org and w.contact_wa_id = any (public.wa_phone_variants(p.phone))
    ) then 'opted_out'
  end
  from public.people p
  where p.id = target_person and p.org_id = target_org;
$$;

revoke all on function public.notice_person_blocker(uuid, uuid) from public, anon, authenticated;

/**
 * The template a kind of notice goes as now, of the firm, and why it cannot
 * go when it cannot: the kind is off, its template is no longer approved as a
 * utility message, no number of the template's account is active, or the
 * vendor refused the firm's token (its connection failed): then nothing goes,
 * and no notice spends a try, until the firm connects it again.
 */
create or replace function public.notice_kind_route(target_org uuid, target_kind text)
returns table (template_id uuid, waba_id text, blocker text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.waba_id,
    case
      when k.enabled is not true then 'kind_off'
      when t.id is null or t.status <> 'approved' or t.category <> 'utility' then 'template_unusable'
      when not exists (
        select 1 from public.wa_numbers n where n.org_id = target_org and n.waba_id = t.waba_id and n.status = 'active'
      ) then 'no_number'
      when not exists (
        select 1 from public.wa_numbers n
        join public.connections c on c.id = n.connection_id
        where n.org_id = target_org and n.waba_id = t.waba_id and n.status = 'active' and c.status = 'connected'
      ) then 'number_failing'
    end
  from (select target_org as org_id) firm
  left join public.firm_notice_kinds k on k.org_id = firm.org_id and k.kind = target_kind
  left join public.wa_templates t on t.id = k.template_id;
$$;

revoke all on function public.notice_kind_route(uuid, text) from public, anon, authenticated;

-- ---------- When a hearing last changed what a notice tells ----------

-- Its own moment: the backend's writes of the hearing's event (`updated_at`) are not a change of the hearing.
alter table public.hearings add column changed_at timestamptz not null default now();

create or replace function public.hearing_changed_at()
returns trigger
language plpgsql
as $$
begin
  if (new.kind, new.starts_at, new.time_zone, new.mode, new.place, new.link, new.status)
     is distinct from (old.kind, old.starts_at, old.time_zone, old.mode, old.place, old.link, old.status) then
    new.changed_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.hearing_changed_at() from public, anon, authenticated;

create trigger hearings_changed_at before update on public.hearings
  for each row execute function public.hearing_changed_at();

-- ---------- What was told already ----------

/** A refusal that says the message did not go out, for a reason that passes: one of the setting's codes, or the vault. */
create or replace function public.notice_retryable(code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    code = any (array(
      select jsonb_array_elements_text(coalesce(public.notices_setting_json('retry_codes'), '[]'::jsonb))
    ))
    or code like 'vault\_%',
    false
  );
$$;

revoke all on function public.notice_retryable(text) from public, anon, authenticated;

/**
 * Whether a notice's message counts as told: it went, is on its way, may have
 * gone (its fate unknown), or was refused for a passing reason and will be
 * reserved again, for as long as its tries and their waits may last. Only a
 * message certain not to have gone out, and not to go again, told nobody
 * anything.
 */
create or replace function public.notice_told(
  message_status text,
  message_error text,
  notice_attempts integer,
  notice_reserved_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select message_status is distinct from 'failed'
    or message_error = 'unconfirmed'
    or (
      public.notice_retryable(message_error)
      and notice_attempts < greatest(public.notices_setting('max_attempts', 5), 1)
      and notice_reserved_at > now() - make_interval(mins => (
        greatest(public.notices_setting('retry_minutes', 30), 1)
        * (power(2, greatest(public.notices_setting('max_attempts', 5), 1)) - 1)
      )::integer)
    );
$$;

revoke all on function public.notice_told(text, text, integer, timestamptz) from public, anon, authenticated;

/**
 * Whether a notice about a moment may go from the earlier hour of the day:
 * the moment is of that very day, and so early that the usual hours would not
 * reach it before the reminder's lead (before the first hour, the lead and
 * one hour more).
 */
create or replace function public.notice_early(at timestamptz, zone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select at is not null
    and (at at time zone zone)::date = (now() at time zone zone)::date
    and extract(hour from at at time zone zone) * 60 + extract(minute from at at time zone zone)
        < least(greatest(public.notices_setting('send_from_hour', 8), 0), 23) * 60
          + greatest(public.notices_setting('day_lead_minutes', 60), 0) + 60;
$$;

revoke all on function public.notice_early(timestamptz, text) from public, anon, authenticated;

/**
 * Whether what a notice would tell was told already, to this person or to
 * the same phone (people of a family may share one): of a hearing at that
 * moment, since the step's window opened (a reminder, or a change that stands
 * for it); of a change, since the hearing last changed; of a lawsuit, in its
 * quiet days; the warning against the scam, in its own; a document's
 * refusal, once (a phone two people share is asked once). Only what counts
 * as told counts (`notice_told`), and never the notice itself (its own try).
 */
create or replace function public.notice_already_told(
  target_org uuid,
  target_kind text,
  target_occurrence text,
  target_person uuid,
  target_phone text,
  target_hearing uuid,
  target_proceeding uuid,
  target_about timestamptz,
  target_opens timestamptz,
  target_since timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.client_notices n
    join public.wa_messages m on m.id = n.message_id
    where n.org_id = target_org
      and (n.person_id = target_person or n.phone = any (public.wa_phone_variants(target_phone)))
      and not (n.person_id = target_person and n.kind = target_kind and n.occurrence = target_occurrence)
      and public.notice_told(m.status, m.error_code, n.attempts, n.reserved_at)
      and case target_kind
        when 'hearing_reminder' then n.hearing_id = target_hearing and n.about_at = target_about
             and n.kind in ('hearing_reminder', 'hearing_change') and n.reserved_at >= target_opens
        when 'hearing_change' then n.kind = 'hearing_change' and n.hearing_id = target_hearing
             and n.reserved_at >= target_since
        when 'lawsuit_update' then n.proceeding_id = target_proceeding
             and n.reserved_at > now() - make_interval(days => greatest(public.notices_setting('update_quiet_days', 7), 0))
        when 'payment_alert' then n.kind = 'payment_alert' and n.proceeding_id = target_proceeding
             and n.reserved_at > now() - make_interval(days => greatest(public.notices_setting('payment_alert_quiet_days', 30), 0))
        when 'document_refused' then n.kind = 'document_refused' and n.occurrence = target_occurrence
        else false
      end
  );
$$;

revoke all on function public.notice_already_told(uuid, text, text, uuid, text, uuid, uuid, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;

-- ---------- What is due ----------

/**
 * Every notice of a firm that is due now (or of one case), recomputed from
 * the data: its kind and occurrence, the order of the line, who it goes to
 * and at which phone, about what, the window it may go in, the zone whose day
 * it goes in and whether it may go from the earlier hour of a same-day
 * notice, the values of its template, and why it cannot go when it cannot
 * (the kind is off, its template is not approved, no number, the number's
 * connection failed, the person has no number, did not agree, or asked to
 * stop). Nothing already told (`notice_already_told`) is due. A notice
 * already reserved is not due again, unless its message did not go out for
 * a reason that says so and it has tries left: then it is due again, as
 * itself, once its wait passed (each wait twice the one before). A notice of
 * a hearing or of a payment waits the setting's minutes after a person last
 * wrote what it tells, so a mistake corrected at once never reaches the
 * client.
 *
 *   hearing_reminder  each step of a hearing to come (a month, a week, the day
 *                     before, the day), in the step's window of the hearing's
 *                     own days;
 *   hearing_change    a hearing somebody of the lawsuit was told of (they or
 *                     the phone they share; by a reminder, a change, or a word
 *                     on the lawsuit that named it, which went or may have
 *                     gone) moved, was cancelled while what they were told of
 *                     was still to come, or was put back after they were told
 *                     it was cancelled: once per change;
 *   lawsuit_update    each fifteen days from the filing of a lawsuit the court
 *                     has, while the case goes on, naming the next hearing;
 *   payment_alert     a publication of the lawsuit a person triaged as a
 *                     payment, in the days after;
 *   document_refused  a document of the client's the firm refused (ONE's
 *                     check or a person), still owed (`case_document_owed`)
 *                     and not answered by a newer one sent after it, of a case
 *                     that still takes papers on the client's link: who it is
 *                     of, or who answers for them (`document_recipient`), is
 *                     asked for it again with the reason, which paper (the day
 *                     it was sent) and, for a client of another case going at
 *                     the firm, which trip, once per refusal, in the days
 *                     after, in the hours of their own state's day.
 */
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
             coalesce(lead(s.opens) over (order by s.days desc), h.starts_at - day_lead) as closes
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
      and h.changed_at <= now() - settle
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
           case when h.status = 'cancelled' then h.starts_at else h.starts_at - day_lead end,
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
      and h.changed_at <= now() - settle
      and (
        (h.status = 'scheduled' and h.starts_at > now() + day_lead)
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
        select 1 from public.hearings h where h.proceeding_id = pr.id and h.changed_at > now() - settle
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
    where pub.org_id = target_org and pub.active and pub.category = 'pagamento' and pub.triaged_by is not null
      and pub.triaged_at <= now() - settle
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

-- ---------- Reserving them ----------

/** The firms with a kind of notice on: the ones the sweep reserves for. Service role only. */
create or replace function public.notice_firms()
returns table (org_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query select distinct k.org_id from public.firm_notice_kinds k where k.enabled order by k.org_id;
end;
$$;

revoke all on function public.notice_firms() from public, anon, authenticated;

/**
 * Reserves the notices of a firm that are due now and may go: what cannot
 * wait first, within the firm's notices of the last 24 hours (the setting's
 * ceiling, part of it kept for what is about a hearing), in the hours of the
 * day of the place each one is about (from the earlier hour for what is about
 * a hearing of the morning of that very day). Each notice is
 * written with its message to the outbox in the same statement, to the
 * person's phone through a number whose connection holds: the outbox sends it
 * once, and a notice is never reserved twice (one firm's sweeps take turns).
 * What this run reserved counts as it would on the next run. A conversation
 * where somebody waits for an answer stays said as waiting. Service role only.
 */
create or replace function public.reserve_client_notices(target_org uuid, target_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  from_hour integer := least(greatest(public.notices_setting('send_from_hour', 8), 0), 23);
  early_hour integer := least(greatest(public.notices_setting('same_day_from_hour', 6), 0), 23);
  until_hour integer := least(greatest(public.notices_setting('send_until_hour', 20), 1), 24);
  urgent integer := greatest(public.notices_setting('urgent_room', 25), 0);
  most integer := least(greatest(coalesce(target_limit, 50), 1), 500);
  room integer;
  item record;
  template public.wa_templates%rowtype;
  sender public.wa_numbers%rowtype;
  conversation uuid;
  message uuid;
  rendered text;
  reserved uuid[] := '{}';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('client_notices:' || target_org::text, 0));
  room := greatest(public.notices_setting('daily_max', 250), 0)
    - (select count(*)::integer from public.client_notices n where n.org_id = target_org and n.reserved_at > now() - interval '24 hours');
  if room <= 0 then
    return jsonb_build_object('ok', true, 'reserved', 0, 'messages', '[]'::jsonb, 'room', 0);
  end if;

  for item in
    select c.* from public.notice_candidates(target_org, null) c
    where c.blocker is null and c.phone is not null and array_position(c.params, null) is null
      and extract(hour from now() at time zone c.zone) >= case when c.early then least(early_hour, from_hour) else from_hour end
      and extract(hour from now() at time zone c.zone) < until_hour
    order by c.priority, c.about_at nulls last, c.opens
    limit least(room, most)
  loop
    -- The room kept for what is about a hearing: the word on a lawsuit and the warning go while more is left.
    if item.priority > 2 and room - cardinality(reserved) <= urgent then
      continue;
    end if;
    -- What this run reserved before counts as it would on the next run: a change stands for the reminder of its
    -- moment, a word on a lawsuit waits after anything else of it, one warning is enough, a phone is told once.
    if public.notice_already_told(target_org, item.kind, item.occurrence, item.person_id, item.phone, item.hearing_id,
         item.proceeding_id, item.about_at, item.opens, item.since) then
      continue;
    end if;
    select t.* into template from public.wa_templates t
    join public.firm_notice_kinds k on k.template_id = t.id
    where k.org_id = target_org and k.kind = item.kind;
    if template.param_count <> cardinality(item.params) then
      continue;
    end if;
    -- The number: one of the template's account the person already talks to, or the oldest one of it; never one
    -- whose connection failed.
    select n.* into sender from public.wa_numbers n
    join public.connections cn on cn.id = n.connection_id and cn.status = 'connected'
    left join public.wa_conversations wc on wc.number_id = n.id and wc.contact_wa_id = any (public.wa_phone_variants(item.phone))
    where n.org_id = target_org and n.waba_id = template.waba_id and n.status = 'active'
    order by (wc.id is not null) desc, wc.last_inbound_at desc nulls last, n.connected_at
    limit 1;
    if sender.id is null then
      continue;
    end if;
    select wc.id into conversation from public.wa_conversations wc
    where wc.number_id = sender.id and wc.contact_wa_id = any (public.wa_phone_variants(item.phone))
    order by wc.last_inbound_at desc nulls last
    limit 1;
    if conversation is null then
      conversation := public.wa_open_conversation(target_org, sender.id, item.phone, null);
    end if;
    rendered := public.notice_rendered(template.body, item.params);

    insert into public.wa_messages (
      org_id, conversation_id, number_id, direction, origin, kind, body, template_id, template_name, template_params, status
    ) values (
      target_org, conversation, sender.id, 'out', 'cloud', 'template', rendered, template.id, template.name,
      to_jsonb(item.params), 'queued'
    )
    returning id into message;

    update public.wa_conversations set
      last_message_at = now(),
      last_message_preview = public.wa_preview('template', rendered),
      last_message_direction = 'out'
    where id = conversation
      and not (last_message_direction = 'in' and last_inbound_at is not null and last_inbound_at >= last_message_at);

    -- The moment each notice was written, never the run's: what a person was told last is read by it.
    if item.notice_id is null then
      insert into public.client_notices (
        org_id, case_id, person_id, phone, proceeding_id, hearing_id, publication_id, document_id, kind, occurrence,
        about_at, params, message_id, reserved_at
      ) values (
        target_org, item.case_id, item.person_id, item.phone, item.proceeding_id, item.hearing_id, item.publication_id,
        item.document_id, item.kind, item.occurrence, item.about_at, to_jsonb(item.params), message, clock_timestamp()
      );
    else
      -- Tried again as it is now: a word on a lawsuit names the hearing it names today.
      update public.client_notices set
        message_id = message, attempts = attempts + 1, params = to_jsonb(item.params), phone = item.phone,
        case_id = item.case_id, proceeding_id = item.proceeding_id, hearing_id = item.hearing_id,
        publication_id = item.publication_id, document_id = item.document_id, about_at = item.about_at,
        reserved_at = clock_timestamp()
      where id = item.notice_id;
    end if;
    reserved := reserved || message;
    conversation := null;
    sender := null;
  end loop;

  return jsonb_build_object('ok', true, 'reserved', cardinality(reserved), 'messages', to_jsonb(reserved),
                            'room', room - cardinality(reserved));
end;
$$;

revoke all on function public.reserve_client_notices(uuid, integer) from public, anon, authenticated;

-- ---------- The firm's templates and kinds ----------

/**
 * Who manages the firm starts submitting the template of a kind of notice:
 * the platform's text or the firm's own, which keeps the kind's values, each
 * once and in order, and neither starts nor ends with one. The answer is what
 * the backend submits to the vendor: the name (the kind's, then a number not
 * used in the account), the language, the category, the footer and an
 * example of each value, with the number whose account takes it. Never a
 * support visit; with the second factor.
 */
create or replace function public.begin_notice_template(target_org uuid, target_kind text, target_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  kind_row public.notice_kinds%rowtype;
  body_value text := btrim(regexp_replace(coalesce(target_body, ''), '\{\{\s*([0-9]{1,2})\s*\}\}', '{{\1}}', 'g'));
  found_slots integer[];
  sender public.wa_numbers%rowtype;
  accounts integer;
  next_number integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();

  select * into kind_row from public.notice_kinds where kind = target_kind;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind');
  end if;
  if char_length(body_value) not between 20 and 1024 then
    return jsonb_build_object('ok', false, 'code', 'invalid_body', 'field', 'body');
  end if;
  select coalesce(array_agg(match[1]::integer order by position), '{}') into found_slots
  from regexp_matches(body_value, '\{\{\s*([0-9]{1,2})\s*\}\}', 'g') with ordinality as found (match, position);
  if found_slots <> array(select generate_series(1, cardinality(kind_row.params))) then
    return jsonb_build_object('ok', false, 'code', 'invalid_values', 'field', 'body');
  end if;
  if body_value ~ '^\{\{' or body_value ~ '\}\}$' then
    return jsonb_build_object('ok', false, 'code', 'value_at_edge', 'field', 'body');
  end if;

  select count(distinct n.waba_id) into accounts from public.wa_numbers n where n.org_id = target_org and n.status = 'active';
  if accounts = 0 then
    return jsonb_build_object('ok', false, 'code', 'no_number');
  end if;
  if accounts > 1 then
    return jsonb_build_object('ok', false, 'code', 'several_accounts');
  end if;
  select * into sender from public.wa_numbers n
  where n.org_id = target_org and n.status = 'active'
  order by n.connected_at
  limit 1;

  select coalesce(max(substring(t.name from '_([0-9]+)$')::integer), 0) + 1 into next_number
  from public.wa_templates t
  where t.org_id = target_org and t.waba_id = sender.waba_id and t.name ~ ('^' || kind_row.template_base || '_[0-9]+$');

  return jsonb_build_object(
    'ok', true,
    'name', kind_row.template_base || '_' || next_number,
    'language', 'pt_BR',
    'category', 'utility',
    'body', body_value,
    'footer', kind_row.footer,
    'examples', to_jsonb(kind_row.examples),
    'number', jsonb_build_object(
      'provider', sender.provider, 'connection_id', sender.connection_id,
      'phone_number_id', sender.phone_number_id, 'waba_id', sender.waba_id
    )
  );
end;
$$;

revoke all on function public.begin_notice_template(uuid, text, text) from public, anon;
grant execute on function public.begin_notice_template(uuid, text, text) to authenticated;

/**
 * The vendor took a template of a kind of notice: ONE keeps it as the
 * account's (`wa_templates`, as a sync would) and as the kind's template. A
 * kind that is off takes it as its template, still off until a person
 * switches it on with the template approved. A kind that is on keeps going
 * as it was and holds the new one as waiting: once the vendor approves it as
 * a utility message, it takes the kind's place by itself
 * (`promote_notice_template`). Service role only.
 */
create or replace function public.record_notice_template(
  target_org uuid,
  target_kind text,
  target_waba text,
  target_name text,
  target_status text,
  target_category text,
  target_body text,
  target_footer text,
  target_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  template uuid;
  current_kind public.firm_notice_kinds%rowtype;
  waiting boolean;
  status_value text := case when lower(coalesce(target_status, '')) in ('approved', 'pending', 'rejected', 'paused', 'disabled')
                            then lower(target_status) else 'pending' end;
  category_value text := case when lower(coalesce(target_category, '')) in ('marketing', 'utility', 'authentication')
                              then lower(target_category) else 'utility' end;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.notice_kinds k where k.kind = target_kind) then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind');
  end if;
  if not exists (select 1 from public.wa_numbers n where n.org_id = target_org and n.waba_id = target_waba) then
    return jsonb_build_object('ok', false, 'code', 'account_not_found');
  end if;
  insert into public.wa_templates (org_id, waba_id, name, language, category, status, body, footer_text, param_count)
  values (target_org, target_waba, target_name, 'pt_BR', category_value, status_value, target_body, target_footer,
          (select count(distinct m[1]) from regexp_matches(target_body, '\{\{\s*([0-9]{1,2})\s*\}\}', 'g') as m))
  on conflict (org_id, waba_id, name, language) do update set
    category = excluded.category, status = excluded.status, body = excluded.body,
    footer_text = excluded.footer_text, param_count = excluded.param_count, synced_at = now()
  returning id into template;

  select * into current_kind from public.firm_notice_kinds k
  where k.org_id = target_org and k.kind = target_kind
  for update;
  waiting := found and current_kind.enabled and current_kind.template_id is distinct from template;
  if waiting then
    update public.firm_notice_kinds set
      pending_template_id = template, pending_body = target_body, submitted_by = target_by, submitted_at = now()
    where org_id = target_org and kind = target_kind;
  else
    insert into public.firm_notice_kinds (org_id, kind, template_id, body, enabled, submitted_by, submitted_at, changed_by, changed_at)
    values (target_org, target_kind, template, target_body, false, target_by, now(), target_by, now())
    on conflict (org_id, kind) do update set
      template_id = excluded.template_id, body = excluded.body, pending_template_id = null, pending_body = null,
      submitted_by = excluded.submitted_by, submitted_at = now(), changed_by = excluded.changed_by, changed_at = now();
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, target_by, 'notices.template_submitted', 'notice_kind', target_kind,
    jsonb_build_object('template', target_name, 'status', status_value, 'category', category_value, 'waiting', waiting));
  -- Approved at once (a utility message may be): a waiting text takes the kind's place now.
  if waiting then
    perform public.promote_notice_template(template);
  end if;
  return jsonb_build_object('ok', true, 'code', 'recorded', 'template_id', template, 'status', status_value,
                            'category', category_value, 'waiting', waiting);
exception when check_violation then
  return jsonb_build_object('ok', false, 'code', 'invalid_value');
end;
$$;

revoke all on function public.record_notice_template(uuid, text, text, text, text, text, text, text, uuid) from public, anon, authenticated;

/** A waiting text the vendor approved as a utility message takes its kind's place, on the record. */
create or replace function public.promote_notice_template(target_template uuid)
returns void
language sql
security definer
set search_path = public
as $$
  with promoted as (
    update public.firm_notice_kinds k set
      template_id = k.pending_template_id,
      body = k.pending_body,
      pending_template_id = null,
      pending_body = null,
      changed_at = now()
    from public.wa_templates t
    where k.pending_template_id = target_template and t.id = target_template
      and t.status = 'approved' and t.category = 'utility'
    returning k.org_id, k.kind, t.name
  )
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  select p.org_id, null, 'notices.template_in_use', 'notice_kind', p.kind, jsonb_build_object('template', p.name)
  from promoted p;
$$;

revoke all on function public.promote_notice_template(uuid) from public, anon, authenticated;

create or replace function public.notice_template_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and new.category = 'utility'
     and (old.status, old.category) is distinct from (new.status, new.category) then
    perform public.promote_notice_template(new.id);
  end if;
  return null;
end;
$$;

revoke all on function public.notice_template_decided() from public, anon, authenticated;

-- What the vendor decided reaches the template by its webhook or by a reading of the account.
create trigger wa_templates_notice_decided after update of status, category on public.wa_templates
  for each row execute function public.notice_template_decided();

/**
 * The vendor changed a template's category (a utility message it now calls
 * marketing, or the other way): only a template ONE knows is touched, in the
 * firms with a number of that provider in the account. A notice whose
 * template is no longer a utility message stops going (`notice_kind_route`),
 * and a new text waiting for the vendor takes its kind's place only as one
 * (`wa_templates_notice_decided`). A word this code does not know changes
 * nothing. Service role only.
 */
create or replace function public.wa_set_template_category(
  target_provider text,
  target_waba_id text,
  target_name text,
  target_language text,
  target_category text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  word text := lower(btrim(coalesce(target_category, '')));
  changed integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if word not in ('marketing', 'utility', 'authentication') then
    return jsonb_build_object('ok', false, 'code', 'ignored');
  end if;
  update public.wa_templates t set category = word, synced_at = now()
  where t.waba_id = target_waba_id and t.name = target_name
    and (target_language is null or t.language = target_language)
    and t.category <> word
    and exists (
      select 1 from public.wa_numbers n
      where n.org_id = t.org_id and n.provider = target_provider and n.waba_id = target_waba_id
    );
  get diagnostics changed = row_count;
  return jsonb_build_object('ok', true, 'changed', changed);
end;
$$;

revoke all on function public.wa_set_template_category(text, text, text, text, text) from public, anon, authenticated;

/**
 * Who manages the firm switches a kind of notice on (its template approved by
 * the vendor as a utility message, and a number of its account active) or
 * off. Never a support visit; with the second factor.
 */
create or replace function public.set_notice_kind(target_org uuid, target_kind text, target_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  current_kind public.firm_notice_kinds%rowtype;
  blocker text;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if target_enabled is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_value');
  end if;
  select * into current_kind from public.firm_notice_kinds where org_id = target_org and kind = target_kind for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', case when target_enabled then 'no_template' else 'unchanged' end);
  end if;
  if current_kind.enabled = target_enabled then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  if target_enabled then
    -- As the line would read it, with the kind on.
    select case
      when t.id is null then 'no_template'
      when t.status <> 'approved' then 'template_not_approved'
      when t.category <> 'utility' then 'template_not_utility'
      when not exists (select 1 from public.wa_numbers n where n.org_id = target_org and n.waba_id = t.waba_id and n.status = 'active')
        then 'no_number'
      when not exists (
        select 1 from public.wa_numbers n
        join public.connections c on c.id = n.connection_id
        where n.org_id = target_org and n.waba_id = t.waba_id and n.status = 'active' and c.status = 'connected'
      ) then 'number_failing'
    end into blocker
    from (select current_kind.template_id as id) chosen
    left join public.wa_templates t on t.id = chosen.id;
    if blocker is not null then
      return jsonb_build_object('ok', false, 'code', blocker);
    end if;
  end if;
  update public.firm_notice_kinds set enabled = target_enabled, changed_by = caller, changed_at = now()
  where org_id = target_org and kind = target_kind;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, case when target_enabled then 'notices.kind_on' else 'notices.kind_off' end,
    'notice_kind', target_kind, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'code', case when target_enabled then 'on' else 'off' end);
end;
$$;

revoke all on function public.set_notice_kind(uuid, text, boolean) from public, anon;
grant execute on function public.set_notice_kind(uuid, text, boolean) to authenticated;

-- ---------- Agreeing to be told ----------

/** What a person agrees to, word for word, for a number: on their link, or as the firm records it. */
create or replace function public.notice_optin_wording(target_source text, target_firm text, target_phone text)
returns text
language sql
immutable
as $$
  select case target_source
    when 'client' then 'Quero receber pelo WhatsApp, no número ' || public.phone_formatted(target_phone)
      || ', os avisos do meu processo enviados pelo escritório ' || target_firm
      || ': lembretes e mudanças de audiência, atualizações do andamento, alertas de segurança e pedidos para reenviar um documento recusado. Posso deixar de receber quando quiser, por este link ou respondendo SAIR.'
    else 'A pessoa concordou em receber pelo WhatsApp, no número ' || public.phone_formatted(target_phone)
      || ', os avisos do processo enviados pelo escritório ' || target_firm
      || ': lembretes e mudanças de audiência, atualizações do andamento, alertas de segurança e pedidos para reenviar um documento recusado.'
  end;
$$;

revoke all on function public.notice_optin_wording(text, text, text) from public, anon, authenticated;

/**
 * A person of the firm records that somebody of a case agreed to be told on
 * WhatsApp, at the number the firm has for them, saying how they agreed (in
 * the contract, in a conversation); or that they asked to stop, saying how.
 * Nothing is rewritten: an agreement for another number ends the one before,
 * and stopping ends the one in force; each stays on record. Anybody of the
 * firm; never a support visit.
 */
create or replace function public.record_notice_optin(target_case uuid, target_person uuid, target_agreed boolean, target_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  person public.people%rowtype;
  current_optin public.notice_optins%rowtype;
  note_value text := nullif(left(btrim(regexp_replace(coalesce(target_note, ''), '[[:cntrl:]]+', ' ', 'g')), 500), '');
  firm text;
begin
  -- The person's row is held: two agreements given at once take turns, and the second finds the first.
  select * into person from public.people p
  where p.id = target_person and p.org_id = current_case.org_id
    and exists (select 1 from public.case_parties cp where cp.case_id = current_case.id and cp.person_id = p.id)
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'person_not_found');
  end if;
  if target_agreed is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_value');
  end if;
  if note_value is null or char_length(note_value) < 8 then
    return jsonb_build_object('ok', false, 'code', 'note_required', 'field', 'note');
  end if;
  select * into current_optin from public.notice_optins o where o.person_id = person.id and o.ended_at is null for update;

  if not target_agreed then
    if current_optin.id is null then
      return jsonb_build_object('ok', true, 'code', 'unchanged');
    end if;
    update public.notice_optins set ended_at = now(), ended_source = 'firm', ended_by = auth.uid(), ended_note = note_value
    where id = current_optin.id;
    perform public.record_case_event(current_case.org_id, current_case.id, 'notices_withdrawn', 'person',
      jsonb_build_object('person', person.id));
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (current_case.org_id, auth.uid(), 'notices.optin_withdrawn', 'person', person.id::text,
      jsonb_build_object('optin', current_optin.id));
    return jsonb_build_object('ok', true, 'code', 'withdrawn');
  end if;

  if person.phone is null then
    return jsonb_build_object('ok', false, 'code', 'no_phone');
  end if;
  if current_optin.id is not null and current_optin.phone = person.phone then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  if current_optin.id is not null then
    update public.notice_optins set ended_at = now(), ended_source = 'replaced', ended_by = auth.uid()
    where id = current_optin.id;
  end if;
  select o.name into firm from public.organizations o where o.id = current_case.org_id;
  insert into public.notice_optins (person_id, org_id, phone, source, wording, note, recorded_by)
  values (person.id, current_case.org_id, person.phone, 'firm', public.notice_optin_wording('firm', firm, person.phone),
          note_value, auth.uid());
  perform public.record_case_event(current_case.org_id, current_case.id, 'notices_agreed', 'person',
    jsonb_build_object('person', person.id));
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'notices.optin_recorded', 'person', person.id::text,
    jsonb_build_object('source', 'firm'));
  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.record_notice_optin(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.record_notice_optin(uuid, uuid, boolean, text) to authenticated;

-- ---------- What the firm reads ----------

/**
 * The firm's notices, for its settings: each kind with the text the platform
 * proposes, what each value is, the template the firm submitted with what the
 * vendor decided of it, and whether it is on; the notices of the last 24 hours
 * against the ceiling, and the number they go from. Anybody of the firm reads
 * it; who manages it acts on it.
 */
create or replace function public.firm_notices(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'daily_max', greatest(public.notices_setting('daily_max', 250), 0),
    'last_day', (select count(*) from public.client_notices n where n.org_id = target_org and n.reserved_at > now() - interval '24 hours'),
    -- When the reminders and the word on a lawsuit go, as the setting says: the screen words them.
    'hearing_days', coalesce((
      select jsonb_agg(distinct (item ->> 'days')::integer)
      from jsonb_array_elements(coalesce(public.notices_setting_json('hearing_steps'), '[]'::jsonb)) item
      where item ->> 'days' ~ '^[0-9]{1,3}$'
    ), '[]'::jsonb),
    'update_days', greatest(public.notices_setting('update_days', 15), 1),
    'accounts', (select count(distinct n.waba_id) from public.wa_numbers n where n.org_id = target_org and n.status = 'active'),
    'kinds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', k.kind,
        'proposed', k.body,
        'footer', k.footer,
        'params', to_jsonb(k.params),
        'examples', to_jsonb(k.examples),
        'enabled', coalesce(f.enabled, false),
        'body', f.body,
        'submitted_at', f.submitted_at,
        'template', case when t.id is null then null else jsonb_build_object(
          'name', t.name, 'status', t.status, 'category', t.category) end,
        'pending', case when pt.id is null then null else jsonb_build_object(
          'name', pt.name, 'status', pt.status, 'category', pt.category, 'body', f.pending_body) end,
        'blocker', (select r.blocker from public.notice_kind_route(target_org, k.kind) r)
      ) order by k.position)
      from public.notice_kinds k
      left join public.firm_notice_kinds f on f.org_id = target_org and f.kind = k.kind
      left join public.wa_templates t on t.id = f.template_id
      left join public.wa_templates pt on pt.id = f.pending_template_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.firm_notices(uuid) from public, anon;
grant execute on function public.firm_notices(uuid) to authenticated;

/**
 * A case's notices, for its card: the people of the case who may be told
 * (its adults, and who answers for a minor), each with their number, whether
 * and how they agreed, and why they cannot be told when they cannot; the
 * notices sent, the latest first, with what became of each message; and the
 * ones due now with why each cannot go. Anybody of the firm.
 */
create or replace function public.case_notices(target_case uuid)
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
  return jsonb_build_object(
    'kinds_on', coalesce((
      select jsonb_agg(f.kind order by f.kind) from public.firm_notice_kinds f
      where f.org_id = current_case.org_id and f.enabled
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', p.id,
        'name', p.full_name,
        'phone', p.phone,
        'optin', case when o.person_id is null then null else jsonb_build_object(
          'source', o.source, 'phone', o.phone, 'note', o.note, 'recorded_at', o.recorded_at,
          'recorded_by', o.recorded_by, 'current', o.phone is not distinct from p.phone) end,
        'blocker', public.notice_person_blocker(current_case.org_id, p.id)
      ) order by p.full_name)
      from public.people p
      left join public.notice_optins o on o.person_id = p.id and o.ended_at is null
      where p.id in (
        select cp.person_id from public.case_parties cp
        join public.people pp on pp.id = cp.person_id
        where cp.case_id = current_case.id
          and (cp.role = 'guardian' or (cp.guardian_id is null and (pp.birth_date is null
               or pp.birth_date <= ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date)))
      )
    ), '[]'::jsonb),
    'sent', coalesce((
      select jsonb_agg(item order by (item ->> 'reserved_at') desc)
      from (
        select jsonb_build_object(
          'id', n.id, 'kind', n.kind, 'person_id', n.person_id, 'reserved_at', n.reserved_at, 'attempts', n.attempts,
          'about_at', n.about_at, 'status', m.status, 'error', m.error_code, 'body', m.body
        ) as item
        from public.client_notices n
        join public.wa_messages m on m.id = n.message_id
        where n.case_id = current_case.id
        order by n.reserved_at desc
        limit 30
      ) latest
    ), '[]'::jsonb),
    'due', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', c.kind, 'person_id', c.person_id, 'about_at', c.about_at, 'hearing_id', c.hearing_id,
        'proceeding_id', c.proceeding_id, 'blocker', c.blocker
      ) order by c.priority, c.about_at nulls last)
      from public.notice_candidates(current_case.org_id, current_case.id) c
      where c.blocker is distinct from 'kind_off'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.case_notices(uuid) from public, anon;
grant execute on function public.case_notices(uuid) to authenticated;

-- ---------- What the client reads and says on their link ----------

/**
 * Whether the client of a link is told on WhatsApp: the number the firm has
 * for them, whether they agreed for it and how, whether they asked the firm
 * to stop, and the words they would agree to now.
 */
create or replace function public.client_link_notices(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  person public.people%rowtype;
  optin public.notice_optins%rowtype;
  firm text;
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now()
     or not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id) then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  select * into person from public.people where id = link.person_id;
  select * into optin from public.notice_optins o where o.person_id = person.id and o.ended_at is null;
  select o.name into firm from public.organizations o where o.id = link.org_id;
  return jsonb_build_object(
    'ok', true,
    -- The firm tells its clients something on WhatsApp: a kind of notice is on.
    'active', exists (select 1 from public.firm_notice_kinds k where k.org_id = link.org_id and k.enabled),
    'phone', person.phone,
    'agreed', optin.person_id is not null and optin.phone is not distinct from person.phone,
    'agreed_source', case when optin.phone is not distinct from person.phone then optin.source end,
    'agreed_at', case when optin.phone is not distinct from person.phone then optin.recorded_at end,
    'opted_out', person.phone is not null and exists (
      select 1 from public.wa_optouts w
      where w.org_id = link.org_id and w.contact_wa_id = any (public.wa_phone_variants(person.phone))
    ),
    'wording', case when person.phone is null then null else public.notice_optin_wording('client', firm, person.phone) end
  );
end;
$$;

revoke all on function public.client_link_notices(text) from public;
grant execute on function public.client_link_notices(text) to anon, authenticated;

/**
 * The client agrees, on their link, to be told on WhatsApp at the number the
 * firm has for them, in the very words the link showed them (`target_wording`:
 * when the number or the firm's name changed since, nothing is recorded and
 * the page reads again); or stops. Nothing is rewritten: each agreement stays
 * on record with what the server saw of the request, and stopping ends the one
 * in force. A link is no switch to flip without end: it agrees a few times a
 * day, and stops whenever asked. Called by the backend only: the evidence is
 * never the caller's to write.
 */
create or replace function public.client_link_set_notices(
  target_token text,
  target_agree boolean,
  target_wording text default null,
  target_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  person public.people%rowtype;
  current_optin public.notice_optins%rowtype;
  evidence jsonb := coalesce(target_evidence, '{}'::jsonb);
  firm text;
  wording text;
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now()
     or not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id) then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_agree is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_value');
  end if;
  -- The person's row is held: two answers given at once take turns, and the second finds the first.
  select * into person from public.people where id = link.person_id for update;
  select * into current_optin from public.notice_optins o where o.person_id = person.id and o.ended_at is null for update;

  if not target_agree and current_optin.id is null then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  if target_agree then
    if person.phone is null then
      return jsonb_build_object('ok', false, 'code', 'no_phone');
    end if;
    select o.name into firm from public.organizations o where o.id = link.org_id;
    wording := public.notice_optin_wording('client', firm, person.phone);
    if target_wording is distinct from wording then
      return jsonb_build_object('ok', false, 'code', 'wording_changed');
    end if;
    if current_optin.id is not null and current_optin.phone = person.phone then
      return jsonb_build_object('ok', true, 'code', 'unchanged');
    end if;
    -- Stopping is always taken; agreeing again, a few times a day.
    if (
      select count(*) from public.notice_optins o
      where o.person_id = person.id and o.source = 'client' and o.recorded_at > now() - interval '24 hours'
    ) >= greatest(public.notices_setting('optin_changes_per_day', 10), 1) then
      return jsonb_build_object('ok', false, 'code', 'too_many');
    end if;
  end if;

  if not target_agree then
    update public.notice_optins set ended_at = now(), ended_source = 'client' where id = current_optin.id;
    perform public.record_case_event(link.org_id, link.case_id, 'notices_withdrawn', 'client',
      jsonb_build_object('person', person.id));
    return jsonb_build_object('ok', true, 'code', 'withdrawn');
  end if;

  if current_optin.id is not null then
    update public.notice_optins set ended_at = now(), ended_source = 'replaced' where id = current_optin.id;
  end if;
  evidence := jsonb_strip_nulls(jsonb_build_object(
    'user_agent', left(case when jsonb_typeof(evidence) = 'object' then evidence ->> 'user_agent' end, 300),
    'ip', left(case when jsonb_typeof(evidence) = 'object' then evidence ->> 'ip' end, 64),
    'channel', 'link'
  ));
  insert into public.notice_optins (person_id, org_id, phone, source, wording, link_id, evidence)
  values (person.id, link.org_id, person.phone, 'client', wording, link.id, evidence);
  perform public.record_case_event(link.org_id, link.case_id, 'notices_agreed', 'client',
    jsonb_build_object('person', person.id));
  return jsonb_build_object('ok', true, 'code', 'agreed');
end;
$$;

revoke all on function public.client_link_set_notices(text, boolean, text, jsonb) from public, anon, authenticated;

/**
 * The client's lawsuits, as their link shows them: the lawsuits of the
 * people the link answers for, each with its number, court and when it was
 * filed, the next hearing with how to be there, and the latest movements the
 * court registered (what happened and when; never their details). The words
 * are the court's.
 */
create or replace function public.client_link_course(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now()
     or not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id) then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  return jsonb_build_object(
    'ok', true,
    'lawsuits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'kind', pr.kind,
        'court', pr.court,
        'comarca', pr.comarca,
        'cnj', pr.cnj,
        'status', pr.status,
        'filed_at', pr.filed_at,
        -- The zone of the court's seat: the day of a movement is said in it.
        'time_zone', coalesce((select c.time_zone from public.courts c where c.acronym = pr.court), 'America/Sao_Paulo'),
        'checked_at', (select t.checked_at from public.proceeding_tracking t where t.proceeding_id = pr.id),
        'next_hearing', (
          select jsonb_build_object('kind', h.kind, 'starts_at', h.starts_at, 'time_zone', h.time_zone,
                                    'mode', h.mode, 'place', h.place, 'link', h.link)
          from public.hearings h
          where h.proceeding_id = pr.id and h.status = 'scheduled' and h.starts_at > now()
            and not public.hearing_publication_cancelled(h.id, h.publication_id)
          order by h.starts_at limit 1
        ),
        'movements', coalesce((
          select jsonb_agg(jsonb_build_object('occurred_at', mv.occurred_at, 'title', mv.title) order by mv.occurred_at desc)
          from (
            select m.occurred_at, m.title from public.movements m
            where m.proceeding_id = pr.id order by m.occurred_at desc limit 5
          ) mv
        ), '[]'::jsonb)
      ) order by pr.filed_at desc nulls last)
      from public.proceedings pr
      where pr.case_id = link.case_id and pr.status in ('filed', 'closed') and pr.cnj is not null
        and exists (
          select 1 from public.proceeding_parties pp
          where pp.proceeding_id = pr.id
            and pp.party_id in (select lp.party_id from public.client_link_people(link) lp)
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.client_link_course(text) from public;
grant execute on function public.client_link_course(text) to anon, authenticated;

-- ---------- The hearings whose client will not be told ----------

/**
 * True when the firm reminds clients of hearings and somebody of this
 * lawsuit will not be reminded: the reminder cannot go at all (its template
 * is not approved, no number), the lawsuit has nobody to tell, or somebody
 * of it has no WhatsApp, did not agree, or asked to stop.
 */
create or replace function public.hearing_unwarned(target_org uuid, target_proceeding uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.firm_notice_kinds k
      where k.org_id = target_org and k.kind = 'hearing_reminder' and k.enabled
    )
    and (
      (select r.blocker from public.notice_kind_route(target_org, 'hearing_reminder') r) is not null
      or not exists (select 1 from public.notice_recipients(target_proceeding))
      or exists (
        select 1 from public.notice_recipients(target_proceeding) r
        where public.notice_person_blocker(target_org, r.person_id) is not null
      )
    );
$$;

revoke all on function public.hearing_unwarned(uuid, uuid) from public, anon, authenticated;

/** Of some hearings of the firm, the ones to come whose client will not be told of them. Anybody of the firm. */
create or replace function public.firm_hearings_unwarned(target_org uuid, target_hearings uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return coalesce((
    select array_agg(h.id order by h.starts_at)
    from public.hearings h
    where h.org_id = target_org and h.id = any (coalesce(target_hearings, '{}'))
      and h.status = 'scheduled' and h.starts_at > now()
      and public.hearing_unwarned(target_org, h.proceeding_id)
  ), '{}');
end;
$$;

revoke all on function public.firm_hearings_unwarned(uuid, uuid[]) from public, anon;
grant execute on function public.firm_hearings_unwarned(uuid, uuid[]) to authenticated;

-- ---------- A link that lasts while the lawsuit goes on ----------

-- A link made for a case the court already has is the client's way to follow the lawsuit: it lasts longer.
update public.platform_settings
set value = value || jsonb_build_object('client_link_days_filed', 180)
where key = 'cases' and not (value ? 'client_link_days_filed');

/**
 * Gives a client their way in (replaces the one of 0022): a link for one
 * person of one case. The app mints the token and hands only its SHA-256
 * here. A new link for the same person and case ends the ones before it.
 * Never for a minor: the person who answers for them gets it. A link of a
 * case the court already has lasts the setting's longer time: the client
 * follows the lawsuit by it.
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
  filed boolean := exists (
    select 1 from public.proceedings pr where pr.case_id = current_case.id and pr.status = 'filed'
  );
  ends timestamptz := now() + make_interval(days => greatest(coalesce(
    case when filed
      then (public.cases_setting('client_link_days_filed') #>> '{}')::integer
      else (public.cases_setting('client_link_days') #>> '{}')::integer
    end,
    case when filed then 180 else 30 end), 1));
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

-- ---------- What needs somebody today ----------

/**
 * What needs somebody of the firm today (replaces the one of 0037), with the
 * hearings in the next days whose client will not be told of them: the firm
 * reminds clients of hearings, and somebody of the lawsuit has no WhatsApp,
 * did not agree or asked to stop, or the reminder cannot go at all.
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
  late_hours integer := greatest(public.publications_setting('late_hours', 24), 1);
  left_days integer := greatest(public.publications_setting('left_out_days', 7), 1);
  closing_hours integer := greatest(coalesce((public.wa_setting('closing_soon_hours') #>> '{}')::integer, 4), 1);
  soon integer := greatest(public.deadlines_setting('soon_days', 3), 0);
  watch integer := greatest(public.deadlines_setting('watch_days', 30), 1);
  hearing_soon integer := greatest(public.hearings_setting('soon_days', 7), 0);
  hearing_ends interval := make_interval(mins => greatest(public.hearings_setting('duration_minutes', 60), 1));
  today date := (now() at time zone 'America/Sao_Paulo')::date;
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
    'chronologies_contested', (
      select count(distinct s.case_id) from public.case_statements s
      join public.cases c on c.id = s.case_id
      where s.org_id = target_org and s.chronology_status = 'contested'
        and c.status not in ('closed', 'declined')
    ),
    'complaints_overdue', (
      select count(distinct a.case_id) from public.admin_complaints a
      join public.cases c on c.id = a.case_id
      where a.org_id = target_org and a.outcome = 'pending'
        and a.answer_due_on < today
        and c.status not in ('closed', 'declined')
    ),
    'filings_ready', (
      select count(*) from public.filing_packages p
      join public.cases c on c.id = p.case_id
      where p.org_id = target_org and p.status = 'ready' and c.status not in ('closed', 'declined')
        -- A package something now blocks is not one to file (0025).
        and public.filing_blocker(p.proceeding_id) is null
    ),
    'drafts_waiting', (
      select count(*) from public.case_drafts d
      join public.cases c on c.id = d.case_id
      join public.proceedings p on p.id = d.proceeding_id
      where d.org_id = target_org and c.status not in ('closed', 'declined') and p.status = 'planned'
        and (
          -- A text the AI is rewriting as a lawyer asked waits for nobody yet.
          (d.status = 'proposed' and d.work is distinct from 'revise' and not exists (
            select 1 from public.approvals a where a.run_id = d.run_id and a.status = 'pending'
          ))
          or d.status = 'failed'
          or (d.status = 'approved' and d.work is null)
        )
    ),
    'publications_new', (
      select count(*) from public.publications p
      where p.org_id = target_org and p.category is null and p.active
    ),
    'publications_cancelled', (
      select count(*) from public.publications p where p.org_id = target_org and p.cancel_pending
    ),
    'publications_to_review', (
      select count(*) from public.publications p where p.org_id = target_org and p.review_due and p.active
    ),
    'djen_late', (
      select count(*) from public.djen_captures c
      where c.org_id = target_org and c.active
        and coalesce(c.captured_at, c.created_at) < now() - make_interval(hours => late_hours)
    ) + (
      -- A registration no sweep has seen for that long: the reading itself is not running.
      select count(*) from public.oab_registrations r
      join public.memberships m on m.user_id = r.user_id
      where m.org_id = target_org
        and greatest(r.created_at, m.created_at) < now() - make_interval(hours => late_hours)
        and not exists (
          select 1 from public.djen_captures c where c.org_id = m.org_id and c.uf = r.uf and c.number = r.number
        )
    ),
    'djen_incomplete', (
      select count(*) from public.djen_captures c
      where c.org_id = target_org and c.active and c.last_skipped > 0
        and c.skipped_at > now() - make_interval(days => left_days)
    ),
    'djen_stopped', (
      select count(*) from public.djen_captures c
      where c.org_id = target_org and not c.active and c.user_id is not null
        and exists (
          select 1 from public.proceeding_lawyers pl
          join public.proceedings p on p.id = pl.proceeding_id
          where pl.org_id = c.org_id and pl.user_id = c.user_id and p.status = 'filed'
        )
    ),
    'movements_new', (
      select count(*) from public.proceeding_tracking t
      join public.cases c on c.id = t.case_id
      where t.org_id = target_org and t.status <> 'off' and t.unseen_count > 0 and c.status not in ('closed', 'declined')
    ),
    'tracking_failed', (
      select count(*) from public.proceeding_tracking t
      join public.cases c on c.id = t.case_id
      where t.org_id = target_org and t.status = 'failed' and t.unseen_count = 0 and c.status not in ('closed', 'declined')
    ),
    'deadlines_to_confirm', (
      select count(*) from public.deadlines d where d.org_id = target_org and d.status = 'proposed'
    ),
    'deadlines_soon', (
      select count(*) from public.deadlines d
      where d.org_id = target_org and d.status in ('proposed', 'confirmed')
        and public.deadline_urgent_on(d.status, d.due_on, d.computed_due_on, d.computed_revision, d.revision,
          d.confirmed_against) between today and today + soon
    ),
    'deadlines_overdue', (
      select count(*) from public.deadlines d
      where d.org_id = target_org and d.status in ('proposed', 'confirmed')
        and public.deadline_urgent_on(d.status, d.due_on, d.computed_due_on, d.computed_revision, d.revision,
          d.confirmed_against) < today
    ),
    'deadlines_review', (
      select count(*) from public.deadlines d
      where d.org_id = target_org and d.status in ('proposed', 'confirmed')
        and cardinality(public.deadline_review_reasons_of(d.status, d.publication_id, d.confirmed_at,
          d.confirmed_revision, d.revision, d.computed_revision, d.computed_due_on, d.confirmed_against, d.due_on,
          d.count_error, d.count_claimed_at, d.count_attempts)) > 0
    ),
    'publications_without_deadline', (
      select count(*) from public.publications p
      where p.org_id = target_org and p.active and p.category = 'prazo'
        and public.publication_watched_since(p.available_on, p.triaged_at, p.captured_at) >= today - watch
        and public.publication_owes_deadline(p.id)
    ),
    'hearings_soon', (
      select count(*) from public.hearings h
      where h.org_id = target_org and h.status = 'scheduled'
        and h.starts_at + hearing_ends >= now() and h.starts_at < now() + make_interval(days => hearing_soon)
    ),
    'hearings_unresolved', (
      select count(*) from public.hearings h
      where h.org_id = target_org and h.status = 'scheduled' and h.starts_at + hearing_ends < now()
    ),
    'calendar_lost', (
      select count(*) from public.firm_calendars f where f.org_id = target_org and f.status = 'lost'
    ),
    'hearings_unwarned', (
      select count(*) from public.hearings h
      where h.org_id = target_org and h.status = 'scheduled'
        and h.starts_at > now() and h.starts_at < now() + make_interval(days => hearing_soon)
        and public.hearing_unwarned(target_org, h.proceeding_id)
    ),
    -- Publications triaged as a hearing that still owe it (0037): what ONE left to a person, or a person did not write.
    'publications_without_hearing', (
      select count(*) from public.publications p
      where p.org_id = target_org and p.active and p.category = 'audiencia'
        and public.publication_watched_since(p.available_on, p.triaged_at, p.captured_at) >= today - watch
        and public.publication_owes_hearing(p.id)
    ),
    -- Cases a claimant said no to the civil court for (0025): a lawsuit planned there waits on the firm.
    'civil_court_declined', (
      select count(distinct a.case_id) from public.civil_court_answers a
      join public.cases c on c.id = a.case_id
      where a.org_id = target_org and a.replaced_at is null and not a.accepted
        and a.person_id is not distinct from public.civil_court_answerer(a.party_id)
        and c.status not in ('closed', 'declined')
        and exists (
          select 1 from public.proceeding_parties pp
          join public.proceedings p on p.id = pp.proceeding_id
          where pp.party_id = a.party_id and p.status = 'planned' and p.kind = 'comum'
        )
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
