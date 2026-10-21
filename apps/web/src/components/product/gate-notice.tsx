"use client";

import { useTranslations } from "next-intl";

import { Box, Button, Typography } from "@mui/material";

/**
 * Whether an action can run right now, as the screen knows it. `blocked`
 * carries the reason already translated by the caller, because only the
 * caller knows which plan, step or setting is missing.
 */
export type Gate =
  | { state: "available" }
  | { state: "loading" }
  | { state: "unknown" }
  | { state: "blocked"; message: string };

/**
 * Why an action cannot run right now — in words, under the control it disables.
 *
 * Three rules this component exists to keep:
 *  - a disabled control ALWAYS states its reason as visible text (link it with
 *    `aria-describedby={id}`); a tooltip does not exist on touch;
 *  - a fact that is still LOADING says nothing at all — it is not a block, and
 *    claiming one would be as dishonest as claiming availability;
 *  - a fact that FAILED to load is "unknown": an offer to try again, never a
 *    block and never an empty state.
 */
export default function GateNotice({
  gate,
  id,
  onRetry,
}: {
  gate: Gate;
  /** Id referenced by the control's `aria-describedby`. */
  id: string;
  /** Re-fetches whatever failed, when the state is "unknown". */
  onRetry?: () => void;
}) {
  const t = useTranslations("product");

  if (gate.state === "unknown") {
    return (
      <Box className="flex flex-row flex-wrap items-center gap-1">
        <Typography id={id} variant="body2" className="text-text-secondary text-xs leading-5">
          {t("gate-unknown")}
        </Typography>
        {onRetry && (
          <Button size="small" className="px-1!" onClick={onRetry}>
            {t("retry")}
          </Button>
        )}
      </Box>
    );
  }

  if (gate.state !== "blocked") return null;

  return (
    <Typography id={id} variant="body2" className="text-text-secondary text-xs leading-5">
      {gate.message}
    </Typography>
  );
}
