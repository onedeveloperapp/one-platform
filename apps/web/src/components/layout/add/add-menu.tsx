"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Fragment, type ReactNode, useId, useState } from "react";

import { Box, Button, Divider, ListSubheader, Menu, MenuItem } from "@mui/material";

import AddPanel, { type AddKind } from "@/components/layout/add/add-panel";
import FinanceAddPanel, { type FinanceAddKind } from "@/components/layout/add/finance-add-panel";
import { useViewer } from "@/components/layout/viewer-context";
import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import NiArrowLeftRight from "@/icons/nexture/ni-arrow-left-right";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiMoney from "@/icons/nexture/ni-money";
import NiPlus from "@/icons/nexture/ni-plus";
import NiWallet from "@/icons/nexture/ni-wallet";
import type { MenuViewer } from "@/lib/firm/menu";
import type { FirmFunction } from "@/lib/firm/roles";
import { isSetupPath } from "@/lib/search/global-search";
import { cn } from "@/lib/utils";

type MenuKind = AddKind | FinanceAddKind;
type AddEntry = {
  kind: MenuKind;
  label: string;
  icon: ReactNode;
  tone: TileTone;
  /** Who may add it: these functions of the firm, or what the viewer says (the books' level). */
  functions?: readonly FirmFunction[];
  allowed?: (viewer: MenuViewer) => boolean;
};
type AddGroup = { key: string; label: string; entries: readonly AddEntry[] };

/** Who signs or runs the deadlines writes a deadline and a hearing (0034, 0037). */
const DEADLINE_WRITERS: readonly FirmFunction[] = ["socio", "advogado", "controladoria"];

/**
 * What may be added from the top, by group, as the drawings of 2026-11-07 group it: the cases', and the books' (Nova
 * receita, Nova despesa, Transferência, 0127) for who writes in them. The people (Nova pessoa) join with their phase.
 */
const GROUPS: readonly AddGroup[] = [
  {
    key: "cases",
    label: "add-group-cases",
    entries: [
      {
        kind: "deadline",
        label: "add-deadline",
        icon: <NiCalendarClock size="small" />,
        tone: "accent-3",
        functions: DEADLINE_WRITERS,
      },
      {
        kind: "hearing",
        label: "add-hearing",
        icon: <NiCalendar size="small" />,
        tone: "accent-4",
        functions: DEADLINE_WRITERS,
      },
    ],
  },
  {
    key: "finance",
    label: "add-group-finance",
    entries: [
      {
        kind: "income",
        label: "finance-new-income",
        icon: <NiMoney size="small" />,
        tone: "secondary",
        allowed: (viewer) => viewer.financeWrites === true,
      },
      {
        kind: "expense",
        label: "finance-new-expense",
        icon: <NiWallet size="small" />,
        tone: "accent-2",
        allowed: (viewer) => viewer.financeWrites === true,
      },
      {
        kind: "transfer",
        label: "finance-new-transfer",
        icon: <NiArrowLeftRight size="small" />,
        tone: "primary",
        allowed: (viewer) => viewer.financeWrites === true,
      },
    ],
  },
];

const FINANCE_KINDS: readonly MenuKind[] = ["income", "expense", "transfer"];

/**
 * "Adicionar" at the top of every screen (the screen pattern after ADVBox, approved on 2026-11-07): what the person
 * may add, by group, each opening its panel at the side of the page wherever they are. Only what this person may
 * write is offered, and the button is not shown to somebody who may add nothing. On a phone it is the plus alone,
 * named.
 */
export default function AddMenu() {
  const t = useTranslations("product");
  const viewer = useViewer();
  const pathname = usePathname();
  const menuId = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // What was picked waits for the menu to finish closing, which gives the focus back to the button: then the panel
  // opens, takes the focus into its first field, and gives it back to the button when it closes.
  const [picked, setPicked] = useState<MenuKind | null>(null);
  const [adding, setAdding] = useState<MenuKind | null>(null);

  const groups = GROUPS.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) =>
      !viewer
        ? false
        : entry.allowed
          ? entry.allowed(viewer)
          : Boolean(viewer.firmFunction && entry.functions?.includes(viewer.firmFunction)),
    ),
  })).filter((group) => group.entries.length > 0);
  if (!viewer?.hasFirm || viewer.partner || viewer.owesSecondFactor || groups.length === 0) return null;
  // A setup leads nowhere else before it ends: nothing is added from the top there.
  if (isSetupPath(pathname) && !adding) return null;

  const open = (event: React.MouseEvent<HTMLElement>) => setAnchor(event.currentTarget);
  const common = {
    "aria-haspopup": "menu" as const,
    "aria-expanded": anchor ? true : undefined,
    "aria-controls": anchor ? menuId : undefined,
    onClick: open,
  };

  return (
    <>
      <Button
        variant="contained"
        color="primary"
        startIcon={<NiPlus size="small" />}
        endIcon={<NiChevronDownSmall size="small" />}
        className="hidden md:inline-flex"
        {...common}
      >
        {t("add-label")}
      </Button>
      <Button
        variant="contained"
        color="primary"
        size="large"
        className="icon-only md:hidden"
        aria-label={t("add-label")}
        startIcon={<NiPlus size="medium" />}
        {...common}
      />
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: { className: "mt-2 w-72" },
          list: { "aria-label": t("add-label") },
          transition: {
            onExited: () => {
              if (!picked) return;
              setAdding(picked);
              setPicked(null);
            },
          },
        }}
      >
        {groups.map((group, index) => (
          <Fragment key={group.key}>
            {index > 0 ? <Divider className="mx-1 my-1.5" /> : null}
            <ListSubheader className="bg-transparent text-xs leading-8 font-extrabold tracking-wider uppercase">
              {t(group.label)}
            </ListSubheader>
            {group.entries.map((entry) => (
              <MenuItem
                key={entry.kind}
                className="gap-2.5 rounded-lg font-semibold"
                onClick={() => {
                  setPicked(entry.kind);
                  setAnchor(null);
                }}
              >
                <Box
                  component="span"
                  aria-hidden
                  className={cn(
                    "flex h-7 w-7 flex-none items-center justify-center rounded-lg",
                    TILE_TONE[entry.tone].bg,
                    TILE_TONE[entry.tone].text,
                  )}
                >
                  {entry.icon}
                </Box>
                {t(entry.label)}
              </MenuItem>
            ))}
          </Fragment>
        ))}
      </Menu>
      {adding && FINANCE_KINDS.includes(adding) ? (
        <FinanceAddPanel key={adding} kind={adding as FinanceAddKind} onClose={() => setAdding(null)} />
      ) : adding ? (
        <AddPanel key={adding} kind={adding as AddKind} onClose={() => setAdding(null)} />
      ) : null}
    </>
  );
}
