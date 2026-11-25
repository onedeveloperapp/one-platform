"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, Typography } from "@mui/material";

/**
 * A part of a list read whole, the rest a press away: `part` is what is shown, `total` how many the list holds
 * under its view and its search, and `more` shows the next `step`. The part goes back to its first `step` when
 * `key` changes (another view, another search): what was opened of one list is not another's.
 */
export function useListPart<T>(items: readonly T[], step: number, key: string) {
  const [opened, setOpened] = useState<{ key: string; count: number }>({ key, count: step });
  const count = opened.key === key ? opened.count : step;
  return {
    part: items.slice(0, count),
    total: items.length,
    more: () => setOpened({ key, count: count + step }),
  };
}

/**
 * The foot of a list shown a part at a time: how many are shown of how many, and the button that shows the next
 * ones, saying how many it brings. Nothing when the whole list is shown. The closest shapes are the pager of
 * `/prazos` (a page asked of the server) and DataTable's (a table): this one is for a list of cards read whole,
 * where the views, the search and the export already act on every row and only the drawing is in parts.
 */
export default function ListMore({
  shown,
  total,
  step,
  onMore,
}: {
  shown: number;
  total: number;
  step: number;
  onMore: () => void;
}) {
  const t = useTranslations("product");
  if (shown >= total) return null;
  return (
    <Box className="flex flex-wrap items-center gap-3">
      <Typography variant="body2" className="text-text-secondary min-w-0 flex-1">
        {t("list-more-shown", { shown, total })}
      </Typography>
      <Button variant="outlined" color="grey" onClick={onMore}>
        {t("list-more", { count: Math.min(step, total - shown) })}
      </Button>
    </Box>
  );
}
