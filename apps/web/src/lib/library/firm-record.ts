import "server-only";

import type { FirmRecord } from "@/lib/library/imports";
import type { SupabaseClient } from "@supabase/supabase-js";

type FirmRow = {
  name: string | null;
  billing_cpf_cnpj: string | null;
  billing_phone: string | null;
  office_postal_code: string | null;
  office_street: string | null;
  office_number: string | null;
  office_complement: string | null;
  office_district: string | null;
  office_city: string | null;
  office_uf: string | null;
  office_email: string | null;
  oab_society_uf: string | null;
  oab_society_number: string | null;
  office_lawyers: unknown;
};

/**
 * What the firm gave of itself (0244), for the marking of a document to
 * compare it with and for the check of a model to take as the firm's own: its
 * name, its CNPJ, its telephone, its society at the bar and where it is
 * (0217), and the registrations at the bar of its people with their names, with the lawyers its papers name (0271).
 * Read by the backend with the service role, or under a member's own session,
 * which reads the firm and its colleagues' registrations (a name it cannot
 * read is left out). Null when the firm could not be read: the marking then
 * asks, as before.
 */
export async function readFirmRecord(client: SupabaseClient, firmId: string): Promise<FirmRecord | null> {
  const [firm, members] = await Promise.all([
    client
      .from("organizations")
      .select(
        "name, billing_cpf_cnpj, billing_phone, office_postal_code, office_street, office_number, office_complement, office_district, office_city, office_uf, office_email, oab_society_uf, oab_society_number, office_lawyers",
      )
      .eq("id", firmId)
      .maybeSingle(),
    client.from("memberships").select("user_id").eq("org_id", firmId),
  ]);
  if (firm.error || !firm.data || members.error) return null;
  const row = firm.data as FirmRow;
  const people = [...new Set(((members.data ?? []) as { user_id: string }[]).map((member) => member.user_id))];
  const [registrations, profiles] =
    people.length > 0
      ? await Promise.all([
          client.from("oab_registrations").select("user_id, uf, number").in("user_id", people),
          client.from("profiles").select("id, display_name").in("id", people),
        ])
      : [null, null];
  const names = new Map(
    ((profiles?.error ? [] : (profiles?.data ?? [])) as { id: string; display_name: string | null }[]).map(
      (profile) => [profile.id, profile.display_name?.trim() || null],
    ),
  );
  const team = (
    (registrations?.error ? [] : (registrations?.data ?? [])) as { user_id: string; uf: string; number: string }[]
  ).map((registration) => ({
    name: names.get(registration.user_id) ?? null,
    oab: `OAB/${registration.uf} ${registration.number}`,
  }));
  // The lawyers a document of the firm names as its own who are not of the team (0271).
  const papers = (Array.isArray(row.office_lawyers) ? row.office_lawyers : []).flatMap((item) => {
    const lawyer = (item ?? {}) as { name?: unknown; uf?: unknown; number?: unknown };
    return typeof lawyer.uf === "string" && typeof lawyer.number === "string"
      ? [{ name: typeof lawyer.name === "string" ? lawyer.name : null, oab: `OAB/${lawyer.uf} ${lawyer.number}` }]
      : [];
  });
  const lawyers = [...team, ...papers.filter((lawyer) => !team.some((member) => member.oab === lawyer.oab))].sort(
    (a, b) => (a.name ?? "").localeCompare(b.name ?? "") || a.oab.localeCompare(b.oab),
  );
  const city = row.office_city && row.office_uf ? `${row.office_city}/${row.office_uf}` : null;
  const address = row.office_street
    ? [row.office_street, row.office_number, row.office_complement, row.office_district, city]
        .filter((part): part is string => Boolean(part?.trim()))
        .join(", ")
    : null;
  return {
    name: row.name ?? "",
    // The billing document is the firm's CNPJ when it has fourteen digits; eleven are a partner's CPF, never written.
    cnpj: row.billing_cpf_cnpj && /^\d{14}$/.test(row.billing_cpf_cnpj) ? row.billing_cpf_cnpj : null,
    society:
      row.oab_society_uf && row.oab_society_number ? `OAB/${row.oab_society_uf} ${row.oab_society_number}` : null,
    lawyers,
    address,
    postalCode: row.office_postal_code,
    email: row.office_email,
    phone: row.billing_phone,
  };
}
