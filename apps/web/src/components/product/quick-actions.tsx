"use client";

import { type ReactNode, useId, useState } from "react";

import { Button, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from "@mui/material";

import NiDotsSquare from "@/icons/nexture/ni-dots-square";

export type QuickAction = {
  key: string;
  label: string;
  /** What the action is, as an icon of the app's set. */
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

/**
 * The actions a card keeps out of sight, one click away (the owner, 2026-11-03): what was already done and may be
 * done again (send a document once more, another link), or what a person seldom needs. An icon button with its
 * name said on hover and to assistive technology, and a menu of the actions, each with its icon. What the card asks
 * for now stays a button of its own, in view; this holds the rest.
 *
 * Closest catalog entry: none had a menu; a card's own action (`CollapsibleCard`'s `action`) is one button in view,
 * which a done action should not be.
 */
export default function QuickActions({
  label,
  actions,
  icon,
  text,
  align = "right",
}: {
  /** What the menu holds, said on hover and to assistive technology ("Mais ações do documento"). */
  label: string;
  actions: QuickAction[];
  /** The button's icon: three dots by default, a plus for a menu that only adds. */
  icon?: ReactNode;
  /**
   * Words in view beside the icon, for a person who would not find an icon alone (somebody on a client's link, on
   * a phone, where nothing says a name on hover): the button stays one, small and quiet.
   */
  text?: string;
  /** The side the menu opens to: under a control at the right of a row (the default), or at the left of a list. */
  align?: "left" | "right";
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = anchor !== null;
  if (actions.length === 0) return null;
  return (
    <>
      <Tooltip title={text ? "" : label}>
        <Button
          variant="text"
          color="grey"
          size="small"
          className={text ? "hover:bg-grey-25" : "icon-only hover:bg-grey-25"}
          aria-label={text ? undefined : label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? `${id}-menu` : undefined}
          onClick={(event) => setAnchor(event.currentTarget)}
          startIcon={icon ?? <NiDotsSquare size="medium" />}
        >
          {text}
        </Button>
      </Tooltip>
      <Menu
        id={`${id}-menu`}
        anchorEl={anchor}
        open={open}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: align }}
        transformOrigin={{ vertical: "top", horizontal: align }}
      >
        {actions.map((action) => (
          <MenuItem
            key={action.key}
            disabled={action.disabled}
            onClick={() => {
              setAnchor(null);
              action.onClick();
            }}
          >
            {action.icon ? <ListItemIcon className="text-text-secondary">{action.icon}</ListItemIcon> : null}
            <ListItemText>{action.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
