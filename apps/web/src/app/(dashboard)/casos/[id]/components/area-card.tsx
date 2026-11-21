"use client";

import type { CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import FactGrid from "@/components/product/fact-grid";
import SectionTitle from "@/components/product/section-title";
import StateLine from "@/components/product/state-line";
import { markCaseTask } from "@/lib/areas/case-task-actions";

type Ready = Extract<CaseState, { kind: "ready" }>;

/**
 * The area of a case of an area of the firm (migrations 0273, 0274): what the client's case is, the version of the
 * area's script it follows, its stages over the common way of a case, and the work outside the lawsuit, each said as
 * the client's or the firm's, with the person of the firm marking it done. What ONE does in every case (the
 * documents, the pieces, the notices) is ONE's, on its own cards.
 */
export default function AreaCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const area = state.case.area;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!area) return null;

  const owed = area.tasks.filter((task) => !task.doneAt);
  const mark = async (taskId: string, done: boolean) => {
    setError(null);
    setBusy(taskId);
    const answer = await markCaseTask({ caseId: state.case.id, taskId, done }).catch(() => ({
      ok: false as const,
      code: "failed",
    }));
    setBusy(null);
    if (!answer.ok) {
      setError(t("case-area-task-error"));
      return;
    }
    onChanged();
  };

  return (
    <CollapsibleCard
      id="case-area"
      title={t("case-area-title", { area: area.name })}
      description={t("case-area-info")}
      summary={owed.length > 0 ? t("case-area-summary-owed", { count: owed.length }) : (area.typeName ?? undefined)}
      summaryClosedOnly
      defaultOpen={owed.length > 0}
      bodyClassName="gap-4"
    >
      <FactGrid
        facts={[
          { key: "type", label: t("case-area-type"), value: area.typeName },
          {
            key: "version",
            label: t("case-area-version"),
            value: area.version !== null ? t("case-area-version-value", { version: area.version }) : null,
          },
          ...(state.case.summary
            ? [{ key: "note", label: t("case-area-note"), value: state.case.summary, wide: true }]
            : []),
        ]}
      />

      {area.stages.length > 0 ? (
        <Box component="section" className="flex flex-col gap-2" aria-labelledby="case-area-stages">
          <SectionTitle
            id="case-area-stages"
            title={t("case-area-stages-title")}
            description={t("case-area-stages-info")}
            as="h3"
            variant="subtitle2"
          />
          <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
            {area.stages.map((stage) => (
              <Typography component="li" variant="body2" key={stage.key}>
                {t("area-script-stage-line", { name: stage.name, phase: t(`area-script-phase-${stage.phase}`) })}
              </Typography>
            ))}
          </Box>
        </Box>
      ) : null}

      {area.tasks.length > 0 ? (
        <Box component="section" className="flex flex-col gap-2" aria-labelledby="case-area-tasks">
          <SectionTitle
            id="case-area-tasks"
            title={t("case-area-tasks-title")}
            description={t("case-area-tasks-info")}
            as="h3"
            variant="subtitle2"
          />
          <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
            {area.tasks.map((task) => (
              <Box component="li" key={task.id}>
                <StateLine
                  tone={task.doneAt ? "done" : task.who === "cliente" ? "waiting" : "attention"}
                  action={
                    writable ? (
                      <Button
                        size="small"
                        variant={task.doneAt ? "text" : "outlined"}
                        disabled={busy !== null}
                        onClick={() => void mark(task.id, !task.doneAt)}
                      >
                        {task.doneAt ? t("case-area-task-reopen") : t("case-area-task-done")}
                      </Button>
                    ) : undefined
                  }
                >
                  {t(task.doneAt ? "case-area-task-line-done" : "case-area-task-line", {
                    name: task.name,
                    who: t(`area-script-worker-${task.who}`),
                    phase: t(`area-script-phase-${task.phase}`),
                  })}
                </StateLine>
              </Box>
            ))}
          </Box>
        </Box>
      ) : null}

      {error ? <StateLine tone="failed">{error}</StateLine> : null}
    </CollapsibleCard>
  );
}
