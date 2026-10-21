import "server-only";

import { BRAND } from "@/brand";
import { supabaseDocumentStore } from "@/lib/documents/store";
import { supabaseFileStore } from "@/lib/files/store";
import { createServiceClient } from "@flyee/auth/service";
import { issueDocument, type IssueInput, type IssueResult, type RenderContext } from "@flyee/documents/issue";

/**
 * Issues a document for a firm: the one entry point of the app into the issue
 * flow (`@flyee/documents/issue`). It builds the stores over the service role
 * and never lets that client out; the renderer receives what must be printed
 * on the document and gives back the PDF.
 *
 * The address printed on a document is the site's own (`BRAND.siteUrl`), so a
 * document issued anywhere is checked in one place: /verificar/<code>.
 */
export async function issueFirmDocument(
  input: Omit<IssueInput, "verifyBaseUrl">,
  render: (context: RenderContext) => Promise<Uint8Array>,
): Promise<IssueResult> {
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { kind: "refused", code: "backend_not_configured" };
  }
  try {
    return await issueDocument(
      { documents: supabaseDocumentStore(service), files: supabaseFileStore(service) },
      { ...input, verifyBaseUrl: BRAND.siteUrl },
      render,
    );
  } catch (error) {
    console.error("document_issue_failed", {
      kind: input.kind,
      orgId: input.orgId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { kind: "refused", code: "store_unavailable" };
  }
}
