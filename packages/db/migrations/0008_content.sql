-- ============================================================
-- 0008_content: help center and blog, written in /admin/help and /admin/blog.
--
-- One row per language (supported_locales(), 0000). Rows that are translations
-- of each other share a `translation_group`, which is what a second language
-- would use to link the versions (hreflang) instead of guessing from slugs.
-- ============================================================

-- Shared by both tables: stamps the first publication.
create or replace function public.set_published_at()
returns trigger
language plpgsql
as $$
begin
  if new.is_published and new.published_at is null then
    new.published_at = now();
  end if;
  return new;
end;
$$;

revoke all on function public.set_published_at() from public, anon;

-- ---------- Help center ----------

create table public.help_categories (
  id uuid primary key default gen_random_uuid(),
  locale text not null default 'pt-BR' check (locale = any (public.supported_locales())),
  slug text not null,
  name text not null,
  description text,
  translation_group uuid not null default gen_random_uuid(),
  sort integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale, slug),
  unique (translation_group, locale)
);

alter table public.help_categories enable row level security;

create policy "help_categories_select_published" on public.help_categories
  for select to anon, authenticated
  using (is_published);

create policy "help_categories_all_superadmin" on public.help_categories
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

grant select on table public.help_categories to anon;
grant select, insert, update, delete on table public.help_categories to authenticated;

create trigger help_categories_updated_at
  before update on public.help_categories
  for each row execute function public.set_updated_at();

create table public.help_articles (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.help_categories (id) on delete cascade,
  locale text not null default 'pt-BR' check (locale = any (public.supported_locales())),
  slug text not null,
  title text not null,
  excerpt text,
  body_md text not null default '',
  translation_group uuid not null default gen_random_uuid(),
  sort integer not null default 0,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale, slug),
  unique (translation_group, locale)
);

create index help_articles_category_idx on public.help_articles (category_id);
create index help_articles_locale_idx on public.help_articles (locale) where is_published;

alter table public.help_articles enable row level security;

create policy "help_articles_select_published" on public.help_articles
  for select to anon, authenticated
  using (is_published);

create policy "help_articles_all_superadmin" on public.help_articles
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

grant select on table public.help_articles to anon;
grant select, insert, update, delete on table public.help_articles to authenticated;

create trigger help_articles_published_at
  before insert or update on public.help_articles
  for each row execute function public.set_published_at();

create trigger help_articles_updated_at
  before update on public.help_articles
  for each row execute function public.set_updated_at();

-- ---------- Blog and news ----------

create type public.blog_comment_status as enum ('pending', 'approved', 'rejected');

create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  locale text not null default 'pt-BR' check (locale = any (public.supported_locales())),
  slug text not null,
  title text not null,
  excerpt text,
  body_md text not null default '',
  cover_url text,
  author_name text,
  tags text[] not null default '{}',
  -- `post` is the public blog. `news` is a notice about the platform, shown in
  -- the logged area.
  kind text not null default 'post' check (kind in ('post', 'news')),
  -- `members` posts are never served to a visitor without a session.
  audience text not null default 'public' check (audience in ('public', 'members')),
  translation_group uuid not null default gen_random_uuid(),
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale, slug),
  unique (translation_group, locale)
);

create index blog_posts_locale_idx on public.blog_posts (locale, published_at desc) where is_published;
create index blog_posts_kind_idx on public.blog_posts (kind, locale, published_at desc) where is_published;

alter table public.blog_posts enable row level security;

create policy "blog_posts_select_public" on public.blog_posts
  for select to anon
  using (is_published and audience = 'public');

create policy "blog_posts_select_member" on public.blog_posts
  for select to authenticated
  using (is_published);

create policy "blog_posts_all_superadmin" on public.blog_posts
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

grant select on table public.blog_posts to anon;
grant select, insert, update, delete on table public.blog_posts to authenticated;

create trigger blog_posts_published_at
  before insert or update on public.blog_posts
  for each row execute function public.set_published_at();

create trigger blog_posts_updated_at
  before update on public.blog_posts
  for each row execute function public.set_updated_at();

create table public.blog_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.blog_posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Copied from the profile by a trigger, so reading comments never needs
  -- access to anybody's profile row.
  author_name text,
  body text not null check (char_length(body) between 1 and 4000),
  status public.blog_comment_status not null default 'pending',
  created_at timestamptz not null default now()
);

create index blog_comments_post_idx on public.blog_comments (post_id, status);

alter table public.blog_comments enable row level security;

create policy "blog_comments_select_public" on public.blog_comments
  for select to anon
  using (
    status = 'approved'
    and exists (
      select 1 from public.blog_posts p
      where p.id = blog_comments.post_id and p.is_published and p.audience = 'public'
    )
  );

create policy "blog_comments_select_member" on public.blog_comments
  for select to authenticated
  using (status = 'approved' or user_id = auth.uid() or public.is_superadmin());

create policy "blog_comments_insert_own" on public.blog_comments
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

create policy "blog_comments_delete_own" on public.blog_comments
  for delete to authenticated
  using (user_id = auth.uid());

create policy "blog_comments_all_superadmin" on public.blog_comments
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

grant select on table public.blog_comments to anon;
grant select, insert, update, delete on table public.blog_comments to authenticated;

create or replace function public.set_blog_comment_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select display_name into new.author_name from public.profiles where id = new.user_id;
  return new;
end;
$$;

revoke all on function public.set_blog_comment_author() from public, anon;

create trigger blog_comments_author
  before insert on public.blog_comments
  for each row execute function public.set_blog_comment_author();
