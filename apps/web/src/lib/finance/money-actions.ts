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
