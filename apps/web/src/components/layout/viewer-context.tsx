"use client";

import { createContext, useContext } from "react";

import type { MenuViewer } from "@/lib/firm/menu";

/**
 * Who is looking at the logged area, as the server layout read it from the
 * session: whether the person has a firm, their role and function in it, and
 * whether they are the platform operator. The menus read it to show each
 * person their own items from the first paint (`lib/firm/menu.ts`).
 *
 * Null when there is no session to read (a clone without Supabase).
 */
const ViewerContext = createContext<MenuViewer | null>(null);

export function ViewerProvider({ viewer, children }: { viewer: MenuViewer | null; children: React.ReactNode }) {
  return <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>;
}

export const useViewer = (): MenuViewer | null => useContext(ViewerContext);
