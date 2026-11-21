"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Box, Button, Typography } from "@mui/material";

import OfficeForm from "@/components/firm/office-form";
import SectionTitle from "@/components/product/section-title";
import type { WizardStep } from "@/components/product/setup-wizard";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
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

/** Where the firm's own power of attorney stands, as the step of the papers reads it. */
export type OfficePaper = "own" | "working" | "none";

/**
 * The setup's step "O escritório" (the plan "o escritório preparado antes do primeiro atendimento", phase 2): it
 * starts from the documents the firm already uses (its power of attorney, which ONE makes the firm's model of and
 * reads the firm's data from), then its logo, which ONE keeps and reads the main colour of by a rule, the person
 * confirming the colour or choosing another, then where the firm is: shown as ONE read it or as given, and typed by
 * hand only as the exception (the owner, 2026-11-20). What a client sees takes the brand; the logged area keeps ONE's
 * own palette.
 */
export function useOfficeStep(input: {
  office: FirmOffice;
  brand: SetupBrand;
  letterhead: SetupLetterhead;
  /** The firm's power of attorney: its own model, one ONE is reading, or none yet. */
  paper: OfficePaper;
  /** Sends the firm's power of attorney: the same panel as the step of the papers, over this step. */
  onSendPaper: (() => void) | null;
  blocked: boolean;
  onChanged: () => void;
}): Pick<WizardStep, "content"> {
  const t = useTranslations("product");
  const chooser = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState(input.brand.logoUrl);
  const [color, setColor] = useState(input.brand.color);
  const [colorFrom, setColorFrom] = useState(input.brand.colorFrom);
  const [savingColor, setSavingColor] = useState(false);

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
  // Typing where the firm is, is the exception: the form shows once something of it is known, or when asked for.
  const [byHand, setByHand] = useState(false);
  const formShown =
    byHand || input.office.read !== null || officeAddressGiven(input.office) || input.office.email.trim() !== "";

  const content = (
    <Box className="flex flex-col gap-6">
      <Box component="section" className="flex flex-col gap-3" aria-labelledby="setup-office-documents">
        <SectionTitle
          id="setup-office-documents"
          title={t("setup-office-documents-title")}
          description={t("setup-office-documents-info")}
          as="h3"
          variant="subtitle1"
        />
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
        {readingLetterhead ? (
          <StateLine tone="waiting">{t("setup-office-letterhead-reading")}</StateLine>
        ) : letterhead.kind && letterhead.confirmed ? (
          <StateLine
            tone="done"
            action={
              <Button variant="text" size="small" onClick={() => letterheadChooser.current?.click()} disabled={off}>
                {t("setup-office-letterhead-replace")}
              </Button>
            }
          >
            {t("setup-office-letterhead-in-use")}
          </StateLine>
        ) : letterhead.kind ? (
          <StateLine
            tone="attention"
            action={
              <Button variant="outlined" size="small" onClick={() => void showSample()} disabled={off || sampleBusy}>
                {t("setup-office-letterhead-see")}
              </Button>
            }
          >
            {t("setup-office-letterhead-check")}
          </StateLine>
        ) : (
          <StateLine
            tone="attention"
            action={
              <Button
                variant="outlined"
                size="small"
                startIcon={<NiUploadCloud size="medium" />}
                onClick={() => letterheadChooser.current?.click()}
                disabled={off}
              >
                {t("setup-office-letterhead-send")}
              </Button>
            }
          >
            {t("setup-office-letterhead-missing")}
          </StateLine>
        )}
        {letterheadError ? <StateLine tone="failed">{letterheadError}</StateLine> : null}
        {input.paper === "own" ? (
          <StateLine tone="done">{t("setup-office-paper-own")}</StateLine>
        ) : input.paper === "working" ? (
          <StateLine tone="waiting">{t("setup-office-paper-working")}</StateLine>
        ) : input.onSendPaper ? (
          <StateLine
            tone="attention"
            action={
              <Button variant="outlined" size="small" onClick={input.onSendPaper} disabled={input.blocked}>
                {t("setup-office-paper-send")}
              </Button>
            }
          >
            {t("setup-office-paper-missing")}
          </StateLine>
        ) : null}
      </Box>

      <Box component="section" className="flex flex-col gap-3" aria-labelledby="setup-office-logo">
        <SectionTitle
          id="setup-office-logo"
          title={t("setup-office-logo-title")}
          description={t("setup-office-logo-info")}
          as="h3"
          variant="subtitle1"
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
        {logoUrl ? (
          <Box className="border-divider bg-background-paper flex items-center justify-center rounded-xl border p-4">
            {/* A signed link of a moment, to ONE's PNG: no optimization to ask of it. */}
            {}
            <img src={logoUrl} alt={t("setup-office-logo-alt")} className="max-h-24 max-w-full object-contain" />
          </Box>
        ) : null}
        {working ? <StateLine tone="waiting">{t("setup-office-logo-reading")}</StateLine> : null}
        <Box>
          <Button
            variant={logoUrl ? "text" : "outlined"}
            startIcon={<NiUploadCloud size="medium" />}
            onClick={() => chooser.current?.click()}
            disabled={off}
          >
            {logoUrl ? t("setup-office-logo-replace") : t("setup-office-logo-send")}
          </Button>
        </Box>

        {color ? (
          <Box className="flex flex-col gap-2">
            <Box className="flex flex-wrap items-center gap-3">
              <Box
                aria-hidden
                className="border-divider h-8 w-8 shrink-0 rounded-lg border"
                style={{ backgroundColor: color }}
              />
              <Typography variant="subtitle2" component="span">
                {t("setup-office-color", { color: color.toUpperCase() })}
              </Typography>
              <Button component="label" size="small" variant="text" disabled={off || savingColor}>
                {t("setup-office-color-change")}
                <input
                  type="color"
                  hidden
                  value={color}
                  onChange={(event) => pick(event.target.value)}
                  aria-label={t("setup-office-color-change")}
                />
              </Button>
              {colorFrom === "person" && input.brand.logoColor ? (
                <Button
                  size="small"
                  variant="text"
                  disabled={off || savingColor}
                  onClick={() => void chooseColor(null)}
                >
                  {t("setup-office-color-back")}
                </Button>
              ) : null}
            </Box>
            <StateLine tone="info">
              {colorFrom === "person" ? t("setup-office-color-chosen") : t("setup-office-color-read")}
            </StateLine>
            {!drawsOnLight(color) ? <StateLine tone="attention">{t("setup-office-color-light")}</StateLine> : null}
          </Box>
        ) : logoUrl ? (
          <StateLine tone="info">
            {t("setup-office-color-none")}{" "}
            <Button component="label" size="small" variant="text" disabled={off || savingColor}>
              {t("setup-office-color-choose")}
              <input
                type="color"
                hidden
                defaultValue="#1a4d8f"
                onChange={(event) => pick(event.target.value)}
                aria-label={t("setup-office-color-choose")}
              />
            </Button>
          </StateLine>
        ) : null}
        {error ? <StateLine tone="failed">{error}</StateLine> : null}
      </Box>

      <Box component="section" className="flex flex-col gap-3" aria-labelledby="setup-office-data">
        <SectionTitle
          id="setup-office-data"
          title={t("setup-office-data-title")}
          description={t("setup-office-data-info")}
          as="h3"
          variant="subtitle1"
        />
        {formShown ? (
          <OfficeForm office={input.office} disabled={input.blocked} onSaved={input.onChanged} />
        ) : (
          <StateLine
            tone="info"
            action={
              <Button variant="text" size="small" onClick={() => setByHand(true)} disabled={input.blocked}>
                {t("setup-office-data-by-hand")}
              </Button>
            }
          >
            {input.paper === "none" ? t("setup-office-data-from-paper") : t("setup-office-data-reading")}
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

  return {
    content: (
      <>
        {content}
        {panel}
      </>
    ),
  };
}
