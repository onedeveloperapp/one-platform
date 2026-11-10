"use server";

import { revalidatePath } from "next/cache";

import { type MoneyShare, readMoneyShares } from "@/lib/finance/money";
import { queueMoneyStatements } from "@/lib/finance/statement-work";
import { getMemberContext } from "@/lib/member/context";

/**
 * The writes of the clients' money (migration 0135), each through its database function, which checks who may and
 * keeps it on the record. ONE never pays: the firm pays at its bank and says so here.
 */

type Result = { ok: true } | { ok: false; code: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function call(name: string, args: Record<string, unknown>): Promise<Result> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc(name, args);
  if (error) return { ok: false, code: error.code === "42501" ? "not_allowed" : "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: answer.code ?? "failed" };
  revalidatePath("/financeiro/repasses");
  return { ok: true };
}

/** The parts of the firm's clients, or of one case, for who reads the books; null for anybody else. */
export async function readMoneyShareList(caseId: string | null): Promise<MoneyShare[] | null> {
  const context = await getMemberContext();
  if (!context?.firm) return null;
  const { data, error } = await context.supabase.rpc("firm_money_shares", {
    target_org: context.firm.id,
    target_case: caseId && UUID.test(caseId) ? caseId : null,
  });
  const shares = error ? null : readMoneyShares(data);
  if (!shares || shares.length === 0) return shares;
  // The accountability statement of each part (0156), where it stands and its file once issued.
  const { data: statements } = await context.supabase.rpc("firm_money_statements", { target_org: context.firm.id });
  const byShare = new Map(
    (Array.isArray(statements) ? (statements as Record<string, unknown>[]) : []).map((row) => [
      String(row.share_id ?? ""),
      row,
    ]),
  );
  return shares.map((share) => {
    const row = byShare.get(share.id);
    const status = row?.status;
    return {
      ...share,
      statement:
        status === "owed" || status === "waiting" || status === "issued" || status === "failed"
          ? { status, fileId: typeof row?.file_id === "string" ? row.file_id : null }
          : null,
    };
  });
}

/** Who operates the books records a part passed on at the bank. */
export async function recordMoneyTransfer(shareId: string, paidOn: string): Promise<Result> {
  if (!UUID.test(shareId) || !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { ok: false, code: "invalid_data" };
  const recorded = await call("record_money_transfer", { target_share: shareId, target_paid_on: paidOn });
  // The part passed on owes its accountability statement (0156), issued after the answer.
  if (recorded.ok) queueMoneyStatements();
  return recorded;
}

/** Who operates the books asks for the accountability statement of a part (0156), with the second factor. */
export async function requestMoneyStatement(shareId: string): Promise<Result> {
  if (!UUID.test(shareId)) return { ok: false, code: "invalid_data" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const asked = await call("request_money_statement", { target_org: context.firm.id, target_share: shareId });
  if (asked.ok) queueMoneyStatements();
  return asked;
}

/** A partner decides a held part, with the second factor. */
export async function decideMoneyHold(shareId: string, decision: "lowered" | "paid_whole" | "resent"): Promise<Result> {
  if (!UUID.test(shareId)) return { ok: false, code: "invalid_data" };
  return call("decide_money_hold", { target_share: shareId, target_decision: decision });
}

/** A partner or a lawyer records what the judge ordered of a minor's part. */
export async function recordMinorOrder(shareId: string, order: "deposited" | "released" | "accounts"): Promise<Result> {
  if (!UUID.test(shareId)) return { ok: false, code: "invalid_data" };
  return call("record_minor_order", { target_share: shareId, target_order: order });
}

// ---------- The way the released money takes (migration 0158) ----------

export type MoneyPath = "firm" | "direct";
export type CaseMoneyPath = { case: MoneyPath | null; firm: MoneyPath; accepts: boolean | null };

const pathOf = (value: unknown): MoneyPath | null => (value === "firm" || value === "direct" ? value : null);

/** The way a case's released money takes, for who reads the books; null for anybody else. */
export async function readCaseMoneyPath(caseId: string): Promise<CaseMoneyPath | null> {
  const context = await getMemberContext();
  if (!context?.firm || !UUID.test(caseId)) return null;
  const { data, error } = await context.supabase.rpc("case_money_path", { target_case: caseId });
  if (error || !data || typeof data !== "object") return null;
  const answer = data as Record<string, unknown>;
  return {
    case: pathOf(answer.case),
    firm: pathOf(answer.firm) ?? "firm",
    accepts: typeof answer.accepts === "boolean" ? answer.accepts : null,
  };
}

/** Who operates the books says a case's way, or none to follow the firm's (the second factor). */
export async function setCaseMoneyPath(caseId: string, path: MoneyPath | null): Promise<Result> {
  if (!UUID.test(caseId)) return { ok: false, code: "invalid_data" };
  return call("set_case_money_path", { target_case: caseId, target_path: path });
}

/** The firm's way, as the books' configuration reads it. */
export async function readFirmMoneyPath(): Promise<MoneyPath | null> {
  const context = await getMemberContext();
  if (!context?.firm) return null;
  const { data, error } = await context.supabase
    .from("organizations")
    .select("money_path")
    .eq("id", context.firm.id)
    .maybeSingle();
  return error ? null : pathOf(data?.money_path);
}

/** Who configures the books says the firm's way (the second factor). */
export async function setFirmMoneyPath(path: MoneyPath): Promise<Result> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  return call("set_money_path", { target_org: context.firm.id, target_path: path });
}
