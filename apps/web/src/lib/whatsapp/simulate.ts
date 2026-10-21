import "server-only";

import { isManager } from "@/lib/firm/roles";
import type { MemberContext } from "@/lib/member/context";
import { isSimulatorOn, simulatorSecret } from "@/lib/whatsapp/config";
import { handleDelivery } from "@/lib/whatsapp/inbox";
import { isSupportVisit } from "@/lib/whatsapp/session";
import {
  disconnectionDelivery,
  echoDelivery,
  inboundTextDelivery,
  signedDelivery,
  type SimulatedNumber,
} from "@flyee/whatsapp/simulator";

/**
 * What the simulator does in place of the vendor's servers: a person writes
 * to the firm, the firm writes from its own phone, the firm disconnects on
 * its phone. Each builds the delivery the vendor would post, signs it with
 * the simulator's secret and hands it to the same door a real one enters by
 * (`handleDelivery`): the signature, the routing by number and the parser all
 * run.
 *
 * Only for a simulated number of the caller's own firm, and only while the
 * simulator is on: a delivery signed by the simulator can never reach a
 * number of the vendor, because routing stays within the provider that signed.
 */

export type SimulationResult = { ok: boolean; code: string };

/** The simulated number of the caller's firm, read under the person's session (row-level security). */
async function simulatedNumber(context: MemberContext, numberId: string): Promise<SimulatedNumber | null> {
  if (!context.firm) return null;
  const { data } = await context.supabase
    .from("wa_numbers")
    .select("phone_number_id, waba_id, display_phone_number")
    .eq("id", numberId)
    .eq("org_id", context.firm.id)
    .eq("provider", "simulator")
    .eq("status", "active")
    .maybeSingle();
  if (!data) return null;
  return {
    phoneNumberId: data.phone_number_id as string,
    wabaId: data.waba_id as string,
    displayPhoneNumber: data.display_phone_number as string,
  };
}

async function deliver(payload: Record<string, unknown>): Promise<SimulationResult> {
  const signed = signedDelivery(payload, simulatorSecret());
  const outcome = await handleDelivery(signed.rawBody, signed.signature);
  if (!outcome.ok) return { ok: false, code: outcome.code };
  return outcome.report.applied > 0 ? { ok: true, code: "delivered" } : { ok: false, code: "not_applied" };
}

const PHONE = /^[0-9]{8,15}$/;

/** A person writes to the firm's number. */
export async function simulateInbound(
  context: MemberContext,
  input: { numberId: string; phone: string; name: string; text: string },
): Promise<SimulationResult> {
  if (!isSimulatorOn()) return { ok: false, code: "simulator_off" };
  // The backend records what is simulated: a support visit, which writes nothing in the firm, simulates nothing.
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  const phone = input.phone.replace(/\D/g, "");
  const text = input.text.trim();
  if (!PHONE.test(phone) || !text || text.length > 4096) return { ok: false, code: "invalid_message" };
  const number = await simulatedNumber(context, input.numberId);
  if (!number) return { ok: false, code: "not_found" };
  return deliver(inboundTextDelivery(number, { phone, name: input.name.trim().slice(0, 120) || phone }, text));
}

/** The firm writes from its own phone: the message arrives as an echo. */
export async function simulateEcho(
  context: MemberContext,
  input: { numberId: string; phone: string; text: string },
): Promise<SimulationResult> {
  if (!isSimulatorOn()) return { ok: false, code: "simulator_off" };
  // The backend records what is simulated: a support visit, which writes nothing in the firm, simulates nothing.
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  const phone = input.phone.replace(/\D/g, "");
  const text = input.text.trim();
  if (!PHONE.test(phone) || !text || text.length > 4096) return { ok: false, code: "invalid_message" };
  const number = await simulatedNumber(context, input.numberId);
  if (!number) return { ok: false, code: "not_found" };
  return deliver(echoDelivery(number, phone, text));
}

/** The firm disconnects the platform on its phone: the vendor says the partner was removed. */
export async function simulateDisconnection(context: MemberContext, numberId: string): Promise<SimulationResult> {
  if (!isSimulatorOn()) return { ok: false, code: "simulator_off" };
  // The backend records what is simulated: a support visit, which writes nothing in the firm, simulates nothing.
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  if (!context.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  const number = await simulatedNumber(context, numberId);
  if (!number) return { ok: false, code: "not_found" };
  return deliver(disconnectionDelivery(number));
}
