import { randomUUID } from "node:crypto";

import { paramCountOf } from "@flyee/whatsapp/rules";
import { signWebhook } from "@flyee/whatsapp/webhook";
import type {
  AccountTemplate,
  MediaResult,
  OutboundMessage,
  SendResult,
  TemplateCreated,
  TemplateSubmission,
  WhatsAppProvider,
} from "@flyee/whatsapp/types";

/**
 * A WhatsApp that lives on the developer's machine.
 *
 * It stands where the vendor stands, on both sides. As a provider it accepts
 * what the firm sends and answers with an id, like the Cloud API does. As the
 * vendor's servers it builds the webhook deliveries the Cloud API would post
 * (a person's message, the statuses of what was sent, an echo from the phone,
 * a disconnection), in the vendor's own shapes and signed with the
 * simulator's secret, so they enter the platform through the same door as the
 * real ones: the signature check, the routing by number, the parser.
 *
 * It never reaches the network. A number connected to the simulator is
 * marked `simulator` in the database, and an event signed by the simulator
 * can only touch numbers so marked.
 */

/** The templates a simulated account starts with: one approved, one waiting, as an account usually has. */
export const SIMULATOR_TEMPLATES: AccountTemplate[] = [
  {
    name: "retomar_conversa",
    language: "pt_BR",
    category: "utility",
    status: "approved",
    body: "Olá, {{1}}. Aqui é do escritório {{2}}. Podemos continuar a conversa sobre o seu caso por aqui?",
    headerText: null,
    footerText: "Responda SAIR para não receber mais.",
    paramCount: 2,
    components: [],
  },
  {
    name: "aviso_de_audiencia",
    language: "pt_BR",
    category: "utility",
    status: "pending",
    body: "Olá, {{1}}. Sua audiência está marcada para {{2}}. Qualquer dúvida, responda esta mensagem.",
    headerText: null,
    footerText: null,
    paramCount: 2,
    components: [],
  },
];

export class SimulatorProvider implements WhatsAppProvider {
  readonly name = "simulator" as const;
  /** What the firm sent through it, oldest first: for tests and for the simulator's own screen. */
  readonly outbox: { providerMessageId: string; to: string; message: OutboundMessage }[] = [];
  /** The templates submitted through it, oldest first. */
  readonly created: AccountTemplate[] = [];
  /**
   * The templates the platform already keeps of this simulated account besides the two it starts with (the
   * ones submitted through a simulator before): the simulator has no memory of its own between instances, so
   * a reading of the account lists them back, and a refresh never takes them away.
   */
  private readonly kept: AccountTemplate[];

  constructor(options: { templates?: AccountTemplate[] } = {}) {
    this.kept = options.templates ?? [];
  }

  async send(to: string, message: OutboundMessage): Promise<SendResult> {
    const recipient = to.replace(/\D/g, "");
    if (recipient.length < 8 || recipient.length > 15) return { ok: false, error: "invalid_recipient" };
    if (message.kind === "text" && !message.text.trim()) return { ok: false, error: "rejected", detail: "empty_text" };
    if (message.kind === "template" && !message.name.trim()) {
      return { ok: false, error: "rejected", detail: "template_without_name" };
    }
    const providerMessageId = `wamid.SIM${randomUUID().replace(/-/g, "").toUpperCase()}`;
    this.outbox.push({ providerMessageId, to: recipient, message });
    return { ok: true, providerMessageId };
  }

  /** A simulated person sends no real file: there is nothing to fetch, now or later. */
  async fetchMedia(): Promise<MediaResult> {
    return { kind: "gone" };
  }

  async listTemplates(): Promise<AccountTemplate[]> {
    const own = [...SIMULATOR_TEMPLATES, ...this.kept, ...this.created];
    const seen = new Set<string>();
    return own
      .filter((template) => {
        const key = `${template.name}/${template.language}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((template) => ({ ...template }));
  }

  /** Approved at once, as a utility message: the simulated vendor reviews nothing. */
  async createTemplate(submission: TemplateSubmission): Promise<TemplateCreated> {
    if (!/^[a-z0-9_]{1,512}$/.test(submission.name) || !submission.body.trim()) return { ok: false, code: "rejected" };
    this.created.push({
      name: submission.name,
      language: submission.language,
      category: "utility",
      status: "approved",
      body: submission.body,
      headerText: null,
      footerText: submission.footer,
      paramCount: paramCountOf(submission.body),
      components: [],
    });
    return { ok: true, id: `sim-template-${randomUUID()}`, status: "approved", category: "utility" };
  }
}

// ---------- The webhook deliveries the vendor would post ----------

export interface SimulatedNumber {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
}

const seconds = (at: Date) => String(Math.floor(at.getTime() / 1000));

const delivery = (number: SimulatedNumber, field: string, value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: number.wabaId,
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: number.displayPhoneNumber, phone_number_id: number.phoneNumberId },
            ...value,
          },
          field,
        },
      ],
    },
  ],
});

/** A person writes to the firm's number. */
export function inboundTextDelivery(
  number: SimulatedNumber,
  from: { phone: string; name: string },
  text: string,
  at: Date = new Date(),
): Record<string, unknown> {
  const phone = from.phone.replace(/\D/g, "");
  return delivery(number, "messages", {
    contacts: [{ profile: { name: from.name }, wa_id: phone }],
    messages: [
      {
        from: phone,
        id: `wamid.SIM${randomUUID().replace(/-/g, "").toUpperCase()}`,
        timestamp: seconds(at),
        type: "text",
        text: { body: text },
      },
    ],
  });
}

/** What became of a message the firm sent: sent, delivered, read. */
export function statusDelivery(
  number: SimulatedNumber,
  providerMessageId: string,
  to: string,
  status: "sent" | "delivered" | "read" | "failed",
  at: Date = new Date(),
): Record<string, unknown> {
  return delivery(number, "messages", {
    statuses: [
      {
        id: providerMessageId,
        status,
        timestamp: seconds(at),
        recipient_id: to.replace(/\D/g, ""),
        ...(status === "sent" || status === "delivered"
          ? { pricing: { billable: false, pricing_model: "PMP", type: "free_customer_service", category: "service" } }
          : {}),
        ...(status === "failed"
          ? { errors: [{ code: 131026, title: "Message undeliverable", message: "Message undeliverable" }] }
          : {}),
      },
    ],
  });
}

/** The firm writes from its own phone (a number that also lives on the phone app). */
export function echoDelivery(
  number: SimulatedNumber,
  to: string,
  text: string,
  at: Date = new Date(),
): Record<string, unknown> {
  return delivery(number, "smb_message_echoes", {
    message_echoes: [
      {
        from: number.displayPhoneNumber,
        to: to.replace(/\D/g, ""),
        id: `wamid.SIM${randomUUID().replace(/-/g, "").toUpperCase()}`,
        timestamp: seconds(at),
        type: "text",
        text: { body: text },
      },
    ],
  });
}

/** The firm disconnected the platform from its phone, or stopped using the phone. */
export function disconnectionDelivery(number: SimulatedNumber, reason = "ACCOUNT_DISCONNECTED"): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: number.wabaId,
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            value: {
              event: "PARTNER_REMOVED",
              waba_info: { waba_id: number.wabaId },
              disconnection_info: { reason, initiated_by: "USER" },
            },
            field: "account_update",
          },
        ],
      },
    ],
  };
}

/** A delivery as it travels: the raw body and the signature header the webhook checks. */
export function signedDelivery(payload: Record<string, unknown>, secret: string): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify(payload);
  return { rawBody, signature: signWebhook(rawBody, secret) };
}
