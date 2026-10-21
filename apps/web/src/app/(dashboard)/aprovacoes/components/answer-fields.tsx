"use client";

import { useTranslations } from "next-intl";

import { Box, FormControl, FormHelperText, FormLabel, Input, Typography } from "@mui/material";

import { type AnswerEdits, fieldKind, fieldLabel, structuredText } from "@/lib/ai/approvals";

const NUMBER = new Intl.NumberFormat("pt-BR");

/**
 * What the model answered, field by field, as a person reads it. This is the
 * view every task gets on its first day: the fields come straight from the
 * answer, named by their keys. A task whose answer deserves its own layout
 * (a document read, a draft) replaces it with a view of its own.
 *
 * While the person corrects, the text fields become inputs and everything
 * else keeps the value the model gave: only text can be corrected here.
 */
export default function AnswerFields({
  idPrefix,
  output,
  editing,
  edits,
  onEdit,
  blank,
  disabled,
}: {
  /** Makes the ids of the inputs unique among the cards of the queue. */
  idPrefix: string;
  output: Record<string, unknown>;
  editing: boolean;
  edits: AnswerEdits;
  onEdit: (key: string, text: string) => void;
  /** The corrected fields left blank, flagged after the person tried to approve. */
  blank: string[];
  disabled: boolean;
}) {
  const t = useTranslations("product");
  const entries = Object.entries(output);

  if (entries.length === 0) {
    return (
      <Typography variant="body1" className="text-text-secondary">
        {t("approvals-field-empty")}
      </Typography>
    );
  }

  const valueOf = (value: unknown) => {
    const kind = fieldKind(value);
    if (kind === "text") {
      return (
        <Typography variant="body1" className="text-text-primary whitespace-pre-wrap">
          {value as string}
        </Typography>
      );
    }
    if (kind === "list") {
      return (
        <Box component="ul" className="text-text-primary m-0 flex list-disc flex-col gap-1 pl-5">
          {(value as (string | number)[]).map((item, index) => (
            <Typography component="li" variant="body1" key={`${index}-${item}`}>
              {typeof item === "number" ? NUMBER.format(item) : item}
            </Typography>
          ))}
        </Box>
      );
    }
    if (kind === "other") {
      return (
        <Typography component="pre" variant="body2" className="text-text-primary m-0 font-mono whitespace-pre-wrap">
          {structuredText(value)}
        </Typography>
      );
    }
    if (kind === "empty") {
      return (
        <Typography variant="body1" className="text-text-secondary">
          {t("approvals-field-empty")}
        </Typography>
      );
    }
    return (
      <Typography variant="body1" className="text-text-primary">
        {kind === "flag"
          ? value
            ? t("approvals-field-yes")
            : t("approvals-field-no")
          : NUMBER.format(value as number)}
      </Typography>
    );
  };

  if (!editing) {
    return (
      <Box component="dl" className="m-0 flex flex-col gap-4">
        {entries.map(([key, value]) => (
          <Box key={key} className="flex flex-col gap-1">
            <Typography component="dt" variant="body2" className="text-text-secondary">
              {fieldLabel(key)}
            </Typography>
            <Box component="dd" className="m-0">
              {valueOf(value)}
            </Box>
          </Box>
        ))}
      </Box>
    );
  }

  const hasFixedField = entries.some(([, value]) => fieldKind(value) !== "text");

  return (
    <Box className="flex flex-col gap-4">
      {entries.map(([key, value]) => {
        const label = fieldLabel(key);
        if (fieldKind(value) !== "text") {
          return (
            <Box key={key} className="flex flex-col gap-1">
              <Typography variant="body2" className="text-text-secondary">
                {label}
              </Typography>
              {valueOf(value)}
            </Box>
          );
        }
        const id = `${idPrefix}-${key}`;
        const isBlank = blank.includes(key);
        return (
          <FormControl key={key} fullWidth className="outlined" variant="standard" error={isBlank}>
            <FormLabel component="label" htmlFor={id}>
              {label}
            </FormLabel>
            <Input
              id={id}
              multiline
              minRows={2}
              value={edits[key] ?? (value as string)}
              onChange={(event) => onEdit(key, event.target.value)}
              disabled={disabled}
              aria-describedby={isBlank ? `${id}-help` : undefined}
            />
            {isBlank ? <FormHelperText id={`${id}-help`}>{t("approvals-field-required")}</FormHelperText> : null}
          </FormControl>
        );
      })}

      {hasFixedField ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("approvals-field-fixed")}
        </Typography>
      ) : null}
    </Box>
  );
}
