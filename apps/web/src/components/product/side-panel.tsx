"use client";

import { type ReactNode, useId, useRef } from "react";

import { Box, Drawer, IconButton, Typography } from "@mui/material";

import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import NiCross from "@/icons/nexture/ni-cross";
import { cn } from "@/lib/utils";

/**
 * Where a registration is made (the screen pattern after ADVBox, approved by the owner on 2026-11-07): a panel that
 * slides in at the right of the page, the page staying behind it under a veil, so the person never loses where they
 * were. The head says what is being made (the icon of its family, its name, one line of what happens to it); the
 * body is the form, which scrolls; the foot keeps the buttons in reach however long the form is: the main one first
 * ("Salvar prazo"), then "Cancelar", and at its right one quiet line when it helps ("Lançado por Ana Souza").
 *
 * On a phone it takes the whole screen. While `busy` it does not close by the veil or by Escape, so a save in
 * course is never left behind. With `onSubmit` the body and the foot are one form: the foot's submit button and
 * Enter in a field send it.
 *
 * Closest component: the product dialogs (`DialogHeader`), whose head it keeps: title and an explicit close.
 */
export default function SidePanel({
  open = true,
  onClose,
  closeLabel,
  title,
  description,
  icon,
  tone = "primary",
  busy = false,
  onSubmit,
  actions,
  note,
  children,
}: {
  open?: boolean;
  onClose: () => void;
  /** The name of the close control (an icon). */
  closeLabel: string;
  title: string;
  /** One line under the title: what happens to what is made here. */
  description?: ReactNode;
  /** The icon of what is made, on its family's tint. */
  icon?: ReactNode;
  tone?: TileTone;
  busy?: boolean;
  onSubmit?: () => void;
  /** The buttons of the foot, the main one first. */
  actions?: ReactNode;
  /** One quiet line at the right of the foot. */
  note?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Once in place, the panel puts the person on its first field (the drawer itself takes the focus as it opens).
  const focusFirstField = () => {
    const body = bodyRef.current;
    if (!body || body.contains(document.activeElement)) return;
    body
      .querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), [role="combobox"]:not([aria-disabled="true"])',
      )
      ?.focus();
  };
  const inner = (
    <>
      {/* Room above the first field, whose floating label would be cut by the scroll's edge. */}
      <Box ref={bodyRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-3 pb-6 sm:px-7">
        {children}
      </Box>
      {actions || note ? (
        <Box className="border-grey-100 flex flex-wrap items-center gap-2 border-t px-5 py-4 sm:px-7">
          {actions}
          {note ? (
            <Typography variant="body2" component="span" className="text-text-secondary ml-auto">
              {note}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </>
  );
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={busy ? undefined : onClose}
      slotProps={{
        paper: {
          className: "flex w-full max-w-full flex-col max-sm:rounded-none! sm:w-[33.75rem]",
          role: "dialog",
          "aria-modal": true,
          "aria-labelledby": titleId,
        },
        transition: { onEntered: focusFirstField },
      }}
    >
      <Box className="flex items-start gap-3 px-5 pt-5 pb-4 sm:px-7">
        {icon ? (
          <Box
            aria-hidden
            className={cn(
              "flex h-10 w-10 flex-none items-center justify-center rounded-xl",
              TILE_TONE[tone].bg,
              TILE_TONE[tone].text,
            )}
          >
            {icon}
          </Box>
        ) : null}
        <Box className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Typography id={titleId} variant="h5" component="h2" className="mb-0">
            {title}
          </Typography>
          {description ? (
            <Typography variant="body2" component="div" className="text-text-secondary">
              {description}
            </Typography>
          ) : null}
        </Box>
        <IconButton
          size="small"
          color="grey"
          aria-label={closeLabel}
          onClick={onClose}
          disabled={busy}
          className="-mt-0.5 flex-none"
        >
          <NiCross size="small" />
        </IconButton>
      </Box>
      {onSubmit ? (
        <Box
          component="form"
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {inner}
        </Box>
      ) : (
        <Box className="flex min-h-0 flex-1 flex-col">{inner}</Box>
      )}
    </Drawer>
  );
}
