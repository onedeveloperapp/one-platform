import ImportView from "./components/import-view";
import type { ImportBatchView, ImportState } from "./import-types";
import { cookies } from "next/headers";

import { momentLabel, type SecondFactorState } from "@/lib/ai/approvals";
import { importLimitsOf } from "@/lib/import/limits";
import { canImportPortfolio } from "@/lib/import/who";
import { getMemberContext } from "@/lib/member/context";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

/**
 * The firm's spreadsheets the history shows, the latest first: every one a person may still do something with
 * (go on, undo or give it up), and of the others the last few.
 */
const ACTIONABLE_READ = 500;
const ENDED_SHOWN = 5;

const BATCH_COLUMNS =
  "id, file_name, source_system, status, rows_count, counts, file_counts, created_at, committed_at, reverted_at";

/**
 * /casos/importar: a firm brings the lawsuits it already has in court from
 * the spreadsheet of the system it used before. The spreadsheet is read in
 * the person's browser; this page hands the screen what the reading needs
 * (the courts and the airlines ONE knows, the limits of a batch) and the
 * firm's imports a person may still act on, read under the person's own
 * session.
 */
async function loadImport(): Promise<ImportState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  if ((await cookies()).has(IMPERSONATION_MARKER_COOKIE)) return { kind: "support" };
  if (!canImportPortfolio(context.firm.firmFunction)) return { kind: "not-allowed" };
  const { supabase } = context;
  const firm = context.firm.id;

  const [courts, airlines, open, recent, limits, assurance] = await Promise.all([
    supabase.from("courts").select("acronym, cnj_segment, cnj_code").order("acronym"),
    // Every airline, the ones that no longer fly too: a party of one of their names is read as none.
    supabase.from("airlines").select("iata, name, legal_name, court_names, active").order("name"),
    supabase
      .from("import_batches")
      .select(BATCH_COLUMNS)
      .eq("org_id", firm)
      .in("status", ["staged", "committed"])
      .order("created_at", { ascending: false })
      .limit(ACTIONABLE_READ),
    supabase
      .from("import_batches")
      .select(BATCH_COLUMNS)
      .eq("org_id", firm)
      .order("created_at", { ascending: false })
      .limit(ENDED_SHOWN * 4),
    supabase.rpc("import_limits"),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (courts.error || airlines.error || open.error || recent.error || limits.error) return { kind: "error" };

  type BatchRow = {
    id: string;
    file_name: string | null;
    source_system: string | null;
    status: string;
    rows_count: number;
    counts: Record<string, unknown> | null;
    file_counts: Record<string, unknown> | null;
    created_at: string;
    committed_at: string | null;
    reverted_at: string | null;
  };
  // What a person may still act on: one that did not end, or one whose cases may still be undone.
  const actionable = (batch: BatchRow) =>
    batch.status === "staged" ||
    (batch.status === "committed" && typeof batch.counts?.created === "number" && batch.counts.created > 0);
  const ended = ((recent.data ?? []) as BatchRow[]).filter((batch) => !actionable(batch)).slice(0, ENDED_SHOWN);
  const rows = [...((open.data ?? []) as BatchRow[]).filter(actionable), ...ended].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  // A batch that did not end: how far it went says what a person may do with it (go on, undo, or give it up).
  const unfinished = rows.filter((batch) => batch.status === "staged");
  const decided = await Promise.all(
    unfinished.map((batch) =>
      supabase
        .from("import_rows")
        .select("id", { count: "exact", head: true })
        .eq("org_id", firm)
        .eq("batch_id", batch.id)
        .not("outcome", "is", null),
    ),
  );
  if (decided.some((answer) => answer.error)) return { kind: "error" };
  const decidedOf = new Map(unfinished.map((batch, index) => [batch.id, decided[index].count ?? 0]));

  const number = (counts: Record<string, unknown>, key: string) =>
    typeof counts[key] === "number" ? (counts[key] as number) : 0;
  const history: ImportBatchView[] = rows.flatMap((batch) => {
    if (batch.status !== "staged" && batch.status !== "committed" && batch.status !== "reverted") return [];
    return [
      {
        id: batch.id,
        fileName: batch.file_name,
        source: batch.source_system,
        status: batch.status,
        rows: batch.rows_count,
        decided: batch.status === "staged" ? (decidedOf.get(batch.id) ?? 0) : null,
        counts: batch.counts
          ? {
              rows: number(batch.counts, "rows"),
              pending: number(batch.counts, "pending"),
              created: number(batch.counts, "created"),
              exists: number(batch.counts, "exists"),
              refused: number(batch.counts, "refused"),
              reverted: number(batch.counts, "reverted"),
              kept: number(batch.counts, "kept"),
            }
          : null,
        // What the screen counted of the file when the batch started: the lawsuits it found in the firm.
        fileExists: typeof batch.file_counts?.exists === "number" ? batch.file_counts.exists : 0,
        whenLabel: momentLabel(batch.reverted_at ?? batch.committed_at ?? batch.created_at, context.profile.timezone),
      },
    ];
  });

  // `nextLevel` is aal2 exactly when the account has a verified factor;
  // `currentLevel` is aal2 when this session already confirmed it.
  const secondFactor: SecondFactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";

  type AirlineRow = {
    iata: string;
    name: string;
    legal_name: string | null;
    court_names: string[] | null;
    active: boolean;
  };
  return {
    kind: "ready",
    courts: ((courts.data ?? []) as { acronym: string; cnj_segment: string; cnj_code: string }[]).map((court) => ({
      acronym: court.acronym,
      segment: court.cnj_segment,
      code: court.cnj_code,
    })),
    // An airline is recognised in a spreadsheet by its own name and by the company's names in court.
    airlines: ((airlines.data ?? []) as AirlineRow[]).map((airline) => ({
      iata: airline.iata,
      name: airline.name,
      names: [airline.legal_name, ...(airline.court_names ?? [])].filter((name): name is string => Boolean(name)),
      active: airline.active,
    })),
    history,
    today: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()),
    secondFactor,
    limits: importLimitsOf(limits.data),
  };
}

export default async function ImportPage() {
  return <ImportView state={await loadImport()} />;
}
