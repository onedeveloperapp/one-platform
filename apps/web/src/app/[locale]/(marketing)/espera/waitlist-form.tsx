"use client";

import { joinWaitlist, type WaitlistStatus } from "./actions";
import { WAITLIST_FORM_ID } from "./form-anchor";
import { useFormik } from "formik";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import * as Yup from "yup";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Input,
} from "@mui/material";

import Link from "@/components/marketing/locale-link";
import NiCheckSquare from "@/icons/nexture/ni-check-square";

const ERROR_KEY: Partial<Record<WaitlistStatus, string>> = {
  rate_limited: "waitlist-error-rate",
  unavailable: "waitlist-error-unavailable",
  error: "waitlist-error-generic",
};

/**
 * The waitlist sign-up: e-mail and the newsletter consent. The answer never
 * says whether the address was already on the list.
 */
export default function WaitlistForm() {
  const t = useTranslations("marketing");
  const locale = useLocale();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [failure, setFailure] = useState<WaitlistStatus | null>(null);

  const formik = useFormik({
    initialValues: { email: "", consent: false, website: "" },
    validationSchema: Yup.object({
      email: Yup.string().trim().email(t("waitlist-error-email")).required(t("waitlist-error-email")),
      consent: Yup.boolean().oneOf([true], t("waitlist-error-consent")),
    }),
    validateOnBlur: false,
    onSubmit: async (values, helpers) => {
      setFailure(null);
      const { status } = await joinWaitlist({ ...values, locale });
      if (status === "sent") {
        setSentTo(values.email.trim());
        helpers.resetForm();
        return;
      }
      if (status === "invalid_email") helpers.setFieldError("email", t("waitlist-error-email"));
      else if (status === "consent_required") helpers.setFieldError("consent", t("waitlist-error-consent"));
      else setFailure(status);
    },
  });

  if (sentTo) {
    return (
      <Box
        id={WAITLIST_FORM_ID}
        role="status"
        className="border-grey-100 bg-background-paper flex w-full max-w-md flex-col gap-3 rounded-3xl border p-6 text-left"
      >
        <span className="bg-accent-2-light/10 text-accent-2 flex h-11 w-11 items-center justify-center rounded-xl">
          <NiCheckSquare size="medium" />
        </span>
        <p className="font-display text-text-primary text-xl font-bold">{t("waitlist-sent-title")}</p>
        <p className="text-text-secondary text-base leading-6">{t("waitlist-sent-body", { email: sentTo })}</p>
        <div>
          <Button variant="text" color="primary" onClick={() => setSentTo(null)}>
            {t("waitlist-sent-again")}
          </Button>
        </div>
      </Box>
    );
  }

  const emailError = formik.touched.email && formik.errors.email ? formik.errors.email : null;
  const consentError = formik.submitCount > 0 && formik.errors.consent ? formik.errors.consent : null;
  const failureKey = failure ? ERROR_KEY[failure] : undefined;

  return (
    <Box
      id={WAITLIST_FORM_ID}
      component="form"
      noValidate
      onSubmit={formik.handleSubmit}
      className="flex w-full max-w-md flex-col gap-1 text-left"
    >
      <FormControl className="outlined" variant="standard" size="small" error={Boolean(emailError)}>
        <FormLabel component="label" htmlFor="waitlist-email">
          {t("waitlist-email-label")}
        </FormLabel>
        <Input
          id="waitlist-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t("waitlist-email-placeholder")}
          inputProps={{ inputMode: "email", "aria-describedby": emailError ? "waitlist-email-error" : undefined }}
          value={formik.values.email}
          onChange={formik.handleChange}
          onBlur={formik.handleBlur}
        />
        {emailError && <FormHelperText id="waitlist-email-error">{emailError}</FormHelperText>}
      </FormControl>

      {/* Honeypot: hidden from people and from assistive technology. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
        value={formik.values.website}
        onChange={formik.handleChange}
      />

      <FormControl error={Boolean(consentError)} className="mt-1">
        <FormControlLabel
          className="items-start"
          control={
            <Checkbox
              name="consent"
              checked={formik.values.consent}
              onChange={formik.handleChange}
              className="-mt-1.5"
              slotProps={{
                input: {
                  // Named by reference: the wrapping label alone is unnamed while
                  // the hero entrance still hides its text.
                  "aria-labelledby": "waitlist-consent-label",
                  "aria-describedby": "waitlist-consent-privacy",
                },
              }}
            />
          }
          label={
            <span id="waitlist-consent-label" className="text-text-secondary text-sm leading-5">
              {t("waitlist-consent")}
            </span>
          }
        />
        <p id="waitlist-consent-privacy" className="text-text-secondary ml-8 text-sm leading-5">
          <Link href="/legal/privacidade" className="text-primary underline">
            {t("waitlist-consent-privacy")}
          </Link>
        </p>
        {consentError && <FormHelperText className="ml-8">{consentError}</FormHelperText>}
      </FormControl>

      {failureKey && (
        <Alert severity="error" className="neutral bg-background-paper/60! mt-2">
          {t(failureKey)}
        </Alert>
      )}

      <Button
        type="submit"
        size="large"
        variant="contained"
        color="primary"
        className="mt-3 self-start"
        disabled={formik.isSubmitting}
      >
        {formik.isSubmitting ? t("waitlist-submitting") : t("cta-waitlist")}
      </Button>
    </Box>
  );
}
