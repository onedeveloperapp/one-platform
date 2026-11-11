"use server";

import { revalidatePath } from "next/cache";

import type { OneMessage } from "@/lib/firm/messages";
import { getMemberContext } from "@/lib/member/context";

/**
 * The firm's writes on its own words in ONE's messages (migration 0191): who decides for the firm writes a version,
 * goes back to ONE's words, or puts a version back. The database checks the text and who may, and records it.
 */

export type MessageResult = { ok: true } | { ok: false; code: string; value?: string };

const KEY = /^[a-z][a-z_]{2,40}$/;

function fold(data: unknown, error: { message: string } | null): MessageResult {
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: unknown; value?: unknown };
  if (answer.ok) return { ok: true };
  return {
    ok: false,
    code: String(answer.code ?? "failed"),
    ...(typeof answer.value === "string" ? { value: answer.value } : {}),
  };
}

export type FirmMessages = {
  messages: (OneMessage & {
    current: string | null;
    versions: { version: number; body: string; active: boolean; writtenAt: string }[];
  })[];
};

/** ONE's messages with the firm's versions of each, the one in force marked. */
export async function readFirmMessages(): Promise<{ ok: true; data: FirmMessages } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_found" };
  const [messages, texts] = await Promise.all([
    context.supabase
      .from("one_messages")
      .select("key, name, where_said, required, optional, example")
      .order("position"),
    context.supabase
      .from("firm_message_texts")
      .select("key, version, body, active, written_at")
      .eq("org_id", context.firm.id)
      .order("version", { ascending: false }),
  ]);
  if (messages.error || texts.error) return { ok: false, code: "failed" };
  const rows = (texts.data ?? []) as {
    key: string;
    version: number;
    body: string;
    active: boolean;
    written_at: string;
  }[];
  return {
    ok: true,
    data: {
      messages: (
        (messages.data ?? []) as {
          key: string;
          name: string;
          where_said: string;
          required: string[];
          optional: string[];
          example: string;
        }[]
      ).map((message) => {
        const versions = rows.filter((row) => row.key === message.key);
        return {
          key: message.key,
          name: message.name,
          whereSaid: message.where_said,
          required: message.required ?? [],
          optional: message.optional ?? [],
          example: message.example,
          current: versions.find((row) => row.active)?.body ?? null,
          versions: versions.map((row) => ({
            version: row.version,
            body: row.body,
            active: row.active,
            writtenAt: row.written_at,
          })),
        };
      }),
    },
  };
}

export async function saveFirmMessage(key: string, body: string): Promise<MessageResult> {
  const context = await getMemberContext();
  if (!context?.firm || !KEY.test(key)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("save_firm_message", {
    target_org: context.firm.id,
    target_key: key,
    target_body: String(body ?? "").slice(0, 1200),
  });
  const result = fold(data, error);
  if (result.ok) revalidatePath("/settings/mensagens");
  return result;
}

export async function resetFirmMessage(key: string): Promise<MessageResult> {
  const context = await getMemberContext();
  if (!context?.firm || !KEY.test(key)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("reset_firm_message", {
    target_org: context.firm.id,
    target_key: key,
  });
  const result = fold(data, error);
  if (result.ok) revalidatePath("/settings/mensagens");
  return result;
}

export async function restoreFirmMessage(key: string, version: number): Promise<MessageResult> {
  const context = await getMemberContext();
  if (!context?.firm || !KEY.test(key) || !Number.isInteger(version)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("restore_firm_message", {
    target_org: context.firm.id,
    target_key: key,
    target_version: version,
  });
  const result = fold(data, error);
  if (result.ok) revalidatePath("/settings/mensagens");
  return result;
}
