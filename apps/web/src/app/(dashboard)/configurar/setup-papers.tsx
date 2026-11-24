"use client";

import { refusalWords } from "../biblioteca/import-panel";
import { useTranslations } from "next-intl";

import { Box, Button, Typography } from "@mui/material";

import type { ItemRow } from "@/components/product/item-rows";
import StateLine from "@/components/product/state-line";
import WordDownloadButton from "@/components/product/word-download-button";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiDocumentNumber from "@/icons/nexture/ni-document-number";
import NiLoader from "@/icons/nexture/ni-loader";
import NiUploadCloud from "@/icons/nexture/ni-upload-cloud";
import { readDraftTemplate } from "@/lib/library/actions";
import type { SetupPaper } from "@/lib/library/facts";
import type { PaperImport } from "@/lib/library/import-read";
import { IMPORT_WORKING, importFailureKey } from "@/lib/library/imports";

export type Paper = "procuracao" | "contrato";

/** The words of each paper: its name, and how a person writes the firm's from what ONE has. */
const PAPER_WORDS: Record<Paper, { title: string; make: string }> = {
  procuracao: { title: "setup-papers-procuracao", make: "setup-papers-procuracao-make" },
  contrato: { title: "setup-papers-contrato", make: "setup-papers-contrato-make" },
};

/** What a request that waits for the person says, and its button. */
const WAITS_WORDS = {
  asking: { state: "setup-papers-request-asking", action: "setup-papers-answer" },
  ready: { state: "setup-papers-request-ready", action: "setup-papers-review" },
} as const;

/** The state of the firm's own model, by who made it. */
const OWN_WORDS = { one: "setup-papers-row-own-one", person: "setup-papers-row-own" } as const;

/**
 * The lines of the papers a client signs, in the step "O escritório" (the owner's canvas of 2026-11-24: the step of
 * the papers asked the power of attorney and the address a second time): each paper says where it stands and holds
 * its one button. What ONE does with a document the firm sent (0079) is said while it lasts, with the next thing to
 * do (follow it, answer, check the model, send another after a refusal); then the model ONE sends, the firm's or the
 * platform's provisional one, with the rest (the powers ONE read, opening or writing the model, the Word file) one
 * click away in the line. Every button opens over the step: nothing leads away. Only a partner or a lawyer writes the
 * models.
 */
export function usePaperRows(input: {
  papers: { procuracao: SetupPaper; contrato: SetupPaper } | null;
  imports: { procuracao: PaperImport | null; contrato: PaperImport | null };
  /** Who answers writes the models: a partner or a lawyer. */
  writes: boolean;
  blocked: boolean;
  onSend: (paper: Paper) => void;
  onFollow: (paper: Paper, requestId: string) => void;
  onOpenModel: (paper: Paper, choice: SetupPaper) => void;
  onRetry: () => void;
}): ItemRow[] {
  const t = useTranslations("product");
  const papers = input.papers;
  if (papers === null) {
    return [
      {
        key: "papeis",
        icon: <NiDocumentCheck size="medium" />,
        tone: "primary",
        title: t("setup-papers-title"),
        state: { tone: "failed", text: t("setup-papers-load-error") },
        action: (
          <Button variant="outlined" size="small" onClick={input.onRetry}>
            {t("today-retry")}
          </Button>
        ),
      },
    ];
  }

  return (["procuracao", "contrato"] as const).map((paper): ItemRow => {
    const choice = papers[paper];
    const used = choice.used;
    const own = used && !used.platform ? used : null;
    const request = input.imports[paper];
    const sends = input.writes && !input.blocked;
    const words = PAPER_WORDS[paper];
    const base = {
      key: paper,
      icon: paper === "procuracao" ? <NiDocumentCheck size="medium" /> : <NiDocumentNumber size="medium" />,
      tone: "primary" as const,
      title: t(words.title),
    };
    const sendButton = (label: string, outlined = true) =>
      sends ? (
        <Button
          variant={outlined ? "outlined" : "text"}
          color={outlined ? "primary" : "grey"}
          size="small"
          startIcon={outlined ? <NiUploadCloud size="small" /> : undefined}
          onClick={() => input.onSend(paper)}
        >
          {label}
        </Button>
      ) : undefined;

    // What ONE does with the document the firm sent, while it lasts.
    if (request) {
      const working = IMPORT_WORKING.includes(request.status);
      if (working)
        return {
          ...base,
          // Its mark turns while ONE works (2026-11-21): the step shows something is happening.
          state: {
            tone: "waiting",
            text: t("setup-papers-request-working", { file: request.fileName }),
            icon: <NiLoader size="medium" className="animate-spin motion-reduce:animate-none" />,
          },
          action: (
            <Button variant="text" color="grey" size="small" onClick={() => input.onFollow(paper, request.id)}>
              {t("setup-papers-follow")}
            </Button>
          ),
        };
      if (request.status === "asking" || request.status === "ready") {
        const words = WAITS_WORDS[request.status];
        return {
          ...base,
          state: { tone: "attention", text: t(words.state, { file: request.fileName }) },
          action: (
            <Button variant="outlined" size="small" onClick={() => input.onFollow(paper, request.id)}>
              {t(words.action)}
            </Button>
          ),
        };
      }
      if (request.status === "refused" || request.status === "failed")
        return {
          ...base,
          state:
            request.status === "refused"
              ? { tone: "attention", text: refusalWords(t, request.refusal, paper) }
              : {
                  tone: "failed",
                  text: t("setup-papers-request-failed", {
                    file: request.fileName,
                    why: t(importFailureKey(request.failure)),
                  }),
                },
          action: sendButton(t("setup-papers-send-again")),
        };
    }

    // The model ONE sends: the rest of what can be done with it, one click away in the line.
    const can = input.writes && !input.blocked && (own !== null || choice.platform !== null || paper === "contrato");
    const more =
      choice.powers || can || used
        ? () => (
            <Box className="flex flex-col gap-3">
              {choice.powers ? (
                <Box className="flex flex-col gap-1">
                  <StateLine tone={choice.powers.discharge ? "done" : "attention"}>
                    {t(
                      choice.powers.discharge ? "setup-papers-power-discharge" : "setup-papers-power-discharge-missing",
                    )}
                  </StateLine>
                  <StateLine tone={choice.powers.hardship ? "done" : "attention"}>
                    {t(choice.powers.hardship ? "setup-papers-power-hardship" : "setup-papers-power-hardship-missing")}
                  </StateLine>
                  <Typography variant="caption" className="text-text-secondary">
                    {t("setup-papers-powers-read")}
                  </Typography>
                </Box>
              ) : null}
              {can || used ? (
                <Box className="flex flex-wrap gap-2">
                  {can ? (
                    <Button variant="text" color="grey" size="small" onClick={() => input.onOpenModel(paper, choice)}>
                      {own ? t("setup-papers-open") : t(words.make)}
                    </Button>
                  ) : null}
                  {used ? (
                    <WordDownloadButton
                      name={used.name}
                      letterhead
                      read={() => readDraftTemplate(used.id).then((read) => (read.ok ? read.body : null))}
                    />
                  ) : null}
                </Box>
              ) : null}
            </Box>
          )
        : undefined;
    const opener = { content: more, openLabel: t("setup-papers-more", { paper: t(words.title) }) };

    const ownKey = OWN_WORDS[own?.preparedByOne ? "one" : "person"];
    if (own)
      return {
        ...base,
        ...opener,
        detail: own.name,
        state: { tone: "done", text: t(ownKey) },
        action: sendButton(t("setup-office-replace"), false),
      };
    if (paper === "procuracao" && used)
      return {
        ...base,
        ...opener,
        detail: t("setup-papers-row-platform-detail"),
        state: { tone: "attention", text: t("setup-papers-row-platform") },
        action: sendButton(t("setup-office-send")),
      };
    return {
      ...base,
      ...opener,
      detail: input.writes ? undefined : t("setup-papers-not-lawyer"),
      state:
        paper === "contrato"
          ? { tone: "info", text: t("setup-papers-row-no-contract") }
          : { tone: "attention", text: t("setup-papers-row-none") },
      action: sendButton(t("setup-office-send")),
    };
  });
}
