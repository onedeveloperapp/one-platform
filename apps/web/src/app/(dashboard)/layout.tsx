import "@/style/global.css";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import DashboardShell from "@/components/layout/dashboard-shell";
import { readFinanceAccess } from "@/lib/finance/read";
import { resolveGate } from "@/lib/firm/gate";
import { FIRM_SETUP_PATH } from "@/lib/firm/gate-rules";
import type { MenuViewer } from "@/lib/firm/menu";
import { sweepWhileUsed } from "@/lib/jobs/while-used";
import { getMemberContext } from "@/lib/member/context";
import { moduleMenuOf } from "@/lib/modules/offer";
import { moduleOf } from "@/lib/modules/registry";

/**
 * The logged area. Before drawing anything it decides whether this person may
 * be here at all: an account with no firm goes to found one or accept an
 * invitation, and somebody whose role asks for a second factor sets it up
 * first (lib/firm/gate.ts). Without a session or without Supabase the pages
 * render their own "unavailable" state, as before.
 */
export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const context = await getMemberContext();
  let owesSecondFactor = false;
  let partnerSetup: string | null = null;
  let partnerSetupPending = false;
  if (context) {
    const gate = await resolveGate(context);
    // A send to another page of the logged area is the shell's on a request of the client router, where a
    // redirect from here would loop (lib/firm/gate.ts); a page the browser loads is redirected.
    const heldByShell = gate.clientRouter && gate.decision?.redirectTo !== FIRM_SETUP_PATH;
    if (gate.decision && !heldByShell) redirect(gate.decision.redirectTo);
    owesSecondFactor = gate.owesSecondFactor;
    partnerSetup = gate.partnerSetup;
    partnerSetupPending = gate.partnerSetupPending;
    // Somebody works in ONE: the sweeps that serve what people wait on run now and then, after the answer
    // (lib/jobs/while-used.ts), whatever the clock does.
    sweepWhileUsed();
  }
  // The modules somebody of a partner works in, as the header names them: from ONE's catalog, or, when it could not
  // be read, by the name the module's own definition gives it, so the header still says which area this is.
  const tProduct = context?.partner ? await getTranslations("product") : null;
  const partnerModules =
    context?.partner && tProduct
      ? context.modules.map((key) => {
          const entry = context.catalog?.find((module) => module.key === key);
          const nameKey = moduleOf(key)?.nameKey;
          return {
            key,
            name: entry?.name ?? (nameKey ? tProduct(nameKey) : key),
            icon: entry?.icon ?? null,
            tone: entry?.tone ?? ("primary" as const),
          };
        })
      : [];
  // Whether the person reads the firm's books (0126): the menu shows the finance only to them.
  const finance = context?.firm ? await readFinanceAccess(context.supabase, context.firm.id) : null;
  // Who is looking, for the menus: read here once, so no item appears and then leaves.
  const viewer: MenuViewer | null = context
    ? {
        hasFirm: context.firm !== null,
        role: context.firm?.role ?? null,
        firmFunction: context.firm?.firmFunction ?? null,
        modules: context.modules,
        // The firm's menu lists ONE's modules with where each stands for the firm; nobody else's lists them.
        moduleMenu: context.firm ? moduleMenuOf(context.catalog, context.modules) : [],
        partner: context.partner !== null,
        // Somebody of a partner reads in the header which module the partner works in (its name, icon and colour).
        partnerModules,
        partnerSetup,
        partnerSetupPending,
        isSuperadmin: context.isSuperadmin,
        owesSecondFactor,
        finance: finance !== null && ["view", "operate", "configure"].includes(finance.level),
        financeWrites: finance !== null && finance.opened && ["operate", "configure"].includes(finance.level),
      }
    : null;
  return <DashboardShell viewer={viewer}>{children}</DashboardShell>;
}
