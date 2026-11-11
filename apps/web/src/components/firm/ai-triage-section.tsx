"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Alert, Box, Button, Typography } from "@mui/material";

import { setFirmAiTriage } from "@/lib/publications/actions";
import type { AiTriage } from "@/lib/publications/facts";
import { CATEGORY_KEY, publicationErrorKey } from "@/lib/publications/publications";

/**
 * Whether the firm lets ONE's reading be the triage of the publications (migration 0035), in the categories the
 * platform let out of the shadow, each with the share a person checks. It sits inside the decision "Triar as
 * publicações" of `/settings/autonomia`, its one home: `/publicacoes` says how it is and leads here. Who decides for
 * the firm turns it on or off; anybody else reads it. Nothing while no category is out of the shadow.
 */
export default function AiTriageSection({
  aiTriage,
  mayDecide,
  onChanged,
}: {
  aiTriage: AiTriage;
  mayDecide: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (aiTriage.sampled.length === 0) return null;
  const switchTo = (enabled: boolean) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await setFirmAiTriage(enabled);
        if (!result.ok) {
          setError(t(publicationErrorKey(result.code)));
          return;
        }
        onChanged();
      } catch {
        setError(t("publication-error-failed"));
      }
    });
  const categories = aiTriage.sampled
    .map((policy) =>
      t("publications-ai-share", { category: t(CATEGORY_KEY[policy.category]), share: policy.samplePercent }),
    )
    .join(", ");
  return (
    <Box component="section" aria-labelledby="autonomy-publications-ai" className="flex flex-col gap-2">
      <Typography id="autonomy-publications-ai" variant="subtitle2" component="h3">
        {t("publications-ai-title")}
      </Typography>
      <Typography variant="body2" className="text-text-secondary">
        {!aiTriage.firmAllows ? t("publications-ai-off") : t("publications-ai-body", { categories })}
      </Typography>
      {mayDecide ? (
        <Box>
          <Button
            variant="outlined"
            color="grey"
            size="small"
            disabled={pending}
            onClick={() => switchTo(!aiTriage.firmAllows)}
          >
            {t(aiTriage.firmAllows ? "publications-ai-disallow" : "publications-ai-allow")}
          </Button>
        </Box>
      ) : null}
      {error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      ) : null}
    </Box>
  );
}
