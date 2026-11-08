"use client";

import { useFormik } from "formik";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import * as yup from "yup";

import {
  Alert,
  Box,
  Button,
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
import { inviteAgency, invitePartnerColleague, type PartnerInviteResult } from "@/lib/partners/actions";
import { partnerErrorKey } from "@/lib/partners/partner";

/** What came of an invitation: its link always, and whether the e-mail left (asked for, or the link chosen). */
type Sent = { email: string; url: string; emailed: boolean; chosen: boolean };

/**
 * An invitation to a partner of a firm (migration 0069), in the two ways one is sent: a firm inviting a travel
 * agency, by its name and the e-mail of its first person (`mode: "agency"`), or who manages the agency inviting a
 * colleague (`mode: "colleague"`, the owner choosing whether the colleague also manages it). One screen (the owner,
 * 2026-11-03: the result on a screen of its own read as a second dialog): the fields, then "Copiar link" or
 * "Enviar por e-mail", the second offered only where ONE can send one; once the invitation exists the fields stay
 * as they were sent, and its link shows under them with what became of the e-mail, so the inviter can always send
 * it by hand too. The invitation exists either way.
 * Kept beside the closest shape of the app, the invitation to a firm's team (`settings/team/invite-dialog.tsx`).
 */
export default function PartnerInviteDialog({
  mode,
  module,
  title,
  mayInviteAdmin = false,
  onClose,
  onInvited,
}: {
  mode: "agency" | "colleague";
  /** The module the agency is invited to (mode `agency`). */
  module?: string;
  title: string;
  /** Only the owner of a partner hands out the admin role. */
  mayInviteAdmin?: boolean;
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
    initialValues: { name: "", email: "", admin: "member" as "admin" | "member" },
    validationSchema: yup.object({
      name:
        mode === "agency"
          ? yup.string().trim().required(t("partners-invite-name-required")).min(2, t("partners-invite-name-required"))
          : yup.string(),
      email: yup
        .string()
        .trim()
        .required(t("partners-invite-email-required"))
        .email(t("partners-invite-email-invalid")),
    }),
    validateOnBlur: true,
    onSubmit: async (values) => {
      if (sent) return;
      setErrorCode(null);
      let result: PartnerInviteResult;
      const chosen = !emailOk || deliver.current === "link";
      try {
        const way = chosen ? "link" : "email";
        result =
          mode === "agency"
            ? await inviteAgency({ module: module ?? "", partnerName: values.name, email: values.email, deliver: way })
            : await invitePartnerColleague({
                email: values.email,
                role: mayInviteAdmin && values.admin === "admin" ? "admin" : "member",
                deliver: way,
              });
      } catch {
        result = { ok: false, code: "failed" };
      }
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }
      setSent({ email: values.email.trim().toLowerCase(), url: result.url, emailed: result.emailed, chosen });
      // The link asked for is copied at once: the next thing the inviter does is paste it.
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
  const nameError = formik.touched.name ? formik.errors.name : undefined;
  const emailError = formik.touched.email ? formik.errors.email : undefined;

  const outcome = !sent
    ? null
    : sent.emailed
      ? { severity: "success" as const, text: t("partners-invite-emailed-link", { email: sent.email }) }
      : sent.chosen
        ? {
            severity: "success" as const,
            text: t(copied ? "partners-invite-link-ready-copied" : "partners-invite-link-ready", { email: sent.email }),
          }
        : { severity: "warning" as const, text: t("partners-invite-not-emailed", { email: sent.email }) };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="partner-invite-dialog">
      <DialogHeader id="partner-invite-dialog" title={title} onClose={onClose} closeLabel={t("partners-close")} />

      <Box component="form" noValidate onSubmit={formik.handleSubmit}>
        <DialogContent>
          <Box className="flex flex-col gap-4">
            {mode === "agency" && (
              <Typography variant="body2" className="text-text-secondary">
                {t("partners-privacy")}
              </Typography>
            )}
            {mode === "agency" && (
              <FormControl className="outlined" variant="standard" error={Boolean(nameError)}>
                <FormLabel component="label" htmlFor="partner-invite-name">
                  {t("partners-invite-name")}
                </FormLabel>
                <Input
                  id="partner-invite-name"
                  name="name"
                  autoComplete="off"
                  autoFocus
                  value={formik.values.name}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  readOnly={sent !== null}
                  disabled={busy}
                  aria-describedby="partner-invite-name-help"
                />
                <FormHelperText id="partner-invite-name-help">{nameError ?? " "}</FormHelperText>
              </FormControl>
            )}
            <FormControl className="outlined" variant="standard" error={Boolean(emailError)}>
              <FormLabel component="label" htmlFor="partner-invite-email">
                {mode === "agency" ? t("partners-invite-email") : t("partner-team-invite-email")}
              </FormLabel>
              <Input
                id="partner-invite-email"
                name="email"
                type="email"
                autoComplete="off"
                autoFocus={mode === "colleague"}
                value={formik.values.email}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                readOnly={sent !== null}
                disabled={busy}
                aria-describedby="partner-invite-email-help"
              />
              <FormHelperText id="partner-invite-email-help">
                {emailError ??
                  (mode === "agency" ? t("partners-invite-email-help") : t("partner-team-invite-email-help"))}
              </FormHelperText>
            </FormControl>
            {mode === "colleague" && mayInviteAdmin && (
              <FormControl component="fieldset">
                <FormLabel component="legend" id="partner-invite-role" className="mb-1">
                  {t("partner-team-invite-role")}
                </FormLabel>
                <RadioGroup
                  aria-labelledby="partner-invite-role"
                  name="admin"
                  value={formik.values.admin}
                  onChange={formik.handleChange}
                >
                  <FormControlLabel
                    value="member"
                    disabled={locked}
                    control={<Radio size="small" />}
                    label={t("partner-team-invite-member")}
                  />
                  <FormControlLabel
                    value="admin"
                    disabled={locked}
                    control={<Radio size="small" />}
                    label={t("partner-team-invite-admin")}
                  />
                </RadioGroup>
              </FormControl>
            )}
            {emailOk === false && !sent && (
              <Typography variant="body2" className="text-text-secondary">
                {t("partners-invite-email-off")}
              </Typography>
            )}
            {errorCode && !sent && (
              <Alert severity="error" className="neutral bg-background-paper/60!">
                {t(partnerErrorKey(errorCode))}
              </Alert>
            )}
            {sent && outcome ? (
              <>
                <Alert severity={outcome.severity} className="neutral bg-background-paper/60!" role="status">
                  {outcome.text}
                </Alert>
                <InvitationLink
                  id="partner-invite-link"
                  label={t("partners-invite-link")}
                  link={sent.url}
                  copied={copied}
                  onCopy={() => void copy()}
                  copyLabel={t("partners-invite-copy")}
                  copyAgainLabel={t("partners-invite-copy-again")}
                  copiedHelp={t("partners-invite-copied")}
                  help={t("partners-invite-link-help")}
                />
              </>
            ) : null}
          </Box>
        </DialogContent>
        <DialogActions className="flex-wrap gap-2">
          {sent ? (
            <Button variant="contained" onClick={onClose}>
              {t("partners-done")}
            </Button>
          ) : (
            <>
              <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
                {t("partners-cancel")}
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
                {busy && deliver.current === "link" ? t("partners-sending") : t("partners-invite-copy-link")}
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
                  {busy && deliver.current === "email" ? t("partners-sending") : t("partners-invite-email-send")}
                </Button>
              ) : null}
            </>
          )}
        </DialogActions>
      </Box>
    </Dialog>
  );
}
