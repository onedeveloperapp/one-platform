"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Alert, Box, Button, Typography } from "@mui/material";

import { sha256OfFile } from "@/lib/documents/verification";

/** The largest file the page will read: a document ONE issues is far smaller, and a huge file would freeze a phone. */
const MAX_BYTES = 60 * 1024 * 1024;

/**
 * Lets somebody check that the file they received is the one the firm issued:
 * the page computes the fingerprint of the file where it is, in the browser,
 * and compares it with the one ONE recorded. The file is never sent anywhere.
 */
export default function FileCheck({ expectedHash }: { expectedHash: string }) {
  const t = useTranslations("product");
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "reading" | "same" | "different" | "too-large" | "failed">("idle");

  const check = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setState("too-large");
      return;
    }
    setState("reading");
    try {
      setState((await sha256OfFile(file)) === expectedHash ? "same" : "different");
    } catch {
      setState("failed");
    }
  };

  return (
    <Box className="flex flex-col gap-3">
      <Box className="flex flex-col gap-1">
        <Typography variant="subtitle2" component="h2" className="mb-0">
          {t("verify-file-title")}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {t("verify-file-body")}
        </Typography>
      </Box>

      <Box>
        {/* A real button opens the file picker, so the keyboard reaches it like any other. */}
        <Button variant="outlined" color="grey" disabled={state === "reading"} onClick={() => input.current?.click()}>
          {state === "reading" ? t("verify-file-reading") : t("verify-file-choose")}
        </Button>
        <input
          ref={input}
          type="file"
          accept="application/pdf"
          hidden
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            void check(event.target.files?.[0]);
            // The same file may be chosen again after an answer.
            event.target.value = "";
          }}
        />
      </Box>

      <Box role="status" aria-live="polite">
        {state === "same" ? (
          <Alert severity="success" className="neutral bg-background-paper/60!">
            {t("verify-file-same")}
          </Alert>
        ) : null}
        {state === "different" ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t("verify-file-different")}
          </Alert>
        ) : null}
        {state === "too-large" ? (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {t("verify-file-too-large")}
          </Alert>
        ) : null}
        {state === "failed" ? (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {t("verify-file-failed")}
          </Alert>
        ) : null}
      </Box>
    </Box>
  );
}
