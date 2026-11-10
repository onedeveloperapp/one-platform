import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, List, ListItem, ListItemButton, ListItemIcon, ListItemText } from "@mui/material";

import { useViewer } from "@/components/layout/viewer-context";
import NiBuilding from "@/icons/nexture/ni-building";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiEraser from "@/icons/nexture/ni-eraser";
import NiPlug from "@/icons/nexture/ni-plug";
import NiRobot from "@/icons/nexture/ni-robot";
import NiUser from "@/icons/nexture/ni-user";
import NiUsers from "@/icons/nexture/ni-users";
import NiWallet from "@/icons/nexture/ni-wallet";
import { canAccess } from "@/lib/firm/menu";

export type SettingsMenuActive =
  | "profile"
  | "billing"
  | "security"
  | "team"
  | "autonomy"
  | "connections"
  | "partners"
  | "data";

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
 * Only real destinations: every item leads to a working settings page. What
 * belongs to the firm shows to who has a firm, and the firm's connections to
 * who manages it (`lib/firm/menu.ts`): the platform operator, who works in no
 * firm, sees the personal items only.
 */
export default function SettingsMenu({ active }: { active: SettingsMenuActive }) {
  const t = useTranslations("product");
  const viewer = useViewer();
  const inFirm = canAccess(undefined, viewer);
  const managesFirm = canAccess({ manager: true }, viewer);
  // Clearing the firm's data is who decides for it (0161): a partner, or who manages a firm with none. The menu shows
  // it to both; the page says whose it is when a partner exists and the viewer only manages the account.
  const clearsFirm = managesFirm || (inFirm && viewer?.firmFunction === "socio");
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
          <>
            <Group label={t("settings-group-firm")} />
            <Item
              href="/settings/team"
              label={t("settings-team")}
              icon={<NiUsers size="medium" />}
              selected={active === "team"}
            />
            <Item
              href="/settings/autonomia"
              label={t("settings-autonomy")}
              icon={<NiRobot size="medium" />}
              selected={active === "autonomy"}
            />
            <Item
              href="/settings/parceiros"
              label={t("settings-partners")}
              icon={<NiBuilding size="medium" />}
              selected={active === "partners"}
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
      </List>
    </Box>
  );
}
