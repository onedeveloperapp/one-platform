import type { AirlineOption, CasesState, NewCasePrefill } from "./cases-types";
import CasesView from "./components/cases-view";
import { cookies } from "next/headers";

import { phoneForField } from "@/lib/cases/cases";
import { DEFAULT_PAGE_SIZE, isCaseFilter } from "@/lib/cases/list";
import { readCaseList } from "@/lib/cases/list-read";
import { canImportPortfolio } from "@/lib/import/who";
import { getMemberContext } from "@/lib/member/context";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * /casos: the firm's cases. Read under the person's own session, a page at a
 * time: the database counts, filters, searches and pages (`firm_cases`,
 * migration 0033), so the list is the same for a firm with ten cases and for
 * one that brought thousands of lawsuits from a spreadsheet. The list is for
 * finding a case and seeing where each one stands; every change happens
 * inside the case.
 */
async function loadCases(params: { ver?: string; conversa?: string }): Promise<CasesState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const { supabase } = context;
  const firm = context.firm.id;
  const filter = isCaseFilter(params.ver) ? params.ver : null;

  const [list, airlines, cookieStore] = await Promise.all([
    readCaseList(supabase, firm, { filter, search: "", page: 0, pageSize: DEFAULT_PAGE_SIZE }),
    supabase.from("airlines").select("iata, name").eq("active", true).order("name"),
    cookies(),
  ]);
  if (!list || airlines.error) return { kind: "error" };

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

  return {
    kind: "ready",
    list,
    airlines: (airlines.data ?? []) as AirlineOption[],
    filter,
    prefill,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    canImport: canImportPortfolio(context.firm.firmFunction),
  };
}

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const one = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : undefined);
  return <CasesView state={await loadCases({ ver: one("ver"), conversa: one("conversa") })} />;
}
