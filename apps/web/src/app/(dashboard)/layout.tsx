import "@/style/global.css";

import { redirect } from "next/navigation";

import DashboardShell from "@/components/layout/dashboard-shell";
import { resolveGate } from "@/lib/firm/gate";
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
  if (context) {
    const decision = await resolveGate(context);
    if (decision) redirect(decision.redirectTo);
  }
  // Who is looking, for the menus: read here once, so no item appears and then leaves.
  const viewer: MenuViewer | null = context
    ? {
        hasFirm: context.firm !== null,
        role: context.firm?.role ?? null,
        firmFunction: context.firm?.firmFunction ?? null,
        isSuperadmin: context.isSuperadmin,
      }
    : null;
  return <DashboardShell viewer={viewer}>{children}</DashboardShell>;
}
