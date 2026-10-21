import { type FirmFunction, isManager, type OrgRole } from "@/lib/firm/roles";

/**
 * Who sees what in the menus of the logged area, as a pure decision.
 *
 * A menu item says who it is for (`canAccess`), and the server layout says
 * who is looking (`MenuViewer`, read once from the session), so the menu is
 * right on the first paint and no item flashes in or out.
 *
 * It is guidance, like the gate: an item that is hidden is not thereby
 * forbidden. What a person may read or do is decided by row-level security
 * and by the functions of the database, never by what the menu shows.
 */

export type MenuViewer = {
  /** The person belongs to a firm. The platform operator works in none. */
  hasFirm: boolean;
  /** What the person may do to the firm account. Null with no firm. */
  role: OrgRole | null;
  /** What the person does in the firm. Null with no firm. */
  firmFunction: FirmFunction | null;
  isSuperadmin: boolean;
  /**
   * The person owes the second factor the rule asks of them (lib/firm/gate-rules.ts):
   * the shell keeps them on the security screen until it is set up.
   */
  owesSecondFactor: boolean;
};

/** Who an item is for. An item that says nothing is for anybody of a firm. */
export type MenuAccess = {
  /** Only the platform operator: the consoles. */
  operator?: boolean;
  /** Also for an account that belongs to no firm: its own settings. */
  withoutFirm?: boolean;
  /** Only who manages the firm account (the owner and the admins). */
  manager?: boolean;
  /** Only these functions of the firm. */
  functions?: readonly FirmFunction[];
};

/**
 * True when the item is shown to the viewer. With no viewer at all (a clone
 * without Supabase, where every screen says it is unavailable) the firm's
 * items are shown and the operator's are not.
 */
export function canAccess(access: MenuAccess | undefined, viewer: MenuViewer | null): boolean {
  if (access?.operator) return viewer?.isSuperadmin === true;
  if (!viewer) return true;
  if (!viewer.hasFirm) return access?.withoutFirm === true;
  if (access?.manager && !isManager(viewer.role)) return false;
  if (access?.functions && !(viewer.firmFunction && access.functions.includes(viewer.firmFunction))) return false;
  return true;
}

type AccessNode = { canAccess?: MenuAccess; children?: AccessNode[] };

/**
 * The items a viewer sees, with the children of each filtered the same way. A
 * child that says nothing is for whoever its group is for: the consoles under
 * the operator's group are the operator's without each one repeating it.
 */
export function visibleItems<Item extends AccessNode>(
  items: readonly Item[],
  viewer: MenuViewer | null,
  inherited?: MenuAccess,
): Item[] {
  return items
    .filter((item) => canAccess(item.canAccess ?? inherited, viewer))
    .map((item) =>
      item.children
        ? ({ ...item, children: visibleItems(item.children, viewer, item.canAccess ?? inherited) } as Item)
        : item,
    );
}
