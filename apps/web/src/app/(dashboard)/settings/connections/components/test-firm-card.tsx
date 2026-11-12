"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import StatusChip from "@/components/product/status-chip";
import NiPlane from "@/icons/nexture/ni-plane";
import NiScale from "@/icons/nexture/ni-scale";

/**
 * A test firm's tools (migration 0220), for who manages it: the operator marked the firm as a test firm, so its
 * cases and the trips ONE follows for it are tests, its flights made to happen by its tools and its lawsuits
 * answered by the test court, while the passengers are told on their real WhatsApp. The card hands out the two
 * links; the tools take the test chat's place.
 */
export default function TestFirmCard({ toolsUrl, courtUrl }: { toolsUrl: string; courtUrl: string }) {
  const t = useTranslations("product");
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toolsUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Grid size={12}>
      <Card component="section" aria-labelledby="connections-test-firm">
        <CardContent className="flex flex-col gap-4">
          <CardTitle
            id="connections-test-firm"
            icon={<NiPlane size="medium" />}
            tone="secondary"
            title={t("test-firm-card-title")}
            description={t("test-firm-card-description")}
            chip={<StatusChip tone="info" label={t("test-firm-chip")} />}
          />
          <Typography variant="body2" className="text-text-secondary break-all">
            {toolsUrl}
          </Typography>
          <Box className="flex flex-row flex-wrap gap-2">
            <Button variant="contained" href={toolsUrl} target="_blank" rel="noopener noreferrer">
              {t("test-firm-card-open")}
            </Button>
            <Button variant="outlined" color="grey" onClick={() => void copy()}>
              {copied ? t("test-firm-card-copied") : t("test-firm-card-copy")}
            </Button>
            <Button
              variant="text"
              color="grey"
              href={courtUrl}
              target="_blank"
              rel="noopener noreferrer"
              startIcon={<NiScale size="small" />}
            >
              {t("test-chat-court")}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Grid>
  );
}
