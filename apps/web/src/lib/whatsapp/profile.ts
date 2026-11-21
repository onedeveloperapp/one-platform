import { createHash } from "node:crypto";

import type { BusinessProfile } from "@flyee/whatsapp/types";

/**
 * The firm's WhatsApp profile, written by ONE from the firm's data (migration 0262, the plan "o escritório preparado
 * antes do primeiro atendimento", phase 2): the line under its name says when it attends, the description what it
 * attends, and the address and the e-mail where it is. A firm that said none of it has no profile written by ONE (its
 * own stays). Pure; the words follow the copy rules (no dash, no exclamation mark).
 */

export type ProfileFirm = {
  name?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  uf?: string;
  postal_code?: string;
  email?: string;
  areas?: string[];
  hours_from?: string;
  hours_to?: string;
  saturdays?: boolean;
};

/** "A", "A e B", "A, B e C". */
const listOf = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;

const hour = (value: string): string => {
  const [h, m] = value.split(":");
  return m === "00" ? `${Number(h)}h` : `${Number(h)}h${m}`;
};

export function businessProfileOf(firm: ProfileFirm): BusinessProfile | null {
  const profile: BusinessProfile = {};
  if (firm.hours_from && firm.hours_to) {
    const days = firm.saturdays ? "de segunda a sábado" : "de segunda a sexta";
    profile.about = `Atendimento ${days}, das ${hour(firm.hours_from)} às ${hour(firm.hours_to)}.`;
  }
  const name = (firm.name ?? "").trim();
  const areas = (firm.areas ?? []).filter(Boolean);
  if (areas.length > 0) {
    profile.description = `${name || "O escritório"} atende ${listOf(areas)}.`;
  }
  if (firm.street && firm.number && firm.city && firm.uf) {
    const cep =
      firm.postal_code && /^\d{8}$/.test(firm.postal_code)
        ? `, CEP ${firm.postal_code.slice(0, 5)}-${firm.postal_code.slice(5)}`
        : "";
    profile.address = [
      `${firm.street}, ${firm.number}`,
      firm.complement,
      firm.district,
      `${firm.city}, ${firm.uf}${cep}`,
    ]
      .filter(Boolean)
      .join(", ");
  }
  if (firm.email) profile.email = firm.email;
  return Object.keys(profile).length > 0 ? profile : null;
}

/** The profile's mark: written again only when it changes. */
export const profileHash = (profile: BusinessProfile): string =>
  createHash("sha256")
    .update(
      JSON.stringify([profile.about ?? "", profile.description ?? "", profile.address ?? "", profile.email ?? ""]),
    )
    .digest("hex");
