import "server-only";

import { momentLabel } from "@/lib/ai/approvals";
import { isPackageStatus, type PackageStatus, QUEUE_SHOWN } from "@/lib/cases/filing";
import { pscAvailable } from "@/lib/psc/provider";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What a screen reads of the filing packages (migration 0027), under the
 * person's own session: the packages of one case with their files and
 * receipt, and the firm's filing queue. A read that fails throws: a screen
 * shows an error, never a case or a queue with no package.
 */

export type FilingItem = {
  id: string;
  position: number;
  name: string;
  bytes: number;
  pages: number | null;
  documentId: string | null;
  /** Which part of its document the file is, and of how many: 1 of 1 for a file that was not cut. */
  part: number;
  parts: number;
  /** The `.p7s` ONE signed of this file (0042), when the package is signed. */
  signed: boolean;
};

/**
 * What the package owes of its signature (migration 0042), where the court's
 * system takes its files already signed (a `.p7s` each).
 */
export type FilingSignature = {
  /** The court's system takes the files already signed. */
  takesSigned: boolean;
  /** A lawyer can authorize ONE at some PSC here: the platform's client is registered at one the list offers. */
  cloudSigning: boolean;
  /** A person confirmed the court system's row, the form of its signed files included. */
  formatConfirmed: boolean;
  status: "due" | "waiting" | "signed" | "failed" | null;
  /** Why it waits or failed: a short code (the lawyer's to put right, or a failure). */
  error: string | null;
  signedBy: string | null;
  signedLabel: string | null;
  /** A lawyer of the lawsuit asked for it with their own authorization. */
  requestedBy: string | null;
  /** The person reading signs the lawsuit: they may ask ONE to sign with their own authorization. */
  viewerSigns: boolean;
  /** The person reading has an authorization of their own in force: what they ask is signed with it, and nobody else's. */
  viewerAuthorized: boolean;
  /** The files were signed with the certificate of the person reading: the `.p7s` are theirs alone to take. */
  viewerSigned: boolean;
  /** The person reading asked for the signature in course. */
  viewerRequested: boolean;
};

export type FilingReceipt = { id: string; cnj: string; filedOn: string };

/** The package of a lawsuit, as the case shows it. */
/**
 * ONE filing a package itself (0101): through which channel (the court's MNI, or the test court of a test case), what
 * keeps it from doing so now, how the firm has the decision, and what came of the submission. Null when it could
 * not be read: the card then shows the lawyer's own way, as before.
 */
export type FilingByOne = {
  channel: "mni" | "test_court" | null;
  blocker: string | null;
  mode: "auto" | "sampled" | "approval";
  submission: {
    id: string;
    status: "owed" | "claimed" | "sending" | "filed" | "refused" | "unknown" | "failed";
    channel: "mni" | "test_court";
    protocol: string | null;
    caseNumber: string | null;
    message: string | null;
    error: string | null;
    attempts: number;
    retryAfter: string | null;
    filedAt: string | null;
    requested: boolean;
  } | null;
};

const SUBMISSION_STATUSES = ["owed", "claimed", "sending", "filed", "refused", "unknown", "failed"] as const;

/** One package's row of `case_filing_by_one`, read. */
function filingByOneOf(row: Record<string, unknown>): FilingByOne {
  const sub = row.submission && typeof row.submission === "object" ? (row.submission as Record<string, unknown>) : null;
  const status = (SUBMISSION_STATUSES as readonly unknown[]).includes(sub?.status)
    ? (sub?.status as FilingByOne["submission"] extends infer S ? (S extends { status: infer T } ? T : never) : never)
    : null;
  const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
  return {
    channel: row.channel === "mni" || row.channel === "test_court" ? row.channel : null,
    blocker: text(row.blocker),
    mode: row.mode === "approval" || row.mode === "sampled" ? row.mode : "auto",
    submission:
      sub && status
        ? {
            id: String(sub.id),
            status,
            channel: sub.channel === "mni" ? "mni" : "test_court",
            protocol: text(sub.protocol),
            caseNumber: text(sub.case_number),
            message: text(sub.message),
            error: text(sub.error),
            attempts: typeof sub.attempts === "number" ? sub.attempts : 0,
            retryAfter: text(sub.retry_after),
            filedAt: text(sub.filed_at),
            requested: sub.requested === true,
          }
        : null,
  };
}

export type CaseFiling = {
  id: string;
  proceedingId: string;
  court: string;
  system: string;
  /** The kind of lawsuit it was built for: one whose kind changed since is built again. */
  kind: "juizado" | "comum";
  status: PackageStatus;
  petitionDocumentId: string;
  documentIds: string[];
  /** The limit of the court's system the package was built under, and whether a person had confirmed it. */
  limitBytes: number | null;
  limitConfirmed: boolean;
  /** The petition's own limit in the system, when it gives one (0036). */
  petitionLimitBytes: number | null;
  /** What cannot go as it is, by document. */
  problems: { documentId: string; code: string }[];
  error: string | null;
  requestedLabel: string;
  /** When it was asked for: since when the case waits at its filing. */
  requestedAt: string;
  /** Asked long enough ago that a job should have built it by now. */
  slow: boolean;
  items: FilingItem[];
  receipt: FilingReceipt | null;
  /**
   * What keeps its lawsuit from being filed now (0025, `filing_blockers`): a family split nobody chose, or a claimant
   * whose word on the civil court is not a yes. A package built before that changed is not to be filed.
   */
  blocker: string | null;
  signature: FilingSignature;
  /** ONE filing it itself (0101); null when it could not be read. */
  byOne: FilingByOne | null;
};

type Embedded<T> = T | T[] | null;
const many = <T>(value: Embedded<T>): T[] => (Array.isArray(value) ? value : value ? [value] : []);
const one = <T>(value: Embedded<T>): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

type PackageRow = {
  id: string;
  case_id: string;
  proceeding_id: string;
  court: string;
  system: string;
  kind: string;
  status: string;
  petition_document_id: string;
  document_ids: string[] | null;
  limit_bytes: number | null;
  limit_confirmed: boolean;
  petition_limit_bytes: number | null;
  problems: unknown;
  error: string | null;
  requested_at: string;
  signature_status: string | null;
  signature_error: string | null;
  signed_by: string | null;
  signed_at: string | null;
  signer_requested: string | null;
  filing_package_items: Embedded<{
    id: string;
    position: number;
    name: string;
    bytes: number;
    pages: number | null;
    document_id: string | null;
    part: number;
    parts: number;
    signed_file_id: string | null;
  }>;
  filing_receipts: Embedded<{ id: string; cnj: string; filed_on: string }>;
};

const PACKAGE_COLUMNS =
  "id, case_id, proceeding_id, court, system, kind, status, petition_document_id, document_ids, limit_bytes, limit_confirmed, petition_limit_bytes, problems, error, requested_at, signature_status, signature_error, signed_by, signed_at, signer_requested, filing_package_items(id, position, name, bytes, pages, document_id, part, parts, signed_file_id), filing_receipts(id, cnj, filed_on)";

const SIGNATURE_STATUSES = ["due", "waiting", "signed", "failed"] as const;

/** How long a package may wait to be built before the screen says a job is late. */
const SLOW_MINUTES = 3;

/** What the person reading is to a package's signature, and what the court's system takes. */
type SignatureContext = {
  takesSigned: boolean;
  cloudSigning: boolean;
  formatConfirmed: boolean;
  viewerId: string | null;
  viewerSigns: boolean;
  viewerAuthorized: boolean;
};

function toFiling(row: PackageRow, timeZone: string | null | undefined, context: SignatureContext): CaseFiling | null {
  if (!isPackageStatus(row.status)) return null;
  const receipt = one(row.filing_receipts);
  const problems = Array.isArray(row.problems) ? (row.problems as Record<string, unknown>[]) : [];
  return {
    id: row.id,
    proceedingId: row.proceeding_id,
    court: row.court,
    system: row.system,
    kind: row.kind === "comum" ? "comum" : "juizado",
    status: row.status,
    petitionDocumentId: row.petition_document_id,
    documentIds: row.document_ids ?? [],
    limitBytes: row.limit_bytes === null ? null : Number(row.limit_bytes),
    limitConfirmed: Boolean(row.limit_confirmed),
    petitionLimitBytes: row.petition_limit_bytes === null ? null : Number(row.petition_limit_bytes),
    problems: problems.flatMap((problem) =>
      typeof problem.document_id === "string" && typeof problem.code === "string"
        ? [{ documentId: problem.document_id, code: problem.code }]
        : [],
    ),
    error: row.error,
    requestedLabel: momentLabel(row.requested_at, timeZone),
    requestedAt: row.requested_at,
    slow: row.status === "requested" && Date.now() - new Date(row.requested_at).getTime() > SLOW_MINUTES * 60_000,
    blocker: null,
    byOne: null,
    signature: {
      takesSigned: context.takesSigned,
      cloudSigning: context.cloudSigning,
      formatConfirmed: context.formatConfirmed,
      status: (SIGNATURE_STATUSES as readonly string[]).includes(row.signature_status ?? "")
        ? (row.signature_status as FilingSignature["status"])
        : null,
      error: row.signature_error,
      signedBy: row.signed_by,
      signedLabel: row.signed_at ? momentLabel(row.signed_at, timeZone) : null,
      requestedBy: row.signer_requested,
      viewerSigns: context.viewerSigns,
      viewerAuthorized: context.viewerAuthorized,
      viewerSigned: context.viewerId !== null && row.signed_by === context.viewerId,
      viewerRequested: context.viewerId !== null && row.signer_requested === context.viewerId,
    },
    items: many(row.filing_package_items)
      .map((item) => ({
        id: item.id,
        position: item.position,
        name: item.name,
        bytes: Number(item.bytes),
        pages: item.pages,
        documentId: item.document_id,
        part: Number(item.part ?? 1),
        parts: Number(item.parts ?? 1),
        signed: item.signed_file_id !== null,
      }))
      .sort((a, b) => a.position - b.position),
    receipt: receipt ? { id: receipt.id, cnj: receipt.cnj, filedOn: receipt.filed_on } : null,
  };
}

/**
 * Whether a lawyer can authorize ONE at any PSC now: the platform's own client
 * is registered at one the list offers (as the team's card offers them).
 * Throws when the list could not be read.
 */
export async function cloudSigningOffered(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.from("psc_providers").select("slug").eq("active", true);
  if (error) throw new Error("the cloud signature providers could not be read");
  return ((data ?? []) as { slug: string }[]).some((row) => pscAvailable(row.slug));
}

/**
 * The packages of a case that still mean something: the one in course of each lawsuit, and the ones filed; with
 * what each owes of its signature, whether the person reading signs its lawsuit, and whether they have an
 * authorization of their own in force (read under their own session: a lawyer reads their own).
 */
export async function loadCaseFilings(
  supabase: SupabaseClient,
  firmId: string,
  caseId: string,
  timeZone: string | null | undefined,
  viewerId: string | null = null,
): Promise<CaseFiling[]> {
  const [packages, systems, lawyers, authorizations, cloudSigning] = await Promise.all([
    supabase
      .from("filing_packages")
      .select(PACKAGE_COLUMNS)
      .eq("case_id", caseId)
      .eq("org_id", firmId)
      .neq("status", "cancelled")
      .order("requested_at", { ascending: false }),
    supabase.from("court_systems").select("court, proceeding_kind, system, confirmed").eq("signed_files", "p7s"),
    viewerId
      ? supabase.from("proceeding_lawyers").select("proceeding_id").eq("org_id", firmId).eq("user_id", viewerId)
      : Promise.resolve({ data: [] as { proceeding_id: string }[], error: null }),
    // A connection of a person is always their authorization at a PSC (0041).
    viewerId
      ? supabase
          .from("connections")
          .select("id")
          .eq("org_id", firmId)
          .eq("person_id", viewerId)
          .in("status", ["connected", "error"])
          .gt("expires_at", new Date(Date.now() + 60_000).toISOString())
          .limit(1)
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
    cloudSigningOffered(supabase),
  ]);
  if (packages.error || systems.error || lawyers.error || authorizations.error) {
    throw new Error("filing packages could not be read");
  }
  const signedSystems = new Map(
    ((systems.data ?? []) as { court: string; proceeding_kind: string; system: string; confirmed: boolean }[]).map(
      (row) => [`${row.court}/${row.proceeding_kind}/${row.system}`, Boolean(row.confirmed)],
    ),
  );
  const signs = new Set(((lawyers.data ?? []) as { proceeding_id: string }[]).map((row) => row.proceeding_id));
  const viewerAuthorized = (authorizations.data ?? []).length > 0;
  const filings = ((packages.data ?? []) as PackageRow[]).flatMap((row) => {
    const system = `${row.court}/${row.kind}/${row.system}`;
    return (
      toFiling(row, timeZone, {
        takesSigned: signedSystems.has(system),
        cloudSigning,
        formatConfirmed: signedSystems.get(system) === true,
        viewerId,
        viewerSigns: signs.has(row.proceeding_id),
        viewerAuthorized,
      }) ?? []
    );
  });
  const [blockers, byOne] = await Promise.all([
    blockersOf(
      supabase,
      firmId,
      filings.filter((filing) => filing.status !== "filed").map((filing) => filing.proceedingId),
    ),
    // What ONE does with each package (0101). A read that fails says nothing of it: the lawyer's own way shows.
    supabase.rpc("case_filing_by_one", { target_case: caseId }).then(
      ({ data, error }) =>
        new Map(
          error || !Array.isArray(data)
            ? []
            : (data as Record<string, unknown>[]).map((row) => [String(row.package_id), filingByOneOf(row)] as const),
        ),
      () => new Map<string, FilingByOne>(),
    ),
  ]);
  return filings.map((filing) => ({
    ...filing,
    blocker: filing.status === "filed" ? filing.blocker : (blockers.get(filing.proceedingId) ?? null),
    byOne: byOne.get(filing.id) ?? null,
  }));
}

/** What keeps each lawsuit named from being filed now, by lawsuit. Throws when it could not be read. */
async function blockersOf(
  supabase: SupabaseClient,
  firmId: string,
  proceedingIds: string[],
): Promise<Map<string, string>> {
  if (proceedingIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc("filing_blockers", {
    target_org: firmId,
    target_proceedings: [...new Set(proceedingIds)],
  });
  if (error) throw new Error("what blocks a filing could not be read");
  return new Map(
    ((data ?? []) as { proceeding_id: string; code: string }[]).map((row) => [row.proceeding_id, row.code]),
  );
}

/** A package in the firm's filing queue, with the case it belongs to. */
export type QueuedFiling = {
  id: string;
  caseId: string;
  caseSeq: number | null;
  client: string;
  court: string;
  system: string;
  kind: "juizado" | "comum" | null;
  comarca: string | null;
  status: "requested" | "ready" | "failed";
  files: number;
  requestedLabel: string;
  /** What keeps its lawsuit from being filed now: the package waits for it before it is filed. */
  blocker: string | null;
  /** Where the court's system takes the files signed: how ONE's signature of them stands. */
  signature: FilingSignature["status"] | null;
};

type QueueRow = {
  id: string;
  case_id: string;
  proceeding_id: string;
  court: string;
  system: string;
  status: string;
  requested_at: string;
  signature_status: string | null;
  filing_package_items: Embedded<{ id: string }>;
  proceedings: Embedded<{ kind: string; comarca: string | null }>;
  cases: Embedded<{
    seq: number;
    case_parties: Embedded<{ role: string; guardian_id: string | null; people: Embedded<{ full_name: string }> }>;
  }>;
};

/** The firm's packages that wait: being built, ready for the lawyer, or failed. The oldest first. */
export async function loadFilingQueue(
  supabase: SupabaseClient,
  firmId: string,
  timeZone: string | null | undefined,
  module: string | null = null,
): Promise<{ rows: QueuedFiling[]; truncated: boolean; cloudSigning: boolean }> {
  // Every package is of a case; under a module (0078), only the packages of that module's cases.
  let query = supabase
    .from("filing_packages")
    .select(
      "id, case_id, proceeding_id, court, system, status, requested_at, signature_status, filing_package_items(id), proceedings(kind, comarca), cases!inner(seq, module, case_parties(role, guardian_id, people(full_name)))",
    )
    .eq("org_id", firmId)
    .in("status", ["requested", "ready", "failed"]);
  if (module) query = query.eq("cases.module", module);
  const { data, error } = await query.order("requested_at", { ascending: true }).limit(QUEUE_SHOWN + 1);
  if (error) throw new Error("the filing queue could not be read");
  const raw = (data ?? []) as QueueRow[];
  const blockers = await blockersOf(
    supabase,
    firmId,
    raw.slice(0, QUEUE_SHOWN).map((row) => row.proceeding_id),
  );
  const rows = raw.slice(0, QUEUE_SHOWN).flatMap((row): QueuedFiling[] => {
    if (row.status !== "requested" && row.status !== "ready" && row.status !== "failed") return [];
    const found = one(row.cases);
    const parties = many(found?.case_parties ?? null);
    // The case is named by its first adult claimant; with only minors, by who answers for them.
    const named =
      parties.find((party) => party.role === "claimant" && !party.guardian_id) ??
      parties.find((party) => party.role === "guardian") ??
      parties[0];
    const proceeding = one(row.proceedings);
    return [
      {
        id: row.id,
        caseId: row.case_id,
        caseSeq: found?.seq ?? null,
        client: one(named?.people ?? null)?.full_name ?? "",
        court: row.court,
        system: row.system,
        kind: proceeding?.kind === "juizado" || proceeding?.kind === "comum" ? proceeding.kind : null,
        comarca: proceeding?.comarca ?? null,
        status: row.status,
        files: many(row.filing_package_items).length,
        requestedLabel: momentLabel(row.requested_at, timeZone),
        blocker: blockers.get(row.proceeding_id) ?? null,
        signature: (SIGNATURE_STATUSES as readonly string[]).includes(row.signature_status ?? "")
          ? (row.signature_status as FilingSignature["status"])
          : null,
      },
    ];
  });
  return { rows, truncated: raw.length > QUEUE_SHOWN, cloudSigning: await cloudSigningOffered(supabase) };
}
