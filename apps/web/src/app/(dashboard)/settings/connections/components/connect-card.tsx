"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Grid,
  Input,
  Typography,
} from "@mui/material";

import { TILE_TONE } from "@/components/product/tile-tone";
import NiPlug from "@/icons/nexture/ni-plug";
import { cn } from "@/lib/utils";
import {
  connectSimulator,
  connectWithOpenWa,
  connectWithSignup,
  connectWithToken,
  disconnectNumber,
  finishRegistration,
  readOpenWaLink,
} from "@/lib/whatsapp/actions";
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
  embedded = false,
  openWaPending = null,
}: {
  firmName: string;
  /** The firm had a number before: this is connecting again. */
  again: boolean;
  pending: PendingRegistration[];
  environment: ConnectEnvironment;
  /** No second factor in this session, or a support visit: the screen already says why. */
  blocked: boolean;
  onConnected: () => void;
  /** Inside another screen's flow (the firm's setup): the section without its card, its title a level down. */
  embedded?: boolean;
  /** A number being linked by WhatsApp Web whose QR the phone has not read yet (0221): the screen goes on with it. */
  openWaPending?: { connectionId: string } | null;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [sdk, setSdk] = useState<FacebookSdk | null>(null);
  const [registrationCode, setRegistrationCode] = useState("");
  // The connection with the firm's own token at Meta: open at once while the signup window is not offered.
  const [tokenOpen, setTokenOpen] = useState(!environment.signup);
  const [tokenFields, setTokenFields] = useState({ wabaId: "", phoneNumberId: "", token: "", code: "" });
  const session = useRef<SignupSession>(null);
  // WhatsApp Web, by the platform's OpenWA (0221): the risk said and accepted, then the QR read again until the phone reads it.
  const [openWaOpen, setOpenWaOpen] = useState(false);
  const [openWaAccepted, setOpenWaAccepted] = useState(false);
  const [linking, setLinking] = useState<string | null>(openWaPending?.connectionId ?? null);
  const [qr, setQr] = useState<string | null>(null);
  // The screen's own refresh, read by the look below without starting it again each time the screen draws.
  const connected = useRef(onConnected);
  useEffect(() => {
    connected.current = onConnected;
  }, [onConnected]);

  useEffect(() => {
    if (!linking) return;
    let live = true;
    let timer: number | undefined;
    const look = async () => {
      const state = await readOpenWaLink(linking).catch(() => null);
      if (!live) return;
      if (state?.ok && state.code === "connected") {
        setLinking(null);
        setQr(null);
        connected.current();
        return;
      }
      if (state && !state.ok) {
        setLinking(null);
        setQr(null);
        setErrorCode(state.code);
        return;
      }
      setQr(state?.ok && state.code === "qr" ? state.qr : null);
      // The QR changes about every 20 seconds, and a person reads it in a few: looked at again every 3.
      if (document.visibilityState === "visible") timer = window.setTimeout(() => void look(), 3_000);
      else timer = window.setTimeout(() => void look(), 10_000);
    };
    void look();
    return () => {
      live = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [linking]);

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

  const tokenReady =
    /^\d{5,30}$/.test(tokenFields.wabaId.trim()) &&
    /^\d{5,30}$/.test(tokenFields.phoneNumberId.trim()) &&
    tokenFields.token.trim().length >= 40 &&
    (tokenFields.code === "" || tokenFields.code.length === 6);

  const connectToken = async () => {
    if (busy || !tokenReady) return;
    setBusy(true);
    setErrorCode(null);
    const result = await connectWithToken({
      token: tokenFields.token,
      wabaId: tokenFields.wabaId,
      phoneNumberId: tokenFields.phoneNumberId,
      registrationCode: tokenFields.code || null,
    });
    // The token never stays on the page once the server has it: what is kept is in the vault.
    if (result.ok || result.code === "registration_code_needed") {
      setTokenFields({ wabaId: "", phoneNumberId: "", token: "", code: "" });
    }
    finish(result);
  };

  const setTokenField = (field: keyof typeof tokenFields, value: string) => {
    setTokenFields((current) => ({ ...current, [field]: value }));
    setErrorCode(null);
  };

  const startOpenWa = async () => {
    if (busy || !openWaAccepted) return;
    setBusy(true);
    setErrorCode(null);
    const result = await connectWithOpenWa().catch(() => ({ ok: false, code: "failed" }) as const);
    setBusy(false);
    if (!result.ok && result.code === "openwa_qr" && "connectionId" in result && result.connectionId) {
      setLinking(result.connectionId);
      return;
    }
    if (!result.ok) setErrorCode(result.code);
  };

  const cancelOpenWa = async () => {
    if (!linking) return;
    const connectionId = linking;
    setLinking(null);
    setQr(null);
    await disconnectNumber(connectionId).catch(() => undefined);
    onConnected();
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
  const nothingToConnectWith =
    !environment.signup && !environment.simulator && !environment.token && !environment.openwa;

  const openWaPanel = linking ? (
    <Box className="flex flex-col gap-3">
      <Typography variant="subtitle2" component="p" className="mb-0">
        {t("connections-openwa-scan")}
      </Typography>
      {qr ? (
        // The QR the platform's OpenWA drew, as a PNG data address: nothing is fetched from elsewhere.

        <img
          src={qr}
          alt={t("connections-openwa-qr-alt")}
          width={240}
          height={240}
          className="rounded-xl bg-white p-2"
        />
      ) : (
        <Typography variant="body2" className="text-text-secondary">
          {t("connections-openwa-preparing")}
        </Typography>
      )}
      <Box>
        <Button variant="text" color="grey" onClick={() => void cancelOpenWa()} disabled={busy}>
          {t("connections-openwa-cancel")}
        </Button>
      </Box>
    </Box>
  ) : openWaOpen ? (
    <Box className="flex flex-col gap-3">
      <Alert severity="warning" className="neutral bg-background-paper/60!">
        {t("connections-openwa-risk")}
      </Alert>
      <FormControlLabel
        control={<Checkbox checked={openWaAccepted} onChange={(event) => setOpenWaAccepted(event.target.checked)} />}
        label={t("connections-openwa-accept")}
      />
      <Box className="flex flex-row flex-wrap gap-2">
        <Button variant="contained" onClick={() => void startOpenWa()} disabled={busy || blocked || !openWaAccepted}>
          {busy ? t("connections-working") : t("connections-openwa-start")}
        </Button>
        <Button variant="text" color="grey" onClick={() => setOpenWaOpen(false)} disabled={busy}>
          {t("connections-openwa-back")}
        </Button>
      </Box>
    </Box>
  ) : null;

  const tokenForm = (
    <Box component="form" className="flex flex-col gap-4" onSubmit={(event) => event.preventDefault()}>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <FormControl fullWidth className="outlined" variant="standard">
            <FormLabel component="label" htmlFor="connections-token-waba">
              {t("connections-token-waba")}
            </FormLabel>
            <Input
              id="connections-token-waba"
              value={tokenFields.wabaId}
              onChange={(event) => setTokenField("wabaId", event.target.value.replace(/\D/g, "").slice(0, 30))}
              disabled={busy || blocked}
              autoComplete="off"
              inputProps={{ inputMode: "numeric" }}
            />
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <FormControl fullWidth className="outlined" variant="standard">
            <FormLabel component="label" htmlFor="connections-token-number">
              {t("connections-token-number")}
            </FormLabel>
            <Input
              id="connections-token-number"
              value={tokenFields.phoneNumberId}
              onChange={(event) => setTokenField("phoneNumberId", event.target.value.replace(/\D/g, "").slice(0, 30))}
              disabled={busy || blocked}
              autoComplete="off"
              inputProps={{ inputMode: "numeric" }}
            />
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          <FormControl fullWidth className="outlined" variant="standard">
            <FormLabel component="label" htmlFor="connections-token-value">
              {t("connections-token-value")}
            </FormLabel>
            <Input
              id="connections-token-value"
              type="password"
              value={tokenFields.token}
              onChange={(event) => setTokenField("token", event.target.value.trim())}
              disabled={busy || blocked}
              autoComplete="off"
              aria-describedby="connections-token-value-help"
            />
            <FormHelperText id="connections-token-value-help">{t("connections-token-value-help")}</FormHelperText>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <FormControl fullWidth className="outlined" variant="standard">
            <FormLabel component="label" htmlFor="connections-token-code">
              {t("connections-token-code")}
            </FormLabel>
            <Input
              id="connections-token-code"
              value={tokenFields.code}
              onChange={(event) => setTokenField("code", event.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={busy || blocked}
              autoComplete="off"
              inputProps={{ inputMode: "numeric", maxLength: 6 }}
              aria-describedby="connections-token-code-help"
            />
            <FormHelperText id="connections-token-code-help">{t("connections-token-code-help")}</FormHelperText>
          </FormControl>
        </Grid>
      </Grid>
      <Box className="flex flex-row flex-wrap gap-2">
        <Button
          type="submit"
          variant="contained"
          onClick={() => void connectToken()}
          disabled={busy || blocked || !tokenReady}
        >
          {busy ? t("connections-working") : t("connections-token-connect")}
        </Button>
      </Box>
    </Box>
  );

  const content = (
    <>
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
          <Typography
            id="connections-connect"
            variant={embedded ? "subtitle2" : "h5"}
            component={embedded ? "h3" : "h2"}
            className="mb-0"
          >
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
          <Box className="flex flex-row flex-wrap gap-2 empty:hidden">
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
            {environment.openwa && !openWaOpen && !linking ? (
              <Button variant="outlined" color="grey" onClick={() => setOpenWaOpen(true)} disabled={busy || blocked}>
                {t("connections-openwa-open")}
              </Button>
            ) : null}
            {environment.token && environment.signup && !tokenOpen ? (
              <Button variant="outlined" color="grey" onClick={() => setTokenOpen(true)} disabled={busy || blocked}>
                {t("connections-token-open")}
              </Button>
            ) : null}
            {environment.simulator ? (
              <Button
                variant={environment.signup || environment.token ? "outlined" : "contained"}
                color={environment.signup || environment.token ? "grey" : "primary"}
                onClick={() => void connectSimulated()}
                disabled={busy || blocked}
              >
                {busy && !environment.signup && !environment.token
                  ? t("connections-working")
                  : t("connections-simulator-connect")}
              </Button>
            ) : null}
          </Box>
          {openWaPanel}
          {environment.token && tokenOpen && !openWaPanel ? tokenForm : null}
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
    </>
  );

  if (embedded) {
    return (
      <Box component="section" aria-labelledby="connections-connect" className="flex flex-col gap-4">
        {content}
      </Box>
    );
  }
  return (
    <Grid size={12}>
      <Card component="section" aria-labelledby="connections-connect">
        <CardContent className="flex flex-col gap-5">{content}</CardContent>
      </Card>
    </Grid>
  );
}
