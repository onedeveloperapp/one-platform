import { type BellCopy, bellCopyFor, type BellText, toBellLocale } from "./bell-copy";
import {
  dateLabel,
  dateTimeLabel,
  DEFAULT_TIME_ZONE,
  isoWeekKey,
  localizedText,
  memberUrl,
  moneyLabel,
  toMessageLocale,
  UNSUBSCRIBE_PATH,
  unsubscribeUrl,
  wholeDaysLeft,
} from "./format";
import { describe, expect, it } from "vitest";

/** Every notice of the bell, written with the arguments a real call would carry. */
const notices = (copy: BellCopy): Record<keyof BellCopy, BellText> => ({
  welcome: copy.welcome(),
  planActive: copy.planActive("Plano Escritório"),
  accessGranted: copy.accessGranted("Acesso anual", "6 de outubro de 2027"),
  accessEnded: copy.accessEnded("Acesso anual", "6 de outubro de 2027"),
  paymentRecovered: copy.paymentRecovered(),
  paymentFailed: copy.paymentFailed(7),
  subscriptionEnded: copy.subscriptionEnded("Plano Escritório", false),
  termEnding: copy.termEnding("Plano Escritório", "17 de outubro de 2026"),
  portfolioTaken: copy.portfolioTaken("Ana Lima"),
  firmDataCleared: copy.firmDataCleared("Ana Lima"),
  partnerJoined: copy.partnerJoined("Viagens Teste"),
  partnerEndedByPartner: copy.partnerEndedByPartner("Viagens Teste"),
  partnerEndedByFirm: copy.partnerEndedByFirm("Souza Advogados"),
  paxUnagreedDeparture: copy.paxUnagreedDeparture("Lara Teste", "06/11/2026 08:30"),
  publicationTriaged: copy.publicationTriaged("uma audiência", "do caso nº 12"),
  publicationAckLate: copy.publicationAckLate("um prazo", "", 4),
  filingWaits: copy.filingWaits("A ação do caso nº 12", "eproc do TJSP", "sexta-feira, 20 de novembro"),
  filingBatchCode: copy.filingBatchCode("eproc do TJSP", false, 5),
  filingBatchConfirm: copy.filingBatchConfirm("eproc do TJSP"),
  filingBatchStopped: copy.filingBatchStopped("Projudi do TJGO"),
  aiDown: copy.aiDown("Anthropic", "6 de novembro de 2026, 10:12"),
  aiUp: copy.aiUp("Anthropic", "20 de novembro de 2026, 13:44"),
  supportAccess: copy.supportAccess("Ana", "pagamento duplicado", 30),
});

describe("bell copy", () => {
  it("writes every notice with a title and a body and no leftovers", () => {
    const written = notices(bellCopyFor("pt-BR"));
    // A notice added to the copy and not listed here fails the build (the Record is exhaustive).
    expect(Object.keys(written).sort()).toEqual(Object.keys(bellCopyFor("pt-BR")).sort());
    for (const [name, notice] of Object.entries(written)) {
      expect(notice.title.trim().length, name).toBeGreaterThan(0);
      expect(notice.body.trim().length, name).toBeGreaterThan(0);
      expect(`${notice.title} ${notice.body}`, name).not.toMatch(/undefined|null|NaN|\[object/);
    }
  });

  it("calls a plan by the name it has in the data", () => {
    const copy = bellCopyFor("pt-BR");
    expect(copy.planActive("Plano Qualquer").body).toContain("Plano Qualquer");
    expect(copy.accessGranted("Plano Qualquer", null).body).toContain("Plano Qualquer");
    expect(copy.accessGranted("Plano Qualquer", "x").body).toContain("Plano Qualquer");
    expect(copy.accessEnded("Plano Qualquer", "x").body).toContain("Plano Qualquer");
    expect(copy.subscriptionEnded("Plano Qualquer", true).body).toContain("Plano Qualquer");
    expect(copy.termEnding("Plano Qualquer", "x").body).toContain("Plano Qualquer");
  });

  it("states the end of an access only when it has one", () => {
    expect(bellCopyFor("pt-BR").accessGranted("Acesso", "6 de outubro de 2027").body).toContain(
      "até 6 de outubro de 2027",
    );
    expect(bellCopyFor("pt-BR").accessGranted("Acesso", null).body).not.toContain("até");
  });

  it("says the access continues only when another purchase keeps it", () => {
    const copy = bellCopyFor("pt-BR");
    expect(copy.subscriptionEnded("Assinatura", true).body).toContain("continua");
    expect(copy.subscriptionEnded("Assinatura", false).body).not.toContain("continua");
  });

  it("never states a count that reads wrong", () => {
    const copy = bellCopyFor("pt-BR");
    expect(copy.paymentFailed(1).body).toContain("em até 1 dia ");
    expect(copy.paymentFailed(3).body).toContain("em até 3 dias ");
    expect(copy.paymentFailed(0).body).not.toMatch(/\d/);
  });

  it("names the operator of a support access, or the team when there is no name", () => {
    expect(bellCopyFor("pt-BR").supportAccess(null, "motivo", 30).body).toContain("A equipe de suporte");
    expect(bellCopyFor("pt-BR").supportAccess("Ana", "motivo", 30).body).toContain("Ana acessou sua conta");
  });

  it("writes in Portuguese whatever language a profile carries", () => {
    expect(toBellLocale("en")).toBe("pt-BR");
    expect(toBellLocale("pt-BR")).toBe("pt-BR");
    expect(toBellLocale(null)).toBe("pt-BR");
    expect(toMessageLocale("en")).toBe("pt-BR");
    expect(toMessageLocale(undefined)).toBe("pt-BR");
  });
});

describe("dates and amounts in a message", () => {
  it("writes a date on the reader's own calendar day", () => {
    // 01:30 UTC on October 3 is still October 2 in São Paulo, and already October 3 in Lisbon.
    const moment = "2026-10-03T01:30:00Z";
    expect(dateLabel(moment, "pt-BR")).toBe("2 de outubro de 2026");
    expect(dateLabel(moment, "pt-BR", "Europe/Lisbon")).toBe("3 de outubro de 2026");
    expect(dateLabel(moment, "pt-BR", "America/Sao_Paulo")).toBe("2 de outubro de 2026");
  });

  it("falls back to the home clock for a time zone the runtime does not know", () => {
    const moment = "2026-10-03T01:30:00Z";
    expect(dateLabel(moment, "pt-BR", "Mars/Olympus")).toBe(dateLabel(moment, "pt-BR", DEFAULT_TIME_ZONE));
    expect(dateLabel(moment, "pt-BR", null)).toBe(dateLabel(moment, "pt-BR", DEFAULT_TIME_ZONE));
  });

  it("writes a moment with the weekday, the hour and the zone", () => {
    const start = "2026-10-09T22:00:00Z";
    const brasilia = dateTimeLabel(start, "pt-BR", "America/Sao_Paulo");
    expect(brasilia).toContain("sexta-feira");
    expect(brasilia).toContain("9 de outubro");
    expect(brasilia).toContain("19:00");
    const manaus = dateTimeLabel(start, "pt-BR", "America/Manaus");
    expect(manaus).toContain("18:00");
  });

  it("writes an amount in its own currency, without decimals it does not have", () => {
    expect(moneyLabel(9700, "BRL", "pt-BR").replace(/\s/g, " ")).toBe("R$ 97");
    expect(moneyLabel(9750, "BRL", "pt-BR").replace(/\s/g, " ")).toBe("R$ 97,50");
  });

  it("rounds the days left up, and never below one", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    expect(wholeDaysLeft("2026-10-07T11:00:00Z", now)).toBe(5);
    expect(wholeDaysLeft("2026-10-02T18:00:00Z", now)).toBe(1);
    expect(wholeDaysLeft("2026-10-01T00:00:00Z", now)).toBe(1);
  });

  it("names the ISO week a moment falls in", () => {
    expect(isoWeekKey(Date.parse("2026-10-02T12:00:00Z"))).toBe("2026-W40");
    // January 1st 2027 is a Friday: it still belongs to the last week of 2026.
    expect(isoWeekKey(Date.parse("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(isoWeekKey(Date.parse("2026-01-01T12:00:00Z"))).toBe("2026-W01");
    // Sunday and the Monday after it are in different weeks.
    expect(isoWeekKey(Date.parse("2026-10-04T23:00:00Z"))).toBe("2026-W40");
    expect(isoWeekKey(Date.parse("2026-10-05T01:00:00Z"))).toBe("2026-W41");
  });
});

describe("texts stored per language", () => {
  it("prefers the reader's language, then any language it was written in, then the fallback", () => {
    const both = { "pt-BR": "Checagem de prazo", en: "Deadline check" };
    expect(localizedText(both, "checagem", "pt-BR")).toBe("Checagem de prazo");
    expect(localizedText({ en: "Only in English" }, "slug", "pt-BR")).toBe("Only in English");
    expect(localizedText({ "pt-BR": "  " }, "slug", "pt-BR")).toBe("slug");
    expect(localizedText(null, "slug", "pt-BR")).toBe("slug");
  });
});

describe("links inside a message", () => {
  it("builds absolute addresses on the canonical host", () => {
    expect(memberUrl("/settings/billing")).toMatch(/^https?:\/\/[^/]+\/settings\/billing$/);
  });

  it("builds the unsubscribe address of a member and of a contact", () => {
    const token = "00000000-0000-4000-8000-000000000000";
    const member = new URL(unsubscribeUrl("member", token));
    expect(member.pathname).toBe(UNSUBSCRIBE_PATH);
    expect(member.searchParams.get("k")).toBe("m");
    expect(member.searchParams.get("t")).toBe(token);
    expect([...member.searchParams.keys()].sort()).toEqual(["k", "t"]);

    const lead = new URL(unsubscribeUrl("lead", token));
    expect(lead.searchParams.get("k")).toBe("l");
  });
});
