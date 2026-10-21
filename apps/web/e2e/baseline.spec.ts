import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("public home and authentication remain reachable without remote data", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.goto("/auth/sign-in");
  await expect(page.locator("body")).toContainText(/entrar|acessar/i);
});

test("public pages state their own address, in the one language the site is written in", async ({ page, request }) => {
  await page.goto("/contato");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/contato$/);
  // One language: there is no other address to point at.
  await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);

  // A public page is shared with the site's social card. A page that states its
  // own Open Graph fields drops the image the root route contributes unless
  // publicPageMetadata names it again, and nothing else shows that it is gone.
  const card = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(card).toMatch(/\/opengraph-image/);
  const cardImage = await request.get(new URL(card ?? "", "http://localhost").pathname);
  expect(cardImage.headers()["content-type"]).toContain("image/png");

  // The prefixed address redirects to the canonical one.
  for (const [from, to] of [
    ["/pt-BR/contato", "/contato"],
    ["/pt-BR", "/"],
  ]) {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status(), from).toBeGreaterThanOrEqual(300);
    expect(response.status(), from).toBeLessThan(400);
    expect(new URL(response.headers().location, "http://localhost").pathname, from).toBe(to);
  }

  // An address in a language the site is not written in is not a public page.
  const english = await request.get("/en/contact", { maxRedirects: 0 });
  expect(english.status()).toBeGreaterThanOrEqual(300);
  expect(new URL(english.headers().location, "http://localhost").pathname).toBe("/auth/sign-in");

  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/contato");
  expect(sitemap).toContain("/espera");
  expect(sitemap).not.toContain("hreflang");
  expect(sitemap).not.toContain("/en/");
});

test("the waitlist is the primary action until the site opens", async ({ page }) => {
  // Without a readable launch stage the site stays in the waitlist stage.
  await page.goto("/");
  await expect(page.locator("footer").getByRole("link", { name: /entrar na lista de espera/i })).toHaveAttribute(
    "href",
    "/espera",
  );

  await page.goto("/espera");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/lista de espera/i);
  const submit = page.getByRole("button", { name: /entrar na lista de espera/i });

  await submit.click();
  await expect(page.getByText("Informe um e-mail válido.")).toBeVisible();

  await page.getByLabel("Seu e-mail").fill("pessoa@example.com");
  await submit.click();
  await expect(page.getByText("Marque a caixa para que possamos enviar o aviso.")).toBeVisible();

  // No database in this run: the form says so instead of promising an e-mail.
  await page.getByRole("checkbox").check();
  await submit.click();
  await expect(page.getByText(/a lista de espera está fora do ar agora/i)).toBeVisible();
});

test("the confirmation link never leaves its token in the address", async ({ page }) => {
  await page.goto(`/espera/confirmar?t=${"a".repeat(43)}`);
  await expect(page).toHaveURL(/\/espera\/confirmar$/);
  const confirm = page.getByRole("button", { name: /confirmar inscrição/i });
  await expect(confirm).toBeVisible();
  await confirm.click();
  await expect(page.getByText(/a lista de espera está fora do ar agora/i)).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/espera/confirmar");
  await expect(page.getByText("Este link expirou ou já foi usado.")).toBeVisible();
});

test("an unsubscribe link asks before acting and never leaves its token in the address", async ({ page, request }) => {
  const token = "0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a4b";

  // The link of someone with an account: the news.
  await page.goto(`/api/public/email/unsubscribe?k=m&t=${token}`);
  await expect(page).toHaveURL(/\/descadastro$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Parar de receber as novidades?");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const stop = page.getByRole("button", { name: "Parar de receber" });
  await expect(stop).toBeVisible();
  // No database in this run: the page says it could not, instead of claiming it did.
  await stop.click();
  await expect(page.getByText("Não foi possível concluir agora. Tente de novo em instantes.")).toBeVisible();

  // A contact of the list: its own words.
  await page.goto(`/api/public/email/unsubscribe?k=l&t=${token}`);
  await expect(page).toHaveURL(/\/descadastro$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sair da lista do ONE?");
  await expect(page.getByRole("button", { name: "Sair da lista" })).toBeVisible();

  // A link that is not one of ours arms nothing, and disarms what was there.
  await page.goto("/api/public/email/unsubscribe?k=m&t=not-a-token");
  await expect(page).toHaveURL(/\/descadastro$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Este link expirou");
  await expect(page.getByRole("button", { name: "Parar de receber" })).toHaveCount(0);

  // The one-click post of a mail client answers by itself, never through sign-in.
  const malformed = await request.post("/api/public/email/unsubscribe?k=m&t=not-a-token", { maxRedirects: 0 });
  expect(malformed.status()).toBe(400);
  const oneClick = await request.post(`/api/public/email/unsubscribe?k=m&t=${token}`, {
    maxRedirects: 0,
    form: { "List-Unsubscribe": "One-Click" },
  });
  // 503 here because this run has no database; with one it is 200.
  expect(oneClick.status()).toBe(503);
  expect(await oneClick.json()).toEqual({ error: "unavailable" });
});

test("legal pages render the terms in force or say they cannot", async ({ page }) => {
  for (const route of ["/legal/termos", "/legal/privacidade", "/legal/cookies"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // No database in this run: never another text dressed as the terms.
    await expect(page.locator("main")).toContainText(/não conseguimos carregar/i);
  }
});

test("protected product routes preserve the intended destination through authentication", async ({ page }) => {
  for (const route of [
    "/inicio",
    "/casos",
    "/casos/importar",
    "/casos/0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a4b",
    "/atendimento",
    "/aprovacoes",
    "/settings",
    "/settings/billing",
    "/settings/security",
    "/settings/team",
    "/settings/connections",
  ]) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`/auth/sign-in\\?next=${encodeURIComponent(route)}`));
    await expect(page.getByRole("heading", { name: /entrar/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      /relation .* does not exist|postgres|\[object Object\]|undefined/i,
    );
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("the WhatsApp webhook takes nothing that is not signed, and answers no challenge it was not given", async ({
  request,
}) => {
  // Reached without a session (the vendor has none), and it authenticates every call itself.
  const challenge = await request.get(
    "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=um-token-qualquer&hub.challenge=1158201444",
  );
  expect(challenge.status()).toBe(403);
  expect(await challenge.text()).not.toContain("1158201444");

  const delivery = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const unsigned = await request.post("/api/webhooks/whatsapp", {
    data: delivery,
    headers: { "content-type": "application/json" },
  });
  expect(unsigned.status()).toBe(401);

  const forged = await request.post("/api/webhooks/whatsapp", {
    data: delivery,
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${"0".repeat(64)}` },
  });
  expect(forged.status()).toBe(401);
});

test("an invitation link opens without a session, keeps its token to itself and loads no tracker", async ({ page }) => {
  const response = await page.goto("/convite/um-token-de-teste");
  // Public by its token: no trip to sign-in before the page can say who invites.
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/convite\/um-token-de-teste$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // No database in this run: the page says so instead of inventing an invitation.
  await expect(page.locator("body")).toContainText(/convites indisponíveis/i);
  // The token is in the address: nothing may carry it elsewhere.
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const trackers = await page.evaluate(() =>
    [...document.scripts].map((script) => script.src).filter((src) => /googletagmanager|facebook|fbevents/.test(src)),
  );
  expect(trackers).toEqual([]);
});

test("a document's code is checked without a session, and the page keeps it to itself", async ({ page }) => {
  // Public by its code: whoever holds the paper needs no account to check it.
  const response = await page.goto("/verificar");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/verificar$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  // A code is twelve letters and digits; one that cannot be a code says so and goes nowhere.
  await page.getByLabel(/código de verificação/i).fill("abc");
  await page.getByRole("button", { name: /^conferir$/i }).click();
  await expect(page.locator("body")).toContainText(/são 12 letras e números/i);
  await expect(page).toHaveURL(/\/verificar$/);

  // Typed as it is printed, with dashes and in lower case, it opens its own address.
  await page.getByLabel(/código de verificação/i).fill("abcd-efgh-jkmn");
  await page.getByRole("button", { name: /^conferir$/i }).click();
  await expect(page).toHaveURL(/\/verificar\/ABCDEFGHJKMN$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // No database in this run: the page says so instead of calling the code unknown.
  await expect(page.locator("body")).toContainText(/conferência indisponível/i);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  const trackers = await page.evaluate(() =>
    [...document.scripts].map((script) => script.src).filter((src) => /googletagmanager|facebook|fbevents/.test(src)),
  );
  expect(trackers).toEqual([]);
});

test("a client's link opens without a session, keeps its token to itself and loads no tracker", async ({ page }) => {
  const token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";
  const response = await page.goto(`/c/${token}`);
  // A passenger has no account: no trip to sign-in.
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/c/${token}$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // No database in this run: the page says so instead of inventing a case.
  await expect(page.locator("body")).toContainText(/página indisponível/i);
  // The firm's page, never the platform's: the title stands alone.
  await expect(page).toHaveTitle("Seu caso");
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const trackers = await page.evaluate(() =>
    [...document.scripts].map((script) => script.src).filter((src) => /googletagmanager|facebook|fbevents/.test(src)),
  );
  expect(trackers).toEqual([]);

  // The robot a messenger sends to draw the link's preview gets no case at all.
  const preview = await page.request.get(`/c/${token}`, { headers: { "user-agent": "WhatsApp/2.24.1 A" } });
  expect(preview.status()).toBe(200);
  expect(await preview.text()).toContain("Abra este link no seu celular");

  // Something that cannot be a token opens nothing, and says so.
  await page.goto("/c/curto");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/link não encontrado/i);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("the firm setup asks for a session first", async ({ page }) => {
  await page.goto("/auth/complete-profile");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
});

test("@a11y core entry and product routes have no critical axe violations", async ({ page }) => {
  for (const route of [
    "/auth/sign-in",
    "/auth/sign-up",
    "/auth/password-reset",
    "/",
    "/contato",
    "/espera",
    "/descadastro",
    "/legal/termos",
    "/inicio",
    "/settings/billing",
    "/settings/security",
    "/convite/um-token-de-teste",
    "/verificar",
    "/verificar/ABCDEFGHJKMN",
    "/c/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd",
  ]) {
    await page.goto(route);
    const results = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    const critical = results.violations.filter((violation) => violation.impact === "critical");
    expect(critical, `Critical accessibility violations at ${route}`).toEqual([]);
  }
});

test("the text people read has no dash, exclamation mark or emoji", async ({ page }) => {
  // The copy rules (CLAUDE.md, "Engineering rules"), checked on the text of the
  // rendered page, not the code. © and → are kept on purpose.
  const forbidden = /[–—!]|(?![©→])\p{Extended_Pictographic}/gu;
  for (const route of [
    "/",
    "/contato",
    "/espera",
    "/ajuda",
    "/blog",
    "/legal/termos",
    "/auth/sign-in",
    "/auth/sign-up",
    "/convite/um-token-de-teste",
    "/verificar",
    "/verificar/ABCDEFGHJKMN",
    "/c/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd",
    "/c/curto",
  ]) {
    await page.goto(route);
    const text = await page.locator("body").innerText();
    const found = [...text.matchAll(forbidden)].map((match) =>
      text.slice(Math.max(0, match.index - 30), match.index + 10).replace(/\s+/g, " "),
    );
    expect(found, `text the copy rules forbid at ${route}`).toEqual([]);
  }
});
