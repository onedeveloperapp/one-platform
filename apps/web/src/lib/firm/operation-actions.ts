"use server";

import { revalidatePath } from "next/cache";

import { djenClient } from "@/lib/courts/djen";
import { type FirmOperation, type OperationArea, operationPayload } from "@/lib/firm/operation";
import { isManager } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";
import { lawsuitSignsOf, type LawsuitText, type XrayAirline } from "@/lib/publications/xray";
import { type AreaProposal, proposeAreas } from "@flyee/rules/areas";

export type OperationResult = { ok: true } | { ok: false; code: string; limit?: number };

const CODES = [
  "invalid_operation",
  "unknown_area",
  "invalid_area_name",
  "no_areas",
  "areas_limit",
  "second_factor_required",
  "not_allowed_in_support_session",
  "not_authorized",
] as const;

const codeOf = (message: unknown): string => {
  const text = typeof message === "string" ? message : "";
  return CODES.find((code) => text.includes(code)) ?? "failed";
};

/**
 * The firm says how it works and its areas (the setup's step "A operação", migration 0256): who manages it, with the
 * second factor; the database checks each answer, keeps the module's area and the plan's ceiling, and records it.
 */
export async function saveFirmOperation(input: {
  operation: FirmOperation;
  areas: OperationArea[];
}): Promise<OperationResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("save_firm_operation", {
    target_org: context.firm.id,
    target_operation: operationPayload(input.operation),
    target_areas: input.areas.map((area) =>
      area.lawArea
        ? { law_area: area.lawArea, source: area.source === "xray" ? "xray" : "person" }
        : { name: area.name },
    ),
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; limit?: number };
  if (answer.ok !== true) {
    return {
      ok: false,
      code: codeOf(answer.code),
      ...(typeof answer.limit === "number" ? { limit: answer.limit } : {}),
    };
  }
  revalidatePath("/inicio");
  revalidatePath("/configurar");
  return { ok: true };
}

export type AreaProposalResult =
  | {
      ok: true;
      /** Where ONE read the lawsuits: the publications the firm keeps, the DJEN now, or nowhere. */
      source: "publications" | "djen" | "none";
      lawsuits: number;
      areas: AreaProposal[];
      untold: number;
    }
  | { ok: false; code: string };

const DAY_MS = 86_400_000;
const dayOf = (date: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date);

/**
 * ONE's proposal of the firm's areas (`@flyee/rules/areas`): from the lawsuits of the publications the firm keeps of
 * the last year, or, where there are none yet, from what the DJEN published in the last 90 days of the registrations
 * of who answers. Read at that moment and never kept; counts only reach the screen.
 */
export async function proposeFirmAreas(): Promise<AreaProposalResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  const supabase = context.supabase;

  const { data: airlineRows } = await supabase
    .from("airlines")
    .select("iata, name, legal_name, court_names")
    .eq("active", true);
  const airlines: XrayAirline[] = (
    (airlineRows ?? []) as { iata: string; name: string; legal_name: string | null; court_names: string[] | null }[]
  ).map((airline) => ({
    iata: airline.iata,
    name: airline.name,
    names: [...(airline.court_names ?? []), airline.legal_name ?? "", airline.name],
  }));
  const answer = (source: "publications" | "djen", items: LawsuitText[]): AreaProposalResult => {
    const signs = lawsuitSignsOf(items, airlines);
    return { ok: true, source, lawsuits: signs.length, ...proposeAreas(signs) };
  };

  const { data: kept, error } = await supabase
    .from("publications")
    .select("cnj, court, class_name, unit, head, tail")
    .eq("org_id", context.firm.id)
    .eq("active", true)
    .gte("available_on", dayOf(new Date(Date.now() - 365 * DAY_MS)))
    .order("available_on", { ascending: false })
    .limit(3000);
  const rows = (error ? [] : (kept ?? [])) as {
    cnj: string;
    court: string;
    class_name: string | null;
    unit: string | null;
    head: string;
    tail: string | null;
  }[];
  if (rows.length > 0) {
    return answer(
      "publications",
      rows.map((row) => ({
        key: row.cnj,
        court: row.court,
        className: row.class_name,
        unit: row.unit,
        text: `${row.head} ${row.tail ?? ""}`,
      })),
    );
  }

  // Nothing kept yet: what the DJEN published of who answers, where the DJEN is read.
  const client = djenClient();
  const { data: registrations } = await supabase
    .from("oab_registrations")
    .select("uf, number")
    .eq("user_id", context.userId)
    .limit(3);
  if (!client || !registrations || registrations.length === 0) {
    return { ok: true, source: "none", lawsuits: 0, areas: [], untold: 0 };
  }
  const since = dayOf(new Date(Date.now() - 90 * DAY_MS));
  const items: LawsuitText[] = [];
  for (const registration of registrations as { uf: string; number: string }[]) {
    try {
      const communications = await client.listByOab({ uf: registration.uf, number: registration.number, since });
      for (const communication of communications) {
        items.push({
          key: communication.cnj || communication.hash,
          court: communication.court,
          className: communication.className,
          unit: communication.unit,
          text: communication.text,
        });
      }
    } catch {
      // A registration the DJEN could not read now is left out; the person adds the areas themselves.
    }
  }
  return items.length > 0 ? answer("djen", items) : { ok: true, source: "none", lawsuits: 0, areas: [], untold: 0 };
}
