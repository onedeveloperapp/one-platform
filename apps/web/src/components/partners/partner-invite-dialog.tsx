"use client";

import { useFormik } from "formik";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
import { inviteAgency, invitePartnerColleague, type PartnerInviteResult } from "@/lib/partners/actions";
import { partnerErrorKey } from "@/lib/partners/partner";

type Sent = { email: string; link: string | null };

/**
 * An invitation to a partner of a firm (migration 0069), in the two ways one is sent: a firm inviting a travel
 * agency, by its name and the e-mail of its first person (`mode: "agency"`), or who manages the agency inviting a
 * colleague (`mode: "colleague"`, the owner choosing whether the colleague also manages it). The link goes by
 * e-mail; when the e-mail cannot leave, it is shown here to be sent by hand, and the invitation exists either way.
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
      setErrorCode(null);
      let result: PartnerInviteResult;
      try {
        result =
          mode === "agency"
            ? await inviteAgency({ module: module ?? "", partnerName: values.name, email: values.email })
            : await invitePartnerColleague({
                email: values.email,
                role: mayInviteAdmin && values.admin === "admin" ? "admin" : "member",
              });
      } catch {
        result = { ok: false, code: "failed" };
      }
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }
      setSent({ email: values.email.trim().toLowerCase(), link: result.link });
      onInvited();
    },
  });

  const copy = async () => {
    if (!sent?.link) return;
    try {
      await navigator.clipboard.writeText(sent.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const busy = formik.isSubmitting;
  const nameError = formik.touched.name ? formik.errors.name : undefined;
  const emailError = formik.touched.email ? formik.errors.email : undefined;

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="partner-invite-dialog">
      <DialogHeader id="partner-invite-dialog" title={title} onClose={onClose} closeLabel={t("partners-close")} />

      {sent ? (
        <>
          <DialogContent>
            <Box className="flex flex-col gap-4">
              <Alert severity={sent.link ? "warning" : "success"} className="neutral bg-background-paper/60!">
                {sent.link
                  ? t("partners-invite-not-emailed", { email: sent.email })
                  : t("partners-invite-sent", { email: sent.email })}
              </Alert>
              {sent.link && (
                <FormControl className="outlined" variant="standard">
                  <FormLabel htmlFor="partner-invite-link">{t("partners-invite-link")}</FormLabel>
                  <Input
                    id="partner-invite-link"
                    value={sent.link}
                    readOnly
                    aria-describedby="partner-invite-link-help"
                  />
                  <FormHelperText id="partner-invite-link-help">
                    {copied ? t("partners-invite-copied") : t("partners-invite-link-help")}
                  </FormHelperText>
                </FormControl>
              )}
            </Box>
          </DialogContent>
          <DialogActions>
            {sent.link && (
              <Button variant="outlined" color="grey" onClick={() => void copy()}>
                {t("partners-invite-copy")}
              </Button>
            )}
            <Button variant="contained" onClick={onClose}>
              {t("partners-done")}
            </Button>
          </DialogActions>
        </>
      ) : (
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
                      disabled={busy}
                      control={<Radio size="small" />}
                      label={t("partner-team-invite-member")}
                    />
                    <FormControlLabel
                      value="admin"
                      disabled={busy}
                      control={<Radio size="small" />}
                      label={t("partner-team-invite-admin")}
                    />
                  </RadioGroup>
                </FormControl>
              )}
              {errorCode && (
                <Alert severity="error" className="neutral bg-background-paper/60!">
                  {t(partnerErrorKey(errorCode))}
                </Alert>
              )}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" color="grey" onClick={onClose} disabled={busy}>
              {t("partners-cancel")}
            </Button>
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? t("partners-sending") : t("partners-invite-submit")}
            </Button>
          </DialogActions>
        </Box>
      )}
    </Dialog>
  );
}
