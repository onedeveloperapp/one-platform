import assert from "node:assert/strict";
import test from "node:test";

import {
  disconnectionDelivery,
  echoDelivery,
  inboundTextDelivery,
  signedDelivery,
  statusDelivery,
} from "./simulator.ts";
import { parseWebhook, signWebhook, verifySignature } from "./webhook.ts";

const NUMBER = { wabaId: "waba-1", phoneNumberId: "phone-1", displayPhoneNumber: "5562900000001" };

/** A delivery in the vendor's shape, with one change. */
const change = (field: string, value: Record<string, unknown>, entryId = "waba-1") => ({
  object: "whatsapp_business_account",
  entry: [{ id: entryId, changes: [{ field, value }] }],
});

const withNumber = (value: Record<string, unknown>) => ({
  messaging_product: "whatsapp",
  metadata: { display_phone_number: "5562900000001", phone_number_id: "phone-1" },
  ...value,
});

test("a delivery is authentic only when its signature is the HMAC of the raw body", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const signature = signWebhook(body, "segredo-do-app");
  assert.match(signature, /^sha256=[0-9a-f]{64}$/);
  assert.equal(verifySignature(body, signature, "segredo-do-app"), true);
  assert.equal(verifySignature(body, signature.toUpperCase().replace("SHA256", "sha256"), "segredo-do-app"), true);

  // Another body, another secret, a header in another form, no header, no secret: none passes.
  assert.equal(verifySignature(`${body} `, signature, "segredo-do-app"), false);
  assert.equal(verifySignature(body, signature, "outro-segredo"), false);
  assert.equal(verifySignature(body, signature.slice(7), "segredo-do-app"), false);
  assert.equal(verifySignature(body, "sha256=abc", "segredo-do-app"), false);
  assert.equal(verifySignature(body, null, "segredo-do-app"), false);
  assert.equal(verifySignature(body, signature, ""), false);
});

test("a person's text is read with who sent it, to which number, and when", () => {
  const events = parseWebhook(
    change(
      "messages",
      withNumber({
        contacts: [{ profile: { name: "Maria Teste" }, wa_id: "5562999990001" }],
        messages: [
          {
            from: "5562999990001",
            id: "wamid.A1",
            timestamp: "1760000000",
            type: "text",
            text: { body: "Perdi meu voo ontem." },
          },
        ],
      }),
    ),
  );
  assert.deepEqual(events, [
    {
      type: "message",
      phoneNumberId: "phone-1",
      from: "5562999990001",
      contactName: "Maria Teste",
      providerMessageId: "wamid.A1",
      kind: "text",
      body: "Perdi meu voo ontem.",
      media: null,
      replyTo: null,
      timestamp: new Date(1760000000 * 1000),
    },
  ]);
});

test("a document, a photo and a tapped button are read as what they are", () => {
  const events = parseWebhook(
    change(
      "messages",
      withNumber({
        messages: [
          {
            from: "5562999990001",
            id: "wamid.D1",
            timestamp: "1760000001",
            type: "document",
            document: { caption: "meu bilhete", filename: "bilhete.pdf", mime_type: "application/pdf", sha256: "x", id: "media-9" },
          },
          {
            from: "5562999990001",
            id: "wamid.I1",
            timestamp: "1760000002",
            type: "image",
            image: { mime_type: "image/jpeg", sha256: "y", id: "media-10" },
          },
          {
            context: { from: "5562900000001", id: "wamid.OUT1" },
            from: "5562999990001",
            id: "wamid.B1",
            timestamp: "1760000003",
            type: "interactive",
            interactive: { type: "button_reply", button_reply: { id: "sim", title: "Sim, pode ser" } },
          },
          { from: "5562999990001", id: "wamid.N1", timestamp: "1760000004", type: "um_tipo_novo" },
        ],
      }),
    ),
  );
  assert.equal(events.length, 4);
  const [document, image, button, unknown] = events;
  assert.deepEqual(
    document.type === "message" && [document.kind, document.body, document.media],
    ["document", "meu bilhete", { id: "media-9", mimeType: "application/pdf", filename: "bilhete.pdf" }],
  );
  assert.deepEqual(image.type === "message" && [image.kind, image.body, image.media?.id], ["image", null, "media-10"]);
  assert.deepEqual(
    button.type === "message" && [button.kind, button.body, button.replyTo],
    ["interactive", "Sim, pode ser", "wamid.OUT1"],
  );
  // A kind this code does not know is kept as unsupported, never dropped: the person did write something.
  assert.equal(unknown.type === "message" && unknown.kind, "unsupported");
});

test("a status carries what became of a message, its pricing, and the error code when it failed", () => {
  const events = parseWebhook(
    change(
      "messages",
      withNumber({
        statuses: [
          {
            id: "wamid.OUT1",
            status: "delivered",
            timestamp: "1760000010",
            recipient_id: "5562999990001",
            pricing: { billable: true, pricing_model: "PMP", type: "regular", category: "utility" },
          },
          {
            id: "wamid.OUT2",
            status: "failed",
            timestamp: "1760000011",
            recipient_id: "5562999990001",
            errors: [{ code: 131047, title: "Re-engagement message", message: "Re-engagement message" }],
          },
          { id: "wamid.OUT3", status: "played", timestamp: "1760000012", recipient_id: "5562999990001" },
        ],
      }),
    ),
  );
  assert.deepEqual(events, [
    {
      type: "status",
      phoneNumberId: "phone-1",
      providerMessageId: "wamid.OUT1",
      status: "delivered",
      errorCode: null,
      pricingCategory: "utility",
      pricingType: "regular",
    },
    {
      type: "status",
      phoneNumberId: "phone-1",
      providerMessageId: "wamid.OUT2",
      status: "failed",
      errorCode: "131047",
      pricingCategory: null,
      pricingType: null,
    },
  ]);
});

test("what the firm types on its phone arrives as an echo, and an edit or a deletion is left alone", () => {
  const events = parseWebhook(
    change(
      "smb_message_echoes",
      withNumber({
        message_echoes: [
          { from: "5562900000001", to: "5562999990001", id: "wamid.E1", timestamp: "1760000020", type: "text", text: { body: "Mandei pelo celular." } },
          { from: "5562900000001", to: "5562999990001", id: "wamid.E2", timestamp: "1760000021", type: "revoke", revoke: { original_message_id: "wamid.E1" } },
        ],
      }),
    ),
  );
  assert.deepEqual(events, [
    {
      type: "echo",
      phoneNumberId: "phone-1",
      to: "5562999990001",
      providerMessageId: "wamid.E1",
      kind: "text",
      body: "Mandei pelo celular.",
      timestamp: new Date(1760000020 * 1000),
    },
  ]);
});

test("the contacts of the firm's phone arrive added or removed", () => {
  const events = parseWebhook(
    change(
      "smb_app_state_sync",
      withNumber({
        state_sync: [
          {
            type: "contact",
            contact: { full_name: "Carlos do voo de Recife", first_name: "Carlos", phone_number: "+55 62 97777-0003" },
            action: "add",
            metadata: { timestamp: "1760000030" },
          },
          { type: "contact", contact: { phone_number: "5562977770004" }, action: "remove", metadata: { timestamp: "1760000031" } },
        ],
      }),
    ),
  );
  assert.deepEqual(events, [
    { type: "contact", phoneNumberId: "phone-1", contact: "5562977770003", name: "Carlos do voo de Recife", action: "add" },
    { type: "contact", phoneNumberId: "phone-1", contact: "5562977770004", name: null, action: "remove" },
  ]);
});

test("the shared history arrives in pieces, each message with its side and what became of it", () => {
  const events = parseWebhook(
    change(
      "history",
      withNumber({
        history: [
          {
            metadata: { phase: 0, chunk_order: 1, progress: 55 },
            threads: [
              {
                id: "5562999990001",
                messages: [
                  { from: "5562999990001", id: "wamid.H1", timestamp: "1750000000", type: "text", text: { body: "Bom dia." }, history_context: { status: "READ" } },
                  { from: "5562900000001", to: "5562999990001", id: "wamid.H2", timestamp: "1750000100", type: "text", text: { body: "Bom dia, Maria." }, history_context: { status: "DELIVERED" } },
                  { from: "5562999990001", id: "wamid.H3", timestamp: "1750000200", type: "media_placeholder" },
                ],
              },
            ],
          },
        ],
      }),
    ),
  );
  assert.equal(events.length, 1);
  const [history] = events;
  assert.equal(history.type, "history");
  if (history.type !== "history") return;
  assert.equal(history.progress, 55);
  assert.deepEqual(
    history.threads[0].messages.map((message) => [message.providerMessageId, message.direction, message.status, message.body]),
    [
      ["wamid.H1", "in", "read", "Bom dia."],
      ["wamid.H2", "out", "delivered", "Bom dia, Maria."],
    ],
  );

  // The firm chose not to share its history.
  const declined = parseWebhook(
    change("history", withNumber({ history: [{ errors: [{ code: 2593109, title: "History sync is turned off" }] }] })),
  );
  assert.deepEqual(declined, [{ type: "history_declined", phoneNumberId: "phone-1" }]);
});

test("what happens to an account and to a template is read with the account it belongs to", () => {
  const removed = parseWebhook({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "portfolio-do-parceiro",
        time: 1748477359,
        changes: [
          {
            field: "account_update",
            value: {
              event: "PARTNER_REMOVED",
              waba_info: { waba_id: "waba-1", owner_business_id: "negocio-1" },
              disconnection_info: { reason: "PRIMARY_INACTIVITY", initiated_by: "SYSTEM" },
            },
          },
        ],
      },
    ],
  });
  assert.deepEqual(removed, [{ type: "account", wabaId: "waba-1", event: "PARTNER_REMOVED", reason: "PRIMARY_INACTIVITY" }]);

  const template = parseWebhook(
    change("message_template_status_update", {
      event: "APPROVED",
      message_template_id: 123,
      message_template_name: "aviso_de_audiencia",
      message_template_language: "pt_BR",
      reason: "NONE",
    }),
  );
  assert.deepEqual(template, [
    { type: "template_status", wabaId: "waba-1", name: "aviso_de_audiencia", language: "pt_BR", status: "APPROVED" },
  ]);
});

test("a category the vendor gave a template is read when the change was made, never when it is only announced", () => {
  const made = parseWebhook(
    change("template_category_update", {
      message_template_id: 123,
      message_template_name: "one_lembrete_audiencia_1",
      message_template_language: "pt_BR",
      previous_category: "UTILITY",
      new_category: "MARKETING",
    }),
  );
  assert.deepEqual(made, [
    {
      type: "template_category",
      wabaId: "waba-1",
      name: "one_lembrete_audiencia_1",
      language: "pt_BR",
      category: "MARKETING",
    },
  ]);
  const announced = parseWebhook(
    change("template_category_update", {
      message_template_id: 123,
      message_template_name: "one_lembrete_audiencia_1",
      message_template_language: "pt_BR",
      new_category: "UTILITY",
      correct_category: "MARKETING",
      category_update_timestamp: 1746169200,
    }),
  );
  assert.deepEqual(announced, []);
});

test("what is not a WhatsApp delivery, or has a shape this code does not know, yields nothing and never throws", () => {
  for (const body of [null, "texto", 42, [], {}, { object: "page", entry: [] }, { object: "whatsapp_business_account" }]) {
    assert.deepEqual(parseWebhook(body), []);
  }
  assert.deepEqual(parseWebhook(change("messages", { messages: [{ from: "5562999990001", id: "wamid.X" }] })), []);
  assert.deepEqual(parseWebhook(change("um_campo_novo", withNumber({ algo: 1 }))), []);
  assert.deepEqual(parseWebhook(change("messages", withNumber({ messages: [{ type: "text" }, "lixo", null] }))), []);
});

test("the simulator's deliveries are in the vendor's shape, signed, and read back as what they simulate", () => {
  const at = new Date("2026-10-09T12:00:00Z");
  const inbound = inboundTextDelivery(NUMBER, { phone: "+55 62 99999-0001", name: "Maria Teste" }, "Oi.", at);
  const signed = signedDelivery(inbound, "segredo-do-simulador");
  assert.equal(verifySignature(signed.rawBody, signed.signature, "segredo-do-simulador"), true);
  assert.equal(verifySignature(signed.rawBody, signed.signature, "segredo-do-app"), false);

  const [message] = parseWebhook(JSON.parse(signed.rawBody));
  assert.equal(message.type, "message");
  if (message.type !== "message") return;
  assert.deepEqual(
    [message.phoneNumberId, message.from, message.contactName, message.body, message.timestamp?.toISOString()],
    ["phone-1", "5562999990001", "Maria Teste", "Oi.", "2026-10-09T12:00:00.000Z"],
  );
  assert.match(message.providerMessageId, /^wamid\.SIM[0-9A-F]{32}$/);

  const [status] = parseWebhook(statusDelivery(NUMBER, "wamid.SIM1", "5562999990001", "delivered", at));
  assert.deepEqual(status.type === "status" && [status.status, status.pricingType, status.pricingCategory], [
    "delivered",
    "free_customer_service",
    "service",
  ]);
  const [failed] = parseWebhook(statusDelivery(NUMBER, "wamid.SIM1", "5562999990001", "failed", at));
  assert.equal(failed.type === "status" && failed.errorCode, "131026");

  const [echo] = parseWebhook(echoDelivery(NUMBER, "5562999990001", "Do celular.", at));
  assert.deepEqual(echo.type === "echo" && [echo.to, echo.body], ["5562999990001", "Do celular."]);

  assert.deepEqual(parseWebhook(disconnectionDelivery(NUMBER)), [
    { type: "account", wabaId: "waba-1", event: "PARTNER_REMOVED", reason: "ACCOUNT_DISCONNECTED" },
  ]);
});
