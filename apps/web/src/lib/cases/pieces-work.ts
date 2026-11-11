import "server-only";

import { queueDraftWork } from "@/lib/cases/drafts-work";
import { mniChannelFor, TestCourtChannel } from "@/lib/courts/filing-channel";
import { supabaseFileStore } from "@/lib/files/store";
import type { Sweep } from "@/lib/jobs/schedule";
import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";
import type { FilingChannel, FilingOutcome } from "@flyee/courts/types";
import { takeBackFile } from "@flyee/documents/files";
import { measureFile } from "@flyee/documents/measure";
import { renderTextPdf } from "@flyee/documents/text-pdf";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of the intermediate pieces (migration 0189): ONE asks for the pieces owed where the firm lets it
 * start pieces (what a publication asks, what a condemnation's next step is), each written by the drafts' own worker;
 * and ONE files a piece the lawyer decided to file through the court's own channel with the lawsuit's number (the
 * MNI), or for a test case the test court, keeping the receipt the court gave. The database decides what is owed,
 * what keeps a piece from being filed and what it came to. Only ids, codes and counts leave this file.
 */

/** ONE asks for the pieces owed now, each as ONE for its case, and has each written right after. */
export async function startOwedPieces(service: SupabaseClient): Promise<{ asked: number; skipped: number }> {
  const { data, error } = await service.rpc("intermediate_pieces_owed", { target_limit: 10 });
  if (error) throw new Error("intermediate_pieces_owed failed");
  let asked = 0;
  let skipped = 0;
  for (const item of (Array.isArray(data) ? data : []) as Record<string, unknown>[]) {
    if (typeof item.proceeding_id !== "string" || typeof item.kind !== "string") continue;
    const { data: answer, error: requestError } = await service.rpc("request_intermediate_piece_by_one", {
      target_proceeding: item.proceeding_id,
      target_kind: item.kind,
      target_publication: typeof item.publication_id === "string" ? item.publication_id : null,
      target_source: typeof item.source === "string" ? item.source : null,
    });
    const said = (answer ?? {}) as { ok?: boolean; code?: string; draft_id?: unknown; waits_for?: unknown };
    if (requestError || !said.ok || said.code !== "requested" || typeof said.draft_id !== "string") {
      skipped += 1;
      continue;
    }
    asked += 1;
    if (!said.waits_for) await queueDraftWork(said.draft_id);
  }
  return { asked, skipped };
}

/** The receipt the test court gives a petition, as a PDF that says no court received it. */
async function testPetitionReceipt(input: { cnj: string; kind: string; protocol: string }): Promise<Uint8Array> {
  const digits = input.cnj;
  const number = `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16)}`;
  return renderTextPdf({
    blocks: [
      { kind: "title", text: "Tribunal de teste do ONE" },
      { kind: "heading", text: "Recibo de juntada de petição" },
      {
        kind: "fields",
        rows: [
          { label: "Processo", value: number },
          { label: "Peça", value: input.kind },
          { label: "Protocolo", value: input.protocol },
          {
            label: "Juntada em",
            value: new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date()),
          },
        ],
      },
      { kind: "paragraph", text: "Nenhum tribunal recebeu esta petição: ela foi juntada ao processo de teste do ONE." },
    ],
    title: "Recibo de juntada do tribunal de teste",
    author: "Tribunal de teste do ONE",
    producer: "ONE",
  });
}

/** Files one claimed piece. Answers what the database recorded of it. */
async function fileClaimedPiece(service: SupabaseClient, draftId: string, claim: number): Promise<string> {
  const { data, error } = await service.rpc("piece_filing_to_send", { target_draft: draftId, target_claim: claim });
  if (error) throw new Error("piece_filing_to_send failed");
  const sub = (data ?? null) as {
    org_id?: string;
    cnj?: string;
    court?: string;
    test?: boolean;
    kind_name?: string;
    endpoint?: string | null;
    type_code?: string | null;
    storage_path?: string | null;
  } | null;
  if (!sub || !sub.org_id || !sub.cnj) return "not_held";

  const record = async (
    outcome: string,
    input: { protocol?: string | null; message?: string | null; receipt?: string | null },
  ) => {
    const { data: recorded, error: recordError } = await service.rpc("record_piece_filing", {
      target_draft: draftId,
      target_claim: claim,
      target_outcome: outcome,
      target_protocol: input.protocol ?? null,
      target_message: input.message ?? null,
      target_receipt: input.receipt ?? null,
    });
    if (recordError) throw new Error("record_piece_filing failed");
    return String(((recorded ?? {}) as { code?: unknown }).code ?? "failed");
  };

  const store = supabaseFileStore(service);
  const pdf = sub.storage_path ? await store.get(sub.storage_path) : null;
  if (!pdf) return record("unavailable", { message: "piece_file_unreadable" });
  const channel: FilingChannel | null = sub.test
    ? new TestCourtChannel({ number: sub.cnj, receipt: async () => new Uint8Array() })
    : mniChannelFor(sub.court ?? "", sub.endpoint ?? null);
  if (!channel) return record("unavailable", { message: "mni_credential_missing" });

  let outcome: FilingOutcome;
  try {
    outcome = await channel.filePetition({
      caseNumber: sub.cnj,
      documents: [
        { id: draftId, typeCode: sub.type_code ?? "57", description: sub.kind_name ?? "Petição", pdf, signature: null },
      ],
      sentAt: new Date(),
    });
  } catch {
    // Nothing tells whether it reached the court: never sent again by itself.
    outcome = { kind: "unknown", reason: "send_threw" };
  }
  if (outcome.kind === "filed") {
    const receipt = sub.test
      ? await testPetitionReceipt({ cnj: sub.cnj, kind: sub.kind_name ?? "Petição", protocol: outcome.protocol })
      : outcome.receipt;
    let kept: { id: string; path: string } | null = null;
    if (receipt && receipt.byteLength > 0) {
      try {
        const reserved = await store.reserve({
          orgId: sub.org_id,
          purpose: "filing_receipt",
          name: `recibo-juntada-${sub.cnj}.pdf`,
          mime: "application/pdf",
          bytes: receipt.byteLength,
        });
        if (reserved.ok) {
          await store.put(reserved.storagePath, receipt, "application/pdf");
          const confirmed = await store.confirm(reserved.fileId, await measureFile(receipt));
          if (confirmed.ok) kept = { id: reserved.fileId, path: reserved.storagePath };
          else await takeBackFile(store, reserved.fileId, reserved.storagePath);
        }
      } catch {
        kept = null;
      }
    }
    const code = await record("filed", {
      protocol: outcome.protocol,
      message: outcome.message,
      receipt: kept?.id ?? null,
    });
    if (kept && code !== "filed") await takeBackFile(store, kept.id, kept.path).catch(() => undefined);
    return code;
  }
  if (outcome.kind === "refused") return record("refused", { protocol: outcome.protocol, message: outcome.message });
  if (outcome.kind === "unavailable") return record("unavailable", { message: outcome.reason });
  return record("unknown", { message: outcome.reason });
}

/** Files the pieces owed now. */
export async function fileOwedPieces(service: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await service.rpc("claim_piece_filings", { target_limit: 5 });
  if (error) throw new Error("claim_piece_filings failed");
  const counts: Record<string, number> = {};
  for (const row of (Array.isArray(data) ? data : []) as { draft_id?: unknown; claim?: unknown }[]) {
    if (typeof row.draft_id !== "string" || typeof row.claim !== "number") continue;
    const code = await fileClaimedPiece(service, row.draft_id, row.claim).catch(() => "failed");
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

/** A lawyer decided to file a piece, or its document was just made: filed right after the answer. */
export function queuePieceFilings(): void {
  soon("piece-filings", async () => {
    await fileOwedPieces(createServiceClient());
  });
}

export const pieceSweeps: Sweep[] = [
  {
    // What ONE asks for by itself (0189): the pieces a publication or a condemnation's next step owes.
    key: "intermediate-pieces",
    when: { every: 10 },
    whileUsed: true,
    run: async (service) => startOwedPieces(service),
  },
  {
    // The pieces a lawyer decided to file, through the court's channel or the test court (0189).
    key: "piece-filings",
    when: { every: 10 },
    whileUsed: true,
    run: async (service) => fileOwedPieces(service),
  },
];
