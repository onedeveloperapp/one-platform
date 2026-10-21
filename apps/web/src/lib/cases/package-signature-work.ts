import "server-only";

import { after } from "next/server";
import { createHash } from "node:crypto";

import { supabaseFileStore } from "@/lib/files/store";
import { signForCourt } from "@/lib/psc/sign";
import { createServiceClient } from "@flyee/auth/service";
import { takeBackFile } from "@flyee/documents/files";
import { measureFile } from "@flyee/documents/measure";
import { sendEvent } from "@flyee/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of a package's signature (migration 0042): a package
 * built of a system that takes signed files (the Projudi of TJGO), of a firm
 * that lets ONE sign, is claimed under a number; its files are read from the
 * bucket, checked against the hashes the database has of them, and signed
 * with the authorization in force of a lawyer of its lawsuit
 * (`signForCourt`, migration 0041: the use bound to these very files, to the
 * claim and to the lawyer the claim chose); each
 * `.p7s` is kept as a file of the `filing` purpose and recorded beside the
 * file it signs. What the lawyer must do (authorize again) leaves the package
 * waiting for them; a failure of the moment is tried again; nothing half
 * signed is ever recorded, and a `.p7s` kept for a signature that was not
 * recorded is taken back. Only ids leave this file.
 */

type ItemToSign = {
  item_id: string;
  position: number;
  name: string;
  file_id: string;
  storage_path: string;
  sha256: string;
};

type PackageToSign = {
  code?: string;
  package_id?: string;
  org_id?: string;
  case_id?: string;
  claim?: number;
  signer?: string;
  items?: ItemToSign[];
};

/** A package the sweep holds, with the number of its claim. */
export type SignatureClaim = { packageId: string; claim: number };

export type SignatureOutcome = "signed" | "waiting" | "retry" | "failed" | "not_held" | "not_working";

/** What a use's failure means for the package: the lawyer's to put right, a failure of the moment, or the end. */
const WAITS_FOR_LAWYER = new Set([
  "no_signature",
  "not_a_lawyer",
  "not_a_signer",
  "session_ended",
  "token_used",
  "denied",
  "certificate_changed",
  "certificate_expired",
  "no_certificate",
  "psc_moved",
  "ended_meanwhile",
]);
const GIVES_UP = new Set(["files_changed", "invalid_subject"]);
/** The claim moved on (a lawyer asked meanwhile) or chose another lawyer since: the next claim signs. */
const CLAIM_MOVED = new Set(["not_claimed", "not_the_signer"]);

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export async function claimPackageSignatures(
  service: SupabaseClient,
  limit = 3,
  packageId: string | null = null,
): Promise<SignatureClaim[]> {
  const { data, error } = await service.rpc("claim_package_signatures", {
    target_limit: limit,
    target_package: packageId,
  });
  if (error) throw new Error(`claim_package_signatures failed: ${error.message}`);
  return ((data ?? []) as { package_id: string; claim: number }[]).map((row) => ({
    packageId: row.package_id,
    claim: Number(row.claim),
  }));
}

/** Signs a claimed package's files and records what came of it. Never throws for what the PSC did. */
export async function signClaimedPackage(service: SupabaseClient, held: SignatureClaim): Promise<SignatureOutcome> {
  const { data, error } = await service.rpc("package_signature_to_sign", {
    target_package: held.packageId,
    target_claim: held.claim,
  });
  if (error) throw new Error(`package_signature_to_sign failed: ${error.message}`);
  const row = data as PackageToSign | null;
  if (!row) return "not_held";
  if (row.code === "waiting") return "waiting";
  if (!row.package_id || !row.org_id || !row.case_id || !row.signer || !Array.isArray(row.items)) return "not_held";
  const packageId = row.package_id;
  const orgId = row.org_id;
  const signer = row.signer;
  const items = row.items;

  const store = supabaseFileStore(service);
  const made: { fileId: string; storagePath: string }[] = [];
  const takeBack = async () => {
    for (const file of made) await takeBackFile(store, file.fileId, file.storagePath);
  };

  const record = async (
    outcome: "signed" | "waiting" | "retry" | "failed",
    input: { useId?: string; files?: { item_id: string; file_id: string }[]; code?: string } = {},
  ): Promise<SignatureOutcome> => {
    const { data: recorded, error: recordError } = await service.rpc("record_package_signature", {
      target_package: packageId,
      target_claim: held.claim,
      target_outcome: outcome,
      target_use: input.useId ?? null,
      target_signer: outcome === "signed" ? signer : null,
      target_files: input.files ?? [],
      target_code: input.code ?? null,
    });
    if (recordError) {
      await takeBack();
      throw new Error(`record_package_signature failed: ${recordError.message}`);
    }
    const said = String((recorded as { code?: string } | null)?.code ?? "failed") as SignatureOutcome;
    // Anything but a signature recorded leaves no .p7s behind.
    if (said !== "signed") await takeBack();
    return said;
  };

  // The files as the bucket has them, each the very file the database has the hash of.
  const documents: { id: string; content: Uint8Array }[] = [];
  try {
    for (const item of items) {
      const bytes = await store.get(item.storage_path);
      if (!bytes) return record("retry", { code: "file_unreadable" });
      if (sha256Hex(bytes) !== item.sha256) return record("failed", { code: "file_changed" });
      documents.push({ id: item.item_id, content: bytes });
    }
  } catch {
    return record("retry", { code: "store_unavailable" });
  }

  const signed = await signForCourt({
    orgId,
    personId: signer,
    purpose: "filing.package",
    subjectId: packageId,
    caseId: row.case_id,
    claim: held.claim,
    documents,
  });
  if (!signed.ok) {
    if (CLAIM_MOVED.has(signed.code)) return record("retry", { code: signed.code });
    if (WAITS_FOR_LAWYER.has(signed.code)) return record("waiting", { code: signed.code });
    if (GIVES_UP.has(signed.code)) return record("failed", { code: signed.code });
    return record("retry", { code: signed.code });
  }

  const files: { item_id: string; file_id: string }[] = [];
  try {
    for (const item of items) {
      const p7s = signed.signed.find((document) => document.id === item.item_id)?.p7s;
      if (!p7s) return await record("retry", { code: "signature_missing" });
      const reserved = await store.reserve({
        orgId,
        purpose: "filing",
        name: `${item.name}.p7s`,
        mime: "application/pkcs7-mime",
        bytes: p7s.byteLength,
      });
      if (!reserved.ok) return await record("retry", { code: "store_unavailable" });
      made.push({ fileId: reserved.fileId, storagePath: reserved.storagePath });
      await store.put(reserved.storagePath, p7s, "application/pkcs7-mime");
      const confirmed = await store.confirm(reserved.fileId, await measureFile(p7s));
      if (!confirmed.ok) return await record("retry", { code: "store_unavailable" });
      files.push({ item_id: item.item_id, file_id: reserved.fileId });
    }
  } catch {
    // The storage did not answer in the middle of the work: tried again, with nothing left behind.
    return record("retry", { code: "store_unavailable" });
  }
  return record("signed", { useId: signed.useId, files });
}

/** Claims and signs what is owed (or the one package named), one after the other. */
export async function signFilingPackages(
  service: SupabaseClient,
  limit = 3,
  packageId: string | null = null,
): Promise<Record<string, number>> {
  const outcomes: Record<string, number> = {};
  for (const held of await claimPackageSignatures(service, limit, packageId)) {
    const outcome = await signClaimedPackage(service, held).catch(() => "error");
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return outcomes;
}

/**
 * A package was just built, a lawyer asked for its signature, or a lawyer
 * authorized ONE: the jobs sign what is owed at once. Without them (a
 * machine with no Inngest), it is signed after the response is sent.
 */
export async function queuePackageSignature(packageId: string | null): Promise<void> {
  const sent = await sendEvent("one/case.filing.signature", { packageId });
  if (sent.sent) return;
  after(async () => {
    try {
      await signFilingPackages(createServiceClient(), packageId ? 1 : 3, packageId);
    } catch {
      // Still owed: the sweep takes it.
    }
  });
}
