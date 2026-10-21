import { MenuItem } from "@/types";

/**
 * Production navigation: only destinations that exist. The firm's area is
 * what needs somebody today, the cases, the conversations, the approval
 * queue, the filing queue, what the courts published, the deadlines and the
 * hearings, and the team is under Settings. The admin group holds the operator consoles.
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
  {
    id: "casos",
    icon: "NiFolder",
    label: "menu-casos",
    description: "menu-casos-description",
    color: "text-primary",
    href: "/casos",
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
    id: "aprovacoes",
    icon: "NiListCheck",
    label: "menu-aprovacoes",
    description: "menu-aprovacoes-description",
    color: "text-primary",
    href: "/aprovacoes",
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
  {
    id: "admin",
    icon: "NiCrown",
    label: "menu-admin",
    description: "menu-admin-description",
    color: "text-primary",
    href: "/admin",
    canAccess: { operator: true },
    children: [
      {
        id: "admin-overview",
        icon: "NiDashboard",
        label: "menu-admin-overview",
        href: "/admin",
        description: "menu-admin-overview-description",
      },
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
