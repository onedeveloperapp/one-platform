/**
 * WhatsApp of ONE (docs/ONE-PLANO-DESENVOLVIMENTO.md, 3.2, 4.6 and 6).
 *
 * Each firm connects its own number through the official Cloud API, and a
 * provider instance speaks for ONE number of ONE firm: the number and its
 * token are fixed when the instance is built, never passed per call.
 *
 * What may be sent (the 24-hour window, approved templates, opt-outs) is
 * decided before a provider is ever called, in the database
 * (`reserve_wa_send`, migration 0019). A provider only carries a message
 * that was already reserved, and says what the vendor answered.
 */

/**
 * Who stands where the vendor stands for a number: the vendor itself, the simulator of a development
 * machine, the test chat of a firm (its page by a link, honoured in production, reaching nobody), or the
 * platform's OpenWA, a number linked by WhatsApp Web (the unofficial way, a firm's choice; 2026-11-11).
 */
export type WhatsAppProviderName = "meta" | "simulator" | "test" | "openwa";

/** How long a person's message keeps free text open. The database's setting is the one that decides. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A message the firm sends. */
export type OutboundMessage =
  | {
      kind: "text";
      text: string;
      /**
       * Shown as buttons or a list where the vendor has them (the official API), the text's numbered choices
       * (`choicesOf`); another provider sends the text as it is, its numbered lines answered by number or words.
       */
      choices?: { body: string; options: string[] };
    }
  | {
      kind: "template";
      /** The name the template was approved under. */
      name: string;
      /** The template's language code, "pt_BR" when left out. */
      language?: string;
      /** The values of the body's placeholders, in order: {{1}}, {{2}}. */
      bodyParams?: string[];
    }
  | {
      kind: "image" | "document";
      /** Where the vendor fetches the file: a short-lived signed address of the firm's file. */
      url: string;
      caption?: string;
      /** The name a document shows with. */
      filename?: string;
    };

/**
 * Why a send was refused, in words the caller records and branches on:
 * - `window_closed`: free text more than 24 hours after the person's last message;
 * - `invalid_recipient`: the destination is not a WhatsApp number;
 * - `token_invalid`: the firm's token no longer works (the number must be connected again);
 * - `rate_limited`: the vendor asked to slow down (trying later may work);
 * - `unavailable`: the vendor SAID it could not take the message now (trying later may work);
 * - `unconfirmed`: the vendor did not answer, or answered without saying what it did. The message
 *   may or may not have gone out: nobody sends it again without asking the person first;
 * - `rejected`: the vendor refused it for another reason, named in `detail` (a code, never a text of the message).
 *
 * Every one of them but `unconfirmed` means the message did not go out.
 */
export type SendError =
  | "window_closed"
  | "invalid_recipient"
  | "token_invalid"
  | "rate_limited"
  | "unavailable"
  | "unconfirmed"
  | "rejected";

export type SendResult = { ok: true; providerMessageId: string } | { ok: false; error: SendError; detail?: string };

/** A template of the firm's account, as ONE keeps it (`wa_templates`). */
export interface AccountTemplate {
  name: string;
  language: string;
  /** `marketing`, `utility` or `authentication`, lower case. */
  category: string;
  /** `approved`, `pending`, `rejected`, `paused` or `disabled`, lower case. */
  status: string;
  body: string;
  headerText: string | null;
  footerText: string | null;
  /** How many placeholders the body has. */
  paramCount: number;
  components: unknown[];
}

/** A template ONE submits to the firm's account for approval: a utility message with its values in order. */
export interface TemplateSubmission {
  /** Lower-case letters, digits and underscores; a new name each time (a name the vendor took is never reused). */
  name: string;
  /** "pt_BR". */
  language: string;
  category: "utility";
  /** The body, with its values {{1}}, {{2}} in order. */
  body: string;
  footer: string | null;
  /** An example of each value, in order: the vendor asks for them to review the template. */
  examples: string[];
}

/**
 * What came of submitting a template:
 * - ok: the vendor took it, with its id, the status it gave it (usually `pending`; a utility message may come
 *   back `approved` at once) and the category it decided, lower case;
 * - not ok: refused (`meta_<code>`, or `http_<status>` when the vendor named no code), or `unconfirmed` when
 *   the vendor did not answer: it may have taken it, and the next reading of the account's templates says.
 */
export type TemplateCreated = { ok: true; id: string; status: string; category: string } | { ok: false; code: string };

/**
 * The business profile of a number, as the firm's brand and data write it (the plan "o escritório preparado antes do
 * primeiro atendimento", phase 2): what a client sees of the firm in WhatsApp. Each provider takes what its vendor
 * takes, within the vendor's limits; a field left out is left as it is.
 */
export type BusinessProfile = {
  /** The line under the name (the vendor's "about"). */
  about?: string;
  description?: string;
  address?: string;
  email?: string;
  websites?: string[];
};

/** What came of a profile sent: taken, or why not (`not_supported` where the vendor has no way to set it). */
export type ProfileUpdated = { ok: true } | { ok: false; code: string };

export interface FetchedMedia {
  bytes: Uint8Array;
  mime: string;
}

/**
 * What came of fetching a media a person sent:
 * - `fetched`: the bytes;
 * - `gone`: the vendor no longer has it (it keeps a media for 7 days), or never had it under this number;
 * - `later`: it could not be fetched NOW (the vendor did not answer, asked to slow down, refused the
 *   token). The media may well still be there, so the caller tries again and never gives it up for this.
 */
export type MediaResult = ({ kind: "fetched" } & FetchedMedia) | { kind: "gone" } | { kind: "later"; detail: string };

export interface WhatsAppProvider {
  readonly name: WhatsAppProviderName;
  /** Sends a reserved message. Never throws: a refusal is an answer the caller records. */
  send(to: string, message: OutboundMessage): Promise<SendResult>;
  /** The bytes of a media a person sent, by the vendor's id. Never throws: what happened is the answer. */
  fetchMedia(mediaId: string): Promise<MediaResult>;
  /** The templates of the number's account, with their approval. */
  listTemplates(): Promise<AccountTemplate[]>;
  /** Submits a template to the number's account for approval. Never throws: what the vendor answered is the answer. */
  createTemplate(submission: TemplateSubmission): Promise<TemplateCreated>;
  /** Sets the number's business profile. Never throws: what the vendor answered is the answer. */
  updateProfile(profile: BusinessProfile): Promise<ProfileUpdated>;
}

// ---------- What a webhook says ----------

export type InboundKind =
  | "text"
  | "image"
  | "document"
  | "audio"
  | "video"
  | "sticker"
  | "location"
  | "contacts"
  | "reaction"
  | "interactive"
  | "button"
  | "system"
  | "unsupported";

export interface InboundMedia {
  id: string;
  mimeType: string | null;
  filename: string | null;
}

/** The ad or post a person's first message came from (Meta's `referral`): nothing of the person. */
export type AdReferral = {
  sourceType: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  headline: string | null;
  ctwaClid: string | null;
};

/** One thing a webhook delivery says, already read into the platform's own words. */
export type WhatsAppEvent =
  /** A person wrote to a firm's number. */
  | {
      type: "message";
      phoneNumberId: string;
      from: string;
      contactName: string | null;
      providerMessageId: string;
      kind: InboundKind;
      /** The text, the caption of a media, or the label of a button the person tapped. */
      body: string | null;
      media: InboundMedia | null;
      replyTo: string | null;
      timestamp: Date | null;
      /**
       * The ad or post the conversation was opened from ("click to WhatsApp"), as Meta's `referral` names it; only
       * on a message that came from one.
       */
      adReferral?: AdReferral;
    }
  /** What became of a message the firm sent. */
  | {
      type: "status";
      phoneNumberId: string;
      providerMessageId: string;
      status: "sent" | "delivered" | "read" | "failed";
      /** The vendor's error code, as text. */
      errorCode: string | null;
      pricingCategory: string | null;
      pricingType: string | null;
    }
  /** The firm sent a message from its own phone (coexistence). */
  | {
      type: "echo";
      phoneNumberId: string;
      to: string;
      providerMessageId: string;
      kind: InboundKind;
      body: string | null;
      timestamp: Date | null;
    }
  /** A contact of the firm's phone was added, renamed or removed (coexistence). */
  | { type: "contact"; phoneNumberId: string; contact: string; name: string | null; action: "add" | "remove" }
  /** A piece of the history the firm agreed to share when it connected (coexistence). */
  | {
      type: "history";
      phoneNumberId: string;
      /** 0 to 100; 100 means the sync is complete. */
      progress: number | null;
      threads: {
        contact: string;
        messages: {
          providerMessageId: string;
          direction: "in" | "out";
          kind: InboundKind;
          body: string | null;
          status: "sent" | "delivered" | "read" | "failed" | null;
          timestamp: Date | null;
        }[];
      }[];
    }
  /** The firm chose not to share its history. */
  | { type: "history_declined"; phoneNumberId: string }
  /** Something happened to the account: the firm disconnected, the vendor restricted it. */
  | {
      type: "account";
      wabaId: string;
      /** The vendor's event name: `PARTNER_REMOVED`, `ACCOUNT_OFFBOARDED`, `ACCOUNT_RECONNECTED`, `DISABLED_UPDATE`. */
      event: string;
      /** Why it was disconnected, when the vendor says: `PRIMARY_INACTIVITY`, `ACCOUNT_DISCONNECTED`. */
      reason: string | null;
    }
  /** A template changed status at the vendor: approved, rejected, paused. */
  | { type: "template_status"; wabaId: string; name: string; language: string | null; status: string }
  /** The vendor changed a template's category (a utility message it now calls marketing): the change made, never one announced. */
  | { type: "template_category"; wabaId: string; name: string; language: string | null; category: string };
