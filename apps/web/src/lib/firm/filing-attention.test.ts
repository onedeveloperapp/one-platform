import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import {
  type FilingAttention,
  filingAttentionItems,
  type FilingViewer,
  momentWords,
  ownSignatureNeed,
  readFilingAttention,
} from "@/lib/firm/filing-attention";
import { type PendingItem, sayPending } from "@/lib/firm/pending";
import messages from "@flyee/content/messages/pt-BR.json";

const ANA = "f1030000-0000-4000-8000-0000000000a1";
const CAIO = "f1030000-0000-4000-8000-0000000000c1";
const CASE_A = "f1030000-0000-4000-8000-00000000000a";
const CASE_B = "f1030000-0000-4000-8000-00000000000b";
const NOW = new Date("2026-11-05T15:00:00Z"); // 12:00 in Brasília

const lawyer = (userId: string, extra: Partial<FilingViewer> = {}): FilingViewer => ({
  userId,
  firmFunction: "advogado",
  managesFirm: false,
  cloudSigning: true,
  ...extra,
});

const ATTENTION: FilingAttention = {
  signatures: [
    {
      userId: ANA,
      name: "Ana Lima",
      lawsuits: 3,
      cases: 2,
      seq: 7,
      caseId: CASE_A,
      state: "expiring",
      expiresAt: "2026-11-05T20:30:00Z",
    },
    { userId: CAIO, name: "", lawsuits: 1, cases: 1, seq: 9, caseId: CASE_B, state: "cpf_missing", expiresAt: null },
  ],
  filings: [
    { submissionId: "s-1", caseId: CASE_A, seq: 7, status: "refused", since: null },
    { submissionId: "s-2", caseId: CASE_B, seq: 9, status: "unknown", since: null },
  ],
  filingsTotal: 4,
};

const translate = createTranslator({ locale: "pt-BR", messages, namespace: "product" });
const t = (key: string, values?: Record<string, string | number>) =>
  translate(key as Parameters<typeof translate>[0], values as never);
const said = (item: PendingItem) => ({
  label: sayPending(t, item.label),
  detail: item.detail ? sayPending(t, item.detail) : null,
});

describe("what ONE's filing waits on a person for, as the database says it", () => {
  it("reads the answer of firm_filing_attention, and refuses one that is not it", () => {
    const read = readFilingAttention({
      signatures: [
        {
          user_id: ANA,
          name: "Ana Lima",
          lawsuits: 2,
          cases: 5,
          seq: 7,
          case_id: CASE_A,
          state: "none",
          expires_at: null,
        },
        { user_id: CAIO, state: "unheard of" },
        { state: "none" },
      ],
      filings: [
        { submission_id: "s-1", case_id: CASE_A, seq: 7, status: "filed", since: "2026-11-05T10:00:00Z" },
        { submission_id: "s-2", case_id: CASE_B, status: "owed" },
      ],
      filings_total: 1,
    });
    expect(read?.signatures).toEqual([
      // Never more cases than lawsuits.
      { userId: ANA, name: "Ana Lima", lawsuits: 2, cases: 2, seq: 7, caseId: CASE_A, state: "none", expiresAt: null },
    ]);
    expect(read?.filings).toEqual([
      { submissionId: "s-1", caseId: CASE_A, seq: 7, status: "filed", since: "2026-11-05T10:00:00Z" },
    ]);
    expect(read?.filingsTotal).toBe(1);
    expect(readFilingAttention(null)).toBeNull();
    expect(readFilingAttention([])).toBeNull();
    expect(readFilingAttention({ signatures: [] })).toBeNull();
  });

  it("says a moment with what goes before it, on the person's clock", () => {
    expect(momentWords("2026-11-05T20:30:00Z", NOW)).toBe("hoje às 17:30");
    expect(momentWords("2026-11-06T12:00:00Z", NOW)).toBe("amanhã às 09:00");
    expect(momentWords("2026-11-09T12:00:00Z", NOW)).toBe("em 09/11 às 09:00");
    expect(momentWords("2026-11-05T20:30:00Z", NOW, "America/Rio_Branco")).toBe("hoje às 15:30");
    // A zone the clock does not know is the platform's.
    expect(momentWords("2026-11-05T20:30:00Z", NOW, "Mars/Olympus")).toBe("hoje às 17:30");
    expect(momentWords(null, NOW)).toBe("");
    expect(momentWords("not a moment", NOW)).toBe("");
  });
});

describe("the lines of the center", () => {
  it("tells a lawyer their own authorization, to renew before it ends, and the filings that came back", () => {
    const items = filingAttentionItems(ATTENTION, lawyer(ANA), NOW);
    expect(items.map((item) => item.id)).toEqual([
      `cloud-signature:${ANA}:expiring`,
      "filing:s-1:refused",
      "filing:s-2:unknown",
      "filings:more",
    ]);
    const [signature, refused, unknown, more] = items;
    expect(signature).toMatchObject({
      href: "/settings/team#team-cloud-signature",
      tag: { key: "pending-tag-cloud-signature" },
      count: 3,
    });
    expect(said(signature)).toEqual({
      label: "A sua autorização de assinatura em nuvem termina hoje às 17:30, e 3 ações suas esperam por ela",
      detail: "Caso nº 7 e mais um caso · o ONE assina os arquivos do protocolo com ela",
    });
    expect(refused).toMatchObject({ href: `/casos/${CASE_A}#case-filing`, tag: { key: "pending-tag-filing" } });
    expect(said(refused)).toEqual({
      label: "O tribunal não aceitou o protocolo do ONE",
      detail: "Caso nº 7 · veja o motivo no caso",
    });
    expect(said(unknown).detail).toBe("Caso nº 9 · confira no sistema do tribunal antes de enviar de novo");
    expect(more).toMatchObject({ href: "/protocolo", count: 2 });
    expect(said(more).label).toBe("Mais 2 protocolos esperam uma pessoa");
  });

  it("tells a partner the team's, a colleague with no name included, and asks a lawyer with no CPF for it", () => {
    const partner = filingAttentionItems(ATTENTION, lawyer(ANA, { firmFunction: "socio" }), NOW);
    const caio = partner.find((item) => item.id === `cloud-signature:${CAIO}:cpf_missing`);
    expect(caio).toBeDefined();
    expect(said(caio as PendingItem)).toEqual({
      label: "Uma ação espera a autorização de assinatura em nuvem de um advogado do escritório",
      detail: "Caso nº 9 · o ONE assina os arquivos do protocolo com ela",
    });

    const own = filingAttentionItems(ATTENTION, lawyer(CAIO), NOW);
    expect(own.filter((item) => item.id.startsWith("cloud-signature:")).map(said)).toEqual([
      {
        label: "Uma ação sua espera o seu CPF para a assinatura em nuvem",
        detail: "Caso nº 9 · o ONE assina os arquivos do protocolo com ela",
      },
    ]);
  });

  it("tells who manages the firm the team's signatures, and nobody who does not file the filings", () => {
    const manager = filingAttentionItems(
      ATTENTION,
      lawyer("someone-else", { firmFunction: "atendimento", managesFirm: true }),
      NOW,
    );
    expect(manager.map((item) => item.id)).toEqual([
      `cloud-signature:${ANA}:expiring`,
      `cloud-signature:${CAIO}:cpf_missing`,
    ]);
    expect(said(manager[0]).label).toBe(
      "A autorização de assinatura em nuvem de Ana Lima termina hoje às 17:30, e 3 ações esperam por ela",
    );
    const attendance = filingAttentionItems(ATTENTION, lawyer("someone-else", { firmFunction: "atendimento" }), NOW);
    expect(attendance).toEqual([]);
  });

  it("says nothing of the cloud signature where no provider can be used here", () => {
    const items = filingAttentionItems(ATTENTION, lawyer(ANA, { firmFunction: "socio", cloudSigning: false }), NOW);
    expect(items.some((item) => item.id.startsWith("cloud-signature:"))).toBe(false);
    expect(items.filter((item) => item.id.startsWith("filing:"))).toHaveLength(2);
  });

  it("has words for every line it can show, in each state", () => {
    const every: FilingAttention = {
      signatures: (["cpf_missing", "none", "expiring"] as const).flatMap((state, index) => [
        {
          userId: ANA,
          name: "Ana Lima",
          lawsuits: index + 1,
          cases: 1,
          seq: index + 1,
          caseId: CASE_A,
          state,
          expiresAt: state === "expiring" ? "2026-11-06T01:00:00Z" : null,
        },
        {
          userId: `${CAIO}-${index}`,
          name: "Caio Prado",
          lawsuits: 2,
          cases: 2,
          seq: 4,
          caseId: CASE_B,
          state,
          expiresAt: state === "expiring" ? "2026-11-07T01:00:00Z" : null,
        },
      ]),
      filings: (["refused", "failed", "unknown", "filed"] as const).map((status, index) => ({
        submissionId: `s-${index}`,
        caseId: CASE_A,
        seq: 7,
        status,
        since: null,
      })),
      filingsTotal: 6,
    };
    const items = filingAttentionItems(every, lawyer(ANA, { firmFunction: "socio" }), NOW);
    expect(items).toHaveLength(6 + 4 + 1);
    for (const item of items) {
      const words = said(item);
      expect(sayPending(t, item.tag)).not.toContain("pending-");
      expect(words.label).not.toMatch(/[{}]|pending-|—|–|!/);
      if (words.detail) expect(words.detail).not.toMatch(/[{}]|pending-|—|–|!/);
    }
  });

  it("finds the person's own need for the team's card", () => {
    expect(ownSignatureNeed(ATTENTION, CAIO)?.state).toBe("cpf_missing");
    expect(ownSignatureNeed(ATTENTION, "nobody")).toBeNull();
    expect(ownSignatureNeed(null, ANA)).toBeNull();
  });
});
