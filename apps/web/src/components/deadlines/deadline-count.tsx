"use client";

import { useTranslations } from "next-intl";

import { Alert, Box, Typography } from "@mui/material";

import { ASSUMPTION_KEY, localDaysToProve, SKIP_KEY } from "@/lib/deadlines/deadlines";
import type { DeadlineAssumption, DeadlineCounting, DeadlineResult } from "@flyee/rules/deadlines";
import { formatDayBr } from "@flyee/rules/person";

const day = (value: string): string => formatDayBr(value) ?? value;

const DAYS_KEY: Record<DeadlineCounting, string> = {
  business: "deadline-count-days-business",
  calendar: "deadline-count-days-calendar",
};

const SCOPE_KEY: Record<"proceeding_kind" | "system", string> = {
  proceeding_kind: "deadline-scope-kind",
  system: "deadline-scope-system",
};

/**
 * How the rule counted a deadline, in a person's words: the day it ran from,
 * how many days and from when, every day that did not count and why, a last
 * day that moved, the days of the court's own calendar a recurso proves when
 * it is filed (CPC, art. 1.003, § 6º), and what the count could not know,
 * each said as what it would change, and when the court's calendar it went
 * through was checked against the court's acts. It is what the person who
 * confirms reads before confirming.
 *
 * Closest component: the explanation list of the rules card of a case
 * (`casos/[id]/components/rules-card.tsx`), which says the grounds of what a
 * rule gave; a count has its own parts, so it is its own list.
 */
export default function DeadlineCount({
  count,
  checked,
  act,
}: {
  count: DeadlineResult;
  /** The checked years of the court's calendar as they are now, when known: a year checked again since the count says its latest day. */
  checked?: readonly { year: number; checkedOn: string | null }[];
  /** The act of the deadline, when it has one: a recurso proves the court's own days its term went past. */
  act?: string | null;
}) {
  const t = useTranslations("product");
  const proofs = localDaysToProve(act, count);
  const checkedYears = (checked ?? count.checkedYears).filter((year) => year.checkedOn !== null);
  const lines: string[] = [
    count.trigger === "publication" && count.publishedOn
      ? t("deadline-count-published", { available: day(count.triggerDay), published: day(count.publishedOn) })
      : t("deadline-count-from-day", { day: day(count.fromDay) }),
    t(DAYS_KEY[count.counting], {
      count: count.days,
      start: day(count.startsOn),
    }),
  ];
  const skipped = count.skipped.map((skip) =>
    t(SKIP_KEY[skip.reason], {
      days:
        skip.from === skip.to ? day(skip.from) : t("deadline-count-range", { from: day(skip.from), to: day(skip.to) }),
      label: skip.label,
    }),
  );
  const movedKey = !count.moved
    ? null
    : count.moved.reason === "partial"
      ? "deadline-count-moved-partial"
      : count.moved.label
        ? "deadline-count-moved-closed"
        : "deadline-count-moved-weekend";
  const moved =
    count.moved && movedKey
      ? t(movedKey, { from: day(count.moved.from), to: day(count.moved.to), label: count.moved.label })
      : null;

  return (
    <Box className="flex flex-col gap-2">
      <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
        {lines.map((line, index) => (
          <Typography key={index} component="li" variant="body2">
            {line}
          </Typography>
        ))}
        {skipped.length > 0 ? (
          <Typography component="li" variant="body2">
            {t("deadline-count-skipped", { days: skipped.join("; ") })}
          </Typography>
        ) : null}
        {moved ? (
          <Typography component="li" variant="body2">
            {moved}
          </Typography>
        ) : null}
        {proofs.length > 0 ? (
          <Typography component="li" variant="body2">
            {t("deadline-count-local-proof", {
              days: proofs
                .map((proof) =>
                  t("deadline-count-local-proof-day", {
                    days:
                      proof.from === proof.to
                        ? day(proof.from)
                        : t("deadline-count-range", { from: day(proof.from), to: day(proof.to) }),
                    label: proof.label,
                  }),
                )
                .join("; "),
            })}
          </Typography>
        ) : null}
        {checkedYears.length > 0 ? (
          <Typography component="li" variant="body2">
            {t("deadline-count-checked", {
              years: checkedYears
                .map((year) => t("deadline-count-checked-year", { year: year.year, day: day(year.checkedOn ?? "") }))
                .join("; "),
            })}
          </Typography>
        ) : null}
      </Box>
      {count.assumptions.length > 0 ? <DeadlineAssumptions assumptions={count.assumptions} /> : null}
    </Box>
  );
}

/** What the count could not know, each said as what it would change: for the person who confirms to weigh. */
export function DeadlineAssumptions({ assumptions }: { assumptions: readonly DeadlineAssumption[] }) {
  const t = useTranslations("product");
  const words = (assumption: DeadlineAssumption): string => {
    switch (assumption.code) {
      case "calendar_unchecked":
      case "local_days_unchecked":
        return t(ASSUMPTION_KEY[assumption.code], { years: assumption.years.join(", ") });
      case "scope_unknown":
        return t(ASSUMPTION_KEY[assumption.code], {
          what: t(SCOPE_KEY[assumption.what]),
          days: assumption.days.map(day).join(", "),
        });
      case "partial_start":
        return t(ASSUMPTION_KEY[assumption.code], { day: day(assumption.day), label: assumption.label });
      case "start_not_business":
      case "portal_first":
        return t(ASSUMPTION_KEY[assumption.code], { day: day(assumption.day) });
      default:
        return t(ASSUMPTION_KEY[assumption.code]);
    }
  };
  return (
    <Alert severity="info" className="neutral bg-background-paper/60!">
      <Typography variant="body2" className="mb-1 font-semibold">
        {t("deadline-assumptions-title")}
      </Typography>
      <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
        {assumptions.map((assumption, index) => (
          <Typography key={index} component="li" variant="body2">
            {words(assumption)}
          </Typography>
        ))}
      </Box>
    </Alert>
  );
}
