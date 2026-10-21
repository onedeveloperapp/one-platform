"use client";

import { useTranslations } from "next-intl";

import { Alert, Box, Card, CardContent, Typography } from "@mui/material";

import type { ClientLawsuit } from "@/lib/cases/client-link";
import {
  isHearingKind,
  isHearingZone,
  KIND_KEY as HEARING_KIND_KEY,
  momentIn,
  ZONE_KEY,
} from "@/lib/hearings/hearings";
import { formatCnj } from "@flyee/rules/cnj";
import { formatDayBr } from "@flyee/rules/person";

/**
 * The client's lawsuits, as their link shows them once the court has one:
 * its number and court, the next hearing with how to be there, and what the
 * court registered last, in the court's own words. Under them, always, the
 * warning against the scam of the fake lawyer: the firm never asks for money
 * to release a value. Nothing here is the firm's reading of the lawsuit: a
 * person of the firm explains what a movement means.
 */
export default function ClientCourse({ lawsuits }: { lawsuits: ClientLawsuit[] }) {
  const t = useTranslations("product");
  if (lawsuits.length === 0) return null;
  return (
    <Card component="section" aria-labelledby="client-course">
      <CardContent className="flex flex-col gap-4">
        <Typography id="client-course" variant="h5" component="h2" className="mb-0">
          {t("client-course-title")}
        </Typography>
        <Box component="ul" className="m-0 flex list-none flex-col gap-4 p-0">
          {lawsuits.map((lawsuit) => (
            <Lawsuit key={lawsuit.id} lawsuit={lawsuit} />
          ))}
        </Box>
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          {t("client-course-scam")}
        </Alert>
      </CardContent>
    </Card>
  );
}

function Lawsuit({ lawsuit }: { lawsuit: ClientLawsuit }) {
  const t = useTranslations("product");
  const next = lawsuit.next_hearing;
  const when = next ? momentIn(next.starts_at, next.time_zone) : null;
  const facts = [
    lawsuit.court,
    lawsuit.comarca,
    lawsuit.filed_at ? t("client-course-filed", { day: formatDayBr(lawsuit.filed_at) ?? lawsuit.filed_at }) : null,
  ].filter(Boolean);
  return (
    <Box component="li" className="border-grey-100 flex flex-col gap-3 rounded-lg border p-3">
      <Box className="flex flex-col gap-1">
        <Typography variant="subtitle2" component="h3" className="mb-0 break-words">
          {t("client-course-lawsuit", { number: formatCnj(lawsuit.cnj) ?? lawsuit.cnj })}
        </Typography>
        {facts.length > 0 ? (
          <Typography variant="body2" className="text-text-secondary">
            {facts.join(" · ")}
          </Typography>
        ) : null}
        {lawsuit.status === "closed" ? <Typography variant="body2">{t("client-course-closed")}</Typography> : null}
      </Box>

      {next && when ? (
        <Box className="flex flex-col gap-1">
          <Typography variant="body1" className="font-semibold">
            {t("client-course-next-hearing", {
              kind: t(isHearingKind(next.kind) ? HEARING_KIND_KEY[next.kind] : "hearing-kind-outra"),
              weekday: when.weekday,
              day: when.day,
              time: when.time,
            })}
          </Typography>
          {isHearingZone(next.time_zone) ? (
            <Typography variant="body2" className="text-text-secondary">
              {t(ZONE_KEY[next.time_zone])}
            </Typography>
          ) : null}
          {next.link ? (
            <Typography variant="body2" className="break-all">
              {t("client-course-link")}{" "}
              <a href={next.link} target="_blank" rel="noreferrer noopener">
                {next.link}
              </a>
            </Typography>
          ) : null}
          {next.place ? (
            <Typography variant="body2">{t("client-course-place", { place: next.place })}</Typography>
          ) : null}
          {!next.link && !next.place ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("client-course-ask-how")}
            </Typography>
          ) : null}
        </Box>
      ) : null}

      <Box className="flex flex-col gap-1">
        <Typography variant="body2" className="font-semibold">
          {t("client-course-movements")}
        </Typography>
        {lawsuit.movements.length === 0 ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("client-course-movements-none")}
          </Typography>
        ) : (
          <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
            {lawsuit.movements.map((movement, index) => (
              <Typography key={index} component="li" variant="body2" className="break-words">
                {`${momentIn(movement.occurred_at, lawsuit.time_zone).day} · ${movement.title}`}
              </Typography>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
