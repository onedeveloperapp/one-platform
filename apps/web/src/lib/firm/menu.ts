import { type FirmFunction, isManager, type OrgRole } from "@/lib/firm/roles";
import type { ModuleCard, ModuleMenuEntry } from "@/lib/modules/offer";

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
  /** The product modules the person works in (migration 0068): the firm's, or the partner's. */
  modules: readonly string[];
  /**
   * ONE's modules as the menu lists them for a firm (0075, 0078): each with where it stands for the firm
   * (contracted, to come, or out and not contracted). Empty for somebody of no firm, and when the catalog could
   * not be read.
   */
  moduleMenu: readonly ModuleMenuEntry[];
  /** The person works in a partner of a firm (0069), and sees the partner's area only. */
  partner: boolean;
  /**
   * For somebody of a partner, the module (or modules) the partner works in with its firm, as the header names it
   * (its name, icon and tone, 0075 and 0081): the agency's area is a module's. Absent or empty for anybody else.
   */
  partnerModules?: readonly Pick<ModuleCard, "key" | "name" | "icon" | "tone">[];
  /** Where the person's partner is set up (0080), which the shell keeps who owes the second factor on; or null. */
  partnerSetup?: string | null;
  /** Who manages the partner never answered its setup (0080): the partner's home opens on it. */
  partnerSetupPending?: boolean;
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
  /** Only a firm (or a partner) that works in this product module (lib/modules/registry.ts). */
  module?: string;
  /** Only somebody of a partner (0069): the partner's area. */
  partner?: boolean;
};

/**
 * True when the item is shown to the viewer. With no viewer at all (a clone
 * without Supabase, where every screen says it is unavailable) the firm's
 * items are shown and the operator's are not.
 */
export function canAccess(access: MenuAccess | undefined, viewer: MenuViewer | null): boolean {
  if (access?.operator) return viewer?.isSuperadmin === true;
  if (!viewer) return access?.partner !== true;
  if (viewer.partner) {
    // Somebody of a partner: the partner's area, in the modules it works in, and their own account.
    if (access?.partner) return !access.module || viewer.modules.includes(access.module);
    return access?.withoutFirm === true;
  }
  if (access?.partner) return false;
  if (!viewer.hasFirm) return access?.withoutFirm === true;
  if (access?.manager && !isManager(viewer.role)) return false;
  if (access?.functions && !(viewer.firmFunction && access.functions.includes(viewer.firmFunction))) return false;
  if (access?.module && !viewer.modules.includes(access.module)) return false;
  return true;
}

type AccessNode = {
  canAccess?: MenuAccess;
  children?: AccessNode[];
  childrenFor?: (viewer: MenuViewer | null) => AccessNode[];
};

/**
 * The items a viewer sees, with the children of each filtered the same way. A
 * child that says nothing is for whoever its group is for: the consoles under
 * the operator's group are the operator's without each one repeating it. A
 * group whose children depend on who is looking (`childrenFor`: the firm's
 * modules) has them made for the viewer first; one left with no child at all
 * is not shown.
 */
export function visibleItems<Item extends AccessNode>(
  items: readonly Item[],
  viewer: MenuViewer | null,
  inherited?: MenuAccess,
): Item[] {
  return items
    .filter((item) => canAccess(item.canAccess ?? inherited, viewer))
    .flatMap((item): Item[] => {
      const children = item.childrenFor ? (item.childrenFor(viewer) as Item[]) : (item.children as Item[] | undefined);
      if (!children) return [item];
      const shown = visibleItems(children, viewer, item.canAccess ?? inherited);
      if (item.childrenFor && shown.length === 0) return [];
      return [{ ...item, children: shown, childrenFor: undefined } as Item];
    });
}
