"use client";
import { useFormik } from "formik";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import * as yup from "yup";

import {
  Alert,
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Input,
  Paper,
  Radio,
  RadioGroup,
  Typography,
} from "@mui/material";

import Logo from "@/components/logo/logo";
import { DEFAULTS } from "@/config";
import { useHydrated } from "@/hooks/use-hydrated";
import NiCrossSquare from "@/icons/nexture/ni-cross-square";
import { acceptInvitation, foundFirm } from "@/lib/firm/actions";
import {
  FIRM_FUNCTIONS,
  type FirmFunction,
  FUNCTION_HINT_KEY,
  FUNCTION_LABEL_KEY,
  isFirmFunction,
} from "@/lib/firm/roles";
import { enterAfterSessionChange, sanitizeInternalNext } from "@/lib/safe-next";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type PendingInvitation = {
  id: string;
  firm: string;
  invitedBy: string | null;
  firmFunction: FirmFunction | null;
  expiresAt: string;
};

/** The errors this screen has words for; anything else reads as "try again". */
const ERROR_KEYS: Record<string, string> = {
  already_in_a_firm: "firm-error-already-in-a-firm",
  invalid_firm_name: "firm-error-invalid-name",
  expired: "firm-error-expired",
  revoked: "firm-error-revoked",
  seat_limit: "firm-error-seat-limit",
  email_not_confirmed: "firm-error-email-not-confirmed",
  not_found: "firm-error-not-found",
  already_accepted: "firm-error-already-accepted",
};

/**
 * Where an account that belongs to no firm gets one: it accepts an invitation
 * addressed to its own confirmed e-mail, or founds a firm and becomes the
 * owner of its account. Sign-up creates the account and nothing else
 * (migration 0000), so every new person passes through here once.
 *
 * Guards itself: somebody who already belongs to a firm is sent to the app,
 * so the page cannot be reached spuriously.
 */
export default function Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("auth");
  const tp = useTranslations("product");
  const hydrated = useHydrated();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const destination = () => {
    const requestedNext = searchParams.get("next");
    return requestedNext ? sanitizeInternalNext(requestedNext, DEFAULTS.appRoot) : DEFAULTS.appRoot;
  };

  const enter = () => enterAfterSessionChange(destination());

  const validationSchema = yup.object({
    name: yup
      .string()
      .trim()
      .required(t("field-required"))
      .min(3, t("field-min", { count: 3 })),
    firm: yup
      .string()
      .trim()
      .required(t("field-required"))
      .min(2, t("field-min", { count: 2 }))
      .max(120, t("firm-name-too-long")),
    firmFunction: yup
      .string()
      .oneOf([...FIRM_FUNCTIONS])
      .required(t("field-required")),
  });

  const formik = useFormik({
    initialValues: { name: "", firm: "", firmFunction: "socio" as FirmFunction },
    validationSchema,
    validateOnBlur: true,
    validateOnMount: false,
    onSubmit: async (values) => {
      setErrorCode(null);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/auth/sign-in");
        return;
      }

      // The name the person confirmed here is the one the team will read.
      await supabase.from("profiles").update({ display_name: values.name.trim() }).eq("id", user.id);

      const result = await foundFirm({ name: values.firm, firmFunction: values.firmFunction });
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }
      await enter();
    },
  });

  const { resetForm } = formik;

  useEffect(() => {
    const check = async () => {
      if (!isSupabaseConfigured) {
        router.replace("/auth/sign-in");
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/auth/sign-in");
        return;
      }
      // Already in a firm: nothing to set up.
      const { data: membership } = await supabase
        .from("memberships")
        .select("org_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (membership) {
        const requestedNext = searchParams.get("next");
        void enterAfterSessionChange(
          requestedNext ? sanitizeInternalNext(requestedNext, DEFAULTS.appRoot) : DEFAULTS.appRoot,
        );
        return;
      }

      const { data: pending } = await supabase.rpc("my_firm_invitations");
      setInvitations(
        (
          (pending ?? []) as {
            id: string;
            firm: string;
            invited_by: string | null;
            firm_function: string;
            expires_at: string;
          }[]
        ).map((row) => ({
          id: row.id,
          firm: row.firm,
          invitedBy: row.invited_by,
          firmFunction: isFirmFunction(row.firm_function) ? row.firm_function : null,
          expiresAt: row.expires_at,
        })),
      );

      const meta = user.user_metadata ?? {};
      const suggestedName = meta.full_name ?? meta.name ?? meta.display_name ?? user.email?.split("@")[0] ?? "";
      resetForm({ values: { name: suggestedName, firm: "", firmFunction: "socio" } });
      setEmail(user.email ?? "");
      setReady(true);
    };
    check();
  }, [router, resetForm, searchParams]);

  const accept = async (invitationId: string) => {
    if (accepting) return;
    setErrorCode(null);
    setAccepting(invitationId);
    const result = await acceptInvitation(invitationId);
    if (!result.ok) {
      setErrorCode(result.code);
      setAccepting(null);
      return;
    }
    await enter();
  };

  const signOut = async () => {
    // This browser's session only: the person's other devices stay signed in.
    await createClient().auth.signOut({ scope: "local" });
    await enterAfterSessionChange("/auth/sign-in");
  };

  if (!ready) {
    // The ground of the card, with the wait said: the first reads go to the database, and a blank screen
    // while they come back reads as broken.
    return (
      <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
        <CircularProgress aria-label={tp("loading")} />
      </Box>
    );
  }

  const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" });
  const hasInvitations = invitations.length > 0;

  return (
    <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
      <Paper elevation={3} className="bg-background-paper shadow-darker-xs w-lg max-w-full rounded-4xl py-14">
        <Box className="flex flex-col gap-4 px-8 sm:px-14">
          <Box className="mb-10 flex justify-center">
            <Logo classNameFull="h-12 w-auto" classNameMobile="hidden" />
          </Box>

          <Box className="flex flex-col gap-8">
            <Box className="flex flex-col">
              <Typography variant="h1" component="h1" className="mb-2">
                {t("firm-title")}
              </Typography>
              <Typography variant="body1" className="text-text-primary">
                {hasInvitations ? t("firm-subtitle-invited") : t("firm-subtitle")}
              </Typography>
            </Box>

            {errorCode && (
              <Alert severity="error" icon={<NiCrossSquare />} className="neutral bg-background-paper/60!">
                <AlertTitle variant="subtitle2" className="mb-0">
                  {t(ERROR_KEYS[errorCode] ?? "firm-error-failed")}
                </AlertTitle>
              </Alert>
            )}

            {hasInvitations && (
              <Box component="section" className="flex flex-col gap-3" aria-labelledby="firm-invitations">
                <Typography id="firm-invitations" variant="h5" component="h2" className="mb-0">
                  {t("firm-invitations-title")}
                </Typography>
                {invitations.map((invitation) => (
                  <Box
                    key={invitation.id}
                    className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"
                  >
                    <Box className="flex min-w-0 flex-1 flex-col">
                      <Typography variant="subtitle2" component="p" className="break-words">
                        {invitation.firm}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary">
                        {[
                          invitation.invitedBy
                            ? t("firm-invitation-from", { inviter: invitation.invitedBy })
                            : t("firm-invitation-from-unknown"),
                          invitation.firmFunction ? tp(FUNCTION_LABEL_KEY[invitation.firmFunction]) : null,
                          t("firm-invitation-expires", { date: dateFormat.format(new Date(invitation.expiresAt)) }),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Typography>
                    </Box>
                    <Button
                      variant="contained"
                      onClick={() => void accept(invitation.id)}
                      disabled={accepting !== null || formik.isSubmitting}
                    >
                      {t("firm-invitation-accept")}
                    </Button>
                  </Box>
                ))}
                <Divider className="mt-4">
                  <Typography variant="body2" className="text-text-secondary">
                    {t("firm-or")}
                  </Typography>
                </Divider>
              </Box>
            )}

            <Box
              component="form"
              method="post"
              noValidate
              onSubmit={formik.handleSubmit}
              className="flex flex-col gap-1"
              aria-labelledby="firm-found"
            >
              {hasInvitations && (
                <Typography id="firm-found" variant="h5" component="h2" className="mb-3">
                  {t("firm-found-title")}
                </Typography>
              )}

              <FormControl
                className="outlined"
                variant="standard"
                size="small"
                error={Boolean(formik.touched.firm && formik.errors.firm)}
              >
                <FormLabel component="label" htmlFor="firm">
                  {t("firm-name")}
                </FormLabel>
                <Input
                  id="firm"
                  name="firm"
                  autoComplete="organization"
                  value={formik.values.firm}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  aria-describedby="firm-help"
                />
                <FormHelperText id="firm-help">
                  {formik.touched.firm && formik.errors.firm ? formik.errors.firm : t("firm-name-hint")}
                </FormHelperText>
              </FormControl>

              <FormControl
                className="outlined"
                variant="standard"
                size="small"
                error={Boolean(formik.touched.name && formik.errors.name)}
              >
                <FormLabel component="label" htmlFor="name">
                  {t("firm-your-name")}
                </FormLabel>
                <Input
                  id="name"
                  name="name"
                  autoComplete="name"
                  value={formik.values.name}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  aria-describedby={formik.touched.name && formik.errors.name ? "name-help" : undefined}
                />
                {formik.touched.name && formik.errors.name ? (
                  <FormHelperText id="name-help">{formik.errors.name}</FormHelperText>
                ) : null}
              </FormControl>

              <FormControl component="fieldset" className="mt-2">
                <FormLabel component="legend" id="firm-function-label" className="mb-1">
                  {t("firm-function")}
                </FormLabel>
                <RadioGroup
                  aria-labelledby="firm-function-label"
                  name="firmFunction"
                  value={formik.values.firmFunction}
                  onChange={formik.handleChange}
                >
                  {FIRM_FUNCTIONS.map((option) => (
                    <FormControlLabel
                      key={option}
                      value={option}
                      control={<Radio size="small" />}
                      className="items-start py-1"
                      label={
                        <Box className="flex flex-col pt-0.5">
                          <Typography variant="body1" component="span" className="font-semibold">
                            {tp(FUNCTION_LABEL_KEY[option])}
                          </Typography>
                          <Typography variant="body2" component="span" className="text-text-secondary">
                            {tp(FUNCTION_HINT_KEY[option])}
                          </Typography>
                        </Box>
                      }
                    />
                  ))}
                </RadioGroup>
              </FormControl>

              <Typography variant="body2" className="text-text-secondary mt-2">
                {t("firm-found-note")}
              </Typography>

              <Button
                type="submit"
                variant={hasInvitations ? "outlined" : "contained"}
                className="mt-4"
                disabled={formik.isSubmitting || accepting !== null || !hydrated}
              >
                {t("firm-found-submit")}
              </Button>
            </Box>

            <Box className="flex flex-col items-start gap-1">
              <Typography variant="body2" className="text-text-secondary">
                {t("firm-other-account-hint", { email })}
              </Typography>
              <Button variant="text" size="small" color="grey" className="-ml-2" onClick={() => void signOut()}>
                {t("firm-other-account")}
              </Button>
            </Box>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
