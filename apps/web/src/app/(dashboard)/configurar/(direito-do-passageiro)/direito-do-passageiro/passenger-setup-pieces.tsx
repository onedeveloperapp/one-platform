"use client";

import { refusalWords } from "../../../biblioteca/import-panel";
import TemplatePanel, { defaultSlot } from "../../../biblioteca/template-panel";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Typography } from "@mui/material";

import ItemRows, { type ItemRow, type ItemSection } from "@/components/product/item-rows";
import WordDownloadButton from "@/components/product/word-download-button";
import NiDocumentArchive from "@/icons/nexture/ni-document-archive";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiLoader from "@/icons/nexture/ni-loader";
import NiUploadCloud from "@/icons/nexture/ni-upload-cloud";
import { readDraftTemplate } from "@/lib/library/actions";
import type { LibraryTemplate, SetupPetition, SetupPieces } from "@/lib/library/facts";
import { watchModelImports } from "@/lib/library/import-actions";
import type { PieceImport } from "@/lib/library/import-read";
import { IMPORT_ACCEPT, IMPORT_WORKING, importFailureKey } from "@/lib/library/imports";
import { caseKindLabelKey } from "@/lib/modules/registry";

type Piece = PieceImport["expected"];

/** How often the step looks again while ONE works on a document sent here, as the core's step of the papers. */
const WATCH_MS = 6_000;

/** The name of what a request was sent as. */
const SENT_AS_KEY: Record<Piece, string> = {
  piece: "pax-setup-pieces-petition",
  peca_processo: "pax-setup-pieces-process-piece",
};

/** The name of the petition of each kind of lawsuit, as the library's "Com que modelo o ONE escreve" says it. */
const PETITION_KEY: Record<SetupPetition["kind"], string> = {
  juizado: "library-use-piece-juizado",
  comum: "library-use-piece-comum",
};

/** What a request that waits for the person says, and its button (the words of the core's step of the papers). */
const WAITS_WORDS = {
  asking: { state: "setup-papers-request-asking", action: "setup-papers-answer" },
  ready: { state: "setup-papers-request-ready", action: "setup-papers-review" },
} as const;

/** The panel open over the step: a model of the firm's, a model of the platform's to start from, or a document. */
type PieceForm = {
  expected: Piece;
  template: LibraryTemplate | null;
  copyOf: LibraryTemplate | null;
  /** The document the firm already uses, sent for ONE to make the firm's model of it (0079). */
  file?: File | null;
  /** A request ONE works or worked on, opened to follow it, answer it or check it. */
  importId?: string | null;
};

/**
 * The step "Peças" of the passenger module's setup (the owner, 2026-11-25: the onboarding had no way to send a
 * model of a petition or of a piece). ONE writes the petition of each kind of lawsuit and the pieces of the process
 * from the firm's model of each, else from the platform's: each use is one line saying the model ONE writes from
 * now, with its one button to send the firm's own. The firm sends a petition or a piece it already uses and ONE makes
 * the model of it, as the library does (0079), keeping the firm's words (0093) and filling "Dados do escritório"
 * with what the document writes of the firm (0271); what ONE does with each document sent is a line of its own
 * while it lasts, its mark turning while ONE works. Every button opens over the step: nothing leads away. Only a
 * partner or a lawyer writes the models.
 */
export default function PassengerPieces({
  pieces,
  imports,
  writes,
  blocked,
  onRetry,
}: {
  pieces: SetupPieces | null;
  imports: PieceImport[];
  /** Who answers writes the models: a partner or a lawyer. */
  writes: boolean;
  /** A support visit, or a session without the second factor: nothing is sent. */
  blocked: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("product");
  const router = useRouter();
  const [form, setForm] = useState<PieceForm | null>(null);
  // The file chooser opens in the person's own click; what it was opened for is remembered here.
  const chooser = useRef<HTMLInputElement>(null);
  const choosing = useRef<Piece>("piece");
  const choose = (expected: Piece) => {
    choosing.current = expected;
    chooser.current?.click();
  };
  const sends = writes && !blocked;

  // While ONE works on a document sent here, the step looks again by itself and reads anew when a state changed.
  const working = imports
    .filter((request) => IMPORT_WORKING.includes(request.status))
    .map((request) => `${request.id}:${request.status}`)
    .sort()
    .join(",");
  useEffect(() => {
    if (!working) return;
    let open = true;
    const timer = setInterval(() => {
      watchModelImports()
        .then((watched) => {
          if (!open || !watched.ok) return;
          const known = working.split(",").map((key) => key.split(":")[0]);
          const now = watched.pending
            .filter((item) => known.includes(item.id))
            .map((item) => `${item.id}:${item.status}`)
            .sort()
            .join(",");
          if (now !== working) router.refresh();
        })
        .catch(() => undefined);
    }, WATCH_MS);
    return () => {
      open = false;
      clearInterval(timer);
    };
  }, [working, router]);

  const sendButton = (expected: Piece, label: string, outlined: boolean) =>
    sends ? (
      <Button
        variant={outlined ? "outlined" : "text"}
        color={outlined ? "primary" : "grey"}
        size="small"
        startIcon={outlined ? <NiUploadCloud size="small" /> : undefined}
        onClick={() => choose(expected)}
      >
        {label}
      </Button>
    ) : undefined;

  // ---------- What ONE does with each document sent here, while it lasts ----------
  const requestRows = imports.map((request): ItemRow => {
    const base = {
      key: request.id,
      icon: request.expected === "piece" ? <NiDocumentFull size="medium" /> : <NiDocumentArchive size="medium" />,
      tone: "primary" as const,
      title: t(SENT_AS_KEY[request.expected]),
    };
    if (IMPORT_WORKING.includes(request.status))
      return {
        ...base,
        state: {
          tone: "waiting",
          text: t("setup-papers-request-working", { file: request.fileName }),
          icon: <NiLoader size="medium" className="animate-spin motion-reduce:animate-none" />,
        },
        action: (
          <Button
            variant="text"
            color="grey"
            size="small"
            onClick={() => setForm({ expected: request.expected, template: null, copyOf: null, importId: request.id })}
          >
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
          <Button
            variant="outlined"
            size="small"
            onClick={() => setForm({ expected: request.expected, template: null, copyOf: null, importId: request.id })}
          >
            {t(words.action)}
          </Button>
        ),
      };
    }
    return {
      ...base,
      detail: request.status === "refused" ? request.fileName : undefined,
      state:
        request.status === "refused"
          ? { tone: "attention", text: refusalWords(t, request.refusal, request.expected) }
          : {
              tone: "failed",
              text: t("setup-papers-request-failed", {
                file: request.fileName,
                why: t(importFailureKey(request.failure)),
              }),
            },
      action: sendButton(request.expected, t("setup-papers-send-again"), true),
    };
  });

  /** A model listed in a line's "more": its name, what it serves, and opening it or taking it in Word. */
  const modelLine = (expected: Piece, model: LibraryTemplate, serves: string | null) => (
    <Box key={model.id} className="flex flex-col gap-1">
      <Typography variant="subtitle2" component="p" className="mb-0 break-words">
        {model.name}
      </Typography>
      {serves ? (
        <Typography variant="caption" className="text-text-secondary">
          {serves}
        </Typography>
      ) : null}
      <Box className="flex flex-wrap gap-2">
        {sends ? (
          <Button
            variant="text"
            color="grey"
            size="small"
            onClick={() =>
              setForm(
                model.platform
                  ? { expected, template: null, copyOf: model }
                  : { expected, template: model, copyOf: null },
              )
            }
          >
            {model.platform ? t("setup-papers-procuracao-make") : t("setup-papers-open")}
          </Button>
        ) : null}
        <WordDownloadButton
          name={model.name}
          letterhead
          read={() => readDraftTemplate(model.id).then((read) => (read.ok ? read.body : null))}
        />
      </Box>
    </Box>
  );

  // ---------- The model ONE writes each petition from now ----------
  const petitionRow = (petition: SetupPetition): ItemRow => {
    const used = petition.used;
    const own = used && !used.platform ? used : null;
    const title = t(PETITION_KEY[petition.kind]);
    const problems = petition.byProblem.map((model) => t(caseKindLabelKey(model.problem) ?? "case-incident-other"));
    const listed = [...(used ? [used] : []), ...petition.byProblem];
    return {
      key: `peticao-${petition.kind}`,
      icon: <NiDocumentFull size="medium" />,
      tone: "primary",
      title,
      detail: own
        ? own.name
        : problems.length > 0
          ? t("library-use-by-problem", { problems: problems.join(", ") })
          : undefined,
      state: own
        ? { tone: "done", text: t(own.preparedByOne ? "setup-papers-row-own-one" : "setup-papers-row-own") }
        : used
          ? { tone: "info", text: t("pax-setup-pieces-platform") }
          : { tone: "attention", text: t("pax-setup-pieces-none") },
      action: own
        ? sendButton("piece", t("pax-setup-pieces-send-another"), false)
        : sendButton("piece", t("pax-setup-pieces-send-petition"), true),
      content:
        listed.length > 0
          ? () => (
              <Box className="flex flex-col gap-3">
                {listed.map((model) =>
                  modelLine(
                    "piece",
                    model,
                    model.problem
                      ? t("pax-setup-pieces-for-problem", {
                          problem: t(caseKindLabelKey(model.problem) ?? "case-incident-other"),
                        })
                      : model.platform
                        ? t("library-use-platform")
                        : null,
                  ),
                )}
              </Box>
            )
          : undefined,
      openLabel: t("setup-papers-more", { paper: title }),
    };
  };

  // ---------- The pieces of the process ----------
  const processRow = (data: SetupPieces): ItemRow => {
    const own = data.processOwn;
    const title = t("library-use-peca-processo");
    return {
      key: "pecas-do-processo",
      icon: <NiDocumentArchive size="medium" />,
      tone: "primary",
      title,
      state:
        own.length > 0
          ? { tone: "done", text: t("library-use-pieces-own", { count: own.length, total: data.pieceKinds.length }) }
          : { tone: "info", text: t("library-use-pieces-none") },
      action:
        own.length > 0
          ? sendButton("peca_processo", t("pax-setup-pieces-send-another"), false)
          : sendButton("peca_processo", t("pax-setup-pieces-send-process"), true),
      content:
        own.length > 0
          ? () => (
              <Box className="flex flex-col gap-3">
                {own.map((model) => modelLine("peca_processo", model, model.pieceKindName))}
              </Box>
            )
          : undefined,
      openLabel: t("setup-papers-more", { paper: title }),
    };
  };

  const sections: ItemSection[] = [
    ...(requestRows.length > 0
      ? [
          {
            key: "enviados",
            title: t("pax-setup-pieces-sent"),
            rows: requestRows,
            // A question, a model to check, a refusal or a failure is the person's to act on.
            ask: imports.some((request) => !IMPORT_WORKING.includes(request.status)),
          },
        ]
      : []),
    ...(pieces
      ? [
          {
            key: "modelos",
            title: t("library-uses-title"),
            rows: [...pieces.petitions.map(petitionRow), processRow(pieces)],
          },
        ]
      : []),
  ];

  return (
    <Box className="flex flex-col gap-4">
      {!writes ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("setup-papers-not-lawyer")}
        </Alert>
      ) : null}
      {pieces === null ? (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              {t("today-retry")}
            </Button>
          }
        >
          {t("pax-setup-pieces-load-error")}
        </Alert>
      ) : null}
      {sections.length > 0 ? <ItemRows sections={sections} /> : null}
      <input
        ref={chooser}
        type="file"
        hidden
        accept={IMPORT_ACCEPT}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) setForm({ expected: choosing.current, template: null, copyOf: null, file });
        }}
      />
      {form ? (
        <TemplatePanel
          template={form.template}
          copyOf={form.copyOf}
          // The firm's defaults of a petition and of each piece, which the one saved here may take the place of.
          defaults={Object.fromEntries(
            (pieces?.firmModels ?? [])
              .filter((model) => model.isDefault && model.id !== form.template?.id)
              .map((model) => [
                defaultSlot(model.documentKind, model.proceedingKind, model.problem, model.pieceKind),
                model.name,
              ]),
          )}
          initialDocument={form.expected}
          initialDefault
          // A document sent here is sent as a petition or a piece: ONE refuses another thing, and its model is the
          // one ONE writes that piece from.
          initialFile={form.file ?? null}
          importId={form.importId ?? null}
          expected={form.file || form.importId ? form.expected : null}
          makeDefault={Boolean(form.file)}
          pieceKinds={pieces?.pieceKinds ?? []}
          // Closed while ONE works, the panel says that this step shows the model once it is ready.
          waitsIn="setup"
          onImportRequested={onRetry}
          onClose={() => {
            // What ONE did meanwhile is read again: the step says it.
            if (form.file || form.importId) onRetry();
            setForm(null);
          }}
          onSaved={() => {
            setForm(null);
            onRetry();
          }}
        />
      ) : null}
    </Box>
  );
}
