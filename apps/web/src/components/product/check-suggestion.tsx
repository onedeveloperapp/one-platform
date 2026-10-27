"use client";

import { useTranslations } from "next-intl";

import { Box, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiSparkle from "@/icons/nexture/ni-sparkle";
import { type CheckAnswer, localMoment } from "@/lib/cases/document-check";
import { cn } from "@/lib/utils";
import { formatCep, formatCpf } from "@flyee/fields";
import { formatDayBr } from "@flyee/rules/person";

const MATCH_KEY: Record<CheckAnswer["matches"], string> = {
  sim: "check-suggestion-match-yes",
  nao: "check-suggestion-match-no",
  sem_nome: "check-suggestion-match-none",
};

/**
 * What the AI read in a document and suggests doing with it, as a person
 * reads it before deciding: the suggestion named (accept or refuse), the
 * reason the client would read, what the file turned out to be, the name on
 * it, what it says of its person (the CPF, the birth date, the nationality,
 * the address), and the legs of the trip it carries. It decides nothing: the card that
 * holds it offers the decision.
 *
 * Closest catalog shape: the tinted icon box of `TILE_TONE` with a
 * `StatusChip` for the state, as the home tiles use them. Nothing existing
 * carried a suggestion with its facts (`AnswerFields` is the generic list of
 * any answer, with no words of its own), so this is the view of this task's
 * answer that `AnswerFields` says a task may have.
 */
export default function CheckSuggestion({ answer, className }: { answer: CheckAnswer; className?: string }) {
  const t = useTranslations("product");
  const refuse = answer.decision === "recusar";
  const tone = TILE_TONE["accent-4"];
  const data = answer.data;
  const address = data
    ? [
        [data.street, data.number].filter(Boolean).join(", "),
        data.complement,
        data.district,
        [data.city, data.uf].filter(Boolean).join("/"),
        data.postalCode ? formatCep(data.postalCode) : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const facts: { key: string; label: string; value: string }[] = [
    { key: "identified", label: t("check-suggestion-identified"), value: answer.identified },
    {
      key: "legible",
      label: t("check-suggestion-legible"),
      value: answer.legible ? t("check-suggestion-yes") : t("check-suggestion-no"),
    },
    { key: "name", label: t("check-suggestion-name"), value: answer.nameOnDocument },
    { key: "match", label: t("check-suggestion-match"), value: t(MATCH_KEY[answer.matches]) },
    // What the document says of its person (migration 0063): written where the record has nothing, once accepted.
    { key: "cpf", label: t("check-suggestion-cpf"), value: data?.cpf ? formatCpf(data.cpf) : "" },
    { key: "birth", label: t("check-suggestion-birth-date"), value: formatDayBr(data?.birthDate) ?? "" },
    { key: "nationality", label: t("check-suggestion-nationality"), value: data?.nationality ?? "" },
    { key: "address", label: t("check-suggestion-address"), value: address },
    { key: "notes", label: t("check-suggestion-notes"), value: answer.notes },
  ].filter((fact) => fact.value !== "");

  return (
    <Box className={cn("border-grey-100 flex flex-col gap-3 rounded-2xl border p-4", className)}>
      <Box className="flex flex-wrap items-center gap-3">
        <Box className={cn("flex h-9 w-9 flex-none items-center justify-center rounded-xl", tone.bg, tone.text)}>
          <NiSparkle size="medium" />
        </Box>
        <Typography variant="subtitle2" component="p" className="mb-0 min-w-0 flex-1">
          {t("check-suggestion-title")}
        </Typography>
        <StatusChip
          tone={refuse ? "attention" : "positive"}
          label={refuse ? t("check-suggestion-refuse") : t("check-suggestion-accept")}
        />
      </Box>

      {refuse && answer.reason ? (
        <Typography variant="body1" className="text-text-primary">
          {t("check-suggestion-reason", { reason: answer.reason })}
        </Typography>
      ) : null}

      {facts.length > 0 ? (
        <Box component="dl" className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {facts.map((fact) => (
            <Box key={fact.key} className="flex min-w-0 flex-col">
              <Typography component="dt" variant="body2" className="text-text-secondary">
                {fact.label}
              </Typography>
              <Typography component="dd" variant="body1" className="text-text-primary m-0 break-words">
                {fact.value}
              </Typography>
            </Box>
          ))}
        </Box>
      ) : null}

      {answer.legs.length > 0 ? (
        <Box className="flex flex-col gap-1">
          <Typography variant="body2" className="text-text-secondary">
            {t("check-suggestion-legs", { count: answer.legs.length })}
          </Typography>
          <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
            {answer.legs.map((leg, index) => (
              <Typography component="li" variant="body1" key={`${leg.flight}-${index}`} className="text-text-primary">
                {[
                  leg.flight,
                  leg.origin && leg.destination
                    ? t("check-suggestion-route", { origin: leg.origin, destination: leg.destination })
                    : null,
                  leg.departure ? localMoment(leg.departure) : null,
                  leg.booking ? t("check-suggestion-booking", { code: leg.booking }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Typography>
            ))}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
