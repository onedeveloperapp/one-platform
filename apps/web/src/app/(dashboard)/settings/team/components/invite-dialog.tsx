"use client";

import { teamErrorKey } from "../team-types";
import { useFormik } from "formik";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import * as yup from "yup";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Input,
  Radio,
  RadioGroup,
  Typography,
} from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import { useEmailReady } from "@/components/product/use-email-ready";
import { inviteToFirm } from "@/lib/firm/actions";
import { FIRM_FUNCTIONS, type FirmFunction, FUNCTION_HINT_KEY, FUNCTION_LABEL_KEY } from "@/lib/firm/roles";

/** What came of an invitation: by e-mail, or as a link the manager sends (chosen, or because the e-mail could not leave). */
type Sent = { email: string; link: string | null; chosen: boolean };

/**
 * Invites somebody to the firm: the address, what the person will do, and
 * (the owner only) whether they also manage the firm account. The first
 * screen offers both ways at once (2026-10-30): copy the link, to send it by
 * the manager's own channel, or send it by e-mail, offered only where ONE can
 * send one. When the e-mail could not leave, the link is shown here so the
 * manager sends it by hand: the invitation exists either way.
 */
export default function InviteDialog({
  firmName,
  mayInviteAdmin,
  onClose,
  onInvited,
}: {
  firmName: string;
  /** Only the owner hands out the admin role. */
  mayInviteAdmin: boolean;
  onClose: () => void;
  onInvited: () => void;
}) {
  const t = useTranslations("product");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [copied, setCopied] = useState(false);
  const emailOk = useEmailReady();
  // How the invitation goes: the button pressed says it; Enter in the form sends it the way the first button would.
  const deliver = useRef<"email" | "link">("email");

  const formik = useFormik({
    initialValues: { email: "", firmFunction: "advogado" as FirmFunction, admin: false },
    validationSchema: yup.object({
      email: yup.string().trim().required(t("team-invite-email-required")).email(t("team-error-invalid-email")),
    }),
    validateOnBlur: true,
    onSubmit: async (values) => {
      setErrorCode(null);
      const chosen = !emailOk || deliver.current === "link";
      const result = await inviteToFirm({
        email: values.email,
        role: values.admin && mayInviteAdmin ? "admin" : "member",
        firmFunction: values.firmFunction,
        deliver: chosen ? "link" : "email",
      });
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }
      setSent({ email: values.email.trim().toLowerCase(), link: result.link, chosen });
      // The link asked for is copied at once: the next thing the manager does is paste it.
      if (chosen && result.link) await copy(result.link);
      onInvited();
    },
  });

  const copy = async (link: string | null | undefined = sent?.link) => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const send = (way: "email" | "link") => {
    deliver.current = way;
    void formik.submitForm();
  };

  const busy = formik.isSubmitting;
  const emailError = formik.touched.email ? formik.errors.email : undefined;

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="team-invite-dialog">
      <DialogHeader
        id="team-invite-dialog"
        title={t("team-invite-title", { firm: firmName })}
        onClose={onClose}
        closeLabel={t("team-close")}
      />

      {sent ? (
        <>
          <DialogContent>
            <Box className="flex flex-col gap-4">
              <Alert
                severity={sent.link && !sent.chosen ? "warning" : "success"}
                className="neutral bg-background-paper/60!"
              >
                {sent.chosen
                  ? t(copied ? "team-invite-link-ready-copied" : "team-invite-link-ready", { email: sent.email })
                  : sent.link
                    ? t("team-invite-not-emailed", { email: sent.email })
                    : t("team-invite-emailed", { email: sent.email })}
              </Alert>
              {sent.link && (
                <FormControl className="outlined" variant="standard">
                  <FormLabel htmlFor="team-invite-link">{t("team-invite-link")}</FormLabel>
                  <Input id="team-invite-link" value={sent.link} readOnly aria-describedby="team-invite-link-help" />
                  <FormHelperText id="team-invite-link-help">
                    {copied ? t("team-invite-link-copied") : t("team-invite-link-help")}
                  </FormHelperText>
                </FormControl>
              )}
              <Typography variant="body2" className="text-text-secondary">
                {t("team-invite-next")}
              </Typography>
            </Box>
          </DialogContent>
          <DialogActions>
            {sent.link && (
              <Button variant="outlined" color="grey" onClick={() => void copy()}>
                {t(copied ? "team-invite-link-copy-again" : "team-invite-link-copy")}
              </Button>
            )}
            <Button variant="contained" onClick={onClose}>
              {t("team-done")}
            </Button>
          </DialogActions>
        </>
      ) : (
        <Box component="form" noValidate onSubmit={formik.handleSubmit}>
          <DialogContent>
            <Box className="flex flex-col gap-4">
              <FormControl className="outlined" variant="standard" error={Boolean(emailError)}>
                <FormLabel component="label" htmlFor="team-invite-email">
                  {t("team-invite-email")}
                </FormLabel>
                <Input
                  id="team-invite-email"
                  name="email"
                  type="email"
                  autoComplete="off"
                  autoFocus
                  value={formik.values.email}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  disabled={busy}
                  aria-describedby="team-invite-email-help"
                />
                <FormHelperText id="team-invite-email-help">{emailError ?? t("team-invite-email-help")}</FormHelperText>
              </FormControl>

              <FormControl component="fieldset">
                <FormLabel component="legend" id="team-invite-function" className="mb-1">
                  {t("team-invite-function")}
                </FormLabel>
                <RadioGroup
                  aria-labelledby="team-invite-function"
                  name="firmFunction"
                  value={formik.values.firmFunction}
                  onChange={formik.handleChange}
                >
                  {FIRM_FUNCTIONS.map((option) => (
                    <FormControlLabel
                      key={option}
                      value={option}
                      disabled={busy}
                      control={<Radio size="small" />}
                      className="items-start py-1"
                      label={
                        <Box className="flex flex-col pt-0.5">
                          <Typography variant="body1" component="span" className="font-semibold">
                            {t(FUNCTION_LABEL_KEY[option])}
                          </Typography>
                          <Typography variant="body2" component="span" className="text-text-secondary">
                            {t(FUNCTION_HINT_KEY[option])}
                          </Typography>
                        </Box>
                      }
                    />
                  ))}
                </RadioGroup>
              </FormControl>

              {mayInviteAdmin && (
                <FormControlLabel
                  className="items-start"
                  control={
                    <Checkbox
                      size="small"
                      name="admin"
                      checked={formik.values.admin}
                      onChange={formik.handleChange}
                      disabled={busy}
                    />
                  }
                  label={
                    <Box className="flex flex-col pt-0.5">
                      <Typography variant="body1" component="span" className="font-semibold">
                        {t("team-invite-admin")}
                      </Typography>
                      <Typography variant="body2" component="span" className="text-text-secondary">
                        {t("team-invite-admin-help")}
                      </Typography>
                    </Box>
                  }
                />
              )}

              {errorCode && (
                <Alert
                  severity="error"
                  className="neutral bg-background-paper/60!"
                  action={
                    errorCode === "second_factor_required" ? (
                      <Button color="inherit" size="small" component={Link} href="/settings/security">
                        {t("team-second-factor-open")}
                      </Button>
                    ) : undefined
                  }
                >
                  {t(teamErrorKey(errorCode))}
                </Alert>
              )}

              {emailOk === false && (
                <Typography variant="body2" className="text-text-secondary">
                  {t("team-invite-email-off")}
                </Typography>
              )}
            </Box>
          </DialogContent>
          <DialogActions className="flex-wrap gap-2">
            <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
              {t("team-cancel")}
            </Button>
            <Button
              type={emailOk ? "button" : "submit"}
              variant={emailOk ? "outlined" : "contained"}
              color={emailOk ? "grey" : "primary"}
              onClick={() => {
                if (emailOk) send("link");
                else deliver.current = "link";
              }}
              disabled={busy}
            >
              {busy && deliver.current === "link" ? t("team-working") : t("team-invite-copy-link")}
            </Button>
            {emailOk ? (
              <Button
                type="submit"
                variant="contained"
                onClick={() => {
                  deliver.current = "email";
                }}
                disabled={busy}
              >
                {busy && deliver.current === "email" ? t("team-working") : t("team-invite-email-send")}
              </Button>
            ) : null}
          </DialogActions>
        </Box>
      )}
    </Dialog>
  );
}
