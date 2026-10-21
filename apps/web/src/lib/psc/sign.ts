import "server-only";

import { createHash } from "node:crypto";

import { getVault } from "@/lib/connections/vault";
import { PSC_COLUMNS, pscClientFor, type PscRow } from "@/lib/psc/provider";
import { createServiceClient } from "@flyee/auth/service";
import type { Envelope } from "@flyee/connectors/types";
import { prepareAttachedCms, readAttachedCms } from "@flyee/documents/cms";
import { certificateFacts } from "@flyee/psc/certificate";
import { PscError, type PscErrorCode } from "@flyee/psc/types";

/**
 * A lawyer's signature on the files that go to a court, made by their
 * certificate in the cloud (migration 0041, `@flyee/psc`): the backend opens
 * the lawyer's authorization for one use declared first (what it is for, the
 * case, the SHA-256 of every document), and signs only with the certificate
 * the lawyer authorized (its serial, the CPF they declared), only at the
 * address the token was issued at. It asks the PSC to sign the digest of each
 * document's signed attributes, writes each attached `.p7s` around what it
 * answers (`@flyee/documents/cms`), checks that every signature holds over
 * its own document with that very certificate, and records what came of the
 * use, once, whatever happened. The files are handed over only when the use
 * is recorded as signed: what was signed while the authorization ended goes
 * nowhere. The token lives in memory for this one use.
 */

export type DocumentToSign = { id: string; content: Uint8Array };

export type SignedDocument = { id: string; p7s: Uint8Array };

export type SignOutcome =
  | { ok: true; useId: string; holder: string; signed: SignedDocument[] }
  | { ok: false; code: string; useId?: string };

export type SignPurpose = "authorization.check" | "filing.package";

type OpenRow = {
  ok?: boolean;
  code?: string;
  use_id?: string;
  connection_id?: string;
  org_id?: string;
  provider?: string;
  external_id?: string | null;
  status?: string;
  expires_at?: string | null;
  serial?: string | null;
  fingerprint?: string | null;
  cpf?: string | null;
  envelope?: { key_version?: number; iv?: string; ciphertext?: string; tag?: string };
};

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** What the PSC answered, as the code the use and the authorization record. */
const PSC_ERROR_CODE: Record<PscErrorCode, string> = {
  expired: "session_ended",
  token_used: "token_used",
  denied: "denied",
  refused: "psc_refused",
  not_authorized: "platform_not_authorized",
  unavailable: "psc_unavailable",
};

const envelopeOf = (row: OpenRow["envelope"]): Envelope | null =>
  row && typeof row.key_version === "number" && row.iv && row.ciphertext && row.tag
    ? { keyVersion: row.key_version, iv: row.iv, ciphertext: row.ciphertext, tag: row.tag }
    : null;

/** A failure the use is closed with: a short code, never the PSC's words. */
class UseFailure extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function signForCourt(input: {
  orgId: string;
  personId: string;
  purpose: SignPurpose;
  subjectId?: string | null;
  caseId?: string | null;
  /** The authorization to use, when one that just arrived is tried; otherwise the lawyer's that lasts the longest. */
  connectionId?: string | null;
  /** The number the backend claimed a filing package under: the use signs for that claim alone. */
  claim?: number | null;
  documents: DocumentToSign[];
  /** The moment written into each signature, when the court's system asks for one. */
  signingTime?: Date;
}): Promise<SignOutcome> {
  if (input.documents.length === 0) return { ok: false, code: "nothing_to_sign" };
  const access = getVault();
  if (!access.ok) return { ok: false, code: "vault_not_configured" };
  const service = createServiceClient();

  const { data, error } = await service.rpc("lawyer_signature_open", {
    target_org: input.orgId,
    target_person: input.personId,
    target_purpose: input.purpose,
    target_subject: input.subjectId ?? null,
    target_case: input.caseId ?? null,
    target_hashes: input.documents.map((document) => sha256Hex(document.content)),
    target_connection: input.connectionId ?? null,
    target_claim: input.claim ?? null,
  });
  if (error) return { ok: false, code: "failed" };
  const opened = (data ?? {}) as OpenRow;
  if (!opened.ok || !opened.use_id || !opened.connection_id) return { ok: false, code: opened.code ?? "failed" };
  const useId = opened.use_id;

  // Each hash goes under an id of this use alone, never one a PSC saw in an earlier use of the session.
  const idOf = (index: number) => `${useId}.${index}`;
  // Only what the PSC was asked counts as signed by it.
  const asked = new Set(input.documents.map((_, index) => idOf(index)));
  let signedCount = 0;
  try {
    if (input.connectionId && opened.connection_id !== input.connectionId) throw new UseFailure("invalid_answer");
    const envelope = envelopeOf(opened.envelope);
    if (!envelope || opened.org_id !== input.orgId || !opened.provider?.startsWith("psc.")) {
      throw new UseFailure("invalid_answer");
    }
    const pinnedSerial = (opened.serial ?? "").toLowerCase();
    const pinnedFingerprint = (opened.fingerprint ?? "").toLowerCase();
    const declaredCpf = opened.cpf ?? "";
    if (!/^[0-9a-f]{2,64}$/.test(pinnedSerial) || !/^[0-9]{11}$/.test(declaredCpf)) {
      throw new UseFailure("certificate_changed");
    }
    const place = { orgId: input.orgId, connectionId: opened.connection_id };
    const token = access.vault.openAnswer(place, {
      ok: true,
      envelope,
      orgId: opened.org_id,
      provider: opened.provider,
      externalId: opened.external_id ?? null,
      status: opened.status === "error" ? "error" : "connected",
      expiresAt: opened.expires_at ?? null,
    });
    if (token.kind !== "opened" || !token.payload.access_token) {
      throw new UseFailure(token.kind === "refused" ? `vault_${token.code}` : "vault_token_missing");
    }
    const accessToken = token.payload.access_token;

    const { data: row } = await service
      .from("psc_providers")
      .select(PSC_COLUMNS)
      .eq("slug", opened.provider.slice(4))
      .maybeSingle();
    const client = row ? await pscClientFor(row as PscRow) : null;
    if (!client) throw new UseFailure("psc_not_configured");
    // A token goes only where it was issued: a PSC that moved, or the fake turned off, signs nothing with it.
    if (token.payload.origin !== client.origin) throw new UseFailure("psc_moved");

    // The certificate the lawyer authorized, by its serial, of the CPF they declared, in force now.
    const now = Date.now();
    const certificates = await client.provider.certificates(accessToken);
    const chosen = certificates
      .map((item) => {
        try {
          return { item, facts: certificateFacts(item.pem) };
        } catch {
          return null;
        }
      })
      // A holder's certificate, never an AC the PSC lists beside it; this very one when its fingerprint was kept.
      .find(
        (entry) =>
          entry !== null &&
          !entry.facts.authority &&
          entry.facts.serialHex.toLowerCase() === pinnedSerial &&
          (!pinnedFingerprint || entry.facts.sha256Hex === pinnedFingerprint),
      );
    if (!chosen) throw new UseFailure(certificates.length === 0 ? "no_certificate" : "certificate_changed");
    if (chosen.facts.cpf !== declaredCpf) throw new UseFailure("certificate_changed");
    if (chosen.facts.validFrom.getTime() > now || chosen.facts.validUntil.getTime() <= now) {
      throw new UseFailure("certificate_expired");
    }

    const prepared = input.documents.map((document) => ({
      id: document.id,
      content: document.content,
      cms: prepareAttachedCms({
        content: document.content,
        certificatePem: chosen.item.pem,
        signingTime: input.signingTime,
      }),
    }));
    const signatures = new Map<string, Uint8Array>();
    for (let start = 0; start < prepared.length; start += client.maxHashes) {
      const batch = prepared.slice(start, start + client.maxHashes);
      const answer = await client.provider.sign({
        token: accessToken,
        hashes: batch.map((item, offset) => ({ id: idOf(start + offset), hash: item.cms.digest })),
        format: "RAW",
        certificateAlias: chosen.item.alias || undefined,
      });
      for (const signature of answer.signatures) {
        if (asked.has(signature.id)) signatures.set(signature.id, signature.value);
      }
      signedCount = signatures.size;
    }

    const signed: SignedDocument[] = [];
    for (const [index, item] of prepared.entries()) {
      const signature = signatures.get(idOf(index));
      if (!signature) throw new UseFailure("psc_refused");
      const p7s = item.cms.assemble(signature);
      // Nothing goes to a court that does not hold, with the certificate the lawyer authorized.
      const read = await readAttachedCms(p7s);
      if (
        !read.signed ||
        read.signerSerialHex.toLowerCase() !== pinnedSerial ||
        sha256Hex(read.content) !== sha256Hex(item.content)
      ) {
        throw new UseFailure("signature_invalid");
      }
      signed.push({ id: item.id, p7s });
    }

    const recorded = await finish(service, input.orgId, useId, true, null, signed.length);
    if (recorded !== "recorded") return { ok: false, code: recorded, useId };
    return { ok: true, useId, holder: chosen.facts.holderName, signed };
  } catch (thrown) {
    const code =
      thrown instanceof UseFailure ? thrown.code : thrown instanceof PscError ? PSC_ERROR_CODE[thrown.code] : "failed";
    await finish(service, input.orgId, useId, false, code, signedCount);
    return { ok: false, code, useId };
  }
}

/** What the database answered of a use: `recorded`, `ended_meanwhile`, or `failed` when it could not be told. */
async function finish(
  service: ReturnType<typeof createServiceClient>,
  orgId: string,
  useId: string,
  ok: boolean,
  code: string | null,
  signed: number,
): Promise<string> {
  try {
    const { data, error } = await service.rpc("lawyer_signature_finish", {
      target_org: orgId,
      target_use: useId,
      target_ok: ok,
      target_error: code,
      target_signed: signed,
    });
    if (error) return "failed";
    // A use whose outcome could not be recorded stays open on the lawyer's list, said as one with no answer.
    return String((data as { code?: string } | null)?.code ?? "failed");
  } catch {
    return "failed";
  }
}
