"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  FormHelperText,
  FormLabel,
  Grid,
  Input,
  Typography,
} from "@mui/material";

import { TILE_TONE } from "@/components/product/tile-tone";
import NiPlug from "@/icons/nexture/ni-plug";
import { cn } from "@/lib/utils";
import { connectSimulator, connectWithSignup, disconnectNumber, finishRegistration } from "@/lib/whatsapp/actions";
import { type ConnectEnvironment, connectErrorKey, type PendingRegistration } from "@/lib/whatsapp/connections";

/** The vendor's browser SDK, as far as the signup window needs it (the Embedded Signup reference, read on 2026-10-09). */
type FacebookSdk = {
  init(options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(
    callback: (response: { authResponse?: { code?: string } | null }) => void,
    options: {
      config_id: string;
      response_type: "code";
      override_default_response_type: true;
      extras: { setup: object };
    },
  ): void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";

/** The signup events that mean the firm finished: with a number of the platform, or one that lives on its phone. */
const FINISHED = ["FINISH", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", "FINISH_ONLY_WABA"];

/** How long the window's own message may trail the code it returns. The code lives 30 seconds. */
const SESSION_WAIT_MS = 5_000;

type SignupSession = { wabaId: string; phoneNumberId: string | null } | "cancelled" | null;

/**
 * Loads the vendor's SDK, once. Nothing of the vendor is on the page until
 * somebody who manages the firm asks to connect: the logged area carries no
 * third-party script otherwise.
 */
function loadSdk(config: NonNullable<ConnectEnvironment["signup"]>): Promise<FacebookSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      if (!window.FB) {
        reject(new Error("sdk_unavailable"));
        return;
      }
      window.FB.init({ appId: config.appId, autoLogAppEvents: false, xfbml: false, version: config.sdkVersion });
      resolve(window.FB);
    };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => reject(new Error("sdk_unavailable"));
    document.body.appendChild(script);
  });
}

/**
 * Putting the firm's number to work. What it offers depends on what this
 * environment can do: the vendor's signup window when the platform's app is
 * configured, the simulator when it is on, and otherwise a sentence that says
 * what is missing instead of a button that would fail.
 */
export default function ConnectCard({
  firmName,
  again,
  pending,
  environment,
  blocked,
  onConnected,
}: {
  firmName: string;
  /** The firm had a number before: this is connecting again. */
  again: boolean;
  pending: PendingRegistration[];
  environment: ConnectEnvironment;
  /** No second factor in this session, or a support visit: the screen already says why. */
  blocked: boolean;
  onConnected: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [sdk, setSdk] = useState<FacebookSdk | null>(null);
  const [registrationCode, setRegistrationCode] = useState("");
  const session = useRef<SignupSession>(null);

  // What the signup window says when it ends: which account, and which number when it names one.
  useEffect(() => {
    if (!environment.signup) return;
    const onMessage = (event: MessageEvent) => {
      let host = "";
      try {
        host = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return;
      let payload: unknown = event.data;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }
      if (typeof payload !== "object" || payload === null) return;
      const message = payload as {
        type?: string;
        event?: string;
        data?: { waba_id?: unknown; phone_number_id?: unknown };
      };
      if (message.type !== "WA_EMBEDDED_SIGNUP") return;
      if (message.event && FINISHED.includes(message.event) && message.data?.waba_id) {
        session.current = {
          wabaId: String(message.data.waba_id),
          phoneNumberId: message.data.phone_number_id ? String(message.data.phone_number_id) : null,
        };
      } else if (message.event === "CANCEL" || message.event === "ERROR") {
        session.current = "cancelled";
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [environment.signup]);

  const finish = (result: { ok: boolean; code: string }) => {
    setBusy(false);
    // The token is sealed and the six digits are missing: the screen asks for them next.
    if (!result.ok && result.code !== "registration_code_needed") {
      setErrorCode(result.code);
      return;
    }
    onConnected();
  };

  const prepare = async () => {
    if (!environment.signup || busy) return;
    setBusy(true);
    setErrorCode(null);
    try {
      setSdk(await loadSdk(environment.signup));
    } catch {
      setErrorCode("signup_incomplete");
    }
    setBusy(false);
  };

  // Called straight from the click: a browser only lets a window open from one.
  const openSignup = () => {
    if (!environment.signup || !sdk || busy) return;
    setBusy(true);
    setErrorCode(null);
    session.current = null;
    sdk.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          finish({ ok: false, code: "signup_incomplete" });
          return;
        }
        const started = Date.now();
        const submit = () => {
          const info = session.current;
          if (info === "cancelled") {
            finish({ ok: false, code: "signup_incomplete" });
          } else if (info) {
            void connectWithSignup({ code, wabaId: info.wabaId, phoneNumberId: info.phoneNumberId }).then(finish);
          } else if (Date.now() - started > SESSION_WAIT_MS) {
            finish({ ok: false, code: "signup_incomplete" });
          } else {
            window.setTimeout(submit, 100);
          }
        };
        submit();
      },
      {
        config_id: environment.signup.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {} },
      },
    );
  };

  const connectSimulated = async () => {
    if (busy) return;
    setBusy(true);
    setErrorCode(null);
    finish(await connectSimulator());
  };

  const register = async (connectionId: string) => {
    if (busy || registrationCode.length !== 6) return;
    setBusy(true);
    setErrorCode(null);
    const result = await finishRegistration({ connectionId, registrationCode });
    setRegistrationCode("");
    finish(result);
  };

  const giveUp = async (connectionId: string) => {
    if (busy) return;
    setBusy(true);
    setErrorCode(null);
    const result = await disconnectNumber(connectionId);
    setRegistrationCode("");
    finish(result);
  };

  const waiting = pending[0] ?? null;
  const nothingToConnectWith = !environment.signup && !environment.simulator;

  return (
    <Grid size={12}>
      <Card component="section" aria-labelledby="connections-connect">
        <CardContent className="flex flex-col gap-5">
          <Box className="flex flex-row items-start gap-3">
            <span
              aria-hidden
              className={cn(
                "flex h-10 w-10 flex-none items-center justify-center rounded-2xl [&_svg]:h-5 [&_svg]:w-5",
                TILE_TONE.primary.bg,
                TILE_TONE.primary.text,
              )}
            >
              <NiPlug />
            </span>
            <Box className="flex min-w-0 flex-col gap-1">
              <Typography id="connections-connect" variant="h5" component="h2" className="mb-0">
                {waiting
                  ? t("connections-register-title", { number: waiting.phoneLabel })
                  : again
                    ? t("connections-connect-again-title")
                    : t("connections-connect-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary max-w-3xl">
                {waiting ? t("connections-register-body") : t("connections-connect-body", { firm: firmName })}
              </Typography>
            </Box>
          </Box>

          {!environment.vault ? (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              {t("connections-environment-vault")}
            </Alert>
          ) : waiting ? (
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 5 }}>
                <FormControl fullWidth className="outlined" variant="standard">
                  <FormLabel component="label" htmlFor="connections-registration-code">
                    {t("connections-register-code")}
                  </FormLabel>
                  <Input
                    id="connections-registration-code"
                    value={registrationCode}
                    onChange={(event) => {
                      setRegistrationCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                      setErrorCode(null);
                    }}
                    disabled={busy || blocked}
                    autoComplete="off"
                    inputProps={{ inputMode: "numeric", maxLength: 6 }}
                    aria-describedby="connections-registration-code-help"
                  />
                  <FormHelperText id="connections-registration-code-help">
                    {t("connections-register-code-help")}
                  </FormHelperText>
                </FormControl>
              </Grid>
              <Grid size={12} className="flex flex-row flex-wrap gap-2">
                <Button
                  variant="contained"
                  onClick={() => void register(waiting.connectionId)}
                  disabled={busy || blocked || registrationCode.length !== 6}
                >
                  {busy ? t("connections-working") : t("connections-register-confirm")}
                </Button>
                {/* The way out: the access the firm gave is discarded, and nothing is left half connected. */}
                <Button
                  variant="text"
                  color="grey"
                  onClick={() => void giveUp(waiting.connectionId)}
                  disabled={busy || blocked}
                >
                  {t("connections-register-cancel")}
                </Button>
              </Grid>
            </Grid>
          ) : nothingToConnectWith ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("connections-environment-meta")}
            </Alert>
          ) : (
            <Box className="flex flex-col gap-3">
              <Box className="flex flex-row flex-wrap gap-2">
                {environment.signup ? (
                  sdk ? (
                    <Button variant="contained" onClick={openSignup} disabled={busy || blocked}>
                      {busy ? t("connections-working") : t("connections-signup-open")}
                    </Button>
                  ) : (
                    <Button variant="contained" onClick={() => void prepare()} disabled={busy || blocked}>
                      {busy ? t("connections-working") : t("connections-signup-prepare")}
                    </Button>
                  )
                ) : null}
                {environment.simulator ? (
                  <Button
                    variant={environment.signup ? "outlined" : "contained"}
                    color={environment.signup ? "grey" : "primary"}
                    onClick={() => void connectSimulated()}
                    disabled={busy || blocked}
                  >
                    {busy && !environment.signup ? t("connections-working") : t("connections-simulator-connect")}
                  </Button>
                ) : null}
              </Box>
              {environment.signup ? (
                <Typography variant="body2" className="text-text-secondary max-w-3xl">
                  {sdk ? t("connections-signup-open-help") : t("connections-signup-prepare-help")}
                </Typography>
              ) : null}
              {environment.simulator ? (
                <Typography variant="body2" className="text-text-secondary max-w-3xl">
                  {t("connections-simulator-help")}
                </Typography>
              ) : null}
            </Box>
          )}

          {errorCode ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t(connectErrorKey(errorCode))}
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </Grid>
  );
}
