"use client";

import { useTranslations } from "next-intl";

import { Box, Typography } from "@mui/material";

import { CpfField } from "@/components/product/fields";
import { declareLawyerCpf } from "@/lib/psc/actions";
import { signatureActionErrorKey } from "@/lib/psc/signature";
import { isValidCpf, onlyDigits } from "@flyee/fields";

/**
 * The lawyer's CPF for the signature in the cloud (0041, 0102), asked in the setup of who signs where a provider of
 * the cloud signature can be used here: ONE signs the files of a filing only with an authorization of a certificate
 * of the CPF the lawyer declared. The authorization itself lasts seven days at most (the provider's own limit), so it
 * is asked when the first lawsuit needs it, on the team's card and in the center of what waits, never here. Optional:
 * left blank, the CPF is asked there too.
 */
export default function SetupCpf({
  id,
  value,
  onChange,
  disabled,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  /** Why the CPF typed was not kept, in words. */
  error: string | null;
}) {
  const t = useTranslations("product");
  return (
    <Box className="flex flex-col gap-2">
      <Typography variant="subtitle2" component="h3" className="mb-0">
        {t("setup-cpf-title")}
      </Typography>
      <Typography variant="body2" className="text-text-secondary">
        {t("setup-cpf-hint")}
      </Typography>
      <Box className="w-full max-w-xs">
        <CpfField
          fullWidth
          size="small"
          id={id}
          label={t("psc-cpf-label")}
          value={value}
          disabled={disabled}
          invalidMessage={t("psc-action-invalid-cpf")}
          error={Boolean(error)}
          helperText={error ?? undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      </Box>
    </Box>
  );
}

/** Whether what was typed may go: nothing, or a whole CPF that checks. */
export const setupCpfReady = (value: string): boolean => {
  const digits = onlyDigits(value);
  return digits.length === 0 || (digits.length === 11 && isValidCpf(digits));
};

/**
 * Declares the CPF typed, when one was: null when it went, or nothing was typed; otherwise the catalog key of why
 * it was not kept (a CPF another person proved, too many declarations in a day, the second factor).
 */
export async function declareSetupCpf(value: string): Promise<string | null> {
  const digits = onlyDigits(value);
  if (digits.length === 0) return null;
  if (!setupCpfReady(digits)) return signatureActionErrorKey("invalid_cpf");
  const result = await declareLawyerCpf(digits).catch(() => ({ ok: false as const, code: "failed" }));
  return result.ok ? null : signatureActionErrorKey(result.code);
}
