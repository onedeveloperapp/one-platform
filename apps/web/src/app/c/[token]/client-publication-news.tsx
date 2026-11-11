"use client";

import { useTranslations } from "next-intl";

import { Box, Card, CardContent, Typography } from "@mui/material";

import StateLine from "@/components/product/state-line";
import type { ClientPublicationNews } from "@/lib/publications/actions-read";

const brDay = (day: string) => (day ? day.split("-").reverse().join("/") : "");

/**
 * What the court's publications of the client's lawsuit mean for them, in plain words, and what the firm asks of them
 * (migration 0186): the latest first. Shown only when there is something to say.
 */
export default function ClientPublicationNews({ items }: { items: ClientPublicationNews[] }) {
  const t = useTranslations("product");
  if (items.length === 0) return null;
  return (
    <Card component="section" aria-labelledby="client-publication-news-title">
      <CardContent className="flex flex-col gap-4">
        <Typography id="client-publication-news-title" variant="h6" component="h2" className="mb-0">
          {t("client-publication-news-title")}
        </Typography>
        {items.slice(0, 5).map((item) => (
          <Box key={item.id} className="flex flex-col gap-1">
            <Typography variant="caption" className="text-text-secondary">
              {brDay(item.on)}
            </Typography>
            <Typography variant="body1">{item.summary}</Typography>
            {item.asks.map((ask, index) => (
              <StateLine key={index} tone="attention">
                {t("client-publication-news-asks", { text: ask })}
              </StateLine>
            ))}
          </Box>
        ))}
      </CardContent>
    </Card>
  );
}
