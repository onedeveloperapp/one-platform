import {
  answered,
  backendOrNull,
  bodyOf,
  hashApiKey,
  keyOf,
  refused,
} from "@/modules/direito-do-passageiro/agency/api";

export const dynamic = "force-dynamic";

/** The most lines a call takes: the database's `import_rows_per_call`. */
const MOST_LINES = 200;

/**
 * `POST /api/parceiros/v1/passageiros`: the agency's system sends passengers and their trips, as the lines of a
 * spreadsheet (migration 0073, `pax_api_import`): each a passenger (found by CPF in the partnership, or by name and
 * birth date, or added) and, with a locator, the trip of that locator with its leg. A line that cannot be written is
 * refused alone, with why; the others go on.
 */
export async function POST(request: Request) {
  const key = keyOf(request);
  if (!key) return refused("missing_key");
  const body = await bodyOf(request);
  const lines = body?.linhas;
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MOST_LINES) return refused("invalid_rows");
  const backend = backendOrNull();
  if (!backend) return refused("unavailable");
  const rows = lines.map((line, index) => {
    const row =
      typeof line === "object" && line !== null && !Array.isArray(line) ? (line as Record<string, unknown>) : {};
    return { ...row, line: typeof row.linha === "number" ? row.linha : index + 1 };
  });
  const { data, error } = await backend.rpc("pax_api_import", { target_key_hash: hashApiKey(key), target_rows: rows });
  if (error) return refused("failed");
  const answer = (data ?? {}) as Record<string, unknown>;
  if (!answer.ok) return refused(String(answer.code ?? "failed"));
  return answered({
    adicionados: answer.added ?? 0,
    ja_existiam: answer.matched ?? 0,
    viagens_novas: answer.trips_added ?? 0,
    trechos_novos: answer.legs_added ?? 0,
    recusadas: (Array.isArray(answer.problems) ? answer.problems : []).map((item) => {
      const problem = (item ?? {}) as { line?: unknown; code?: unknown; field?: unknown };
      return { linha: problem.line ?? null, motivo: problem.code ?? "not_written", campo: problem.field ?? null };
    }),
  });
}
