"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { IconButton, Tooltip } from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import NiClipboard from "@/icons/nexture/ni-clipboard";

/**
 * Copies one value to the clipboard, as the field it goes to takes it (a CPF's digits), and says it did: the mark
 * turns into a check for two seconds, and a screen reader hears it. Beside a value a person types into another
 * system by hand (the court's screen, in the guide of a filing by hand). Closest catalog entry: none copies; the
 * client's link and the extension's code copy a whole line with a button of words, which a value in a grid has no
 * room for.
 */
export default function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const t = useTranslations("product");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const name = t("copy-value", { label });
  return (
    <>
      <Tooltip title={copied ? t("copy-done") : name}>
        <IconButton
          size="small"
          aria-label={name}
          className={className}
          onClick={() => {
            navigator.clipboard.writeText(text).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? (
            <NiCheck size="small" className="text-success" />
          ) : (
            <NiClipboard size="small" className="text-text-secondary" />
          )}
        </IconButton>
      </Tooltip>
      <span role="status" className="sr-only">
        {copied ? t("copy-done") : ""}
      </span>
    </>
  );
}
