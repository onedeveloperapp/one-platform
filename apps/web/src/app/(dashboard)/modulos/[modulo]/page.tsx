import ModuleAreaView, { type ModuleAreaState, type ModuleShortcut } from "./module-area-view";
import type { Metadata } from "next";

import { readCaseList, readCaseStock } from "@/lib/cases/list-read";
import { isManager } from "@/lib/firm/roles";
import { canImportPortfolio } from "@/lib/import/who";
import { getMemberContext } from "@/lib/member/context";
import { readModuleOffer } from "@/lib/modules/offer-read";
import { moduleOf } from "@/lib/modules/registry";
import { testChatCardOf } from "@/lib/test-chat/test-chat";

type Params = { params: Promise<{ modulo: string }> };

/** How many of the module's latest cases in progress the area shows; the list of them all is one click further. */
const RECENT_CASES = 5;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { modulo } = await params;
  const context = await getMemberContext();
  const module = context?.catalog?.find((entry) => entry.key === modulo);
  return module ? { title: module.name } : {};
}

/**
 * /modulos/<key>: a module's own area (migration 0078). Somebody comes here to work one module: where its cases are
 * and the latest of them, nothing of another module's (the list of them is `/casos` under the module, which the
 * area opens and never repeats, 2026-11-09), the module's share of the firm's work (its conversations, approvals, filings,
 * deadlines, hearings and publications, each page under the module), and what only that module has (for the
 * passenger module, its partner agencies, the portfolio a firm brings from a spreadsheet, the Valor da Causa Pedido
 * and, while it is on, the test chat). A module the firm did not contract, or one still to come, says so, and the
 * way to the overview of the modules.
 */
async function loadArea(key: string): Promise<ModuleAreaState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const offer = await readModuleOffer(context);
  if (!offer) return { kind: "error" };

  const contracted = offer.contracted.find((module) => module.key === key);
  if (!contracted) {
    const soon = offer.comingSoon.find((module) => module.key === key);
    if (soon) return { kind: "soon", module: soon };
    const locked = offer.locked.find((module) => module.key === key);
    if (locked) return { kind: "locked", module: locked };
    return { kind: "not-found" };
  }

  const definition = moduleOf(key);
  const manager = isManager(context.firm.role);
  const importer = canImportPortfolio(context.firm.firmFunction);
  const [stock, recent, testChat] = await Promise.all([
    // Where the module's cases are, by the rule of the top of the case (0111), as the home and the controladoria count
    // them, and the latest few in progress (`firm_cases`, the latest moved first).
    readCaseStock(context.supabase, context.firm.id, { module: key }).catch(() => null),
    readCaseList(context.supabase, context.firm.id, {
      filter: null,
      search: "",
      module: key,
      page: 0,
      pageSize: RECENT_CASES,
    }).catch(() => null),
    definition?.testChat && manager
      ? context.supabase.rpc("test_chat_link", { target_org: context.firm.id }).then(
          ({ data, error }) => (error ? null : testChatCardOf(data)),
          () => null,
        )
      : Promise.resolve(null),
  ]);

  // What only this module has: the places its definition names, the import to who brings a portfolio.
  const shortcuts: ModuleShortcut[] = (definition?.firmArea ?? [])
    .filter((entry) => !entry.importers || importer)
    .map((entry) => ({
      id: entry.id,
      href: entry.href,
      icon: entry.icon,
      labelKey: entry.labelKey,
      descriptionKey: entry.descriptionKey,
    }));
  if (testChat?.on && testChat.token) {
    shortcuts.push({
      id: "chat-de-teste",
      href: `/t/${testChat.token}`,
      icon: "NiMessages",
      labelKey: "module-area-test-chat",
      descriptionKey: "module-area-test-chat-hint",
    });
  }

  return {
    kind: "ready",
    firm: context.firm.name,
    module: contracted,
    shortcuts,
    progress: stock && recent ? { stock, ended: recent.counts.ended, recent: recent.rows } : null,
  };
}

export default async function ModuleAreaPage({ params }: Params) {
  const { modulo } = await params;
  return <ModuleAreaView state={await loadArea(modulo)} />;
}
