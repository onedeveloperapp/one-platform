"use client";
import { ContactResult, submitContact } from "./actions";
import { useFormik } from "formik";
import { useTranslations } from "next-intl";
import { useState } from "react";
import * as Yup from "yup";

import { Alert, Box, Button, FormControl, FormHelperText, FormLabel, Input } from "@mui/material";

/**
 * The public contact form: name, e-mail and message, forwarded to the
 * operator by e-mail. Each label is tied to its field and each error is
 * written under the field it belongs to, so a screen reader hears both.
 */
export default function ContactForm() {
  const t = useTranslations("marketing");
  const [result, setResult] = useState<ContactResult["status"] | null>(null);

  const validationSchema = Yup.object({
    name: Yup.string().trim().required(t("contact-required")),
    email: Yup.string().trim().email(t("contact-invalid-email")).required(t("contact-required")),
    message: Yup.string().trim().required(t("contact-required")),
  });

  const formik = useFormik({
    initialValues: { name: "", email: "", message: "" },
    validationSchema,
    onSubmit: async (values, helpers) => {
      setResult(null);
      const { status } = await submitContact(values);
      setResult(status);
      if (status === "sent") helpers.resetForm();
    },
    validateOnBlur: false,
    validateOnMount: false,
  });

  const errorOf = (field: "name" | "email" | "message") =>
    formik.touched[field] && formik.errors[field] ? formik.errors[field] : null;
  const nameError = errorOf("name");
  const emailError = errorOf("email");
  const messageError = errorOf("message");

  return (
    <Box component="form" noValidate onSubmit={formik.handleSubmit} className="mx-auto flex w-full max-w-xl flex-col">
      <FormControl className="outlined" variant="standard" size="small" error={Boolean(nameError)}>
        <FormLabel component="label" htmlFor="contact-name">
          {t("contact-name")}
        </FormLabel>
        <Input
          id="contact-name"
          name="name"
          autoComplete="name"
          inputProps={{ "aria-describedby": nameError ? "contact-name-error" : undefined }}
          value={formik.values.name}
          onChange={formik.handleChange}
          onBlur={formik.handleBlur}
        />
        {nameError && <FormHelperText id="contact-name-error">{nameError}</FormHelperText>}
      </FormControl>

      <FormControl className="outlined" variant="standard" size="small" error={Boolean(emailError)}>
        <FormLabel component="label" htmlFor="contact-email">
          {t("contact-email")}
        </FormLabel>
        <Input
          id="contact-email"
          name="email"
          type="email"
          autoComplete="email"
          inputProps={{ inputMode: "email", "aria-describedby": emailError ? "contact-email-error" : undefined }}
          value={formik.values.email}
          onChange={formik.handleChange}
          onBlur={formik.handleBlur}
        />
        {emailError && <FormHelperText id="contact-email-error">{emailError}</FormHelperText>}
      </FormControl>

      <FormControl className="outlined" variant="standard" size="small" error={Boolean(messageError)}>
        <FormLabel component="label" htmlFor="contact-message">
          {t("contact-message")}
        </FormLabel>
        <Input
          id="contact-message"
          name="message"
          multiline
          minRows={5}
          inputProps={{ "aria-describedby": messageError ? "contact-message-error" : undefined }}
          value={formik.values.message}
          onChange={formik.handleChange}
          onBlur={formik.handleBlur}
        />
        {messageError && <FormHelperText id="contact-message-error">{messageError}</FormHelperText>}
      </FormControl>

      {result === "sent" && (
        <Alert severity="success" className="mb-4">
          {t("contact-success")}
        </Alert>
      )}
      {result === "not-configured" && (
        <Alert severity="info" className="mb-4">
          {t("contact-not-configured")}
        </Alert>
      )}
      {result === "error" && (
        <Alert severity="error" className="mb-4">
          {t("contact-error")}
        </Alert>
      )}

      <Button type="submit" variant="contained" color="primary" size="large" disabled={formik.isSubmitting}>
        {t("contact-submit")}
      </Button>
    </Box>
  );
}
