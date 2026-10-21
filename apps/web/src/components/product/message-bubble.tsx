import { Box, Typography } from "@mui/material";

import { TILE_TONE } from "@/components/product/tile-tone";
import { cn } from "@/lib/utils";

/**
 * One message of a conversation, on the side of who said it: what the person
 * wrote on the left, what the firm wrote on the right.
 *
 * Nothing in the catalog is a thing somebody said: cards, tiles and badges
 * hold facts about the firm, and a thread is a column of sayings told apart
 * by their side. So this is built in the same language instead of borrowed
 * from another: the tile's radius, the tile's primary tint (`TILE_TONE`) for
 * the firm's side and the neutral surface for the person's, body text at the
 * product scale. The side is never carried by colour alone: it is also the
 * alignment, and `sideLabel` says it to a screen reader.
 */
export default function MessageBubble({
  side,
  sideLabel,
  children,
  meta,
  note,
  className,
}: {
  /** `in`: the person wrote it. `out`: the firm did. */
  side: "in" | "out";
  /** Who said it, for a screen reader: "Maria disse", "O escritório disse". */
  sideLabel: string;
  /** What was said. */
  children: React.ReactNode;
  /** The line under it: when, and what became of it. */
  meta?: React.ReactNode;
  /** A line above it, when the message is not an ordinary one: sent from the phone, from before the connection. */
  note?: string;
  className?: string;
}) {
  return (
    <Box component="li" className={cn("flex w-full", side === "out" ? "justify-end" : "justify-start", className)}>
      <Box
        className={cn(
          "flex max-w-[85%] min-w-0 flex-col gap-1 rounded-2xl px-4 py-3 md:max-w-[70%]",
          side === "out" ? TILE_TONE.primary.bg : "bg-grey-25",
        )}
      >
        <span className="sr-only">{sideLabel}</span>
        {note ? (
          <Typography variant="body2" className="text-text-secondary">
            {note}
          </Typography>
        ) : null}
        <Box className="text-text-primary min-w-0 text-sm leading-relaxed break-words whitespace-pre-wrap">
          {children}
        </Box>
        {meta ? (
          <Box className="text-text-secondary flex flex-row flex-wrap items-center gap-x-2 gap-y-1 text-xs">{meta}</Box>
        ) : null}
      </Box>
    </Box>
  );
}
