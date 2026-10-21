-- ============================================================
-- 0015_seed: the data the platform needs to exist on day one.
--
--   * the floor every firm stands on while it has no subscription. NO PRICED
--     PLAN is seeded: prices, tiers and their limits are commercial decisions,
--     written as rows by the operator in /admin/billing, and nothing in the
--     code repeats them;
--   * operational settings (the lead window, the support channels, the stage
--     of the public site, the company that operates the platform);
--   * the one sentence a visitor agrees to on the waitlist form.
--
-- NO LEGAL DOCUMENT is seeded. The terms of use, the privacy policy and the
-- cookie policy are written by the company that operates ONE and published
-- with publish_consent_term(); until then the legal pages say they have
-- nothing to show and nothing can be accepted.
--
-- Everything is `on conflict do nothing`: re-running this file never
-- overwrites what the operator changed.
-- ============================================================

-- ---------- The floor ----------

-- A firm with no subscription. It sets no limit of its own: what a firm may
-- use comes from the plan it subscribes to (or a courtesy), read through
-- org_entitlements(). The seat ceiling of a team is the plan's `assentos_max`;
-- a plan that does not name it sets no ceiling.
insert into public.plans (slug, name, description, kind, family, tier, period, price_cents, currency, is_free, is_public, sort, limits) values
  (
    'sem-assinatura', 'Sem assinatura', 'Escritório sem assinatura ativa.',
    'recurring', 'free', null, 'monthly', 0, 'BRL', true, false, 0, '{}'
  )
on conflict (slug) do nothing;

-- ---------- Settings ----------

insert into public.platform_settings (key, value, is_public) values
  -- Human support channels shown by the quick-support widget. Edited at
  -- /admin/support; empty until the operator fills them.
  ('support', '{}'::jsonb, true),
  -- Waitlist and newsletter sign-ups per network per hour.
  ('leads', '{"per_network_hour": 10}'::jsonb, false),
  -- What the public site offers. With `stage = waitlist` every primary call to
  -- action leads to the waitlist (/espera), because there is nothing to buy
  -- yet. With `stage = open` the same buttons lead to sign-up. The superadmin
  -- flips it at /admin/support; sign-in and sign-up stay reachable in both
  -- stages (the operator's own account is created through them).
  ('launch', '{"stage": "waitlist"}'::jsonb, true),
  -- The company that operates the platform: name, CNPJ and city, rendered in
  -- the site footer. Ships empty until the operator fills it at /admin/support.
  ('legal_entity', '{}'::jsonb, true)
on conflict (key) do nothing;

-- ---------- The consent of the waitlist ----------

-- What the visitor agrees to when leaving an address: the sentence of the form,
-- frozen with its version (submit_lead pins it on the row).
insert into public.consent_terms (slug, locale, version, title, body_md, is_active) values
('newsletter', 'pt-BR', 1, 'Avisos por e-mail', $md$
Quero receber por e-mail os avisos do ONE sobre a abertura da plataforma e as suas novidades. Para isso são usados o meu e-mail e, se eu informar, o meu nome. O envio é feito pela Resend. Posso sair quando quiser, pelo link presente em toda mensagem.
$md$, true)
on conflict (slug, locale, version) do nothing;
