"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, FormControl, FormHelperText, FormLabel, Input } from "@mui/material";

import { normalizeVerifyCode } from "@flyee/documents/codes";

/**
 * Where somebody types the code printed on a document. The code is twelve
 * letters and digits; spaces and dashes are how it is printed, so they are
 * accepted and ignored.
 */
export default function CodeForm({ initial = "" }: { initial?: string }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);

  const code = normalizeVerifyCode(value);
  const invalid = touched && !code;

  return (
    <Box
      component="form"
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (code) router.push(`/verificar/${code}`);
      }}
    >
      <FormControl fullWidth className="outlined" variant="standard" error={invalid}>
        <FormLabel component="label" htmlFor="verify-code">
          {t("verify-code-label")}
        </FormLabel>
        <Input
          id="verify-code"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="ABCD-EFGH-JKMN"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputProps={{ maxLength: 20 }}
          aria-describedby="verify-code-help"
        />
        <FormHelperText id="verify-code-help">
          {invalid ? t("verify-code-invalid") : t("verify-code-help")}
        </FormHelperText>
      </FormControl>
      <Button type="submit" variant="contained">
        {t("verify-code-submit")}
      </Button>
    </Box>
  );
}
