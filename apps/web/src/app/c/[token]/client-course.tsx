"use client";

import { ClientSection, SectionFrame } from "./client-section";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Box, Button, Typography } from "@mui/material";

import FactGrid from "@/components/product/fact-grid";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiScale from "@/icons/nexture/ni-scale";
import type { ClientLawsuit } from "@/lib/cases/client-link";
import {
  isHearingKind,
  isHearingZone,
  KIND_KEY as HEARING_KIND_KEY,
  momentIn,
  ZONE_KEY,
} from "@/lib/hearings/hearings";
import type { ClientPublicationNews } from "@/lib/publications/actions-read";
import { formatCnj } from "@flyee/rules/cnj";
import { formatDayBr } from "@flyee/rules/person";

/** How many lines of what happened the lawsuit's card shows: the latest. */
const TIMELINE_SHOWN = 8;

/** What the firm asks of the client in its explanations of the court's publications, the latest first. */
export function firmAsks(news: ClientPublicationNews[]): string[] {
  return [...new Set(news.slice(0, 5).flatMap((item) => item.asks))];
}

/**
 * The next hearing of the client's lawsuits, first on the page once the court has one, with what the firm asks of
 * them for it (the owner, 2026-11-13: the firm's "separe um documento com foto" sat in the fifth card, far from the
 * hearing's date) and the one way to be there.
 */
export function ClientHearing({ lawsuits, news }: { lawsuits: ClientLawsuit[]; news: ClientPublicationNews[] }) {
  const t = useTranslations("product");
  const next = lawsuits
    .map((lawsuit) => lawsuit.next_hearing)
    .filter((hearing): hearing is NonNullable<ClientLawsuit["next_hearing"]> => hearing !== null)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
  if (!next) return null;
  const when = momentIn(next.starts_at, next.time_zone);
  const asks = firmAsks(news);
  const kind = t(isHearingKind(next.kind) ? HEARING_KIND_KEY[next.kind] : "hearing-kind-outra");
  const zone = isHearingZone(next.time_zone) ? t(ZONE_KEY[next.time_zone]) : null;
  return (
    <ClientSection
      id="client-hearing"
      icon={<NiCalendar size="medium" />}
      tone="primary"
      title={t("client-hearing-title")}
      chip={
        asks.length > 0 ? (
          <StatusChip tone="attention" label={t("client-hearing-chip-asks")} />
        ) : (
          <StatusChip tone="info" label={t("client-hearing-chip-set")} />
        )
      }
    >
      <Box className="flex flex-col gap-0.5">
        <Typography variant="body1" className="font-semibold">
          {t("client-hearing-when", { weekday: when.weekday, day: when.day, time: when.time })}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {[kind, zone].filter(Boolean).join(" · ")}
        </Typography>
      </Box>
      {asks.map((ask) => (
        <StateLine key={ask} tone="attention" emphasis>
          {t("client-firm-asks", { text: ask })}
        </StateLine>
      ))}
      {next.link ? (
        <Box>
          <Button variant="contained" href={next.link} target="_blank" rel="noreferrer noopener">
            {t("client-hearing-join")}
          </Button>
        </Box>
      ) : next.place ? (
        <Typography variant="body2">{t("client-course-place", { place: next.place })}</Typography>
      ) : (
        <Typography variant="body2" className="text-text-secondary">
          {t("client-course-ask-how")}
        </Typography>
      )}
    </ClientSection>
  );
}

type Happening = { key: string; at: string; day: string; text: string; explained: boolean };

/**
 * The client's lawsuits in one card (the owner, 2026-11-13, who found the lawsuit spread over four cards): each
 * lawsuit's facts under their names, one line of what happened that joins what the firm explained of the court's
 * publications and what the court registered, the judgment and the values once they come (`children`), and the
 * warning against the scam of the fake lawyer always at its foot. Nothing here is the firm's reading of the lawsuit
 * but what a person of the firm wrote.
 */
export function ClientProcess({
  lawsuits,
  news,
  asksAbove,
  children,
}: {
  lawsuits: ClientLawsuit[];
  news: ClientPublicationNews[];
  /** The firm's asks are said in the hearing's card above; with no hearing, here. */
  asksAbove: boolean;
  /** The judgment and the values, each under its own sub-heading. */
  children?: ReactNode;
}) {
  const t = useTranslations("product");
  if (lawsuits.length === 0) return null;
  const closed = lawsuits.every((lawsuit) => lawsuit.status === "closed");
  const asks = asksAbove ? [] : firmAsks(news);

  const happenings: Happening[] = [
    ...news.map((item) => ({
      key: `news-${item.id}`,
      at: item.on,
      day: item.on ? item.on.split("-").reverse().slice(0, 2).join("/") : "",
      text: item.summary,
      explained: true,
    })),
    ...lawsuits.flatMap((lawsuit) =>
      lawsuit.movements.map((movement, index) => ({
        key: `movement-${lawsuit.id}-${index}`,
        at: movement.occurred_at,
        day: momentIn(movement.occurred_at, lawsuit.time_zone).day.slice(0, 5),
        text: movement.title,
        explained: false,
      })),
    ),
  ]
    .sort((a, b) => b.at.slice(0, 10).localeCompare(a.at.slice(0, 10)))
    .slice(0, TIMELINE_SHOWN);

  return (
    <ClientSection
      id="client-course"
      icon={<NiScale size="medium" />}
      tone="primary"
      title={t("client-course-title")}
      chip={
        <StatusChip
          tone={closed ? "neutral" : "info"}
          label={t(closed ? "client-course-chip-closed" : "client-course-chip-court")}
        />
      }
    >
      {asks.map((ask) => (
        <StateLine key={ask} tone="attention" emphasis>
          {t("client-firm-asks", { text: ask })}
        </StateLine>
      ))}
      {lawsuits.map((lawsuit) => (
        <Box key={lawsuit.id} className="flex flex-col gap-2">
          {lawsuits.length > 1 ? (
            <Typography variant="subtitle2" component="h3" className="mb-0">
              {t("client-course-lawsuit", { number: formatCnj(lawsuit.cnj) ?? lawsuit.cnj })}
            </Typography>
          ) : null}
          <FactGrid
            pairs
            facts={[
              {
                key: "number",
                label: t("client-course-fact-number"),
                value: formatCnj(lawsuit.cnj) ?? lawsuit.cnj,
                wide: true,
              },
              { key: "court", label: t("client-course-fact-court"), value: lawsuit.court },
              { key: "comarca", label: t("client-course-fact-comarca"), value: lawsuit.comarca },
              {
                key: "filed",
                label: t("client-course-fact-filed"),
                value: lawsuit.filed_at ? formatDayBr(lawsuit.filed_at) : null,
              },
            ]}
          />
          {lawsuit.status === "closed" ? <StateLine tone="info">{t("client-course-closed")}</StateLine> : null}
        </Box>
      ))}

      <Box className="border-grey-100 flex flex-col gap-1 border-t pt-3">
        <Typography variant="subtitle2" component="h3" className="mb-1">
          {t("client-course-timeline")}
        </Typography>
        {happenings.length === 0 ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("client-course-movements-none")}
          </Typography>
        ) : (
          <Box component="ol" className="m-0 flex list-none flex-col p-0">
            {happenings.map((item) => (
              <Box component="li" key={item.key} className="flex gap-3 py-1.5">
                <Typography variant="body2" className="text-text-secondary w-12 flex-none">
                  {item.day}
                </Typography>
                <Typography variant="body2" component="div" className="min-w-0 break-words">
                  {item.explained ? (
                    <>
                      <span className="font-semibold">{item.text}</span>{" "}
                      <span className="text-text-secondary">{t("client-course-explained")}</span>
                    </>
                  ) : (
                    item.text
                  )}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {children ? (
        <Box className="border-grey-100 flex flex-col gap-4 border-t pt-4 empty:hidden">
          <SectionFrame titles>{children}</SectionFrame>
        </Box>
      ) : null}

      <Box className="border-grey-100 border-t pt-3">
        <StateLine tone="attention">{t("client-course-scam")}</StateLine>
      </Box>
    </ClientSection>
  );
}
