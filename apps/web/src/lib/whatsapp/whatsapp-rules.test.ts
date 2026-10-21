import { describe, expect, it } from "vitest";

import { connectErrorKey, disconnectReasonKey, findingKey, templateStatus } from "@/lib/whatsapp/connections";
import {
  composerMode,
  contactName,
  failureHasNoWords,
  failureKey,
  isWaiting,
  kindKey,
  mayRemoveOptOut,
  phoneLabel,
  sendErrorKey,
  statusKey,
} from "@/lib/whatsapp/conversations";
import {
  type AccountNumber,
  applyEvents,
  type NumberRoute,
  RefusedEvent,
  type WhatsAppInbox,
} from "@/lib/whatsapp/events";
import messages from "@flyee/content/messages/pt-BR.json";
import { disconnectionDelivery, echoDelivery, inboundTextDelivery, statusDelivery } from "@flyee/whatsapp/simulator";
import type { WhatsAppEvent, WhatsAppProviderName } from "@flyee/whatsapp/types";
import { parseWebhook } from "@flyee/whatsapp/webhook";

const product = messages.product as Record<string, string>;

/**
 * An inbox that keeps what it was handed. Two firms, each with a number: firm
 * A's is simulated, firm B's is the vendor's, and they share the vendor's id
 * on purpose, to show that the provider keeps them apart.
 */
function fakeInbox(options: { failOn?: string; refuseOn?: string } = {}) {
  const numbers: (NumberRoute & { provider: WhatsAppProviderName; phoneNumberId: string })[] = [
    {
      provider: "simulator",
      phoneNumberId: "phone-1",
      orgId: "firm-a",
      numberId: "number-a",
      connectionId: "conn-a",
      wabaId: "waba-a",
      mode: "coexistence",
    },
    {
      provider: "meta",
      phoneNumberId: "phone-1",
      orgId: "firm-b",
      numberId: "number-b",
      connectionId: "conn-b",
      wabaId: "waba-b",
      mode: "cloud",
    },
  ];
  const calls: string[] = [];
  let lookups = 0;
  const step = (name: string, detail: string) => {
    if (options.failOn === name) throw new Error("database unreachable");
    if (options.refuseOn === name) throw new RefusedEvent(name);
    calls.push(`${name}:${detail}`);
  };
  const inbox: WhatsAppInbox = {
    async route(provider, phoneNumberId) {
      lookups += 1;
      const found = numbers.find((number) => number.provider === provider && number.phoneNumberId === phoneNumberId);
      if (!found) return null;
      const { orgId, numberId, connectionId, wabaId, mode } = found;
      return { orgId, numberId, connectionId, wabaId, mode };
    },
    async accountNumbers(provider, wabaId): Promise<AccountNumber[]> {
      return numbers
        .filter((number) => number.provider === provider && number.wabaId === wabaId)
        .map(({ orgId, numberId, connectionId }) => ({ orgId, numberId, connectionId }));
    },
    async inbound(route, event) {
      step("inbound", `${route.orgId}:${event.from}:${event.body}`);
      return { mediaPending: event.media !== null };
    },
    async status(route, event) {
      step("status", `${route.orgId}:${event.status}`);
    },
    async echo(route, event) {
      step("echo", `${route.orgId}:${event.to}:${event.body}`);
    },
    async contact(route, event) {
      step("contact", `${route.orgId}:${event.contact}:${event.action}`);
    },
    async history(route, event) {
      step("history", `${route.orgId}:${event.threads.length}`);
    },
    async disconnect(number, reason) {
      step("disconnect", `${number.orgId}:${reason}`);
    },
    async templateStatus(provider, event) {
      step("template", `${provider}:${event.wabaId}:${event.name}:${event.status}`);
    },
    async templateCategory(provider, event) {
      step("category", `${provider}:${event.wabaId}:${event.name}:${event.category}`);
    },
  };
  return { inbox, calls, lookups: () => lookups };
}

const NUMBER = { wabaId: "waba-a", phoneNumberId: "phone-1", displayPhoneNumber: "5500900000001" };
const at = new Date("2026-10-09T12:00:00Z");
const eventsOf = (payload: unknown): WhatsAppEvent[] => parseWebhook(payload);

describe("what a delivery does once it is read", () => {
  it("routes a person's message to the firm of the number, within the provider that signed the delivery", async () => {
    const delivery = eventsOf(inboundTextDelivery(NUMBER, { phone: "5562999990001", name: "Maria Teste" }, "Oi.", at));

    const simulated = fakeInbox();
    expect(await applyEvents(simulated.inbox, "simulator", delivery)).toMatchObject({
      events: 1,
      applied: 1,
      unrouted: 0,
    });
    expect(simulated.calls).toEqual(["inbound:firm-a:5562999990001:Oi."]);

    // The same number id, signed by the vendor, belongs to another firm: the simulator never reaches it.
    const vendor = fakeInbox();
    await applyEvents(vendor.inbox, "meta", delivery);
    expect(vendor.calls).toEqual(["inbound:firm-b:5562999990001:Oi."]);
  });

  it("drops what is for a number no firm has connected, and says how many", async () => {
    const stranger = { ...NUMBER, phoneNumberId: "phone-de-ninguem" };
    const { inbox, calls } = fakeInbox();
    const report = await applyEvents(
      inbox,
      "simulator",
      eventsOf(inboundTextDelivery(stranger, { phone: "5562999990001", name: "Maria Teste" }, "Oi.", at)),
    );
    expect(report).toMatchObject({ events: 1, applied: 0, unrouted: 1, failed: 0 });
    expect(calls).toEqual([]);
  });

  it("looks a number up once per delivery, however many events it carries", async () => {
    const { inbox, calls, lookups } = fakeInbox();
    const events = [
      ...eventsOf(inboundTextDelivery(NUMBER, { phone: "5562999990001", name: "Maria Teste" }, "Um.", at)),
      ...eventsOf(inboundTextDelivery(NUMBER, { phone: "5562999990001", name: "Maria Teste" }, "Dois.", at)),
      ...eventsOf(statusDelivery(NUMBER, "wamid.SIM1", "5562999990001", "delivered", at)),
      ...eventsOf(echoDelivery(NUMBER, "5562999990001", "Do celular.", at)),
    ];
    const report = await applyEvents(inbox, "simulator", events);
    expect(report).toMatchObject({ events: 4, applied: 4 });
    expect(lookups()).toBe(1);
    expect(calls).toEqual([
      "inbound:firm-a:5562999990001:Um.",
      "inbound:firm-a:5562999990001:Dois.",
      "status:firm-a:delivered",
      "echo:firm-a:5562999990001:Do celular.",
    ]);
  });

  it("closes every number of an account the firm disconnected on its phone, and only within the provider", async () => {
    const left = eventsOf(disconnectionDelivery(NUMBER, "PRIMARY_INACTIVITY"));

    const simulated = fakeInbox();
    expect(await applyEvents(simulated.inbox, "simulator", left)).toMatchObject({ applied: 1 });
    expect(simulated.calls).toEqual(["disconnect:firm-a:PRIMARY_INACTIVITY"]);

    // The vendor has no number in that account: nothing is closed.
    const vendor = fakeInbox();
    expect(await applyEvents(vendor.inbox, "meta", left)).toMatchObject({ applied: 0, unrouted: 1 });
    expect(vendor.calls).toEqual([]);
  });

  it("changes nothing for an account event that is not a disconnection", async () => {
    const { inbox, calls } = fakeInbox();
    const report = await applyEvents(inbox, "simulator", [
      { type: "account", wabaId: "waba-a", event: "ACCOUNT_RECONNECTED", reason: null },
      { type: "account", wabaId: "waba-a", event: "DISABLED_UPDATE", reason: null },
      { type: "history_declined", phoneNumberId: "phone-1" },
    ]);
    expect(report).toMatchObject({ events: 3, applied: 0, ignored: 3 });
    expect(calls).toEqual([]);
  });

  it("hands a template's new status to the account it names", async () => {
    const { inbox, calls } = fakeInbox();
    await applyEvents(inbox, "meta", [
      { type: "template_status", wabaId: "waba-b", name: "aviso_de_audiencia", language: "pt_BR", status: "APPROVED" },
    ]);
    expect(calls).toEqual(["template:meta:waba-b:aviso_de_audiencia:APPROVED"]);
  });

  it("hands a template's new category to the account it names", async () => {
    const { inbox, calls } = fakeInbox();
    const report = await applyEvents(inbox, "meta", [
      {
        type: "template_category",
        wabaId: "waba-b",
        name: "one_lembrete_audiencia_1",
        language: "pt_BR",
        category: "MARKETING",
      },
    ]);
    expect(report).toMatchObject({ events: 1, applied: 1 });
    expect(calls).toEqual(["category:meta:waba-b:one_lembrete_audiencia_1:MARKETING"]);
  });

  it("says a media is pending only when a message brought one", async () => {
    const withMedia: WhatsAppEvent = {
      type: "message",
      phoneNumberId: "phone-1",
      from: "5562999990001",
      contactName: "Maria Teste",
      providerMessageId: "wamid.M1",
      kind: "document",
      body: "meu bilhete",
      media: { id: "media-9", mimeType: "application/pdf", filename: "bilhete.pdf" },
      replyTo: null,
      timestamp: at,
    };
    const first = fakeInbox();
    expect((await applyEvents(first.inbox, "simulator", [withMedia])).mediaPending).toBe(true);
    const second = fakeInbox();
    const text = eventsOf(inboundTextDelivery(NUMBER, { phone: "5562999990001", name: "Maria Teste" }, "Oi.", at));
    expect((await applyEvents(second.inbox, "simulator", text)).mediaPending).toBe(false);
  });

  it("asks for a delivery again when the database was not reachable, and not when the data itself was refused", async () => {
    const events = [
      ...eventsOf(inboundTextDelivery(NUMBER, { phone: "5562999990001", name: "Maria Teste" }, "Oi.", at)),
      ...eventsOf(statusDelivery(NUMBER, "wamid.SIM1", "5562999990001", "read", at)),
    ];

    const down = fakeInbox({ failOn: "inbound" });
    // The message failed and the status after it was still applied: one failure does not lose the rest.
    expect(await applyEvents(down.inbox, "simulator", events)).toMatchObject({ applied: 1, failed: 1, ignored: 0 });
    expect(down.calls).toEqual(["status:firm-a:read"]);

    const refused = fakeInbox({ refuseOn: "inbound" });
    expect(await applyEvents(refused.inbox, "simulator", events)).toMatchObject({ applied: 1, failed: 0, ignored: 1 });
  });
});

describe("the rules of the conversations screen", () => {
  it("writes a number as people write it", () => {
    expect(phoneLabel("5562999990001")).toBe("+55 (62) 99999-0001");
    expect(phoneLabel("556232320001")).toBe("+55 (62) 3232-0001");
    expect(phoneLabel("15550001111")).toBe("+15550001111");
    expect(phoneLabel("")).toBe("");
  });

  it("names a conversation by the firm's own name for the person first", () => {
    const contact = "5562999990001";
    expect(contactName({ savedName: "Maria do voo de Recife", contactName: "Maria", contact })).toBe(
      "Maria do voo de Recife",
    );
    expect(contactName({ savedName: " ", contactName: "Maria", contact })).toBe("Maria");
    expect(contactName({ savedName: null, contactName: null, contact })).toBe("+55 (62) 99999-0001");
  });

  it("offers in the composer only what the database would accept, in the order the database decides", () => {
    const open = { supportVisit: false, numberActive: true, windowOpen: true, optedOut: false };
    expect(composerMode(open)).toBe("text");
    // Inside the window the person is answered even after asking to stop: they wrote first.
    expect(composerMode({ ...open, optedOut: true })).toBe("text");
    expect(composerMode({ ...open, windowOpen: false })).toBe("template");
    expect(composerMode({ ...open, windowOpen: false, optedOut: true })).toBe("opted_out");
    expect(composerMode({ ...open, numberActive: false })).toBe("disconnected");
    // A support visit writes nothing, whatever else is true.
    expect(composerMode({ ...open, supportVisit: true })).toBe("read_only");
    expect(composerMode({ ...open, supportVisit: true, numberActive: false })).toBe("read_only");
  });

  it("says a conversation waits only when the person wrote through the platform and nobody answered", () => {
    const at = "2026-10-09T12:00:00Z";
    expect(isWaiting({ lastDirection: "in", lastInboundAt: at, lastMessageAt: at })).toBe(true);
    // The firm answered, here or from its phone.
    expect(isWaiting({ lastDirection: "out", lastInboundAt: at, lastMessageAt: "2026-10-09T12:05:00Z" })).toBe(false);
    // A last word that came with the history of the number, from before it was connected, waits for nobody.
    expect(isWaiting({ lastDirection: "in", lastInboundAt: null, lastMessageAt: "2026-08-01T09:00:00Z" })).toBe(false);
    expect(
      isWaiting({ lastDirection: "in", lastInboundAt: "2026-07-01T09:00:00Z", lastMessageAt: "2026-08-01T09:00:00Z" }),
    ).toBe(false);
    expect(isWaiting({ lastDirection: null, lastInboundAt: null, lastMessageAt: null })).toBe(false);
  });

  it("lets who manages the firm or works its cases record that a person agreed to be written to again", () => {
    expect(mayRemoveOptOut("owner", "atendimento")).toBe(true);
    expect(mayRemoveOptOut("admin", "controladoria")).toBe(true);
    expect(mayRemoveOptOut("member", "socio")).toBe(true);
    expect(mayRemoveOptOut("member", "advogado")).toBe(true);
    expect(mayRemoveOptOut("member", "atendimento")).toBe(false);
    expect(mayRemoveOptOut("member", "controladoria")).toBe(false);
  });

  it("has words in the catalog for every state, kind, failure and refusal the screens name", () => {
    const keys = [
      ...(["received", "queued", "sending", "sent", "delivered", "read", "failed"] as const).map(statusKey),
      ...[
        "text",
        "image",
        "document",
        "audio",
        "video",
        "sticker",
        "location",
        "contacts",
        "reaction",
        "interactive",
        "button",
        "template",
        "system",
        "um_tipo_novo",
      ].map(kindKey),
      ...[
        "window_closed",
        "invalid_recipient",
        "token_invalid",
        "rate_limited",
        "unavailable",
        "unconfirmed",
        "not_attempted",
        "number_disconnected",
        "simulator_off",
        "file_unavailable",
        "meta_132000",
        null,
      ].map(failureKey),
      ...[
        "not_allowed_in_support_session",
        "not_found",
        "number_disconnected",
        "empty",
        "too_long",
        "window_closed",
        "template_not_found",
        "template_not_approved",
        "template_params_mismatch",
        "opted_out",
        "note_required",
        "not_authorized",
        "backend_not_configured",
        "qualquer_outro",
      ].map(sendErrorKey),
      ...[
        "second_factor_required",
        "not_allowed_in_support_session",
        "not_authorized",
        "number_in_use",
        "simulator_off",
        "simulator_not_allowed",
        "not_recorded",
        "vault_not_configured",
        "backend_not_configured",
        "meta_not_configured",
        "invalid_signup",
        "signup_incomplete",
        "signup_code_refused",
        "account_unreadable",
        "no_number",
        "several_numbers",
        "subscribe_failed",
        "registration_code_needed",
        "registration_failed",
        "connection_not_found",
        "templates_unreadable",
        "qualquer_outro",
      ].map(connectErrorKey),
      ...[
        "connection_disconnected",
        "connection_expired",
        "partner_removed",
        "account_disconnected",
        "primary_inactivity",
        "account_offboarded",
        "outro",
        null,
      ].map(disconnectReasonKey),
      ...["approved", "pending", "rejected", "paused", "disabled", "um_estado_novo"].map(
        (status) => templateStatus(status).key,
      ),
      ...["promises_result", "speaks_of_price", "marketing_category"].map((code) => findingKey(code) ?? "missing"),
    ];
    for (const key of keys) expect(product[key], key).toBeTruthy();
    // A failure with no words of its own shows the vendor's code beside the generic sentence.
    expect(failureHasNoWords("meta_132000")).toBe(true);
    expect(failureHasNoWords("window_closed")).toBe(false);
    expect(product["inbox-failure-other"]).toContain("{code}");
    expect(findingKey("invalid_name")).toBeNull();
  });
});
