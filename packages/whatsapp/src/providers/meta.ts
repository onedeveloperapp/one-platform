import { failureCodeOf, fitsButtons, paramCountOf } from "@flyee/whatsapp/rules";
import type {
  AccountTemplate,
  MediaResult,
  OutboundMessage,
  SendError,
  SendResult,
  TemplateCreated,
  TemplateSubmission,
  WhatsAppProvider,
} from "@flyee/whatsapp/types";

/**
 * The official Cloud API, for one number of one firm.
 *
 * The firm's token comes from the vault (never from an environment
 * variable) and the Graph API version from configuration (`platform_settings`,
 * key `whatsapp`): the caller hands both in. Nothing here decides whether a
 * message may be sent; it carries what was already reserved and reports what
 * the vendor answered, as a code and never as the vendor's text, which can
 * quote the message.
 */

const GRAPH = "https://graph.facebook.com";

export interface MetaConfig {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  /** `v25.0`: from configuration, so a new version is a setting and not a deploy. */
  apiVersion: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
  /** How long a call may take. A message is short; a download may be large. */
  timeoutMs?: number;
}

type GraphError = { code?: number; error_subcode?: number; message?: string };

/** What the vendor's error code means for whoever sent the message (the error reference, read on 2026-10-09). */
export function sendErrorOf(code: number | undefined, httpStatus: number): { error: SendError; detail: string } {
  const detail = code === undefined ? `http_${httpStatus}` : `meta_${code}`;
  if (code === 131047) return { error: "window_closed", detail };
  if (code === 131026 || code === 131021) return { error: "invalid_recipient", detail };
  if (code === 190 || code === 0) return { error: "token_invalid", detail };
  if (code === 4 || code === 80007 || code === 130429 || code === 131056) return { error: "rate_limited", detail };
  // The vendor said, in its own words, that it could not take the message now.
  if (code === 131016 || code === 131000) return { error: "unavailable", detail };
  // A server error that names nothing (a gateway in the way): whether the message was taken is not known.
  if (code === undefined && httpStatus >= 500) return { error: "unconfirmed", detail };
  return { error: "rejected", detail };
}

/**
 * The code recorded for a message the vendor reported as failed after
 * accepting it (a status webhook carries the vendor's error code as text):
 * the same words a refused send gets, so a screen has one list to read.
 */
export function vendorFailureCode(vendorCode: string | null | undefined): string {
  const code = Number(vendorCode);
  const known = vendorCode !== null && vendorCode !== undefined && vendorCode !== "" && Number.isInteger(code);
  const { error, detail } = sendErrorOf(known ? code : undefined, 400);
  return failureCodeOf(error, known ? detail : undefined);
}

async function call(
  config: Pick<MetaConfig, "fetch" | "timeoutMs">,
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown } | null> {
  const run = config.fetch ?? fetch;
  try {
    const response = await run(url, { ...init, signal: AbortSignal.timeout(config.timeoutMs ?? 20_000) });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body };
  } catch {
    // A timeout or a network failure: the vendor did not answer.
    return null;
  }
}

const errorOf = (body: unknown): GraphError | undefined => (body as { error?: GraphError } | null)?.error ?? undefined;

/** Why a call that is not a send failed, as a code: the vendor's own, or the HTTP status when it gave none. */
function failureCode(answer: { status: number; body: unknown }, whenAccepted: string): string {
  const code = errorOf(answer.body)?.code;
  if (code !== undefined) return `meta_${code}`;
  return answer.status >= 200 && answer.status < 300 ? whenAccepted : `http_${answer.status}`;
}

function payloadOf(message: OutboundMessage): Record<string, unknown> {
  if (message.kind === "text" && message.choices) {
    // The person taps a choice; its title comes back as the reply's words (`button_reply`, `list_reply`).
    const { body, options } = message.choices;
    if (fitsButtons(options)) {
      return {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: body },
          action: {
            buttons: options.map((title, index) => ({ type: "reply", reply: { id: `opcao-${index + 1}`, title } })),
          },
        },
      };
    }
    return {
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: body },
        action: {
          button: "Escolher",
          sections: [{ title: "Opções", rows: options.map((title, index) => ({ id: `opcao-${index + 1}`, title })) }],
        },
      },
    };
  }
  if (message.kind === "text") return { type: "text", text: { body: message.text } };
  if (message.kind === "template") {
    const parameters = (message.bodyParams ?? []).map((value) => ({ type: "text", text: value }));
    return {
      type: "template",
      template: {
        name: message.name,
        language: { code: message.language ?? "pt_BR" },
        ...(parameters.length > 0 ? { components: [{ type: "body", parameters }] } : {}),
      },
    };
  }
  const media = {
    link: message.url,
    ...(message.caption ? { caption: message.caption } : {}),
    ...(message.kind === "document" && message.filename ? { filename: message.filename } : {}),
  };
  return { type: message.kind, [message.kind]: media };
}

type ComponentRow = { type?: string; format?: string; text?: string };
type TemplateRow = {
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: ComponentRow[];
};

/** A template as the vendor lists it, in ONE's own words. Null when it has no body text ONE can show. */
export function toAccountTemplate(row: TemplateRow): AccountTemplate | null {
  const components = Array.isArray(row.components) ? row.components : [];
  const part = (type: string) => components.find((component) => component.type?.toUpperCase() === type);
  const body = part("BODY")?.text;
  if (!row.name || !body) return null;
  const header = part("HEADER");
  return {
    name: row.name,
    language: row.language ?? "pt_BR",
    category: (row.category ?? "").toLowerCase(),
    status: (row.status ?? "").toLowerCase(),
    body,
    headerText: header && (header.format ?? "TEXT").toUpperCase() === "TEXT" ? (header.text ?? null) : null,
    footerText: part("FOOTER")?.text ?? null,
    paramCount: paramCountOf(body),
    components,
  };
}

export class MetaProvider implements WhatsAppProvider {
  readonly name = "meta" as const;
  private readonly config: MetaConfig;

  constructor(config: MetaConfig) {
    this.config = config;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.accessToken}`, "Content-Type": "application/json" };
  }

  async send(to: string, message: OutboundMessage): Promise<SendResult> {
    const recipient = to.replace(/\D/g, "");
    if (recipient.length < 8 || recipient.length > 15) return { ok: false, error: "invalid_recipient" };

    const answer = await call(this.config, `${GRAPH}/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        ...payloadOf(message),
      }),
    });
    // No answer at all (a timeout, a connection that dropped): the vendor may have taken the message
    // before the line went quiet, so this is never reported as "not sent, try again".
    if (!answer) return { ok: false, error: "unconfirmed", detail: "no_answer" };

    const accepted = answer.status >= 200 && answer.status < 300;
    const id = (answer.body as { messages?: { id?: string }[] } | null)?.messages?.[0]?.id;
    if (accepted && id) return { ok: true, providerMessageId: id };
    const code = errorOf(answer.body)?.code;
    // Accepted, and no message named: there is nothing a status could ever be matched to.
    if (accepted && code === undefined) return { ok: false, error: "rejected", detail: "no_message_id" };
    return { ok: false, ...sendErrorOf(code, answer.status) };
  }

  async fetchMedia(mediaId: string): Promise<MediaResult> {
    // Two steps: the id gives an address good for five minutes, and the address gives the bytes.
    const located = await call(
      this.config,
      `${GRAPH}/${this.config.apiVersion}/${encodeURIComponent(mediaId)}?phone_number_id=${encodeURIComponent(this.config.phoneNumberId)}`,
      { method: "GET", headers: this.headers() },
    );
    if (!located) return { kind: "later", detail: "no_answer" };
    if (located.status !== 200) {
      const code = errorOf(located.body)?.code;
      // The vendor says the object is not there (it keeps a media for 7 days): the one answer that ends the wait.
      if (located.status === 404 || code === 100) return { kind: "gone" };
      return { kind: "later", detail: code === undefined ? `http_${located.status}` : `meta_${code}` };
    }
    const info = (located.body ?? null) as { url?: string; mime_type?: string } | null;
    if (!info?.url) return { kind: "later", detail: "no_address" };

    const run = this.config.fetch ?? fetch;
    try {
      const response = await run(info.url, {
        headers: { Authorization: `Bearer ${this.config.accessToken}` },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
      });
      // The address stopped working, or the vendor is busy: a new address is asked for on the next try.
      if (!response.ok) return { kind: "later", detail: `download_http_${response.status}` };
      return {
        kind: "fetched",
        bytes: new Uint8Array(await response.arrayBuffer()),
        mime: info.mime_type ?? response.headers.get("content-type") ?? "application/octet-stream",
      };
    } catch {
      return { kind: "later", detail: "download_no_answer" };
    }
  }

  async listTemplates(): Promise<AccountTemplate[]> {
    const templates: AccountTemplate[] = [];
    let url: string | null =
      `${GRAPH}/${this.config.apiVersion}/${this.config.wabaId}/message_templates?fields=name,language,status,category,components&limit=100`;
    // A firm has tens of templates, not thousands: ten pages is a ceiling, not a target.
    for (let page = 0; url && page < 10; page += 1) {
      const answer = await call(this.config, url, { method: "GET", headers: this.headers() });
      if (!answer || answer.status !== 200) throw new Error("meta: the templates could not be listed");
      const body = answer.body as { data?: TemplateRow[]; paging?: { next?: string } } | null;
      for (const row of body?.data ?? []) {
        const template = toAccountTemplate(row);
        if (template) templates.push(template);
      }
      url = body?.paging?.next ?? null;
    }
    return templates;
  }

  /**
   * Submits a template to the account (the reference of the account's
   * `message_templates`, read on 2026-10-11): a utility message with
   * positional values, an example of each, and its footer. The vendor
   * answers with the template's id, its status and the category it decided.
   */
  async createTemplate(submission: TemplateSubmission): Promise<TemplateCreated> {
    const components: Record<string, unknown>[] = [
      {
        type: "BODY",
        text: submission.body,
        ...(submission.examples.length > 0 ? { example: { body_text: [submission.examples] } } : {}),
      },
      ...(submission.footer ? [{ type: "FOOTER", text: submission.footer }] : []),
    ];
    const answer = await call(
      this.config,
      `${GRAPH}/${this.config.apiVersion}/${this.config.wabaId}/message_templates`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          name: submission.name,
          language: submission.language,
          category: "UTILITY",
          parameter_format: "POSITIONAL",
          components,
        }),
      },
    );
    // No answer: the vendor may have taken it before the line went quiet.
    if (!answer) return { ok: false, code: "unconfirmed" };
    const body = (answer.body ?? null) as { id?: unknown; status?: unknown; category?: unknown } | null;
    if (answer.status >= 200 && answer.status < 300 && typeof body?.id === "string" && body.id) {
      return {
        ok: true,
        id: body.id,
        status: typeof body.status === "string" ? body.status.toLowerCase() : "pending",
        category: typeof body.category === "string" ? body.category.toLowerCase() : "utility",
      };
    }
    // A server error, whatever it names: whether the account took it is not known either (a reading of the
    // account's templates says).
    if (answer.status >= 500) return { ok: false, code: "unconfirmed" };
    return { ok: false, code: failureCode(answer, "no_template_id") };
  }
}

// ---------- Connecting a firm's account (Embedded Signup) ----------

/**
 * What the platform does on its own name when a firm connects a number
 * through Embedded Signup (the onboarding reference for Tech Providers and
 * the coexistence page, read on 2026-10-09). The app's id and secret are the
 * platform's; every call after the exchange uses the firm's own token.
 */
export interface MetaAppConfig {
  appId: string;
  appSecret: string;
  apiVersion: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export type SignupStep = { ok: true } | { ok: false; code: string };

/**
 * Exchanges the code the signup window returned for the firm's business
 * token. The code lives for 30 seconds: this is the first thing done with it.
 */
export async function exchangeSignupCode(
  app: MetaAppConfig,
  code: string,
): Promise<{ ok: true; accessToken: string } | { ok: false; code: string }> {
  const query = new URLSearchParams({ client_id: app.appId, client_secret: app.appSecret, code });
  const run = app.fetch ?? fetch;
  let status: number;
  let raw: string;
  try {
    const response = await run(`${GRAPH}/${app.apiVersion}/oauth/access_token?${query}`, {
      method: "GET",
      signal: AbortSignal.timeout(app.timeoutMs ?? 20_000),
    });
    status = response.status;
    raw = (await response.text()).trim();
  } catch {
    return { ok: false, code: "no_answer" };
  }

  // The reference describes the answer as the token itself; the endpoint is
  // the OAuth one, which answers with JSON. Both are read.
  let body: { access_token?: string; error?: GraphError } | null = null;
  try {
    body = JSON.parse(raw) as { access_token?: string; error?: GraphError };
  } catch {
    body = null;
  }
  const token = body?.access_token ?? (body === null && /^[A-Za-z0-9_|.-]{20,}$/.test(raw) ? raw : undefined);
  if (status === 200 && token) return { ok: true, accessToken: token };
  return { ok: false, code: failureCode({ status, body }, "no_token") };
}

async function step(
  app: MetaAppConfig,
  token: string,
  path: string,
  body?: Record<string, unknown>,
  method: "POST" | "DELETE" = "POST",
): Promise<SignupStep> {
  const answer = await call(app, `${GRAPH}/${app.apiVersion}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!answer) return { ok: false, code: "no_answer" };
  if (answer.status === 200 && (answer.body as { success?: boolean } | null)?.success !== false) return { ok: true };
  return { ok: false, code: failureCode(answer, "not_confirmed") };
}

/** Subscribes the platform's app to the webhooks of the firm's account. */
export const subscribeApp = (app: MetaAppConfig, token: string, wabaId: string): Promise<SignupStep> =>
  step(app, token, `${encodeURIComponent(wabaId)}/subscribed_apps`);

/**
 * Takes the platform's app off the webhooks of the firm's account: what is
 * done at the vendor when a firm disconnects. A number that also lives on the
 * phone app is never deregistered here (the vendor refuses it): the firm
 * leaves from its phone, and the account says so by webhook.
 */
export const unsubscribeApp = (app: MetaAppConfig, token: string, wabaId: string): Promise<SignupStep> =>
  step(app, token, `${encodeURIComponent(wabaId)}/subscribed_apps`, undefined, "DELETE");

/** Registers a number that lives only on the Cloud API. A number that also lives on the phone app is already registered. */
export const registerNumber = (
  app: MetaAppConfig,
  token: string,
  phoneNumberId: string,
  pin: string,
): Promise<SignupStep> =>
  step(app, token, `${encodeURIComponent(phoneNumberId)}/register`, { messaging_product: "whatsapp", pin });

/**
 * Asks for one of the two syncs of a number that also lives on the phone app:
 * its contacts (`smb_app_state_sync`) or its history (`history`). Each may be
 * asked once, within 24 hours of connecting.
 */
export const requestCoexistenceSync = (
  app: MetaAppConfig,
  token: string,
  phoneNumberId: string,
  sync: "smb_app_state_sync" | "history",
): Promise<SignupStep> =>
  step(app, token, `${encodeURIComponent(phoneNumberId)}/smb_app_data`, {
    messaging_product: "whatsapp",
    sync_type: sync,
  });

/**
 * The ids of the numbers of an account, for a signup that named the account
 * and no number (the one of a number that lives on the phone app does that).
 * Null when the account could not be read.
 */
export async function listAccountNumbers(app: MetaAppConfig, token: string, wabaId: string): Promise<string[] | null> {
  const answer = await call(
    app,
    `${GRAPH}/${app.apiVersion}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id&limit=50`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const body = (answer?.body ?? null) as { data?: { id?: string }[] } | null;
  if (!answer || answer.status !== 200 || !Array.isArray(body?.data)) return null;
  return body.data.flatMap((row) => (typeof row.id === "string" && row.id ? [row.id] : []));
}

/**
 * The number as the vendor knows it: what it shows, its name, whether it also lives on the phone app,
 * and whether it is registered on the Cloud API already (`platform_type` `CLOUD_API`): a number the
 * firm registered in its WhatsApp Manager, or the test number Meta gives an app, needs no six digits.
 */
export async function getNumberInfo(
  app: MetaAppConfig,
  token: string,
  phoneNumberId: string,
): Promise<{
  displayPhoneNumber: string;
  verifiedName: string | null;
  onBusinessApp: boolean;
  onCloudApi: boolean;
} | null> {
  const fields = "display_phone_number,verified_name,is_on_biz_app,platform_type";
  const answer = await call(app, `${GRAPH}/${app.apiVersion}/${encodeURIComponent(phoneNumberId)}?fields=${fields}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (answer?.body ?? null) as {
    display_phone_number?: string;
    verified_name?: string;
    is_on_biz_app?: boolean;
    platform_type?: string;
  } | null;
  if (!answer || answer.status !== 200 || !body?.display_phone_number) return null;
  return {
    displayPhoneNumber: body.display_phone_number.replace(/\D/g, ""),
    verifiedName: body.verified_name ?? null,
    onBusinessApp: Boolean(body.is_on_biz_app),
    onCloudApi: body.platform_type === "CLOUD_API",
  };
}
