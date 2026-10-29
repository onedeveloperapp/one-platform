import "@/style/global.css";

import { redirect } from "next/navigation";

import DashboardShell from "@/components/layout/dashboard-shell";
import { resolveGate } from "@/lib/firm/gate";
import { FIRM_SETUP_PATH } from "@/lib/firm/gate-rules";
import type { MenuViewer } from "@/lib/firm/menu";
import { getMemberContext } from "@/lib/member/context";

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
  if (context) {
    const gate = await resolveGate(context);
    // A send to another page of the logged area is the shell's on a request of the client router, where a
    // redirect from here would loop (lib/firm/gate.ts); a page the browser loads is redirected.
    const heldByShell = gate.clientRouter && gate.decision?.redirectTo !== FIRM_SETUP_PATH;
    if (gate.decision && !heldByShell) redirect(gate.decision.redirectTo);
    owesSecondFactor = gate.owesSecondFactor;
  }
  // Who is looking, for the menus: read here once, so no item appears and then leaves.
  const viewer: MenuViewer | null = context
    ? {
        hasFirm: context.firm !== null,
        role: context.firm?.role ?? null,
        firmFunction: context.firm?.firmFunction ?? null,
        modules: context.modules,
        partner: context.partner !== null,
        isSuperadmin: context.isSuperadmin,
        owesSecondFactor,
      }
    : null;
  return <DashboardShell viewer={viewer}>{children}</DashboardShell>;
}
