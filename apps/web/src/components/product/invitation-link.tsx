"use client";

import { Box, Button, FormControl, FormHelperText, FormLabel, Input } from "@mui/material";

/**
 * The link of an invitation, in the very dialog that made it (the team's, the agency's, an agency's colleague's):
 * the address read-only and whole, selected at a touch, its copy button beside it and what became of the copy
 * under it. The invitation goes by e-mail or by this link, and both stay on the one screen the inviter is on
 * (the owner, 2026-11-03): a second screen of the dialog read as a second dialog.
 *
 * Closest to the Pix code at checkout (`assinatura/pix-payment-panel.tsx`), a read-only field with its copy button;
 * the words are the caller's, so each dialog keeps its own.
 */
export default function InvitationLink({
  id,
  label,
  link,
  copied,
  onCopy,
  copyLabel,
  copyAgainLabel,
  copiedHelp,
  help,
}: {
  /** Unique on the screen: names the field and its help. */
  id: string;
  label: string;
  link: string;
  copied: boolean;
  onCopy: () => void;
  copyLabel: string;
  copyAgainLabel: string;
  /** Said under the field once the link was copied. */
  copiedHelp: string;
  /** Said under the field before: who may open the link. */
  help: string;
}) {
  return (
    <FormControl className="outlined mb-0" variant="standard" fullWidth>
      <FormLabel component="label" htmlFor={id}>
        {label}
      </FormLabel>
      <Box className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id={id}
          value={link}
          readOnly
          className="min-w-0 flex-1"
          onFocus={(event) => event.target.select()}
          aria-describedby={`${id}-help`}
        />
        <Button variant="outlined" color="grey" className="flex-none self-start sm:self-auto" onClick={onCopy}>
          {copied ? copyAgainLabel : copyLabel}
        </Button>
      </Box>
      <FormHelperText id={`${id}-help`} role="status">
        {copied ? copiedHelp : help}
      </FormHelperText>
    </FormControl>
  );
}
