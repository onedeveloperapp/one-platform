import { render } from "@react-email/render";
import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { emailCopyFor } from "./copy";
import { type EmailLocale, toEmailLocale } from "./locale";
import AccessEndedEmail from "./templates/access-ended";
import ContactFormEmail from "./templates/contact-form";
import FirmInvitationEmail from "./templates/firm-invitation";
import KitReceiptEmail from "./templates/kit-receipt";
import LeadConfirmEmail from "./templates/lead-confirm";
import MemberWelcomeEmail from "./templates/member-welcome";
import NewsletterEmail from "./templates/newsletter";
import SubscriptionActiveEmail from "./templates/subscription-active";
import SubscriptionCanceledEmail from "./templates/subscription-canceled";
import TermEndingEmail from "./templates/term-ending";

const LOCALES: EmailLocale[] = ["pt-BR"];
const APP = "https://one.example/inicio";
const INVITATION = "https://one.example/convite/um-token-de-teste";
const UNSUBSCRIBE = "https://one.example/api/public/email/unsubscribe?k=m&t=00000000-0000-4000-8000-000000000000";

/**
 * The text a reader sees, on one line: the plain-text rendering wraps at 80
 * columns, so a sentence would otherwise be cut wherever the wrap falls.
 */
async function textOf(element: ReactElement): Promise<string> {
  return (await render(element, { plainText: true })).replace(/\s+/g, " ");
}

/** The address as it is written inside an HTML attribute. */
const inHtml = (url: string) => url.replaceAll("&", "&amp;");

/** Every template in a language, with the props a real send would carry. */
function every(locale: EmailLocale): Record<string, ReactElement> {
  return {
    "member-welcome": createElement(MemberWelcomeEmail, { locale, name: "Ana", appUrl: APP }),
    "firm-invitation": createElement(FirmInvitationEmail, {
      locale,
      firmName: "Souza Advogados",
      inviterName: "Ana Souza",
      functionLabel: "Advocacia",
      acceptUrl: INVITATION,
      expiresLabel: "15 de outubro de 2026",
    }),
    "kit-receipt": createElement(KitReceiptEmail, {
      locale,
      name: "Ana",
      planName: "Acesso anual",
      amountLabel: "R$ 97",
      untilLabel: null,
      fiscalNote: true,
      appUrl: APP,
    }),
    "subscription-active": createElement(SubscriptionActiveEmail, {
      locale,
      name: null,
      planName: "Plano Escritório",
      appUrl: APP,
    }),
    "subscription-canceled": createElement(SubscriptionCanceledEmail, {
      locale,
      planName: "Plano Escritório",
      cause: "requested",
      endedLabel: "2 de outubro de 2026",
      keptAccess: null,
      billingUrl: APP,
    }),
    "access-ended": createElement(AccessEndedEmail, {
      locale,
      planName: "Acesso anual",
      endedLabel: "2 de outubro de 2026",
      billingUrl: APP,
    }),
    "term-ending": createElement(TermEndingEmail, {
      locale,
      planName: "Plano Escritório",
      endsLabel: "17 de outubro de 2026",
      billingUrl: APP,
    }),
    "lead-confirm": createElement(LeadConfirmEmail, { locale, confirmUrl: APP }),
    newsletter: createElement(NewsletterEmail, {
      locale,
      heading: "O ONE abriu",
      bodyMarkdown: "O ONE **abriu** hoje.\n\n- um\n- dois\n\n[Abrir](https://one.example)",
      unsubscribeUrl: UNSUBSCRIBE,
    }),
  };
}

describe("e-mail templates", () => {
  for (const locale of LOCALES) {
    it(`render in ${locale} with the language on the document and no template leftovers`, async () => {
      for (const [name, element] of Object.entries(every(locale))) {
        const html = await render(element);
        expect(html, name).toContain(`lang="${locale}"`);
        // A function of the copy that reached the page unrendered, or a missing value.
        expect(html, name).not.toMatch(/undefined|\[object Object\]|=&gt;|NaN/);
        expect(html, name).toContain(emailCopyFor(locale).shell.signature.split(" · ")[0]);
      }
    });
  }

  it("only the messages a reader may stop carry an unsubscribe link", async () => {
    for (const locale of LOCALES) {
      for (const [name, element] of Object.entries(every(locale))) {
        const html = await render(element);
        const stoppable = name === "newsletter";
        expect(html.includes(inHtml(UNSUBSCRIBE)), `${name} (${locale})`).toBe(stoppable);
      }
    }
  });

  it("writes in Portuguese whatever language a profile or a contact carries", () => {
    expect(toEmailLocale("en")).toBe("pt-BR");
    expect(toEmailLocale(null)).toBe("pt-BR");
  });
});

describe("the receipt", () => {
  const base = {
    locale: "pt-BR" as const,
    name: null,
    planName: "Acesso anual",
    amountLabel: "R$ 97",
    appUrl: APP,
  };

  it("states the end date the grant has, or that it has none", async () => {
    expect(await textOf(createElement(KitReceiptEmail, { ...base, fiscalNote: false, untilLabel: null }))).toContain(
      "sem prazo para acabar",
    );
    const dated = await textOf(
      createElement(KitReceiptEmail, { ...base, fiscalNote: false, untilLabel: "2 de outubro de 2027" }),
    );
    expect(dated).toContain("até 2 de outubro de 2027");
    expect(dated).not.toContain("sem prazo");
  });

  it("mentions the tax invoice only for a purchase that has one", async () => {
    expect(await textOf(createElement(KitReceiptEmail, { ...base, untilLabel: null, fiscalNote: false }))).not.toContain(
      "Asaas",
    );
    expect(await textOf(createElement(KitReceiptEmail, { ...base, untilLabel: null, fiscalNote: true }))).toContain(
      "Asaas",
    );
  });
});

describe("the end of a subscription", () => {
  const base = {
    locale: "pt-BR" as const,
    planName: "Plano Escritório",
    endedLabel: "2 de outubro de 2026",
    billingUrl: APP,
  };

  it("says the access continues only when another purchase keeps it", async () => {
    const without = await textOf(
      createElement(SubscriptionCanceledEmail, { ...base, cause: "requested", keptAccess: null }),
    );
    expect(without).toContain("termina com ele");
    expect(without).not.toContain("continua");
    const named = await textOf(
      createElement(SubscriptionCanceledEmail, { ...base, cause: "requested", keptAccess: { by: "Acesso anual" } }),
    );
    expect(named).toContain("continua por outra compra ativa (Acesso anual)");
    expect(named).not.toContain("termina com ele");
    const unnamed = await textOf(
      createElement(SubscriptionCanceledEmail, { ...base, cause: "requested", keptAccess: { by: null } }),
    );
    expect(unnamed).toContain("O acesso continua por outra compra ativa.");
  });

  it("gives the reason it ended", async () => {
    const text = (cause: "requested" | "payment" | "term" | "ended") =>
      textOf(createElement(SubscriptionCanceledEmail, { ...base, cause, keptAccess: null }));
    expect(await text("requested")).toContain("como você pediu");
    expect(await text("payment")).toContain("o pagamento não foi confirmado");
    expect(await text("term")).toContain("o período pago chegou ao fim");
    expect(await text("ended")).toContain("Plano Escritório terminou em 2 de outubro de 2026.");
  });
});

describe("the internal contact notice", () => {
  it("keeps the visitor's line breaks and is written for the operator", async () => {
    const html = await render(
      createElement(ContactFormEmail, { name: "Ana", email: "ana@example.com", message: "one\ntwo" }),
    );
    expect(html).toContain('lang="pt-BR"');
    expect(html).toContain("pre-wrap");
    expect(html).toContain("ana@example.com");
  });
});

describe("the invitation to a firm", () => {
  const base = {
    locale: "pt-BR" as const,
    firmName: "Souza Advogados",
    functionLabel: "Advocacia",
    acceptUrl: INVITATION,
    expiresLabel: "15 de outubro de 2026",
  };

  it("names who invited, the firm, the function and the last day, and carries the link", async () => {
    const element = createElement(FirmInvitationEmail, { ...base, inviterName: "Ana Souza" });
    const text = await textOf(element);
    expect(text).toContain("Ana Souza convidou você para a equipe de Souza Advogados");
    expect(text).toContain("Função no escritório: Advocacia.");
    expect(text).toContain("até 15 de outubro de 2026");
    expect(text).toContain("O convite vale para este endereço de e-mail");
    expect(await render(element)).toContain(INVITATION);
  });

  it("still reads when the name of who invited is not known", async () => {
    const text = await textOf(createElement(FirmInvitationEmail, { ...base, inviterName: null }));
    expect(text).toContain("Você recebeu um convite para a equipe de Souza Advogados");
  });
});
