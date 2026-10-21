import "server-only";

import { getVault } from "@/lib/connections/vault";
import { isSimulatorOn, type WhatsAppSettings } from "@/lib/whatsapp/config";
import { MetaProvider } from "@flyee/whatsapp/providers/meta";
import { SimulatorProvider } from "@flyee/whatsapp/simulator";
import type { AccountTemplate, WhatsAppProvider } from "@flyee/whatsapp/types";

/**
 * The provider that speaks for one number of one firm.
 *
 * A number of the vendor needs the firm's token: it is opened from the vault,
 * once per piece of work, with the firm, the connection and a purpose that is
 * recorded with the read. A simulated number has no vendor behind it and
 * opens nothing.
 */
export type NumberTarget = {
  provider: string;
  orgId: string;
  connectionId: string;
  phoneNumberId: string;
  wabaId: string;
};

export type ProviderAccess = { ok: true; provider: WhatsAppProvider } | { ok: false; code: string };

export async function providerFor(
  target: NumberTarget,
  settings: WhatsAppSettings,
  purpose: string,
  /** For a simulated account: the templates ONE submitted to it, which the simulator lists back (it keeps no memory). */
  options: { simulatedTemplates?: AccountTemplate[] } = {},
): Promise<ProviderAccess> {
  if (target.provider === "simulator") {
    // A simulated number left in a database that reached production sends nothing.
    return isSimulatorOn()
      ? { ok: true, provider: new SimulatorProvider({ templates: options.simulatedTemplates }) }
      : { ok: false, code: "simulator_off" };
  }
  if (target.provider !== "meta") return { ok: false, code: "unknown_provider" };

  const access = getVault();
  if (!access.ok) return { ok: false, code: "vault_not_configured" };
  const opened = await access.vault.open({ orgId: target.orgId, connectionId: target.connectionId }, purpose);
  if (opened.kind !== "opened") return { ok: false, code: `vault_${opened.code}` };
  const accessToken = opened.payload.access_token;
  if (!accessToken) return { ok: false, code: "vault_token_missing" };

  return {
    ok: true,
    provider: new MetaProvider({
      accessToken,
      phoneNumberId: target.phoneNumberId,
      wabaId: target.wabaId,
      apiVersion: settings.graphApiVersion,
    }),
  };
}
