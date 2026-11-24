/**
 * The reminder of a package that waits to be filed (migration 0269): a package ready to file that nobody files, the
 * setting's days after it was built, is said to the lawyers of its lawsuit on the bell and on their WhatsApp, as the
 * firm's template `filing_waits`, at most the setting's rounds, each the setting's days after the last
 * (`filing_waits_owed`). Pure: when a reminder may reach a person, and its words.
 */

const ZONE = "America/Sao_Paulo";

/** One reminder owed, as `filing_waits_owed` answers it. */
export type FilingWaitsOwed = {
  packageId: string;
  orgId: string;
  caseId: string;
  seq: number | null;
  court: string;
  system: string;
  systemName: string | null;
  since: string;
  isTest: boolean;
  userId: string;
  name: string;
  round: number;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/** The database's answer, read; an entry that is not one is left out. */
export function filingWaitsOwedOf(raw: unknown): FilingWaitsOwed[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const packageId = text(row.package_id);
    const orgId = text(row.org_id);
    const caseId = text(row.case_id);
    const userId = text(row.user_id);
    const since = text(row.since);
    const round = typeof row.round === "number" && Number.isInteger(row.round) ? row.round : null;
    if (!packageId || !orgId || !caseId || !userId || !since || round === null || round < 1) return [];
    return [
      {
        packageId,
        orgId,
        caseId,
        seq: typeof row.seq === "number" ? row.seq : null,
        court: text(row.court) ?? "",
        system: text(row.system) ?? "",
        systemName: text(row.system_name),
        since,
        isTest: row.is_test === true,
        userId,
        name: text(row.name) ?? "",
        round,
      },
    ];
  });
}

/**
 * Whether a reminder may reach a person now: on a weekday, between eight in the morning and seven in the evening in
 * Brasília. A package waits for a working day; nobody is called about it on a Sunday night.
 */
export function remindNow(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
  const hour = Number(parts.hour);
  return !["Sat", "Sun"].includes(parts.weekday ?? "") && hour >= 8 && hour < 19;
}

/** The court's system as the reminder names it: its own name where the platform has it ("eproc do TJSP"). */
export function systemWords(owed: Pick<FilingWaitsOwed, "court" | "system" | "systemName">): string {
  if (owed.systemName) return owed.systemName;
  const system = { projudi: "Projudi", eproc: "eproc", pje: "PJe", esaj: "e-SAJ" }[owed.system] ?? "sistema";
  return owed.court ? `${system} do ${owed.court}` : system;
}

/** The day a package became ready, as a person reads it: "sexta-feira, 20 de novembro". */
export function sinceWords(since: string): string {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: ZONE }).format(
    new Date(since),
  );
}

/** The values of the template `filing_waits`: the first name, the lawsuit, the court's system and since when. */
export function filingWaitsParams(owed: FilingWaitsOwed): string[] {
  const first = owed.name.trim().split(/\s+/)[0] || "equipe";
  const what = owed.seq !== null ? `A ação do caso ${owed.seq}` : "A ação";
  return [first, what, systemWords(owed), sinceWords(owed.since)];
}
