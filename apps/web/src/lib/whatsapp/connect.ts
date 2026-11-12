import "server-only";

import { randomBytes, randomInt } from "node:crypto";

import { getVault } from "@/lib/connections/vault";
import { isManager } from "@/lib/firm/roles";
import type { MemberContext } from "@/lib/member/context";
import {
  isSimulatorOn,
  metaApp,
  metaAppConfig,
  openWaPlatform,
  readWhatsAppSettings,
  type WhatsAppSettings,
} from "@/lib/whatsapp/config";
import { providerFor } from "@/lib/whatsapp/provider";
import { connectionRefusal } from "@/lib/whatsapp/session";
import { createServiceClient } from "@flyee/auth/service";
import type { Vault } from "@flyee/connectors/vault";
import { BRAND } from "@flyee/content";
import {
  exchangeSignupCode,
  getNumberInfo,
  listAccountNumbers,
  type MetaAppConfig,
  registerNumber,
  requestCoexistenceSync,
  subscribeApp,
  unsubscribeApp,
} from "@flyee/whatsapp/providers/meta";
import { openWaSessions } from "@flyee/whatsapp/providers/openwa";
import type { AccountTemplate, WhatsAppProviderName } from "@flyee/whatsapp/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Connecting a firm's WhatsApp number, and cutting it (migrations 0017 and
 * 0019).
 *
 * The order is always the same. The person who manages the firm starts the
 * connection under their own session (`begin_connection`: the database checks
 * the role and the second factor); the backend seals the firm's token in the
 * vault; and only then is the number recorded (`register_wa_number`), so a
 * number never exists without a sealed token behind it.
 *
 * With the simulator there is no vendor: the same steps run with a number
 * that exists only here. With Meta the token comes from Embedded Signup: the
 * signup window hands the browser a code that lives 30 seconds, and the
 * first thing done with it is the exchange.
 *
 * The vendor's side of this file was written from the reference read on
 * 2026-10-09 and is covered by the package's contract tests; it has not run
 * against Meta, because ONE has no Meta app yet.
 */

export type ConnectResult =
  | { ok: true; code: "connected"; numberId: string; syncRequested: boolean }
  | { ok: false; code: string; connectionId?: string };

const KNOWN_CODES = [
  "second_factor_required",
  "not_allowed_in_support_session",
  "not_authorized",
  "invalid_provider",
  "connection_not_found",
  "connection_not_connected",
  "number_in_use",
  "simulator_not_allowed",
  "test_chat_not_allowed",
  "not_found",
] as const;

const codeOf = (message: string | null | undefined): string =>
  KNOWN_CODES.find((code) => (message ?? "").includes(code)) ?? "failed";

type Backend = { service: SupabaseClient; vault: Vault; settings: WhatsAppSettings };

async function backend(): Promise<Backend | { problem: string }> {
  const access = getVault();
  if (!access.ok)
    return { problem: access.problem === "backend_not_configured" ? access.problem : "vault_not_configured" };
  let service: SupabaseClient;
  try {
    service = createServiceClient();
  } catch {
    return { problem: "backend_not_configured" };
  }
  return { service, vault: access.vault, settings: await readWhatsAppSettings(service) };
}

/** Starts the connection under the person's own session: the database decides whether they may. */
async function begin(context: MemberContext, orgId: string, wabaId: string, label: string) {
  const { data, error } = await context.supabase.rpc("begin_connection", {
    target_org: orgId,
    target_provider: "whatsapp",
    target_external_id: wabaId,
    target_label: label,
  });
  if (error) return { ok: false as const, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; connection_id?: string };
  if (!answer.ok || !answer.connection_id) return { ok: false as const, code: codeOf(answer.code) };
  return { ok: true as const, connectionId: answer.connection_id };
}

const templateRows = (templates: AccountTemplate[]) =>
  templates.map((template) => ({
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    body: template.body,
    header_text: template.headerText,
    footer_text: template.footerText,
    param_count: template.paramCount,
    components: template.components,
  }));

/**
 * The templates ONE submitted to a simulated account (the notices', named `one_*`), as the platform keeps
 * them: the simulator lists them back, so a reading of the account never takes them away.
 */
async function simulatedTemplates(
  service: SupabaseClient,
  orgId: string,
  wabaId: string,
): Promise<AccountTemplate[] | null> {
  let data: unknown[] | null = null;
  try {
    const answer = await service
      .from("wa_templates")
      .select("name, language, category, status, body, header_text, footer_text, param_count")
      .eq("org_id", orgId)
      .eq("waba_id", wabaId)
      .like("name", "one\\_%")
      .neq("status", "disabled");
    if (answer.error) return null;
    data = answer.data;
  } catch {
    return null;
  }
  return (
    (data ?? []) as {
      name: string;
      language: string;
      category: string;
      status: string;
      body: string;
      header_text: string | null;
      footer_text: string | null;
      param_count: number;
    }[]
  ).map((row) => ({
    name: row.name,
    language: row.language,
    category: row.category,
    status: row.status,
    body: row.body,
    headerText: row.header_text,
    footerText: row.footer_text,
    paramCount: row.param_count,
    components: [],
  }));
}

/** Brings the account's templates, with their approval, into what ONE knows. Never fatal: a number works without it. */
export async function syncAccountTemplates(
  service: SupabaseClient,
  settings: WhatsAppSettings,
  number: { provider: string; orgId: string; connectionId: string; phoneNumberId: string; wabaId: string },
): Promise<{ ok: boolean; code: string }> {
  // A simulated account lists back what ONE submitted to it, as the platform keeps it; not read, nothing is synced,
  // since a list without them would take them away.
  const kept =
    number.provider === "simulator" || number.provider === "test"
      ? await simulatedTemplates(service, number.orgId, number.wabaId)
      : undefined;
  if (kept === null) return { ok: false, code: "templates_unreadable" };
  const access = await providerFor(number, settings, "whatsapp.templates", { simulatedTemplates: kept });
  if (!access.ok) return { ok: false, code: access.code };
  let templates: AccountTemplate[];
  try {
    templates = await access.provider.listTemplates();
  } catch {
    // A list that could not be read is not an empty list: nothing is disabled.
    return { ok: false, code: "templates_unreadable" };
  }
  const { data, error } = await service.rpc("sync_wa_templates", {
    target_org: number.orgId,
    target_waba: number.wabaId,
    target_templates: templateRows(templates),
  });
  if (error || (data as { ok?: boolean } | null)?.ok !== true) return { ok: false, code: "templates_not_saved" };
  return { ok: true, code: "synced" };
}

async function recordNumber(
  env: Backend,
  input: {
    orgId: string;
    connectionId: string;
    provider: WhatsAppProviderName;
    phoneNumberId: string;
    wabaId: string;
    displayPhoneNumber: string;
    verifiedName: string | null;
    mode: "cloud" | "coexistence";
  },
): Promise<{ ok: true; numberId: string } | { ok: false; code: string }> {
  const { data, error } = await env.service.rpc("register_wa_number", {
    target_org: input.orgId,
    target_connection: input.connectionId,
    target_provider: input.provider,
    target_phone_number_id: input.phoneNumberId,
    target_waba_id: input.wabaId,
    target_display_phone_number: input.displayPhoneNumber,
    target_verified_name: input.verifiedName,
    target_mode: input.mode,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; number_id?: string };
  if (!answer.ok || !answer.number_id) return { ok: false, code: codeOf(answer.code) };
  return { ok: true, numberId: answer.number_id };
}

/**
 * Undoes a connection that got as far as a sealed token and no further. The
 * database cuts it, under the person's own session, which discards the token;
 * for a real account the platform's app also comes off its webhooks. A token
 * is never left sealed behind a number the firm can neither see nor cut.
 */
async function undo(context: MemberContext, connectionId: string, leave?: () => Promise<unknown>): Promise<void> {
  const { error } = await context.supabase.rpc("disconnect_connection", { target_connection: connectionId });
  if (error) console.error("whatsapp_connection_not_undone", { state: error.code ?? null });
  if (leave) await leave().catch(() => undefined);
}

/** What the screen is told when a number could not be recorded: the reason when it is the firm's to act on. */
const notRecorded = (code: string): string =>
  code === "number_in_use" || code === "simulator_not_allowed" || code === "test_chat_not_allowed"
    ? code
    : "not_recorded";

// ---------- The simulator ----------

/** A number that exists only here: an area code no carrier has, so it is nobody's. */
const simulatedPhone = () => `55009${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;

export async function connectSimulatedNumber(context: MemberContext): Promise<ConnectResult> {
  if (!context.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  if (!isSimulatorOn()) return { ok: false, code: "simulator_off" };
  const env = await backend();
  if ("problem" in env) return { ok: false, code: env.problem };

  const orgId = context.firm.id;

  // A firm that had a simulated number connects the same one again, as it
  // would its real number: the conversations it had come back with it.
  const { data: previous } = await context.supabase
    .from("wa_numbers")
    .select("phone_number_id, waba_id, display_phone_number")
    .eq("org_id", orgId)
    .eq("provider", "simulator")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const wabaId = (previous?.waba_id as string | undefined) ?? `sim-waba-${randomBytes(8).toString("hex")}`;
  const phoneNumberId = (previous?.phone_number_id as string | undefined) ?? `sim-${randomBytes(8).toString("hex")}`;
  const displayPhoneNumber = (previous?.display_phone_number as string | undefined) ?? simulatedPhone();

  const started = await begin(context, orgId, wabaId, "WhatsApp (simulador)");
  if (!started.ok) return started;
  const place = { orgId, connectionId: started.connectionId };

  // The same steps as a real number: nothing is recorded without a sealed token behind it.
  const sealed = await env.vault.seal(place, { access_token: "simulator" }, { metadata: { simulated: true } });
  if (sealed.kind !== "sealed") return { ok: false, code: `vault_${sealed.code}`, connectionId: started.connectionId };

  const recorded = await recordNumber(env, {
    orgId,
    connectionId: started.connectionId,
    provider: "simulator",
    phoneNumberId,
    wabaId,
    displayPhoneNumber,
    verifiedName: context.firm.name,
    // As the firms will use it: the number also lives on the phone, whose messages arrive as echoes.
    mode: "coexistence",
  });
  if (!recorded.ok) {
    await undo(context, started.connectionId);
    return { ok: false, code: notRecorded(recorded.code) };
  }

  await syncAccountTemplates(env.service, env.settings, {
    provider: "simulator",
    orgId,
    connectionId: started.connectionId,
    phoneNumberId,
    wabaId,
  });
  return { ok: true, code: "connected", numberId: recorded.numberId, syncRequested: false };
}

// ---------- The test chat (0047) ----------

/** A number of the test chat: an area code no carrier has, so it is nobody's. */
const testChatPhone = () => `55008${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;

/**
 * Connects the number of a firm's test chat, as a real one is connected (a
 * connection under the person's own session, a sealed token behind it, the
 * number recorded by the backend), with no vendor behind it: honoured in
 * production, since it reaches nobody. A firm that had one connects the
 * same again, and its conversations come back with it. The database refuses
 * it beside a real number. Who manages the firm.
 */
export async function connectTestChatNumber(context: MemberContext): Promise<ConnectResult> {
  if (!context.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  const env = await backend();
  if ("problem" in env) return { ok: false, code: env.problem };
  const orgId = context.firm.id;

  const { data: previous } = await context.supabase
    .from("wa_numbers")
    .select("phone_number_id, waba_id, display_phone_number")
    .eq("org_id", orgId)
    .eq("provider", "test")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const wabaId = (previous?.waba_id as string | undefined) ?? `test-waba-${randomBytes(8).toString("hex")}`;
  const phoneNumberId = (previous?.phone_number_id as string | undefined) ?? `test-${randomBytes(8).toString("hex")}`;
  const displayPhoneNumber = (previous?.display_phone_number as string | undefined) ?? testChatPhone();

  const started = await begin(context, orgId, wabaId, "Chat de teste");
  if (!started.ok) return started;
  const place = { orgId, connectionId: started.connectionId };

  const sealed = await env.vault.seal(place, { access_token: "test-chat" }, { metadata: { test_chat: true } });
  if (sealed.kind !== "sealed") return { ok: false, code: `vault_${sealed.code}`, connectionId: started.connectionId };

  const recorded = await recordNumber(env, {
    orgId,
    connectionId: started.connectionId,
    provider: "test",
    phoneNumberId,
    wabaId,
    displayPhoneNumber,
    verifiedName: context.firm.name,
    mode: "cloud",
  });
  if (!recorded.ok) {
    await undo(context, started.connectionId);
    return { ok: false, code: notRecorded(recorded.code) };
  }
  return { ok: true, code: "connected", numberId: recorded.numberId, syncRequested: false };
}

// ---------- Meta (Embedded Signup) ----------

const VENDOR_ID = /^[0-9]{5,32}$/;
/** The six digits of the number's two-step verification, asked only for a number that lives on the Cloud API alone. */
const REGISTRATION_CODE = /^[0-9]{6}$/;

type MetaNumber = { phoneNumberId: string; wabaId: string; displayPhoneNumber: string; verifiedName: string | null };

/**
 * What is left once the firm's token is sealed: register a number that lives
 * only on the Cloud API, record it, ask for the phone's contacts and history
 * when it also lives on the phone app, and bring the templates.
 */
async function finishMetaNumber(
  context: MemberContext,
  env: Backend,
  app: MetaAppConfig,
  token: string,
  place: { orgId: string; connectionId: string },
  number: MetaNumber,
  onBusinessApp: boolean,
  registrationCode: string | null,
  /** The number is on the Cloud API already (registered in the firm's WhatsApp Manager): six digits only when given. */
  registered = false,
): Promise<ConnectResult> {
  if (!onBusinessApp && !(registered && !registrationCode)) {
    // Used once, here, and kept nowhere: the firm chooses it and the firm keeps it.
    if (!registrationCode || !REGISTRATION_CODE.test(registrationCode)) {
      return { ok: false, code: "registration_code_needed", connectionId: place.connectionId };
    }
    const registered = await registerNumber(app, token, number.phoneNumberId, registrationCode);
    if (!registered.ok) return { ok: false, code: "registration_failed", connectionId: place.connectionId };
  }

  const recorded = await recordNumber(env, {
    ...place,
    provider: "meta",
    phoneNumberId: number.phoneNumberId,
    wabaId: number.wabaId,
    displayPhoneNumber: number.displayPhoneNumber,
    verifiedName: number.verifiedName,
    mode: onBusinessApp ? "coexistence" : "cloud",
  });
  if (!recorded.ok) {
    // Sealed and subscribed, and the number cannot be the firm's (it is active in another firm):
    // everything done so far is taken back.
    await undo(context, place.connectionId, () => unsubscribeApp(app, token, number.wabaId));
    return { ok: false, code: notRecorded(recorded.code) };
  }

  // The two syncs of a number that also lives on the phone: contacts first,
  // then history, each asked once, within a day of connecting.
  let syncRequested = false;
  if (onBusinessApp) {
    const note = (sync: "contacts" | "history") =>
      env.service.rpc("wa_note_sync", { target_org: place.orgId, target_number: recorded.numberId, target_sync: sync });
    const contacts = await requestCoexistenceSync(app, token, number.phoneNumberId, "smb_app_state_sync");
    if (contacts.ok) await note("contacts");
    const history = await requestCoexistenceSync(app, token, number.phoneNumberId, "history");
    if (history.ok) await note("history");
    syncRequested = contacts.ok && history.ok;
  }

  await syncAccountTemplates(env.service, env.settings, { provider: "meta", ...place, ...number });
  return { ok: true, code: "connected", numberId: recorded.numberId, syncRequested };
}

export async function connectMetaNumber(
  context: MemberContext,
  input: { code: string; wabaId: string; phoneNumberId?: string | null; registrationCode?: string | null },
): Promise<ConnectResult> {
  if (!context.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  const platform = metaApp();
  if (!platform) return { ok: false, code: "meta_not_configured" };
  if (!input.code || input.code.length > 2000 || !VENDOR_ID.test(input.wabaId))
    return { ok: false, code: "invalid_signup" };
  if (input.phoneNumberId && !VENDOR_ID.test(input.phoneNumberId)) return { ok: false, code: "invalid_signup" };
  const env = await backend();
  if ("problem" in env) return { ok: false, code: env.problem };
  const app = metaAppConfig(platform, env.settings);

  // The database says first whether this person may connect at all (the role,
  // the second factor): a refusal here costs the firm nothing at the vendor.
  // It is one short call, and the code that came from the signup lives for 30 seconds.
  const orgId = context.firm.id;
  const started = await begin(context, orgId, input.wabaId, "WhatsApp");
  if (!started.ok) return started;
  const place = { orgId, connectionId: started.connectionId };

  const exchanged = await exchangeSignupCode(app, input.code);
  if (!exchanged.ok) return { ok: false, code: "signup_code_refused", connectionId: place.connectionId };
  const token = exchanged.accessToken;

  // A signup of a number that lives on the phone app names the account and may name no number.
  let phoneNumberId = input.phoneNumberId ?? null;
  if (!phoneNumberId) {
    const numbers = await listAccountNumbers(app, token, input.wabaId);
    if (!numbers) return { ok: false, code: "account_unreadable", connectionId: place.connectionId };
    if (numbers.length !== 1) {
      return {
        ok: false,
        code: numbers.length === 0 ? "no_number" : "several_numbers",
        connectionId: place.connectionId,
      };
    }
    [phoneNumberId] = numbers;
  }
  const info = await getNumberInfo(app, token, phoneNumberId);
  if (!info) return { ok: false, code: "account_unreadable", connectionId: place.connectionId };

  const number: MetaNumber = {
    phoneNumberId,
    wabaId: input.wabaId,
    displayPhoneNumber: info.displayPhoneNumber,
    verifiedName: info.verifiedName,
  };

  // What the connection keeps beside the sealed token is nothing secret: which number it is.
  const sealed = await env.vault.seal(
    place,
    { access_token: token },
    {
      metadata: {
        waba_id: number.wabaId,
        phone_number_id: number.phoneNumberId,
        display_phone_number: number.displayPhoneNumber,
        verified_name: number.verifiedName,
        on_business_app: info.onBusinessApp,
      },
    },
  );
  if (sealed.kind !== "sealed") return { ok: false, code: `vault_${sealed.code}`, connectionId: place.connectionId };

  const subscribed = await subscribeApp(app, token, number.wabaId);
  if (!subscribed.ok) {
    // Without the webhooks the number would be connected and deaf: the token is discarded instead.
    await undo(context, place.connectionId);
    return { ok: false, code: "subscribe_failed" };
  }

  return finishMetaNumber(context, env, app, token, place, number, info.onBusinessApp, input.registrationCode ?? null);
}

/** A token of the Graph API as Meta writes it: letters and digits, long. Nothing about it is ever logged. */
const META_TOKEN = /^[A-Za-z0-9_-]{40,1024}$/;

/**
 * A number connected with the firm's own token at Meta, while the platform's signup window is not
 * open (it needs the platform to be a Tech Provider at Meta). Who manages the firm creates, in the
 * firm's business at Meta, a system user with the platform's app and the WhatsApp account, and its
 * permanent token with `whatsapp_business_messaging` and `whatsapp_business_management`; then gives
 * here the account's id, the number's id and that token. The token is checked against the account
 * before it is kept: it must read the account, and the number must be one of the account's. From
 * there the steps are the signup's: sealed in the vault, the platform's app on the account's
 * webhooks, the number registered (unless it is on the Cloud API already and no six digits were
 * given), recorded and its templates brought. A number that also lives on the phone app connects
 * only through the signup window, which is what moves it to the coexistence.
 */
export async function connectMetaNumberByToken(
  context: MemberContext,
  input: { token: string; wabaId: string; phoneNumberId: string; registrationCode?: string | null },
): Promise<ConnectResult> {
  if (!context.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  const platform = metaApp();
  if (!platform) return { ok: false, code: "meta_not_configured" };
  const token = input.token.trim();
  const registrationCode = input.registrationCode ? input.registrationCode : null;
  if (
    !META_TOKEN.test(token) ||
    !VENDOR_ID.test(input.wabaId) ||
    !VENDOR_ID.test(input.phoneNumberId) ||
    (registrationCode !== null && !REGISTRATION_CODE.test(registrationCode))
  ) {
    return { ok: false, code: "meta_token_invalid" };
  }
  const env = await backend();
  if ("problem" in env) return { ok: false, code: env.problem };
  const app = metaAppConfig(platform, env.settings);

  const orgId = context.firm.id;
  const started = await begin(context, orgId, input.wabaId, "WhatsApp");
  if (!started.ok) return started;
  const place = { orgId, connectionId: started.connectionId };

  // The token reads the account and the number is the account's, or nothing is kept.
  const numbers = await listAccountNumbers(app, token, input.wabaId);
  if (!numbers) {
    await undo(context, place.connectionId);
    return { ok: false, code: "meta_token_refused" };
  }
  if (!numbers.includes(input.phoneNumberId)) {
    await undo(context, place.connectionId);
    return { ok: false, code: "meta_number_not_in_account" };
  }
  const info = await getNumberInfo(app, token, input.phoneNumberId);
  if (!info) {
    await undo(context, place.connectionId);
    return { ok: false, code: "account_unreadable" };
  }
  if (info.onBusinessApp) {
    await undo(context, place.connectionId);
    return { ok: false, code: "meta_number_on_business_app" };
  }

  const number: MetaNumber = {
    phoneNumberId: input.phoneNumberId,
    wabaId: input.wabaId,
    displayPhoneNumber: info.displayPhoneNumber,
    verifiedName: info.verifiedName,
  };
  const sealed = await env.vault.seal(
    place,
    { access_token: token },
    {
      metadata: {
        waba_id: number.wabaId,
        phone_number_id: number.phoneNumberId,
        display_phone_number: number.displayPhoneNumber,
        verified_name: number.verifiedName,
        on_business_app: false,
        by_token: true,
      },
    },
  );
  if (sealed.kind !== "sealed") {
    await undo(context, place.connectionId);
    return { ok: false, code: `vault_${sealed.code}` };
  }

  const subscribed = await subscribeApp(app, token, number.wabaId);
  if (!subscribed.ok) {
    await undo(context, place.connectionId);
    return { ok: false, code: "subscribe_failed" };
  }

  return finishMetaNumber(context, env, app, token, place, number, false, registrationCode, info.onCloudApi);
}

/**
 * The second half of connecting a number that lives on the Cloud API alone:
 * the signup ended, the token is sealed, and the person now gives the six
 * digits the number is registered with.
 */
export async function finishMetaRegistration(
  context: MemberContext,
  input: { connectionId: string; registrationCode: string },
): Promise<ConnectResult> {
  if (!context.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  // No function of the database is asked on this half: the same questions are asked here.
  const refusal = await connectionRefusal(context);
  if (refusal) return { ok: false, code: refusal };
  const platform = metaApp();
  if (!platform) return { ok: false, code: "meta_not_configured" };
  if (!REGISTRATION_CODE.test(input.registrationCode)) {
    return { ok: false, code: "registration_code_needed", connectionId: input.connectionId };
  }

  // Read under the person's session: a connection of another firm is not found.
  const { data: connection } = await context.supabase
    .from("connections")
    .select("id, org_id, provider, status, metadata")
    .eq("id", input.connectionId)
    .eq("org_id", context.firm.id)
    .eq("provider", "whatsapp")
    .maybeSingle();
  const metadata = (connection?.metadata ?? {}) as Record<string, unknown>;
  const phoneNumberId = typeof metadata.phone_number_id === "string" ? metadata.phone_number_id : "";
  const wabaId = typeof metadata.waba_id === "string" ? metadata.waba_id : "";
  if (
    !connection ||
    connection.status !== "connected" ||
    !VENDOR_ID.test(phoneNumberId) ||
    !VENDOR_ID.test(wabaId) ||
    // A number that also lives on the firm's phone is registered there: the vendor refuses to register it again.
    metadata.on_business_app !== false
  ) {
    return { ok: false, code: "connection_not_found" };
  }

  const env = await backend();
  if ("problem" in env) return { ok: false, code: env.problem };
  const app = metaAppConfig(platform, env.settings);
  const place = { orgId: context.firm.id, connectionId: input.connectionId };
  const opened = await env.vault.open(place, "whatsapp.register");
  if (opened.kind !== "opened" || !opened.payload.access_token) return { ok: false, code: "connection_not_found" };

  return finishMetaNumber(
    context,
    env,
    app,
    opened.payload.access_token,
    place,
    {
      phoneNumberId,
      wabaId,
      displayPhoneNumber: String(metadata.display_phone_number ?? ""),
      verifiedName: typeof metadata.verified_name === "string" ? metadata.verified_name : null,
    },
    false,
    input.registrationCode,
  );
}

// ---------- Cutting ----------

/**
 * Cuts a connection. The database is what cuts it (`disconnect_connection`:
 * the role, the second factor, the token discarded, the numbers closed); what
 * is added here is the vendor's side: the platform's app comes off the
 * account's webhooks, with the token read before it is discarded.
 */
export async function disconnectWhatsApp(
  context: MemberContext,
  connectionId: string,
): Promise<{ ok: boolean; code: string }> {
  if (!context.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  // The database refuses the cut itself from a support visit or without the second factor;
  // the token is not even read for a session it would refuse.
  const refusal = await connectionRefusal(context);
  if (refusal) return { ok: false, code: refusal };

  // Which account at the vendor this connection is, read under the person's session: the one of
  // its active number, or, for a connection that never got a number (a signup that stopped at
  // the six digits), the one its own row names. A simulated connection has no vendor behind it.
  const [{ data: numbers }, { data: connection }] = await Promise.all([
    context.supabase
      .from("wa_numbers")
      .select("provider, waba_id")
      .eq("connection_id", connectionId)
      .eq("org_id", context.firm.id)
      .eq("status", "active"),
    context.supabase
      .from("connections")
      .select("metadata")
      .eq("id", connectionId)
      .eq("org_id", context.firm.id)
      .eq("provider", "whatsapp")
      .maybeSingle(),
  ]);
  const rows = (numbers ?? []) as { provider: string; waba_id: string }[];
  const metadata = (connection?.metadata ?? {}) as Record<string, unknown>;
  const named = typeof metadata.waba_id === "string" && VENDOR_ID.test(metadata.waba_id) ? metadata.waba_id : null;
  const simulated = metadata.simulated === true || rows.some((number) => number.provider === "simulator");
  const vendorAccount = simulated ? null : (rows.find((number) => number.provider === "meta")?.waba_id ?? named);

  // Read now, used after: once the connection is cut the token no longer exists.
  let leave: (() => Promise<unknown>) | null = null;
  const platform = metaApp();
  if (vendorAccount && platform) {
    const env = await backend();
    if (!("problem" in env)) {
      // A token that cannot be opened (it expired, the keys changed) stops nothing: the firm still leaves here.
      const opened = await env.vault
        .open({ orgId: context.firm.id, connectionId }, "whatsapp.disconnect")
        .catch(() => null);
      const token = opened?.kind === "opened" ? opened.payload.access_token : null;
      if (token) {
        const app = metaAppConfig(platform, env.settings);
        leave = () => unsubscribeApp(app, token, vendorAccount);
      }
    }
  }

  // A number of OpenWA: its session is unlinked from the phone and ended at the platform's OpenWA.
  const openWaSession =
    typeof metadata.session_id === "string" && metadata.openwa === true
      ? metadata.session_id
      : (rows.find((number) => number.provider === "openwa")?.waba_id ?? null);
  const openWa = openWaPlatform();
  if (openWaSession && openWa) {
    const sessions = openWaSessions(openWa);
    leave = async () => {
      await sessions.logout(openWaSession);
      await sessions.remove(openWaSession);
    };
  }

  const { data, error } = await context.supabase.rpc("disconnect_connection", { target_connection: connectionId });
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: codeOf(answer.code) };

  // The firm is disconnected here whatever the vendor answers: its token is gone.
  if (leave) await leave().catch(() => undefined);
  return { ok: true, code: "disconnected" };
}

// ---------- WhatsApp Web, by the platform's OpenWA (migration 0221) ----------

/** What the screen shows while a number of OpenWA is being linked: the QR to read, or how the session stands. */
export type OpenWaLinkState =
  | { ok: true; code: "connected"; numberId: string }
  | { ok: true; code: "qr"; qr: string }
  | { ok: true; code: "waiting"; status: string }
  | { ok: false; code: string };

/**
 * Starts linking the firm's number by WhatsApp Web: the unofficial way, which who manages the firm chooses after
 * accepting its risk (the screen says it first). The database says whether this person may connect (the role, the
 * second factor); a session of the platform's OpenWA is made for the firm, with ONE's signed webhook, and started;
 * the connection keeps which session it is (no token of the firm exists: the key is the platform's). The screen
 * then reads the session's QR (`openWaLinkState`) until the phone reads it.
 */
export async function connectOpenWaNumber(context: MemberContext): Promise<ConnectResult> {
  if (!context.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  const platform = openWaPlatform();
  if (!platform) return { ok: false, code: "openwa_not_configured" };
  const env = await backend();
  if ("problem" in env) return { ok: false, code: env.problem };

  const orgId = context.firm.id;
  const sessionName = `one-${orgId.slice(0, 8)}-${randomBytes(3).toString("hex")}`;
  const started = await begin(context, orgId, sessionName, "WhatsApp Web");
  if (!started.ok) return started;
  const place = { orgId, connectionId: started.connectionId };

  const sessions = openWaSessions(platform);
  const session = await sessions.create(sessionName);
  if (!session) {
    await undo(context, place.connectionId);
    return { ok: false, code: "openwa_unavailable" };
  }
  const leave = async () => {
    await sessions.remove(session.id);
  };
  const hooked = await sessions.webhook(session.id, `${BRAND.siteUrl}/api/webhooks/openwa`, platform.webhookSecret);
  if (!hooked) {
    await undo(context, place.connectionId, leave);
    return { ok: false, code: "openwa_unavailable" };
  }
  const sealed = await env.vault.seal(
    place,
    { access_token: "openwa" },
    { metadata: { openwa: true, session_id: session.id, session_name: sessionName } },
  );
  if (sealed.kind !== "sealed") {
    await undo(context, place.connectionId, leave);
    return { ok: false, code: `vault_${sealed.code}` };
  }
  if (!(await sessions.start(session.id))) {
    await undo(context, place.connectionId, leave);
    return { ok: false, code: "openwa_unavailable" };
  }
  return { ok: false, code: "openwa_qr", connectionId: place.connectionId };
}

/**
 * How the linking of a number of OpenWA stands, read again by the screen every few seconds: the QR while the phone
 * has not read it, the session's state while it starts, and, once it is ready, the number recorded as the firm's
 * (a real number: the test chat and the simulator end, 0221).
 */
export async function openWaLinkState(context: MemberContext, connectionId: string): Promise<OpenWaLinkState> {
  if (!context.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  const refusal = await connectionRefusal(context);
  if (refusal) return { ok: false, code: refusal };
  const platform = openWaPlatform();
  if (!platform) return { ok: false, code: "openwa_not_configured" };

  const { data: connection } = await context.supabase
    .from("connections")
    .select("id, status, metadata")
    .eq("id", connectionId)
    .eq("org_id", context.firm.id)
    .eq("provider", "whatsapp")
    .maybeSingle();
  const metadata = (connection?.metadata ?? {}) as Record<string, unknown>;
  const sessionId = typeof metadata.session_id === "string" ? metadata.session_id : null;
  if (!connection || connection.status !== "connected" || metadata.openwa !== true || !sessionId) {
    return { ok: false, code: "connection_not_found" };
  }

  const sessions = openWaSessions(platform);
  const session = await sessions.read(sessionId);
  if (session === "missing") return { ok: false, code: "openwa_session_missing" };
  if (!session) return { ok: true, code: "waiting", status: "unknown" };
  if (session.status === "ready" && session.phone) {
    const env = await backend();
    if ("problem" in env) return { ok: false, code: env.problem };
    const recorded = await recordNumber(env, {
      orgId: context.firm.id,
      connectionId,
      provider: "openwa",
      phoneNumberId: sessionId,
      wabaId: sessionId,
      displayPhoneNumber: session.phone,
      verifiedName: null,
      // The number lives on the firm's phone, which WhatsApp Web is a device of.
      mode: "coexistence",
    });
    if (!recorded.ok) {
      await undo(context, connectionId, async () => {
        await sessions.logout(sessionId);
        await sessions.remove(sessionId);
      });
      return { ok: false, code: notRecorded(recorded.code) };
    }
    return { ok: true, code: "connected", numberId: recorded.numberId };
  }
  if (session.status === "qr_ready") {
    const qr = await sessions.qr(sessionId);
    if (qr) return { ok: true, code: "qr", qr };
  }
  if (session.status === "failed" || session.status === "disconnected") {
    // Stopped before it was linked: started again, and the next read shows its QR.
    await sessions.start(sessionId);
  }
  return { ok: true, code: "waiting", status: session.status };
}
