import { choiceOf, type IntakeOption, optionsText } from "@/lib/conversations/intake";
import { isAccountMethod } from "@/lib/signatures/methods";

/**
 * The documents ONE asks in the chat, one at a time (migration 0230, the chat's script of 2026-11-12): after the files
 * of a turn are said back, the next one still owed, by whose it is; with nothing essential left, the dispensable ones
 * the case asks now, once, with "Não tenho"; and, when the case waits for its signature, that the link to sign comes
 * here. Pure: the database says what is owed (`conversation_papers_owed`).
 */

export type PaperOwed = {
  kind: string;
  per: string;
  name: string | null;
  own: boolean;
  minor: boolean;
  rejected: boolean;
  /** The name the case asks it by (a document of a case of an area of the firm, 0274). */
  label: string | null;
};

export type DispensableState = { kind: string; label: string; state: string };

export type PapersOwed = {
  caseId: string;
  waitsSignature: boolean;
  owed: PaperOwed[];
  dispensables: DispensableState[];
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/** The database's answer, or null when there is no case being gathered or it could not be read. */
export function papersOwedOf(raw: unknown): PapersOwed | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (row.ok !== true || row.code !== "case" || !text(row.case_id)) return null;
  return {
    caseId: String(row.case_id),
    waitsSignature: row.waits_signature === true,
    owed: (Array.isArray(row.owed) ? row.owed : []).flatMap((item): PaperOwed[] => {
      const owed = (item ?? {}) as Record<string, unknown>;
      const kind = text(owed.kind);
      return kind
        ? [
            {
              kind,
              per: text(owed.per) ?? "case",
              name: text(owed.name),
              own: owed.own === true,
              minor: owed.minor === true,
              rejected: owed.rejected === true,
              label: text(owed.label),
            },
          ]
        : [];
    }),
    dispensables: (Array.isArray(row.dispensables) ? row.dispensables : []).flatMap((item): DispensableState[] => {
      const d = (item ?? {}) as Record<string, unknown>;
      const kind = text(d.kind);
      return kind ? [{ kind, label: text(d.label) ?? kind, state: text(d.state) ?? "" }] : [];
    }),
  };
}

const first = (name: string | null): string => (name ?? "").trim().split(/\s+/)[0] ?? "";

/** "dos últimos 3 meses", or "do último mês": how far back a proof of address may be dated (0237). */
export const monthsWords = (months: number): string =>
  months <= 1 ? "do último mês" : `dos últimos ${Math.round(months)} meses`;

/**
 * How ONE asks one document, by whose it is. A proof of address is asked in the client's own name and recent, never
 * offered in somebody else's, which costs more steps (the owner, 2026-11-13); one in another name is taken up after.
 */
export function paperAsk(owed: PaperOwed, addressMonths = 3): string {
  const whose = owed.own ? null : first(owed.name) || null;
  switch (owed.kind) {
    case "identity":
      if (!whose) return "Agora a foto do seu documento de identidade, RG ou CNH, com a frente e o verso.";
      return owed.minor
        ? `Agora a certidão de nascimento ou o RG de ${whose}.`
        : `Agora a foto do documento de identidade de ${whose}, RG ou CNH, com a frente e o verso.`;
    case "address_proof":
      return `Agora um comprovante de endereço no seu nome, ${monthsWords(addressMonths)}: conta de luz, água, telefone ou internet.`;
    case "ticket":
    case "boarding_pass":
      return "Agora o cartão de embarque, o bilhete ou o print da reserva.";
    case "baggage_report":
      return "Agora o RIB, o registro que você fez no aeroporto do problema com a bagagem.";
    default:
      // A document a case of an area asks by its name (0274).
      if (owed.label) return `Agora ${whose ? `de ${whose}: ` : ""}${owed.label}. Pode mandar a foto aqui.`;
      return "Agora o próximo documento que o escritório pediu. Pode mandar a foto aqui.";
  }
}

/** The answer to the dispensable documents ONE asked. */
export const NOT_HAVE_OPTIONS: readonly IntakeOption[] = [
  {
    value: "nao_tenho",
    label: "Não tenho",
    words: ["nao tenho", "nao", "nenhum", "nao tenho nenhum", "nao tenho nada"],
  },
];

/** The last line of ONE's message that asks the dispensable documents: how the next turn knows its answer. */
export const NOT_HAVE_LINE = optionsText(NOT_HAVE_OPTIONS);

/** The dispensable documents the case asks now, in one message; null when none is asked. */
export function dispensablesAsk(items: readonly DispensableState[]): string | null {
  const asked = items.filter((item) => item.state === "asked");
  if (asked.length === 0) return null;
  return `Se você tiver, mande também: ${asked.map((item) => item.label).join("; ")}. Ajuda a provar o que aconteceu.\n${NOT_HAVE_LINE}`;
}

/** What ONE says once nothing essential is owed and the case waits for its signature. */
export const AWAITING_SIGNATURE =
  "Recebi tudo o que eu precisava por agora. O escritório prepara a procuração e eu te mando aqui o link para assinar.";

/**
 * What ONE asks after the files of a turn: the next document owed that was not just refused (the line of the refused
 * one already says to send it again); with nothing essential left, the dispensable ones, or the word that the link to
 * sign comes here. Null when there is nothing to ask.
 */
export function nextPaperAsk(
  papers: PapersOwed,
  options: { dispensablesAsked: boolean; addressMonths?: number },
): string | null {
  const next = papers.owed.find((owed) => !owed.rejected);
  if (next) return paperAsk(next, options.addressMonths);
  if (papers.owed.length > 0) return null;
  if (papers.waitsSignature) return AWAITING_SIGNATURE;
  return options.dispensablesAsked ? null : dispensablesAsk(papers.dispensables);
}

/** Whether a reply answers ONE's question on the dispensable documents with "Não tenho". */
export const saysNotHave = (reply: string): boolean => choiceOf(NOT_HAVE_OPTIONS, reply) === "nao_tenho";

// ---------- The links to sign, in the chat (0231) ----------

export type PaperToSign = { paperId: string; kind: string; method: string; signUrl: string | null };

/** Each paper of a case as ONE names it. */
const PAPER_NAMES: Record<string, string> = {
  procuracao: "Procuração",
  contrato: "Contrato",
  declaracao_residencia: "Declaração de residência",
  declaracao_hipossuficiencia: "Declaração para a justiça gratuita",
};

const paperName = (kind: string): string => PAPER_NAMES[kind] ?? "Documento";

/** Each paper with its article, as a sentence names it. */
const PAPER_IN_SENTENCE: Record<string, string> = {
  procuracao: "a procuração",
  contrato: "o contrato",
  declaracao_residencia: "a declaração de residência",
  declaracao_hipossuficiencia: "a declaração para a justiça gratuita",
};

const paperInSentence = (kind: string): string => PAPER_IN_SENTENCE[kind] ?? "o documento";

/** The papers of a row of `signature_links_owed`, read. */
export function papersToSignOf(raw: unknown): PaperToSign[] {
  return (Array.isArray(raw) ? raw : []).flatMap((item): PaperToSign[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    const paperId = text(row.paper_id);
    const kind = text(row.kind);
    const method = text(row.method);
    return paperId && kind && method ? [{ paperId, kind, method, signUrl: text(row.sign_url) }] : [];
  });
}

/**
 * ONE's message with the links to sign: each paper the provider signs with its own address, the ones signed by gov.br
 * said to be on the client's link (`linkUrl`, made with this message since the case opened in the chat sends none,
 * 0237), and that ONE goes on here once it is signed. Null when there is nothing to tell.
 */
export function signatureLinksMessage(
  name: string | null,
  papers: readonly PaperToSign[],
  linkUrl: string | null = null,
): string | null {
  const online = papers.filter((paper) => isAccountMethod(paper.method) && paper.signUrl);
  const govbr = papers.filter((paper) => paper.method === "govbr");
  if (online.length === 0 && govbr.length === 0) return null;
  const who = first(name);
  const lines = [`Falta só assinar${who ? `, ${who}` : ""}.`];
  if (online.length === 1) {
    lines[0] += ` O escritório preparou ${paperInSentence(online[0].kind)}, e leva uns 2 minutos: ${online[0].signUrl}`;
  } else if (online.length > 1) {
    lines[0] += " Cada documento tem o seu link, e leva uns 2 minutos no total:";
    online.forEach((paper, index) => lines.push(`${index + 1}. ${paperName(paper.kind)}: ${paper.signUrl}`));
  }
  if (govbr.length > 0) {
    const names = govbr.map((paper) => paperInSentence(paper.kind)).join(", ");
    lines.push(
      `${online.length > 0 ? "E" : "O escritório preparou"} ${govbr.length > 1 ? "estes documentos, que se assinam" : "este documento, que se assina"} pelo gov.br: ${names}. ${linkUrl ? `O documento e os passos estão neste link: ${linkUrl}` : "O documento e os passos estão no link do seu caso."}`,
    );
  }
  lines.push("Depois de assinar, eu continuo por aqui.");
  return lines.join("\n");
}
