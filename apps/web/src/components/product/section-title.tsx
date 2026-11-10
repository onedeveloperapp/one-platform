import type { ReactNode } from "react";

import { Box, Typography } from "@mui/material";

import InfoHint from "@/components/product/info-hint";

/**
 * The heading of a section of a page that is not a card (a board, a row of numbers): its title, what it is behind
 * the "i" beside it, where it stands (a `StatusChip`) and its own action at the right. A page had a heading and a
 * paragraph under it for each section, read on every visit (the owner, 2026-11-09).
 *
 * Closest catalog entry: `CardTitle`, the head of a card, which leads with an icon on its tint; a section of a page
 * sits on the page's ground and needs none.
 */
export default function SectionTitle({
  id,
  title,
  description,
  chip,
  action,
  as = "h2",
}: {
  /** The heading's id: what the section is labelled by. */
  id: string;
  title: string;
  /** What the section is, behind the "i" beside the title. At most 200 characters (a test keeps it). */
  description?: string;
  /** Where the section stands, as a `StatusChip` (or a chip with its own "i", such as the environment's). */
  chip?: ReactNode;
  /** The section's own action, at the right. */
  action?: ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <Box className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Typography id={id} variant="h5" component={as} className="mb-0">
        {title}
      </Typography>
      {description ? <InfoHint label={description} placement="bottom-start" className="self-center" /> : null}
      {chip ? <Box className="flex items-center">{chip}</Box> : null}
      {action ? <Box className="ml-auto flex items-center gap-2">{action}</Box> : null}
    </Box>
  );
}
