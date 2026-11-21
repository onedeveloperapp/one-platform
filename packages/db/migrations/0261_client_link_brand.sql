-- ============================================================
-- 0261_client_link_brand: the client's link in the firm's brand (the owner, 2026-11-20).
--
-- The second phase of the plan "o escritório preparado antes do primeiro atendimento": what a client sees carries
-- the firm's logo and colour (0258), never ONE's. `client_link_brand` answers, by the token of an open link, the
-- firm's logo (the PNG ONE kept, by its file, for the backend to hand a short link to) and its colour; the page puts
-- the colour on icons and bars only where it reads on white, the words keeping the text's colours.
-- ============================================================

create or replace function public.client_link_brand(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  brand public.firm_brands%rowtype;
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  select * into brand from public.firm_brands b where b.org_id = link.org_id;
  return jsonb_build_object(
    'ok', true,
    'logo_file_id', brand.logo_file_id,
    'logo_width', brand.logo_width,
    'logo_height', brand.logo_height,
    'color', brand.color
  );
end;
$$;

revoke all on function public.client_link_brand(text) from public;
grant execute on function public.client_link_brand(text) to anon, authenticated;
