/**
 * The firms' panel of attendance (the owner's decisions of 2026-11-09 and 2026-11-11): a Chatwoot of the
 * platform's own, one account per firm, where the firm's people follow and answer the conversations of the
 * firm's WhatsApp. ONE stays the one that talks to WhatsApp: the account has one inbox of the API kind, ONE
 * writes into it every message of the firm's conversations, and what a person of the firm writes there comes
 * back to ONE through the inbox's webhook and goes out through ONE's outbox, under its rules.
 *
 * The platform's token (a Platform App of the instance) creates the accounts, the people and the link that
 * enters the panel already signed in; an account's service person (an administrator of that account only)
 * writes the conversations; a person's own token sets their preferences of the panel. No token is kept by
 * ONE: the platform's comes from the environment, and the others are read through the platform's API when a
 * piece of work needs them.
 *
 * Shapes read in the code of Chatwoot 4.19.1 (`-ce`) on 2026-11-12: `config/routes.rb`, the Platform API's
 * users and accounts, `Api::V1::Accounts::{Inboxes,Contacts,Conversations,Conversations::Messages}Controller`,
 * `Messages::MessageBuilder`, `Channel::Api`, `WebhookListener` and `Webhooks::Trigger`.
 */

/** The account's functions, on or off, as the Platform API takes them (`features`). */
export type ChatwootFeatures = Record<string, boolean>;

/** A person of the instance, as the Platform API returns one created by its app. */
export type ChatwootUser = {
  id: number;
  /** The person's own token of the API; null when the instance did not return it. */
  accessToken: string | null;
  /** The accounts the person is in, with the role in each. */
  accounts: { id: number; role: string }[];
};

/** An inbox of the API kind: where ONE writes, and the secret Chatwoot signs its webhook with. */
export type ChatwootInbox = { id: number; secret: string | null };

/** What a conversation's status means to ONE: pending while ONE answers, open while a person does. */
export type ChatwootConversationStatus = "open" | "pending";

/** The status of a message written into an inbox of the API kind, which the inbox's owner keeps. */
export type ChatwootMessageStatus = "sent" | "delivered" | "read" | "failed";

/** A file that goes with a message: the bytes ONE keeps of a conversation's photo or document. */
export type ChatwootAttachment = { name: string; mime: string; bytes: Uint8Array };

export type NewChatwootMessage = {
  content: string;
  /** `incoming`: the client wrote it. `outgoing`: the firm or ONE did. */
  type: "incoming" | "outgoing";
  /** A note only the firm's people read. */
  private?: boolean;
  /** ONE's id of the message (`one:<id>`): the webhook of the message carries it back, so ONE knows its own. */
  sourceId?: string | null;
  attachment?: ChatwootAttachment | null;
};

/** The instance, through the platform's app. */
export interface ChatwootPlatform {
  createAccount(input: { name: string; features: ChatwootFeatures }): Promise<{ id: number }>;
  /** Takes the account out with everything in it (Chatwoot deletes it in the background). */
  deleteAccount(accountId: number): Promise<void>;
  /** Chatwoot returns the person that already has the e-mail, when one does (`User.from_email`). */
  createUser(input: { name: string; email: string; password: string }): Promise<{ id: number }>;
  user(userId: number): Promise<ChatwootUser>;
  updateUser(userId: number, fields: { name?: string; display_name?: string }): Promise<void>;
  /** Puts the person in the account with the role, or changes their role there. */
  addAccountUser(accountId: number, userId: number, role: "agent" | "administrator"): Promise<void>;
  /** Takes the person out of the account, never out of the instance. */
  removeAccountUser(accountId: number, userId: number): Promise<void>;
  /** The link that enters the panel signed in as the person: five minutes, once. */
  ssoLink(userId: number): Promise<string>;
}

/** One account, through a person's token (the service person's, or a person of the firm's). */
export interface ChatwootAccount {
  /** An inbox of the API kind, whose webhook is ONE's and whose replies close after so many hours. */
  createApiInbox(input: { name: string; webhookUrl: string; replyWindowHours: number }): Promise<ChatwootInbox>;
  /** The inbox, with its secret (an administrator reads it). */
  inbox(inboxId: number): Promise<ChatwootInbox>;
  addInboxMembers(inboxId: number, userIds: number[]): Promise<void>;
  /** The contact whose identifier is this one (ONE writes the client's WhatsApp number there), or null. */
  findContact(identifier: string): Promise<{ id: number } | null>;
  createContact(input: { inboxId: number; name: string; phone: string; identifier: string }): Promise<{ id: number }>;
  deleteContact(contactId: number): Promise<void>;
  /** A conversation of the contact in the inbox; its id is the account's own number of it (`display_id`). */
  createConversation(input: {
    inboxId: number;
    contactId: number;
    status: ChatwootConversationStatus;
  }): Promise<{ id: number }>;
  deleteConversation(conversationId: number): Promise<void>;
  setConversationStatus(conversationId: number, status: ChatwootConversationStatus): Promise<void>;
  createMessage(conversationId: number, message: NewChatwootMessage): Promise<{ id: number }>;
  /** Only in an inbox of the API kind: what became of a message, and why it failed. */
  setMessageStatus(
    conversationId: number,
    messageId: number,
    status: ChatwootMessageStatus,
    externalError?: string | null,
  ): Promise<void>;
}

/** A person's own preferences of the panel, through their token. */
export interface ChatwootProfile {
  /** Joins these to what the person already has: Chatwoot writes the whole object. */
  mergeUiSettings(settings: Record<string, unknown>): Promise<void>;
}

export interface ChatwootProvider {
  readonly platform: ChatwootPlatform;
  account(accountId: number, token: string): ChatwootAccount;
  profile(userToken: string): ChatwootProfile;
}

/** Chatwoot refused the request (a wrong value, something that is not there, no permission). */
export class ChatwootRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`chatwoot refused the request: ${status} ${code}`);
    this.name = "ChatwootRequestError";
    this.status = status;
    this.code = code;
  }
}

/** No answer, a time out, an error of Chatwoot's own: the same request may go through later. */
export class ChatwootUnavailableError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`chatwoot unavailable: ${code}`);
    this.name = "ChatwootUnavailableError";
    this.code = code;
  }
}

/** Something that is not there (any longer): a 404. */
export function isChatwootNotFound(error: unknown): boolean {
  return error instanceof ChatwootRequestError && error.status === 404;
}
