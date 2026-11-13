import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { papersToSignOf, signatureLinksMessage } from "@/lib/conversations/papers";
import type { Sweep } from "@/lib/jobs/schedule";
import { deliverOutbox } from "@/lib/whatsapp/send";
import { BRAND } from "@flyee/content";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The links to sign, in the chat (migration 0231, the chat's script of 2026-11-12): once the papers of a case are open
 * to sign, ONE writes their links to the person who signs in the conversation the firm holds with them, inside the 24
 * hours, so they sign on the provider's page with no stop at the client's link. The database says what is owed and
 * marks each paper told in the same transaction as the message; this writes the words and sends. Counts only.
 */
export async function tellSignatureLinks(service: SupabaseClient, limit = 20): Promise<{ told: number }> {
  const { data, error } = await service.rpc("signature_links_owed", { target_limit: limit });
  if (error) throw new Error("signature_links_owed failed");
  let told = 0;
  for (const row of (data ?? []) as { conversation_id: string; full_name: string | null; papers: unknown }[]) {
    const papers = papersToSignOf(row.papers);
    // A paper signed by gov.br is on the client's link: a new one goes with this message, since the case opened in
    // the chat sent none (0237). Where it cannot be made, the message says the link of the case.
    const token = papers.some((paper) => paper.method === "govbr") ? randomBytes(32).toString("base64url") : null;
    const tell = async (withLink: boolean) => {
      const link = withLink && token ? token : null;
      // The page of the papers alone, never the whole folder: the client lands on what to sign.
      const body = signatureLinksMessage(row.full_name, papers, link ? `${BRAND.siteUrl}/c/${link}/assinar` : null);
      if (!body) return null;
      return service.rpc("one_tell_signature_links", {
        target_conversation: row.conversation_id,
        target_papers: papers.map((paper) => paper.paperId),
        target_body: body,
        target_token_hash: link ? createHash("sha256").update(link, "utf8").digest("hex") : null,
      });
    };
    let written = await tell(true);
    if (written && token && String((written.data as { code?: unknown } | null)?.code ?? "").startsWith("link_")) {
      written = await tell(false);
    }
    if (!written) continue;
    const answer = (written.data ?? {}) as { ok?: boolean; message_id?: unknown };
    if (written.error || !answer.ok) continue;
    told += 1;
    if (typeof answer.message_id === "string") {
      try {
        await deliverOutbox(service, { messageId: answer.message_id });
      } catch {
        // Queued: the outbox's sweep sends it.
      }
    }
  }
  return { told };
}

export const signatureLinkSweeps: Sweep[] = [
  {
    // A person waits on the conversation: swept while ONE is used too.
    key: "signature-links",
    when: { every: 5 },
    whileUsed: true,
    run: async (service) => ({ ...(await tellSignatureLinks(service)) }),
  },
];
