import "server-only";

import type { AirlineOption, CasesScope, CasesState, NewCasePrefill } from "./cases-types";
import { cookies } from "next/headers";

import { readAreaChoices } from "@/lib/cases/area-choices-read";
import { phoneForField } from "@/lib/cases/cases";
import { canExportCases } from "@/lib/cases/export";
import { DEFAULT_PAGE_SIZE, isCaseFilter } from "@/lib/cases/list";
import { readCaseList, readCaseStock } from "@/lib/cases/list-read";
import { canImportPortfolio } from "@/lib/import/who";
import { getMemberContext } from "@/lib/member/context";
import { pageScopeOf } from "@/lib/modules/offer";
import { moduleOf } from "@/lib/modules/registry";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The firm's cases as `/casos` and a module's area read them. Under the person's own session, a page at a time:
 * the database counts, filters, searches and pages (`firm_cases`, migrations 0033 and 0078), so the list is the
 * same for a firm with ten cases and for one that brought thousands of lawsuits from a spreadsheet. Under a module
 * (`modulo`, one the firm contracted) it lists that module's cases only, with what only that module has.
 */
export async function loadCases(params: {
  ver?: string;
  conversa?: string;
  modulo?: string;
  /** Whether the test cases count (0114); every case when left out. */
  tests?: boolean;
}): Promise<CasesState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const { supabase } = context;
  const firm = context.firm.id;
  const filter = isCaseFilter(params.ver) ? params.ver : null;
  const tests = params.tests !== false;
  const { modules, current } = pageScopeOf(context.catalog, context.modules, params.modulo);
  const definition = current ? moduleOf(current.key) : null;
  const scope: CasesScope | null = current
    ? {
        module: current,
        partner: (definition?.partnerArea.length ?? 0) > 0,
        importable: definition?.firmArea.some((entry) => entry.importers) ?? false,
      }
    : null;

  const [list, stock, airlines, areas, cookieStore] = await Promise.all([
    readCaseList(supabase, firm, {
      filter,
      search: "",
      module: current?.key ?? null,
      page: 0,
      pageSize: DEFAULT_PAGE_SIZE,
      tests,
    }),
    // Who has the cases and the stagnant ones, counted for the views of the list (0111): one read a load.
    readCaseStock(supabase, firm, { module: current?.key ?? null, tests }),
    supabase.from("airlines").select("iata, name").eq("active", true).order("name"),
    // Under a module's list a case is of that module: the firm's areas are not read.
    current ? Promise.resolve([]) : readAreaChoices(supabase, firm),
    cookies(),
  ]);
  if (!list || airlines.error || !areas) return { kind: "error" };

  // Opened from a conversation: who the person is comes from the conversation, read under this
  // person's session, never from the address (a name or a number in a URL ends up in logs).
  let prefill: NewCasePrefill = null;
  if (params.conversa && UUID.test(params.conversa)) {
    const { data: conversation } = await supabase
      .from("wa_conversations")
      .select("contact_wa_id, contact_name, saved_name")
      .eq("id", params.conversa)
      .eq("org_id", firm)
      .maybeSingle();
    if (conversation) {
      prefill = {
        name: String(conversation.saved_name ?? conversation.contact_name ?? "").slice(0, 200),
        phone: phoneForField(conversation.contact_wa_id as string),
      };
    }
  }

  const supportVisit = cookieStore.has(IMPERSONATION_MARKER_COOKIE);
  return {
    kind: "ready",
    list,
    tests,
    stock,
    airlines: (airlines.data ?? []) as AirlineOption[],
    areas,
    filter,
    prefill,
    supportVisit,
    canImport: canImportPortfolio(context.firm.firmFunction),
    canExport: !supportVisit && canExportCases(context.firm.role, context.firm.firmFunction),
    firmName: context.firm.name,
    scope,
    modules,
  };
}
