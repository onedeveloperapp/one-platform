import "server-only";

import type { DocumentStatus, DocumentStore, ReservedDocument } from "@flyee/documents/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The issued documents over the database (migration 0018_files_documents):
 * the four things the issue flow does to a version, each through a function
 * that takes the firm. Built from the service-role client; hands out an
 * interface, never the client.
 */

const isStatus = (value: unknown): value is DocumentStatus =>
  value === "draft" || value === "issued" || value === "revoked";

export function supabaseDocumentStore(service: SupabaseClient): DocumentStore {
  return {
    async reserve(input): Promise<ReservedDocument> {
      const { data, error } = await service.rpc("reserve_document", {
        target_org: input.orgId,
        target_kind: input.kind,
        target_title: input.title,
        target_idempotency_key: input.idempotencyKey,
        target_verify_code: input.verifyCode,
        target_previous: input.previousId ?? null,
        target_requested_by: input.requestedBy ?? null,
      });
      if (error) throw new Error(`reserve_document failed: ${error.message}`);
      const answer = (data ?? {}) as {
        ok?: boolean;
        code?: string;
        document_id?: string;
        version?: number;
        verify_code?: string;
        status?: string;
      };
      if (!answer.ok || !answer.document_id || !answer.verify_code || !answer.version || !isStatus(answer.status)) {
        return { ok: false, code: answer.code ?? "refused" };
      }
      return {
        ok: true,
        documentId: answer.document_id,
        version: answer.version,
        verifyCode: answer.verify_code,
        status: answer.status,
      };
    },

    async claim(documentId, claimToken) {
      const { data, error } = await service.rpc("claim_document", {
        target_document: documentId,
        target_claim_token: claimToken,
      });
      if (error) throw new Error(`claim_document failed: ${error.message}`);
      const code = (data as { code?: string } | null)?.code;
      return code === "claimed" || code === "issued" || code === "revoked" || code === "busy" ? code : "not_found";
    },

    async publish(documentId, claimToken, fileId) {
      const { data, error } = await service.rpc("publish_document", {
        target_document: documentId,
        target_claim_token: claimToken,
        target_file: fileId,
      });
      if (error) throw new Error(`publish_document failed: ${error.message}`);
      const answer = (data ?? {}) as { ok?: boolean; code?: string };
      return { ok: Boolean(answer.ok), code: answer.code ?? "refused" };
    },

    async release(documentId, claimToken): Promise<void> {
      const { error } = await service.rpc("release_document", {
        target_document: documentId,
        target_claim_token: claimToken,
      });
      if (error) throw new Error(`release_document failed: ${error.message}`);
    },
  };
}
