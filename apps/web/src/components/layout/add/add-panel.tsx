"use client";

import NextLink from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import DeadlinePanel from "@/components/deadlines/deadline-panel";
import HearingPanel from "@/components/hearings/hearing-panel";
import CaseLawsuitPicker, { type PickedLawsuit } from "@/components/layout/add/case-lawsuit-picker";
import OutcomeDialog, { type OutcomeLine } from "@/components/product/outcome-dialog";
import StateLine from "@/components/product/state-line";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiFolder from "@/icons/nexture/ni-folder";
import { type AddContext, readAddContext } from "@/lib/add/actions";
import { formatDayBr } from "@flyee/rules/person";

/** What the "Adicionar" of the top makes today; the finance and the people join with their phases. */
export type AddKind = "deadline" | "hearing";

type Context = { kind: "loading" } | { kind: "ready"; value: AddContext } | { kind: "error" };
type Outcome = { title: string; lines: OutcomeLine[] };

/**
 * A new deadline or hearing made from the "Adicionar" of the top (the screen pattern of 2026-11-07), wherever the
 * person is: the same panel the case opens, with the case and the lawsuit asked first. Once saved, what now holds is
 * said in front of the person, with the way to the case, since the page behind may be another one.
 */
export default function AddPanel({ kind, onClose }: { kind: AddKind; onClose: () => void }) {
  const t = useTranslations("product");
  const [context, setContext] = useState<Context>({ kind: "loading" });
  const [lawsuit, setLawsuit] = useState<PickedLawsuit | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    let live = true;
    readAddContext()
      .then((answer) => {
        if (live) setContext(answer.ok ? { kind: "ready", value: answer.context } : { kind: "error" });
      })
      .catch(() => {
        if (live) setContext({ kind: "error" });
      });
    return () => {
      live = false;
    };
  }, []);

  if (outcome) {
    return (
      <OutcomeDialog open title={outcome.title} lines={outcome.lines} closeLabel={t("add-done")} onClose={onClose} />
    );
  }

  const ready = context.kind === "ready" ? context.value : null;
  // The lawsuit reaches the form only once its lists are read, so the form never opens on empty ones.
  const chosen = ready ? lawsuit : null;
  const lead = (
    <>
      <CaseLawsuitPicker onLawsuit={setLawsuit} />
      {context.kind === "error" ? <StateLine tone="failed">{t("add-context-error")}</StateLine> : null}
    </>
  );
  const caseLine = (picked: PickedLawsuit): OutcomeLine => ({
    key: "case",
    icon: <NiFolder size="small" />,
    text: (
      <>
        {t("add-done-case", { client: picked.caseName })}{" "}
        <NextLink href={`/casos/${picked.caseId}`} onClick={onClose} className="text-primary font-semibold underline">
          {t("add-done-open-case")}
        </NextLink>
      </>
    ),
  });

  return kind === "deadline" ? (
    <DeadlinePanel
      panelTitle={t("add-deadline")}
      acts={ready?.acts ?? []}
      subject={chosen ? { kind: "lawsuit", proceedingId: chosen.id, proceedingKind: chosen.kind } : undefined}
      lead={lead}
      onClose={onClose}
      onSaved={(saved) => {
        if (!chosen) return onClose();
        setOutcome({
          title: t("add-done-deadline-title"),
          lines: [
            {
              key: "due",
              icon: <NiCalendarClock size="small" />,
              text: saved.dueOn
                ? t("deadline-proposed-notice", { day: formatDayBr(saved.dueOn) ?? saved.dueOn })
                : t("deadline-proposed-notice-counting"),
            },
            caseLine(chosen),
          ],
        });
      }}
    />
  ) : (
    <HearingPanel
      panelTitle={t("add-hearing")}
      colleagues={ready?.colleagues ?? []}
      subject={
        chosen
          ? {
              proceedingId: chosen.id,
              lawsuitLabel: chosen.label,
              zones: chosen.court ? (ready?.zones[chosen.court] ?? null) : null,
            }
          : undefined
      }
      lead={lead}
      onClose={onClose}
      onSaved={() => {
        if (!chosen) return onClose();
        setOutcome({
          title: t("add-done-hearing-title"),
          lines: [
            { key: "agenda", icon: <NiCalendar size="small" />, text: t("hearing-scheduled-notice") },
            caseLine(chosen),
          ],
        });
      }}
    />
  );
}
