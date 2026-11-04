"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Box, Button, Card, CardContent } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import {
  unagreedDepartureLabel,
  unagreedLineKey,
  type UnagreedRead,
} from "@/modules/direito-do-passageiro/agency/unagreed";
import { readUnagreedDepartures } from "@/modules/direito-do-passageiro/agency/unagreed-actions";

/**
 * The agency's passengers who fly in the next days with no agreement (migration 0094), on its home, while there is
 * still time to send the link: ONE follows only the flights of who agreed, so a problem on such a flight reaches
 * nobody. Each line says how the passenger stands and opens their agreement. The card asks only for what is owed:
 * with nobody to remind, it is not there. Who said no or took the agreement back is never listed.
 */
export default function PartnerUnagreedCard() {
  const t = useTranslations("product");
  const [read, setRead] = useState<UnagreedRead | null>(null);
  useEffect(() => {
    let live = true;
    void readUnagreedDepartures()
      .then((answer) => (answer.ok ? { days: answer.days, travelers: answer.travelers } : null))
      .catch(() => null)
      .then((answer) => {
        if (live) setRead(answer);
      });
    return () => {
      live = false;
    };
  }, []);

  // Nothing owed (or nothing read: the list of passengers below says its own failure), nothing shown.
  if (!read || read.travelers.length === 0) return null;
  return (
    <Card component="section" aria-labelledby="pax-unagreed-title">
      <CardContent className="flex flex-col gap-4">
        <CardTitle
          id="pax-unagreed-title"
          icon={<NiCalendarClock size="medium" />}
          tone="accent-3"
          title={t("pax-unagreed-title")}
          description={t("pax-unagreed-body", { days: read.days })}
          chip={<StatusChip tone="attention" label={t("pax-unagreed-chip", { count: read.travelers.length })} />}
        />
        <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
          {read.travelers.map((traveler) => (
            <Box component="li" key={traveler.id}>
              <StateLine
                tone="attention"
                action={
                  <Button
                    component={Link}
                    href={`/parceiro/passageiros/${traveler.id}#acordo`}
                    variant="outlined"
                    color="grey"
                    size="small"
                  >
                    {traveler.linkUntil || traveler.reagree ? t("pax-unagreed-open") : t("pax-unagreed-send")}
                  </Button>
                }
              >
                <strong>{traveler.fullName}</strong> ·{" "}
                {t("pax-unagreed-flies", { date: unagreedDepartureLabel(traveler) })}. {t(unagreedLineKey(traveler))}
              </StateLine>
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
