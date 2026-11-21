import "server-only";

import { runFirmTask } from "@/lib/ai/executor";
import { SCRIPT_TASK, scriptOf } from "@/lib/areas/script";
import { supabaseFileStore } from "@/lib/files/store";
import type { Sweep } from "@/lib/jobs/schedule";
import { soon } from "@/lib/jobs/soon";
import { readDocx } from "@/lib/library/docx";
import { lawsuitSignsOf } from "@/lib/publications/xray";
import type { ChatMessage } from "@flyee/ai/types";
import { createServiceClient } from "@flyee/auth/service";
import { areaOfLawsuit } from "@flyee/rules/areas";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ONE writes the script of an area of the firm (migration 0273, phase 4 of the plan "o escritório preparado antes do
 * primeiro atendimento"): each writing owed is claimed, its input read (the area, the firm and its profile, the script
 * before it and the words asked, the documents the firm sent, and the firm's lawsuits, of which only the area's are
 * counted, by the rule of the x-ray), the task run, and the draft recorded, every text kept within the rules for
 * everybody, which the database checks again. A run that did not answer gives the writing back for the next round; a
 * draft the database refuses ends it with why. Counts only.
 */

const MOST_FILE_BYTES = 8 * 1024 * 1024;
const MOST_FILE_CHARS = 30_000;

type Told = {
  ok?: boolean;
  area?: { id: string; name: string; law_area?: string | null; covers?: string | null };
  firm?: Record<string, unknown>;
  profile?: unknown;
  current?: { script: unknown; status: string; version: number } | null;
  change?: string | null;
  files?: { file_id: string; name: string; mime: string; storage_path: string; bytes: number | null }[];
  lawsuits?: { cnj: string; court: string; class_name: string | null; unit: string | null; text: string | null }[];
};

/** The firm's lawsuits of the area, by court and class, with how many of each: numbers and names only. */
export function areaLawsuits(
  lawArea: string | null | undefined,
  lawsuits: NonNullable<Told["lawsuits"]>,
): { tribunal: string; classe: string; processos: number }[] {
  if (!lawArea) return [];
  const signs = lawsuitSignsOf(
    lawsuits.map((lawsuit) => ({
      key: lawsuit.cnj,
      court: lawsuit.court,
      className: lawsuit.class_name,
      unit: lawsuit.unit,
      text: lawsuit.text ?? "",
    })),
    [],
  );
  const counted = new Map<string, { tribunal: string; classe: string; processos: number }>();
  for (const sign of signs) {
    if (areaOfLawsuit(sign) !== lawArea) continue;
    const key = `${sign.court}|${sign.className ?? ""}`;
    const row = counted.get(key) ?? { tribunal: sign.court, classe: sign.className ?? "", processos: 0 };
    row.processos += 1;
    counted.set(key, row);
  }
  return [...counted.values()].sort((a, b) => b.processos - a.processos).slice(0, 30);
}

/** The documents the firm sent: a Word file's text, a PDF for the model to read, a text file's words. */
async function documentsOf(
  service: SupabaseClient,
  files: NonNullable<Told["files"]>,
): Promise<{ texts: { nome: string; texto: string }[]; attachments: { name: string; base64: string }[] }> {
  const store = supabaseFileStore(service);
  const texts: { nome: string; texto: string }[] = [];
  const attachments: { name: string; base64: string }[] = [];
  for (const file of files) {
    if ((file.bytes ?? 0) > MOST_FILE_BYTES) continue;
    const bytes = await store.get(file.storage_path).catch(() => null);
    if (!bytes) continue;
    if (file.mime === "application/pdf") {
      attachments.push({ name: file.name, base64: Buffer.from(bytes).toString("base64") });
    } else if (file.mime === "text/plain") {
      texts.push({ nome: file.name, texto: new TextDecoder().decode(bytes).slice(0, MOST_FILE_CHARS) });
    } else {
      const read = readDocx(bytes);
      if (read.ok) texts.push({ nome: file.name, texto: read.paragraphs.join("\n").slice(0, MOST_FILE_CHARS) });
    }
  }
  return { texts, attachments };
}

export async function writeAreaScripts(service: SupabaseClient, limit = 2): Promise<Record<string, number>> {
  const { data, error } = await service.rpc("claim_area_script_requests", { target_limit: limit });
  if (error) throw new Error("claim_area_script_requests failed");
  const claimed = (data ?? []) as { request_id: string; org_id: string; area_id: string; claim: number }[];
  const report = { claimed: claimed.length, drafted: 0, failed: 0, given_back: 0 };

  for (const held of claimed) {
    const giveBack = async (code: string, final: boolean) => {
      await service.rpc("fail_area_script_request", {
        target_request: held.request_id,
        target_claim: held.claim,
        target_code: code,
        target_final: final,
      });
      if (final) report.failed += 1;
      else report.given_back += 1;
    };
    const { data: input } = await service.rpc("area_script_request_input", {
      target_request: held.request_id,
      target_claim: held.claim,
    });
    const told = (input ?? {}) as Told;
    if (!told.ok || !told.area) continue;

    const documents = await documentsOf(service, told.files ?? []);
    const briefing = {
      area: { nome: told.area.name, cobre: told.area.covers ?? "" },
      escritorio: told.firm ?? {},
      perfil: told.profile ?? null,
      processos_da_area: areaLawsuits(told.area.law_area, told.lawsuits ?? []),
      documentos_do_escritorio: documents.texts,
      roteiro_anterior: told.current?.script ?? null,
      pedido_de_mudanca: told.change ?? null,
    };
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: JSON.stringify(briefing),
        ...(documents.attachments.length > 0
          ? {
              attachments: documents.attachments.map((attachment) => ({
                kind: "document" as const,
                mime: "application/pdf",
                dataBase64: attachment.base64,
              })),
            }
          : {}),
      },
    ];
    const run = await runFirmTask({
      orgId: held.org_id,
      task: SCRIPT_TASK,
      // What is hashed for the record: the briefing and the size of each PDF, never its bytes.
      input: { ...briefing, pdfs: documents.attachments.map((attachment) => attachment.base64.length) },
      messages,
      subject: { type: "firm_area", id: held.area_id },
      idempotencyKey: `area-script:${held.request_id}:${held.claim}`,
    }).catch(() => null);
    if (!run || run.kind !== "finished") {
      await giveBack(run?.kind === "refused" ? run.code : "not_answered", false);
      continue;
    }
    const written = scriptOf(run.output);
    if (!written) {
      await giveBack("unreadable", false);
      continue;
    }
    const { data: recorded } = await service.rpc("record_area_script_draft", {
      target_request: held.request_id,
      target_claim: held.claim,
      target_script: written,
      target_run: run.runId,
    });
    const answer = (recorded ?? {}) as { ok?: boolean; code?: string };
    if (answer.ok) report.drafted += 1;
    else if (answer.code !== "not_held") await giveBack(answer.code ?? "refused", true);
  }
  return report;
}

/** The writing the person just asked for, done right after their answer; the sweep takes what does not finish. */
export function queueAreaScriptWriting(): boolean {
  return soon("area-script", async () => {
    await writeAreaScripts(createServiceClient(), 1);
  });
}

export const areaScriptSweeps: Sweep[] = [
  {
    key: "area-script",
    when: { every: 5 },
    whileUsed: true,
    ai: [SCRIPT_TASK],
    run: async (service) => writeAreaScripts(service),
  },
];
