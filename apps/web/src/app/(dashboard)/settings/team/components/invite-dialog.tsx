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
import InvitationLink from "@/components/product/invitation-link";
import { useEmailReady } from "@/components/product/use-email-ready";
import { inviteToFirm } from "@/lib/firm/actions";
import { FIRM_FUNCTIONS, type FirmFunction, FUNCTION_HINT_KEY, FUNCTION_LABEL_KEY } from "@/lib/firm/roles";

/** What came of an invitation: its link always, and whether the e-mail left (asked for, or the link chosen). */
type Sent = { email: string; url: string; emailed: boolean; chosen: boolean };

/**
 * Invites somebody to the firm: the address, what the person will do, and
 * (the owner only) whether they also manage the firm account. One screen
 * (the owner, 2026-11-03: the result on a screen of its own read as a second
 * dialog): the fields, then "Copiar link" or "Enviar por e-mail", the second
 * offered only where ONE can send one; once the invitation exists the fields
 * stay as they were sent, and its link shows under them with what became of
 * the e-mail, so the manager can always send it by hand too. The invitation
 * exists either way.
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
      if (sent) return;
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
      setSent({ email: values.email.trim().toLowerCase(), url: result.url, emailed: result.emailed, chosen });
      // The link asked for is copied at once: the next thing the manager does is paste it.
      if (chosen) await copy(result.url);
      onInvited();
    },
  });

  const copy = async (link: string | null | undefined = sent?.url) => {
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
  // Once the invitation exists the fields say what it was sent with, and change no more.
  const locked = busy || sent !== null;
  const emailError = formik.touched.email ? formik.errors.email : undefined;

  const outcome = !sent
    ? null
    : sent.emailed
      ? { severity: "success" as const, text: t("team-invite-emailed-link", { email: sent.email }) }
      : sent.chosen
        ? {
            severity: "success" as const,
            text: t(copied ? "team-invite-link-ready-copied" : "team-invite-link-ready", { email: sent.email }),
          }
        : { severity: "warning" as const, text: t("team-invite-not-emailed", { email: sent.email }) };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="team-invite-dialog">
      <DialogHeader
        id="team-invite-dialog"
        title={t("team-invite-title", { firm: firmName })}
        onClose={onClose}
        closeLabel={t("team-close")}
      />

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
                readOnly={sent !== null}
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
                    disabled={locked}
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
                    disabled={locked}
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

            {errorCode && !sent && (
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

            {emailOk === false && !sent && (
              <Typography variant="body2" className="text-text-secondary">
                {t("team-invite-email-off")}
              </Typography>
            )}

            {sent && outcome ? (
              <>
                <Alert severity={outcome.severity} className="neutral bg-background-paper/60!" role="status">
                  {outcome.text}
                </Alert>
                <InvitationLink
                  id="team-invite-link"
                  label={t("team-invite-link")}
                  link={sent.url}
                  copied={copied}
                  onCopy={() => void copy()}
                  copyLabel={t("team-invite-link-copy")}
                  copyAgainLabel={t("team-invite-link-copy-again")}
                  copiedHelp={t("team-invite-link-copied")}
                  help={t("team-invite-link-help")}
                />
                <Typography variant="body2" className="text-text-secondary">
                  {t("team-invite-next")}
                </Typography>
              </>
            ) : null}
          </Box>
        </DialogContent>
        <DialogActions className="flex-wrap gap-2">
          {sent ? (
            <Button variant="contained" onClick={onClose}>
              {t("team-done")}
            </Button>
          ) : (
            <>
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
            </>
          )}
        </DialogActions>
      </Box>
    </Dialog>
  );
}
