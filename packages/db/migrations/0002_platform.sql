-- ============================================================
-- 0002_platform: platform settings, notifications, announcements, onboarding
-- state, avatars, backups and the check for texts written per language.
-- ============================================================

-- ---------- Texts written per language ----------

/**
 * Whether a jsonb value is a text written per language: an object whose keys
 * are languages the platform is written in (`{"pt-BR": "…"}`) and whose
 * values are strings. With `require_default`, the first language of
 * supported_locales() must be there and not blank.
 */
create or replace function public.i18n_ok(value jsonb, require_default boolean default false)
returns boolean
language sql
immutable
as $$
  select value is not null
    and jsonb_typeof(value) = 'object'
    and not exists (
      select 1 from jsonb_each(value) as entry
      where not (entry.key = any (public.supported_locales())) or jsonb_typeof(entry.value) <> 'string'
    )
    and (not require_default or nullif(btrim(value ->> (public.supported_locales())[1]), '') is not null);
$$;

revoke all on function public.i18n_ok(jsonb, boolean) from public, anon;
grant execute on function public.i18n_ok(jsonb, boolean) to authenticated;

-- ---------- Platform settings ----------

/**
 * Configuration edited by the superadmin: prices of things that are not plans,
 * windows, ceilings, switches. Never secrets.
 *
 * `is_public` decides who may read a key. Commercial promises (the guarantee
 * window, the support channels, the launch stage) are public on purpose: the
 * page and the server gate read the SAME row, so what is announced and what is
 * enforced cannot drift. Operational keys (model prices, the impersonation
 * window) stay readable by superadmins and the backend only.
 */
create table public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint platform_settings_key_check check (key ~ '^[a-z][a-z0-9_]{1,39}$')
);

alter table public.platform_settings enable row level security;

create policy "platform_settings_select_public" on public.platform_settings
  for select to anon, authenticated
  using (is_public);

create policy "platform_settings_all_superadmin" on public.platform_settings
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

grant select on table public.platform_settings to anon;
grant select, insert, update, delete on table public.platform_settings to authenticated;

create trigger platform_settings_updated_at
  before update on public.platform_settings
  for each row execute function public.set_updated_at();

-- ---------- Notifications (the header bell) ----------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null default 'system',
  title text not null,
  body text,
  href text,
  read_at timestamptz,
  -- Idempotency fence for jobs: one notification per source, however many
  -- times the job runs (e.g. `term-ending:<subscription>:<day>`).
  source_key text,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create unique index notifications_source_key_unique_idx on public.notifications (source_key)
  where source_key is not null;

alter table public.notifications enable row level security;

create policy "notifications_select_own" on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

create policy "notifications_update_own" on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Rows are created by the backend (service role) and by definer functions.
-- A person only marks them read.
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

-- ---------- Announcements (banner in the logged area) ----------

create type public.announcement_level as enum ('info', 'warning', 'critical');

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  level public.announcement_level not null default 'info',
  href text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.announcements enable row level security;

create policy "announcements_select_live" on public.announcements
  for select to authenticated
  using (
    public.is_superadmin()
    or (is_active and starts_at <= now() and (ends_at is null or ends_at > now()))
  );

create policy "announcements_all_superadmin" on public.announcements
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

grant select, insert, update, delete on table public.announcements to authenticated;

create trigger announcements_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

create table public.announcement_dismissals (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

alter table public.announcement_dismissals enable row level security;

create policy "announcement_dismissals_select_own" on public.announcement_dismissals
  for select to authenticated
  using (user_id = auth.uid());

create policy "announcement_dismissals_insert_own" on public.announcement_dismissals
  for insert to authenticated
  with check (user_id = auth.uid());

grant select, insert on table public.announcement_dismissals to authenticated;

-- ---------- Onboarding state ----------

-- What a person dismissed or finished in a setup checklist. The STEPS
-- themselves are live predicates over real state; this table only remembers
-- presentation choices, which is why the person may write it freely and no
-- metric ever reads it.
create table public.onboarding_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  org_id uuid references public.organizations (id) on delete cascade,
  flow text not null,
  completed_steps jsonb not null default '[]'::jsonb,
  dismissed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (user_id, org_id, flow)
);

create index onboarding_state_user_idx on public.onboarding_state (user_id);

alter table public.onboarding_state enable row level security;

create policy "onboarding_select_own" on public.onboarding_state
  for select to authenticated
  using (user_id = auth.uid() and (org_id is null or public.is_org_member(org_id)));

create policy "onboarding_insert_own" on public.onboarding_state
  for insert to authenticated
  with check (user_id = auth.uid() and (org_id is null or public.is_org_member(org_id)));

create policy "onboarding_update_own" on public.onboarding_state
  for update to authenticated
  using (user_id = auth.uid() and (org_id is null or public.is_org_member(org_id)))
  with check (user_id = auth.uid() and (org_id is null or public.is_org_member(org_id)));

grant select, insert, update on table public.onboarding_state to authenticated;

create trigger onboarding_state_updated_at
  before update on public.onboarding_state
  for each row execute function public.set_updated_at();

-- ---------- Avatars ----------

-- Public bucket: an avatar URL is shown wherever the person's name is. Each
-- person writes only under a folder named after their own id.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars_public_read" on storage.objects
  for select to public
  using (bucket_id = 'avatars');

create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Backups ----------

create table public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  triggered_by text not null default 'manual' check (triggered_by in ('cron', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  table_count integer not null default 0,
  row_count bigint not null default 0,
  total_bytes bigint not null default 0,
  storage_prefix text,
  error text
);

create index backup_runs_started_idx on public.backup_runs (started_at desc);

alter table public.backup_runs enable row level security;

create policy "backup_runs_select_superadmin" on public.backup_runs
  for select to authenticated
  using (public.is_superadmin());

grant select on table public.backup_runs to authenticated;

-- Private bucket with NO object policies: only the service role reads or
-- writes archives; downloads are signed URLs minted by the backend.
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;
