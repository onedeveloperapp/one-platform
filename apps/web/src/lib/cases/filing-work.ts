import "server-only";

import { FILING_LABEL } from "@/lib/cases/filing";
import { submitFilings } from "@/lib/cases/filing-submit-work";
import { signFilingPackages } from "@/lib/cases/package-signature-work";
import { supabaseFileStore } from "@/lib/files/store";
import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";
import { filingKindOf, type FilingSource, partName, planFiling } from "@flyee/courts/filing";
import { takeBackFile } from "@flyee/documents/files";
import { measureFile } from "@flyee/documents/measure";
import { recompressPdfImages, splitPdfBySize } from "@flyee/documents/normalize";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of a filing package (migration 0027): a package a
 * person asked for is claimed, its documents are put in the order of a
 * filing and named (`@flyee/courts/filing`), a file larger than the limit of
 * the court's system is cut at page boundaries (its scans compressed again
 * first when a page alone is too large), and the files are recorded. What
 * cannot go is named, and the package fails instead of going out short.
 *
 * Every step is a function of the database the service role alone may call,
 * under the number of the claim; a package claimed and never recorded goes
 * back to the line by itself. Only ids leave this file.
 */

type BuildDocument = {
  document_id: string;
  kind: string;
  person: string | null;
  file_id: string;
  storage_path: string;
  mime: string | null;
  bytes: number;
  pages: number | null;
};

type PackageToBuild = {
  package_id: string;
  org_id: string;
  claim: number;
  petition_document_id: string;
  document_ids: string[];
  limit_bytes: number | null;
  /** The petition's own limit, when the system gives it one (0036): a petition is never cut. */
  petition_limit_bytes?: number | null;
  name_max_length: number | null;
  documents: BuildDocument[];
};

/** A package the sweep holds, with the number of the claim. */
export type PackageClaim = { packageId: string; claim: number };

export async function claimFilingPackages(
  service: SupabaseClient,
  limit = 5,
  packageId: string | null = null,
): Promise<PackageClaim[]> {
  const { data, error } = await service.rpc("claim_filing_packages", {
    target_limit: limit,
    target_package: packageId,
  });
  if (error) throw new Error(`claim_filing_packages failed: ${error.message}`);
  return ((data ?? []) as { package_id: string; claim: number }[]).map((row) => ({
    packageId: row.package_id,
    claim: Number(row.claim),
  }));
}

type Item = { position: number; name: string; file_id: string; document_id: string; part: number; parts: number };
type Problem = { document_id: string; code: string };

const OUTCOMES = ["ready", "failed", "retry", "not_working"] as const;
export type PackageOutcome = (typeof OUTCOMES)[number] | "not_held";

/**
 * Builds a claimed package and records what came of it. Never throws for
 * what a file did: a PDF that cannot be read is a problem of that document.
 */
export async function buildClaimedPackage(service: SupabaseClient, held: PackageClaim): Promise<PackageOutcome> {
  const { data, error } = await service.rpc("filing_package_to_build", {
    target_package: held.packageId,
    target_claim: held.claim,
  });
  if (error) throw new Error(`filing_package_to_build failed: ${error.message}`);
  const row = data as PackageToBuild | null;
  if (!row?.package_id) return "not_held";

  const store = supabaseFileStore(service);
  // The parts cut for this package, taken back when it does not come to be.
  const made: { fileId: string; storagePath: string }[] = [];
  const takeBack = async () => {
    // A part whose record could not be forgotten (the database did not answer, or something names it)
    // keeps its object, and the sweep forgets both once nothing names the part.
    for (const part of made) await takeBackFile(store, part.fileId, part.storagePath);
  };

  const record = async (
    outcome: "ready" | "failed" | "retry",
    input: { items?: Item[]; problems?: Problem[]; code?: string } = {},
  ): Promise<PackageOutcome> => {
    const { data: recorded, error: recordError } = await service.rpc("record_filing_package", {
      target_package: row.package_id,
      target_claim: row.claim,
      target_outcome: outcome,
      target_items: input.items ?? [],
      target_problems: input.problems ?? [],
      target_code: input.code ?? null,
    });
    if (recordError) throw new Error(`record_filing_package failed: ${recordError.message}`);
    const answer = recorded as { ok?: boolean; code?: string } | null;
    const said = OUTCOMES.find((code) => code === answer?.code) ?? "failed";
    // Anything but a package that came to be leaves no part behind.
    if (said !== "ready") await takeBack();
    return said;
  };

  const documents = new Map(row.documents.map((document) => [document.document_id, document]));
  const problems: Problem[] = [row.petition_document_id, ...(row.document_ids ?? [])]
    .filter((id) => !documents.has(id))
    .map((id) => ({ document_id: id, code: "missing" }));

  const sources: FilingSource[] = row.documents.map((document) => ({
    key: document.document_id,
    kind: document.kind,
    label: FILING_LABEL[filingKindOf(document.kind)],
    person: document.person,
    mime: document.mime,
    bytes: Number(document.bytes),
    pages: document.pages,
  }));
  const plan = planFiling(sources, {
    maxFileBytes: row.limit_bytes,
    maxPetitionBytes: row.petition_limit_bytes ?? null,
    nameMaxLength: row.name_max_length ?? undefined,
  });
  problems.push(...plan.problems.map((problem) => ({ document_id: problem.key, code: problem.code })));
  if (plan.blockedBy === "no_petition" || plan.blockedBy === "two_petitions") {
    return record("failed", { problems, code: plan.blockedBy });
  }
  if (problems.length > 0) return record("failed", { problems, code: "problems" });

  const items: Item[] = [];
  try {
    for (const planned of plan.items) {
      const document = documents.get(planned.key) as BuildDocument;
      if (!planned.split || row.limit_bytes === null) {
        items.push({
          position: items.length + 1,
          name: partName(planned.stem, 1, 1),
          file_id: document.file_id,
          document_id: document.document_id,
          part: 1,
          parts: 1,
        });
        continue;
      }
      const bytes = await store.get(document.storage_path);
      if (!bytes) return await record("retry", { code: "file_unreadable" });
      let parts: Uint8Array[] | null = null;
      try {
        let cut = await splitPdfBySize(bytes, row.limit_bytes);
        if (cut.oversized.length > 0) {
          // A page that alone is too large is usually a scan: its images compressed again may fit.
          cut = await splitPdfBySize((await recompressPdfImages(bytes)).bytes, row.limit_bytes);
        }
        parts = cut.oversized.length > 0 ? null : cut.parts;
      } catch {
        problems.push({ document_id: document.document_id, code: "unreadable" });
        continue;
      }
      if (!parts) {
        problems.push({ document_id: document.document_id, code: "page_too_large" });
        continue;
      }
      // A cut that gave nothing (a PDF with no page) is no document at all.
      if (parts.length === 0) {
        problems.push({ document_id: document.document_id, code: "unreadable" });
        continue;
      }
      for (const [index, part] of parts.entries()) {
        const name = partName(planned.stem, index + 1, parts.length);
        const reserved = await store.reserve({
          orgId: row.org_id,
          purpose: "filing",
          name,
          mime: "application/pdf",
          bytes: part.byteLength,
        });
        if (!reserved.ok) return await record("retry", { code: "store_unavailable" });
        made.push({ fileId: reserved.fileId, storagePath: reserved.storagePath });
        await store.put(reserved.storagePath, part, "application/pdf");
        const confirmed = await store.confirm(reserved.fileId, await measureFile(part));
        if (!confirmed.ok) return await record("retry", { code: "store_unavailable" });
        items.push({
          position: items.length + 1,
          name,
          file_id: reserved.fileId,
          document_id: document.document_id,
          part: index + 1,
          parts: parts.length,
        });
      }
    }
  } catch {
    // The storage did not answer in the middle of the work: tried again, with nothing left behind.
    return record("retry", { code: "store_unavailable" });
  }

  if (problems.length > 0) return record("failed", { problems, code: "problems" });
  return record("ready", { items });
}

/** Claims and builds what waits (or the one package named), one after the other. */
export async function buildFilingPackages(
  service: SupabaseClient,
  limit = 5,
  packageId: string | null = null,
): Promise<Record<string, number>> {
  const outcomes: Record<string, number> = {};
  for (const held of await claimFilingPackages(service, limit, packageId)) {
    const outcome = await buildClaimedPackage(service, held).catch(() => "error");
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    // A package built may owe its signature (0042): signed now, in the same work.
    if (outcome === "ready") {
      await signFilingPackages(service, 1, held.packageId).catch(() => undefined);
      // And filed, where ONE files it (0101): a package nothing keeps from being filed goes to the court now.
      await submitFilings(service, 1, held.packageId).catch(() => undefined);
    }
  }
  return outcomes;
}

/**
 * A package was just asked for: it is built right after the response is
 * sent, and signed there where it owes its signature. The sweep takes what
 * that did not finish.
 */
export async function queueFilingPackage(packageId: string): Promise<void> {
  soon("filing-package", () => buildFilingPackages(createServiceClient(), 1, packageId));
}
