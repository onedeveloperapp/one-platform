import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Box, List, ListItem, ListItemButton, ListItemIcon, ListItemText } from "@mui/material";

import { useViewer } from "@/components/layout/viewer-context";
import NextureIcons from "@/icons/icon-registry";
import NiBriefcase from "@/icons/nexture/ni-briefcase";
import NiBuilding from "@/icons/nexture/ni-building";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiEraser from "@/icons/nexture/ni-eraser";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiMessage from "@/icons/nexture/ni-message";
import NiPlug from "@/icons/nexture/ni-plug";
import NiPuzzle from "@/icons/nexture/ni-puzzle";
import NiRobot from "@/icons/nexture/ni-robot";
import NiUser from "@/icons/nexture/ni-user";
import NiUsers from "@/icons/nexture/ni-users";
import NiWallet from "@/icons/nexture/ni-wallet";
import { canAccess } from "@/lib/firm/menu";
import { firmSettingsOf } from "@/lib/modules/registry";

export type SettingsMenuActive =
  | "profile"
  | "security"
  | "professional"
  | "firm"
  | "team"
  | "rules"
  | "autonomy"
  | "messages"
  | "connections"
  | "billing"
  | "modules"
  | "data"
  /** A page of a module's own settings: the item is the one at the page's address. */
  | "module"
  | "partners";

type GroupProps = { label: string };

const Group = ({ label }: GroupProps) => (
  <ListItem disablePadding>
    <ListItemButton className="pointer-events-none mt-4">
      <ListItemText
        primary={label}
        slotProps={{
          primary: { className: "text-xs! font-semibold! opacity-40" },
        }}
      />
    </ListItemButton>
  </ListItem>
);

type ItemProps = {
  href: string;
  label: string;
  icon: React.ReactNode;
  selected?: boolean;
};

const Item = ({ href, label, icon, selected }: ItemProps) => (
  <ListItem disablePadding>
    <ListItemButton href={href} LinkComponent={Link} selected={selected}>
      <ListItemIcon>{icon}</ListItemIcon>
      <ListItemText primary={label} />
    </ListItemButton>
  </ListItem>
);

/**
 * Only real destinations: every item leads to a working settings page, each setting in one home (the owner,
 * 2026-11-11). "Sua conta" holds what is the person's in any firm: the profile, the security and, in a firm, their
 * practice (the bar, the certificates, their cloud signature). "Escritório" holds what is the whole firm's, which who
 * decides for it changes: its data, its team, the rules of its cases, what ONE decides, what the client reads, the
 * connections, the plan and the clearing of test data. Then each module the firm contracted, under its name, with what
 * only that module's cases read (`firmSettings` of the module's definition). What belongs to the firm shows to who has
 * a firm, the connections to who manages it (`lib/firm/menu.ts`): the platform operator, who works in no firm, sees
 * the personal items only.
 */
export default function SettingsMenu({ active }: { active: SettingsMenuActive }) {
  const t = useTranslations("product");
  const viewer = useViewer();
  const pathname = usePathname();
  const inFirm = canAccess(undefined, viewer);
  const managesFirm = canAccess({ manager: true }, viewer);
  // Clearing the firm's data is who decides for it (0161): a partner, or who manages a firm with none. The menu shows
  // it to both; the page says whose it is when a partner exists and the viewer only manages the account.
  const clearsFirm = managesFirm || (inFirm && viewer?.firmFunction === "socio");
  const modules = inFirm
    ? (viewer?.moduleMenu ?? [])
        .filter((entry) => entry.state === "contracted")
        .map((entry) => ({ ...entry, settings: firmSettingsOf(entry.key) }))
        .filter((entry) => entry.settings.length > 0)
    : [];
  return (
    <Box className="flex flex-col gap-4">
      <List className="-mt-6">
        <Group label={t("settings-group-personal")} />
        <Item
          href="/settings"
          label={t("settings-profile")}
          icon={<NiUser size="medium" />}
          selected={active === "profile"}
        />
        <Item
          href="/settings/security"
          label={t("settings-security")}
          icon={<NiCheckSquare size="medium" />}
          selected={active === "security"}
        />
        {inFirm ? (
          <Item
            href="/settings/atuacao"
            label={t("settings-professional")}
            icon={<NiBriefcase size="medium" />}
            selected={active === "professional"}
          />
        ) : null}
        {inFirm ? (
          <>
            <Group label={t("settings-group-firm")} />
            <Item
              href="/settings/escritorio"
              label={t("settings-firm")}
              icon={<NiBuilding size="medium" />}
              selected={active === "firm"}
            />
            <Item
              href="/settings/team"
              label={t("settings-team")}
              icon={<NiUsers size="medium" />}
              selected={active === "team"}
            />
            <Item
              href="/settings/regras"
              label={t("settings-rules")}
              icon={<NiListCheck size="medium" />}
              selected={active === "rules"}
            />
            <Item
              href="/settings/autonomia"
              label={t("settings-autonomy")}
              icon={<NiRobot size="medium" />}
              selected={active === "autonomy"}
            />
            <Item
              href="/settings/mensagens"
              label={t("settings-messages")}
              icon={<NiMessage size="medium" />}
              selected={active === "messages"}
            />
            {managesFirm ? (
              <Item
                href="/settings/connections"
                label={t("settings-connections")}
                icon={<NiPlug size="medium" />}
                selected={active === "connections"}
              />
            ) : null}
            <Item
              href="/settings/billing"
              label={t("settings-billing")}
              icon={<NiWallet size="medium" />}
              selected={active === "billing"}
            />
            {/* ONE's modules beside the plan they are packages of (2026-11-14: the menu of the modules went). */}
            <Item
              href="/settings/modulos"
              label={t("modules-title")}
              icon={<NiPuzzle size="medium" />}
              selected={active === "modules"}
            />
            {clearsFirm ? (
              <Item
                href="/settings/dados"
                label={t("settings-data")}
                icon={<NiEraser size="medium" />}
                selected={active === "data"}
              />
            ) : null}
          </>
        ) : null}
        {modules.map((entry) => (
          <Box key={entry.key} component="li" className="list-none">
            <List disablePadding>
              <Group label={entry.name} />
              {entry.settings.map((item) => (
                <Item
                  key={item.id}
                  href={item.href}
                  label={t(item.labelKey)}
                  icon={<NextureIcons icon={item.icon} size="medium" />}
                  selected={(active === "module" || active === "partners") && pathname === item.href}
                />
              ))}
            </List>
          </Box>
        ))}
      </List>
    </Box>
  );
}
