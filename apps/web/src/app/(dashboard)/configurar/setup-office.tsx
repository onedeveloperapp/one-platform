"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Box, Button } from "@mui/material";

import OfficeForm, { useOfficeDraft } from "@/components/firm/office-form";
import ItemRows, { type ItemRow } from "@/components/product/item-rows";
import SectionTitle from "@/components/product/section-title";
import type { WizardStep } from "@/components/product/setup-wizard";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiLoader from "@/icons/nexture/ni-loader";
import NiPalette from "@/icons/nexture/ni-palette";
import NiUploadCloud from "@/icons/nexture/ni-upload-cloud";
import {
  confirmFirmLetterhead,
  letterheadSample,
  readFirmLetterhead,
  startLetterheadUpload,
} from "@/lib/brand/letterhead-actions";
import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";
import { readFirmLogo, setFirmColor, startLogoUpload } from "@/lib/firm/brand-actions";
import { type FirmOffice, officeAddressGiven } from "@/lib/firm/office";
import { drawsOnLight, LOGO_MIMES } from "@flyee/documents/brand";

/** The firm's brand as the step reads it (0258). */
export type SetupBrand = {
  /** A short link to ONE's PNG of the logo, for the preview; null with no logo. */
  logoUrl: string | null;
  color: string | null;
  colorFrom: "logo" | "person" | null;
  /** The colour the rule read of the logo, for giving the choice back to it. */
  logoColor: string | null;
};

/** The firm's letterhead (0260): its kind, and whether the person confirmed it on the page of example. */
export type SetupLetterhead = { kind: "word" | "pdf" | null; confirmed: boolean };

/** What the letterhead's refusal says, by its code. */
const LETTERHEAD_ERRORS: Record<string, string> = {
  not_blank: "setup-office-letterhead-error-not-blank",
  empty: "setup-office-letterhead-error-empty",
  no_letterhead: "setup-office-letterhead-error-none",
  too_heavy: "setup-office-letterhead-error-heavy",
  type_not_allowed: "setup-office-letterhead-error-type",
  not_pdf: "setup-office-letterhead-error-unreadable",
  not_docx: "setup-office-letterhead-error-unreadable",
};

/**
 * The setup's step "O escritório" (the plan "o escritório preparado antes do primeiro atendimento", phase 2, and the
 * owner's canvas of 2026-11-24, which brought the papers a client signs into it): the documents the firm already uses,
 * one line each with where it stands and its one button (the letterhead, the power of attorney and the fee contract,
 * whose lines the flow draws since it owns their panel, and the logo with its colour, which ONE reads by a rule), then
 * the firm's data, as ONE read them from those documents or typed by hand as the exception. Nothing in the step is
 * saved by a button of its own: sending a document acts at once and says so in its line, and "Continuar" saves the
 * data (a "Salvar" over "Continuar" left the address behind whenever the person went on). What a client sees takes
 * the brand; the logged area keeps ONE's own palette.
 */
export function useOfficeStep(input: {
  office: FirmOffice;
  brand: SetupBrand;
  letterhead: SetupLetterhead;
  /** The lines of the power of attorney and the fee contract, drawn by the flow. */
  paperRows: ItemRow[];
  /** ONE is reading one of the firm's papers: the data say ONE fills them from it. */
  readingPaper: boolean;
  blocked: boolean;
  onChanged: () => void;
}): Pick<WizardStep, "content" | "onPrimary" | "onLeave" | "done"> {
  const t = useTranslations("product");
  const chooser = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState(input.brand.logoUrl);
  const [color, setColor] = useState(input.brand.color);
  const [colorFrom, setColorFrom] = useState(input.brand.colorFrom);
  const [savingColor, setSavingColor] = useState(false);
  // What is typed in the firm's data lives here, with the flow: going back and forth keeps it.
  const draft = useOfficeDraft(input.office, input.onChanged);

  const errorOf = (code: string): string =>
    code === "type_not_allowed"
      ? t("setup-office-logo-error-type")
      : code === "too_large"
        ? t("setup-office-logo-error-large")
        : code === "unreadable"
          ? t("setup-office-logo-error-unreadable")
          : code === "second_factor_required"
            ? t("setup-operation-error-second_factor")
            : t("setup-operation-error-failed");

  const send = async (file: File) => {
    setError(null);
    setWorking(true);
    try {
      const mime = mimeOf(file);
      const started = await startLogoUpload({ name: file.name, mime, bytes: file.size });
      if (!started.ok) {
        setError(errorOf(started.code));
        return;
      }
      const sent = await uploadToSignedUrl({
        storagePath: started.storagePath,
        uploadToken: started.uploadToken,
        file,
        contentType: mime,
      });
      if (!sent) {
        setError(errorOf("failed"));
        return;
      }
      const read = await readFirmLogo(started.fileId);
      if (!read.ok) {
        setError(errorOf(read.code));
        return;
      }
      setLogoUrl(read.logoUrl);
      setColor(read.color);
      if (colorFrom !== "person") setColorFrom(read.color ? "logo" : null);
      input.onChanged();
    } catch {
      setError(errorOf("failed"));
    } finally {
      setWorking(false);
    }
  };

  const chooseColor = async (value: string | null) => {
    setSavingColor(true);
    setError(null);
    const saved = await setFirmColor(value).catch(() => ({ ok: false as const, code: "failed" }));
    setSavingColor(false);
    if (!saved.ok) {
      setError(errorOf(saved.code));
      return;
    }
    setColor(value ?? input.brand.logoColor);
    setColorFrom(value ? "person" : input.brand.logoColor ? "logo" : null);
    input.onChanged();
  };

  // A colour picker reports every shade it passes by: the preview follows them, and only where it stops is saved.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pick = (value: string) => {
    setColor(value);
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void chooseColor(value), 700);
  };

  // ---------- The letterhead (0260) ----------
  const letterheadChooser = useRef<HTMLInputElement>(null);
  const [letterhead, setLetterhead] = useState<SetupLetterhead>(input.letterhead);
  const [readingLetterhead, setReadingLetterhead] = useState(false);
  const [letterheadError, setLetterheadError] = useState<string | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);

  const showSample = async () => {
    setSampleBusy(true);
    const drawn = await letterheadSample().catch(() => ({ ok: false as const, code: "failed" }));
    setSampleBusy(false);
    if (!drawn.ok) {
      setLetterheadError(t("setup-operation-error-failed"));
      return;
    }
    const bytes = Uint8Array.from(atob(drawn.pdf), (char) => char.charCodeAt(0));
    setSample(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })));
  };
  const closeSample = () => {
    if (sample) URL.revokeObjectURL(sample);
    setSample(null);
  };

  const sendLetterhead = async (file: File) => {
    setLetterheadError(null);
    setReadingLetterhead(true);
    try {
      const mime = mimeOf(file);
      const started = await startLetterheadUpload({ name: file.name, mime, bytes: file.size });
      if (!started.ok) {
        setLetterheadError(t(LETTERHEAD_ERRORS[started.code] ?? "setup-operation-error-failed"));
        return;
      }
      const sent = await uploadToSignedUrl({
        storagePath: started.storagePath,
        uploadToken: started.uploadToken,
        file,
        contentType: mime,
      });
      if (!sent) {
        setLetterheadError(t("setup-operation-error-failed"));
        return;
      }
      const read = await readFirmLetterhead(started.fileId);
      if (!read.ok) {
        setLetterheadError(t(LETTERHEAD_ERRORS[read.code] ?? "setup-operation-error-failed"));
        return;
      }
      setLetterhead({ kind: read.kind, confirmed: false });
      if (read.logoUrl && !logoUrl) setLogoUrl(read.logoUrl);
      input.onChanged();
      // What ONE read is shown at once, for the person to confirm.
      await showSample();
    } catch {
      setLetterheadError(t("setup-operation-error-failed"));
    } finally {
      setReadingLetterhead(false);
    }
  };

  const confirmLetterhead = async () => {
    setSampleBusy(true);
    const done = await confirmFirmLetterhead().catch(() => ({ ok: false as const, code: "failed" }));
    setSampleBusy(false);
    if (!done.ok) {
      setLetterheadError(
        done.code === "second_factor_required"
          ? t("setup-operation-error-second_factor")
          : t("setup-operation-error-failed"),
      );
      return;
    }
    setLetterhead((current) => ({ ...current, confirmed: true }));
    closeSample();
    input.onChanged();
  };

  const off = input.blocked || working;
  // The mark of a line ONE is reading: it turns while the work goes on.
  const turning = <NiLoader size="medium" className="animate-spin motion-reduce:animate-none" />;

  // ---------- The lines of the documents ----------
  const letterheadRow: ItemRow = {
    key: "timbrado",
    icon: <NiDocumentFull size="medium" />,
    tone: "primary",
    title: t("setup-office-letterhead-name"),
    ...(letterheadError
      ? {
          state: { tone: "failed" as const, text: letterheadError },
          action: (
            <Button variant="outlined" size="small" onClick={() => letterheadChooser.current?.click()} disabled={off}>
              {t("setup-office-send-another")}
            </Button>
          ),
        }
      : readingLetterhead
        ? { state: { tone: "waiting" as const, text: t("setup-office-letterhead-reading"), icon: turning } }
        : letterhead.kind && letterhead.confirmed
          ? {
              detail: t("setup-office-letterhead-in-use"),
              state: { tone: "done" as const, text: t("setup-office-row-in-use") },
              action: (
                <Button
                  variant="text"
                  color="grey"
                  size="small"
                  onClick={() => letterheadChooser.current?.click()}
                  disabled={off}
                >
                  {t("setup-office-replace")}
                </Button>
              ),
            }
          : letterhead.kind
            ? {
                state: { tone: "attention" as const, text: t("setup-office-letterhead-check") },
                action: (
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => void showSample()}
                    disabled={off || sampleBusy}
                  >
                    {t("setup-office-letterhead-see")}
                  </Button>
                ),
              }
            : {
                detail: t("setup-office-letterhead-what"),
                state: { tone: "attention" as const, text: t("setup-office-row-missing") },
                action: (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<NiUploadCloud size="small" />}
                    onClick={() => letterheadChooser.current?.click()}
                    disabled={off}
                  >
                    {t("setup-office-send")}
                  </Button>
                ),
              }),
  };

  const colorPicker = (label: string, initial: string) => (
    <Button component="label" variant="text" color="grey" size="small" disabled={off || savingColor}>
      {label}
      <input type="color" hidden value={initial} onChange={(event) => pick(event.target.value)} aria-label={label} />
    </Button>
  );

  const logoRow: ItemRow = {
    key: "logomarca",
    icon: logoUrl ? (
      // A signed link of a moment, to ONE's PNG: no optimization to ask of it.
      <img src={logoUrl} alt="" className="max-h-7 max-w-7 object-contain" />
    ) : (
      <NiPalette size="medium" />
    ),
    tone: "primary",
    title: t("setup-office-logo-title"),
    ...(error
      ? {
          state: { tone: "failed" as const, text: error },
          action: (
            <Button variant="outlined" size="small" onClick={() => chooser.current?.click()} disabled={off}>
              {t("setup-office-send-another")}
            </Button>
          ),
        }
      : working
        ? { state: { tone: "waiting" as const, text: t("setup-office-logo-reading"), icon: turning } }
        : logoUrl && color
          ? {
              detail:
                colorFrom === "person" ? t("setup-office-color-chosen-short") : t("setup-office-color-read-short"),
              state: {
                tone: "done" as const,
                text: (
                  <Box component="span" className="inline-flex items-center gap-2">
                    <Box
                      component="span"
                      aria-hidden
                      className="border-divider inline-block size-4 rounded border"
                      style={{ backgroundColor: color }}
                    />
                    {t("setup-office-color-short", { color: color.toUpperCase() })}
                  </Box>
                ),
              },
              action: colorPicker(t("setup-office-color-change"), color),
              content: () => (
                <Box className="flex flex-col gap-2">
                  {!drawsOnLight(color) ? (
                    <StateLine tone="attention">{t("setup-office-color-light")}</StateLine>
                  ) : null}
                  <Box className="flex flex-wrap gap-2">
                    <Button
                      variant="text"
                      color="grey"
                      size="small"
                      startIcon={<NiUploadCloud size="small" />}
                      onClick={() => chooser.current?.click()}
                      disabled={off}
                    >
                      {t("setup-office-logo-replace")}
                    </Button>
                    {colorFrom === "person" && input.brand.logoColor ? (
                      <Button
                        variant="text"
                        color="grey"
                        size="small"
                        onClick={() => void chooseColor(null)}
                        disabled={off || savingColor}
                      >
                        {t("setup-office-color-back")}
                      </Button>
                    ) : null}
                  </Box>
                </Box>
              ),
              openLabel: t("setup-office-logo-more"),
            }
          : logoUrl
            ? {
                state: { tone: "info" as const, text: t("setup-office-color-none") },
                action: colorPicker(t("setup-office-color-choose"), "#1a4d8f"),
              }
            : {
                detail: t("setup-office-logo-what"),
                state: { tone: "attention" as const, text: t("setup-office-row-missing") },
                action: (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<NiUploadCloud size="small" />}
                    onClick={() => chooser.current?.click()}
                    disabled={off}
                  >
                    {t("setup-office-send")}
                  </Button>
                ),
              }),
  };

  // Typing where the firm is, is the exception: the fields show once something of it is known, or when asked for.
  const [byHand, setByHand] = useState(false);
  const formShown =
    byHand || input.office.read !== null || officeAddressGiven(input.office) || input.office.email.trim() !== "";

  const content = (
    <Box className="flex flex-col gap-6">
      <input
        ref={letterheadChooser}
        type="file"
        hidden
        accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void sendLetterhead(file);
        }}
      />
      <input
        ref={chooser}
        type="file"
        hidden
        accept={LOGO_MIMES.join(",")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void send(file);
        }}
      />
      <ItemRows
        sections={[
          {
            key: "documentos",
            title: t("setup-office-documents-title"),
            rows: [letterheadRow, ...input.paperRows, logoRow],
          },
        ]}
      />

      <Box component="section" className="flex flex-col gap-3" aria-labelledby="setup-office-data">
        <SectionTitle
          id="setup-office-data"
          title={t("setup-office-data-title")}
          description={t("setup-office-data-info")}
          as="h3"
          variant="subtitle1"
        />
        {formShown ? (
          // What ONE read is said over the fields by the form itself; "Continuar" saves or confirms it.
          <OfficeForm office={input.office} disabled={input.blocked} onSaved={input.onChanged} draft={draft} embedded />
        ) : (
          <StateLine
            tone="info"
            action={
              <Button variant="text" color="grey" size="small" onClick={() => setByHand(true)} disabled={input.blocked}>
                {t("setup-office-data-by-hand")}
              </Button>
            }
          >
            {input.readingPaper ? t("setup-office-data-reading") : t("setup-office-data-from-paper")}
          </StateLine>
        )}
      </Box>
    </Box>
  );

  const panel = sample ? (
    <SidePanel
      onClose={closeSample}
      closeLabel={t("setup-office-letterhead-close")}
      title={t("setup-office-letterhead-sample-title")}
      description={t("setup-office-letterhead-sample-info")}
      icon={<NiDocumentFull size="medium" />}
      wide
      busy={sampleBusy}
      actions={
        letterhead.confirmed ? null : (
          <>
            <Button variant="contained" onClick={() => void confirmLetterhead()} disabled={sampleBusy || input.blocked}>
              {t("setup-office-letterhead-use")}
            </Button>
            <Button
              variant="text"
              onClick={() => letterheadChooser.current?.click()}
              disabled={sampleBusy || input.blocked}
            >
              {t("setup-office-letterhead-another")}
            </Button>
          </>
        )
      }
    >
      <Box className="h-[70vh] w-full">
        <iframe
          src={sample}
          title={t("setup-office-letterhead-sample-title")}
          className="h-full w-full rounded-lg border-0"
        />
      </Box>
    </SidePanel>
  ) : null;

  // "Continuar" saves what is typed in the data, or confirms what ONE read; with nothing there, it just goes on.
  const save = async (): Promise<boolean> => (input.blocked ? true : draft.save());

  return {
    content: (
      <>
        {content}
        {panel}
      </>
    ),
    onPrimary: save,
    onLeave: save,
    done: Boolean(logoUrl),
  };
}
