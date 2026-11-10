import type { IconName } from "@/icons/icon-registry";
import type { MenuViewer } from "@/lib/firm/menu";
import { GENERIC_MODULE_ICON, type ModuleMenuEntry } from "@/lib/modules/offer";
import { MODULES } from "@/lib/modules/registry";
import { MenuItem } from "@/types";

/**
 * The modules of ONE as the firm's menu lists them (0075, 0078), in the catalog's order; the overview of all of
 * them is the "Todos" beside the submenu's title, never an item of it. One the firm contracted opens its area; one
 * still to come says "Em breve", and one out that the firm did not contract carries a lock, both leading to where
 * the overview says what each is.
 */
export function moduleMenuItems(entries: readonly ModuleMenuEntry[]): MenuItem[] {
  return entries.map(
    (entry): MenuItem => ({
      id: `modulo-${entry.key}`,
      // The catalog's name (a name the set does not have is drawn as the generic module icon, by the item).
      icon: (entry.icon ?? GENERIC_MODULE_ICON) as IconName,
      label: "menu-modulos",
      text: entry.name,
      href: entry.state === "contracted" ? `/modulos/${entry.key}` : `/modulos#${entry.key}`,
      tag: entry.state === "contracted" ? undefined : entry.state,
    }),
  );
}

/**
 * Production navigation: only destinations that exist. The firm's area is
 * what needs somebody today, its modules (each with an area of its own),
 * the cases, the conversations, the approval queue, the filing queue, what
 * the courts published, the deadlines and the hearings, and the team is
 * under Settings. The admin group holds the operator consoles.
 *
 * Each item says who it is for (`canAccess`, decided in `lib/firm/menu.ts`):
 * one that says nothing is for anybody of a firm, so the platform operator,
 * who works in no firm, sees the consoles and the settings only.
 */
export const leftMenuItems: MenuItem[] = [
  {
    id: "inicio",
    icon: "NiHome",
    label: "menu-inicio",
    description: "menu-inicio-description",
    color: "text-primary",
    href: "/inicio",
  },
  // The firm's modules, each opening its own area: read for the viewer, so a module still to come shows as such.
  {
    id: "modulos",
    icon: "NiPuzzle",
    label: "menu-modulos",
    description: "menu-modulos-description",
    color: "text-primary",
    href: "/modulos",
    childrenFor: (viewer: MenuViewer | null) => moduleMenuItems(viewer?.moduleMenu ?? []),
  },
  {
    id: "casos",
    icon: "NiFolder",
    label: "menu-casos",
    description: "menu-casos-description",
    color: "text-primary",
    href: "/casos",
  },
  {
    id: "controladoria",
    icon: "NiChartBar",
    label: "menu-controladoria",
    description: "menu-controladoria-description",
    color: "text-primary",
    href: "/controladoria",
    canAccess: { oversees: true },
  },
  // What ONE did for the firm each month (0120, 0121): the tasks and the hours are the whole firm's.
  {
    id: "trabalho-do-one",
    icon: "NiRobot",
    label: "menu-trabalho-do-one",
    description: "menu-trabalho-do-one-description",
    color: "text-primary",
    href: "/trabalho-do-one",
  },
  // The firm's books (0126): only who reads them; the costs of the cases are read on each case.
  {
    id: "financeiro",
    icon: "NiMoney",
    label: "menu-financeiro",
    description: "menu-financeiro-description",
    color: "text-primary",
    href: "/financeiro",
    canAccess: { finance: true },
  },
  {
    id: "atendimento",
    icon: "NiMessages",
    label: "menu-atendimento",
    description: "menu-atendimento-description",
    color: "text-primary",
    href: "/atendimento",
  },
  {
    id: "protocolo",
    icon: "NiScale",
    label: "menu-protocolo",
    description: "menu-protocolo-description",
    color: "text-primary",
    href: "/protocolo",
  },
  {
    id: "publicacoes",
    icon: "NiInbox",
    label: "menu-publicacoes",
    description: "menu-publicacoes-description",
    color: "text-primary",
    href: "/publicacoes",
  },
  {
    id: "prazos",
    icon: "NiCalendarClock",
    label: "menu-prazos",
    description: "menu-prazos-description",
    color: "text-primary",
    href: "/prazos",
  },
  {
    id: "agenda",
    icon: "NiCalendar",
    label: "menu-agenda",
    description: "menu-agenda-description",
    color: "text-primary",
    href: "/agenda",
  },
  {
    id: "biblioteca",
    icon: "NiBook",
    label: "menu-biblioteca",
    description: "menu-biblioteca-description",
    color: "text-primary",
    href: "/biblioteca",
  },
  // The area of a partner of a firm (migration 0069): only somebody of a partner sees it, and nothing above.
  {
    id: "parceiro",
    icon: "NiBuilding",
    label: "menu-parceiro",
    description: "menu-parceiro-description",
    color: "text-primary",
    href: "/parceiro",
    canAccess: { partner: true },
  },
  // What each module gives a partner to do (lib/modules/registry.ts), in the modules of its partnerships.
  ...MODULES.modules.flatMap((definition) =>
    definition.partnerArea.map(
      (area): MenuItem => ({
        id: area.id,
        icon: area.icon,
        label: area.labelKey,
        description: area.descriptionKey,
        color: "text-primary",
        href: area.href,
        canAccess: { partner: true, module: definition.key },
      }),
    ),
  ),
  {
    id: "parceiro-equipe",
    icon: "NiUsers",
    label: "menu-parceiro-equipe",
    description: "menu-parceiro-equipe-description",
    color: "text-primary",
    href: "/parceiro/equipe",
    canAccess: { partner: true },
  },
  {
    id: "admin",
    icon: "NiCrown",
    label: "menu-admin",
    description: "menu-admin-description",
    color: "text-primary",
    href: "/admin",
    // The consoles' overview is the subtle link beside the submenu's title, as every group's own page.
    overviewLabel: "menu-admin-overview",
    canAccess: { operator: true },
    children: [
      {
        id: "admin-firms",
        icon: "NiBriefcase",
        label: "menu-admin-firms",
        href: "/admin/escritorios",
        description: "menu-admin-firms-description",
      },
      {
        id: "admin-leads",
        icon: "NiEmail",
        label: "menu-admin-leads",
        href: "/admin/leads",
        description: "menu-admin-leads-description",
      },
      {
        id: "admin-billing",
        icon: "NiMoney",
        label: "menu-admin-billing",
        href: "/admin/billing",
        description: "menu-admin-billing-description",
      },
      {
        id: "admin-ai",
        icon: "NiAI",
        label: "menu-admin-ai",
        href: "/admin/ai",
        description: "menu-admin-ai-description",
      },
      {
        id: "admin-calendar",
        icon: "NiCalendar",
        label: "menu-admin-calendar",
        href: "/admin/calendario",
        description: "menu-admin-calendar-description",
      },
      {
        id: "admin-content",
        icon: "NiBook",
        label: "menu-admin-content",
        href: "/admin/conteudo",
        description: "menu-admin-content-description",
      },
      {
        id: "admin-audit",
        icon: "NiShieldCheck",
        label: "menu-admin-audit",
        href: "/admin/audit",
        description: "menu-admin-audit-description",
      },
      {
        id: "admin-backups",
        icon: "NiArchive",
        label: "menu-admin-backups",
        href: "/admin/backups",
        description: "menu-admin-backups-description",
      },
      {
        id: "admin-announcements",
        icon: "NiAnnouncement",
        label: "menu-admin-announcements",
        href: "/admin/announcements",
        description: "menu-admin-announcements-description",
      },
      {
        id: "admin-help",
        icon: "NiQuestionHexagon",
        label: "menu-admin-help",
        href: "/admin/help",
        description: "menu-admin-help-description",
      },
      {
        id: "admin-blog",
        icon: "NiPen",
        label: "menu-admin-blog",
        href: "/admin/blog",
        description: "menu-admin-blog-description",
      },
      {
        id: "admin-support",
        icon: "NiHeadset",
        label: "menu-admin-support",
        href: "/admin/support",
        description: "menu-admin-support-description",
      },
    ],
  },
];

export const leftMenuBottomItems: MenuItem[] = [
  // An account with no firm still has its own profile and security.
  { id: "settings", label: "menu-settings", href: "/settings", icon: "NiSettings", canAccess: { withoutFirm: true } },
];
