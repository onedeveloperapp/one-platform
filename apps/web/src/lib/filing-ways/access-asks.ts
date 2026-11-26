/**
 * ONE asking a lawyer for their access where a lawsuit of theirs goes to a court's screen they never said how to file
 * at (migration 0304; the owner, 2026-11-25: "identifique quando for um tribunal diferente do cadastrado e o ONE
 * dentro do próprio caso solicite o acesso ao advogado"). Pure: what `filing_access_owed` answers, read, and the words,
 * the key and the address of each ask. The work is in `access-asks-work.ts`.
 */

/** One lawyer whose access ONE needs, as `filing_access_owed` answers it. */
export type AccessOwed = {
  packageId: string;
  caseId: string;
  seq: number | null;
  proceedingId: string;
  systemKey: string;
  systemName: string;
  userId: string;
};

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** The rows of `filing_access_owed`, read; a row missing what an ask needs is left out. */
export function accessOwedOf(data: unknown): AccessOwed[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const packageId = text(row.package_id);
    const caseId = text(row.case_id);
    const proceedingId = text(row.proceeding_id);
    const systemKey = text(row.system_key);
    const systemName = text(row.system_name);
    const userId = text(row.user_id);
    if (!packageId || !caseId || !proceedingId || !systemKey || !systemName || !userId) return [];
    return [
      {
        packageId,
        caseId,
        seq: typeof row.seq === "number" ? row.seq : null,
        proceedingId,
        systemKey,
        systemName,
        userId,
      },
    ];
  });
}

/** The lawsuit an ask names: "A ação do caso nº 19", or "A ação" for a case with no number. */
export const accessWhat = (seq: number | null): string => (seq !== null ? `A ação do caso nº ${seq}` : "A ação");

/**
 * The values of the firm's template of `filing_batch_waits` (0284: "Olá, {{1}}. O protocolo do ONE no {{2}} precisa de
 * você: {{3}}. Abra Protocolo no ONE para seguir."): the lawyer's first name, the system and what is asked.
 */
export function accessParams(name: string, owed: Pick<AccessOwed, "seq" | "systemName">): string[] {
  const first = name.trim().split(/\s+/)[0] || "equipe";
  const lawsuit = owed.seq !== null ? `a ação do caso nº ${owed.seq}` : "uma ação";
  return [first, owed.systemName, `${lawsuit} está pronta, e falta você escolher como o ONE protocola por você`];
}

/** The bell's key of an ask: once per lawsuit and system, so a package built again rings no second time. */
export const accessKey = (owed: Pick<AccessOwed, "proceedingId" | "systemKey">): string =>
  `filing-access:${owed.proceedingId}:${owed.systemKey}`;

/** The case with the choice open in front (`?acesso=` on the card of the filing). */
export const accessHref = (owed: Pick<AccessOwed, "caseId" | "systemKey">): string =>
  `/casos/${owed.caseId}?acesso=${encodeURIComponent(owed.systemKey)}#case-filing`;
