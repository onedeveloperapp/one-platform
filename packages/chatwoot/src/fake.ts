import { createHmac, randomBytes } from "node:crypto";

import {
  type ChatwootAccount,
  type ChatwootConversationStatus,
  type ChatwootFeatures,
  type ChatwootMessageStatus,
  type ChatwootPlatform,
  type ChatwootProfile,
  type ChatwootProvider,
  ChatwootRequestError,
  type ChatwootUser,
  type NewChatwootMessage,
} from "@flyee/chatwoot/types";

/**
 * Chatwoot in memory, deterministic, for tests and for a machine with no instance: what the HTTP provider does,
 * on the same rules (the person of an e-mail that already exists is returned, a token reaches only its own
 * account, a conversation's id is the account's own number, a status is kept only in an inbox of the API kind).
 * It also writes the deliveries the inbox's webhook would carry, signed with the inbox's secret, so a test drives
 * ONE's webhook as Chatwoot would.
 */

type FakeUser = { id: number; name: string; email: string; token: string; uiSettings: Record<string, unknown> };
type FakeInbox = {
  id: number;
  accountId: number;
  name: string;
  secret: string;
  webhookUrl: string;
  window: number;
  members: Set<number>;
};
type FakeContact = { id: number; accountId: number; name: string; phone: string; identifier: string };
type FakeConversation = { id: number; accountId: number; inboxId: number; contactId: number; status: string };
export type FakeMessage = {
  id: number;
  accountId: number;
  conversationId: number;
  senderId: number | null;
  content: string;
  type: "incoming" | "outgoing";
  private: boolean;
  sourceId: string | null;
  attachment: { name: string; mime: string; bytes: number } | null;
  status: ChatwootMessageStatus;
  externalError: string | null;
};
type FakeAccount = {
  id: number;
  name: string;
  features: ChatwootFeatures;
  users: Map<number, string>;
  nextConversation: number;
  deleted: boolean;
};

export class FakeChatwootProvider implements ChatwootProvider {
  readonly platform: ChatwootPlatform;
  readonly accounts = new Map<number, FakeAccount>();
  readonly users = new Map<number, FakeUser>();
  readonly inboxes = new Map<number, FakeInbox>();
  readonly contacts = new Map<number, FakeContact>();
  readonly conversations = new Map<string, FakeConversation>();
  readonly messages: FakeMessage[] = [];
  /** The links handed out, by person: a test follows one as the browser would. */
  readonly links: { userId: number; url: string }[] = [];
  private next = 1;

  constructor() {
    this.platform = {
      createAccount: async ({ name, features }) => {
        const id = this.id();
        this.accounts.set(id, {
          id,
          name,
          features: { ...features },
          users: new Map(),
          nextConversation: 1,
          deleted: false,
        });
        return { id };
      },
      deleteAccount: async (accountId) => {
        this.accountOf(accountId).deleted = true;
      },
      createUser: async ({ name, email }) => {
        const existing = [...this.users.values()].find((user) => user.email === email.toLowerCase());
        if (existing) return { id: existing.id };
        const id = this.id();
        this.users.set(id, { id, name, email: email.toLowerCase(), token: this.token(), uiSettings: {} });
        return { id };
      },
      user: async (userId): Promise<ChatwootUser> => {
        const user = this.userOf(userId);
        return {
          id: user.id,
          accessToken: user.token,
          accounts: [...this.accounts.values()]
            .filter((account) => !account.deleted && account.users.has(user.id))
            .map((account) => ({ id: account.id, role: account.users.get(user.id)! })),
        };
      },
      updateUser: async (userId, fields) => {
        const user = this.userOf(userId);
        if (fields.name) user.name = fields.name;
      },
      addAccountUser: async (accountId, userId, role) => {
        this.userOf(userId);
        this.accountOf(accountId).users.set(userId, role);
      },
      removeAccountUser: async (accountId, userId) => {
        this.accountOf(accountId).users.delete(userId);
        for (const inbox of this.inboxes.values()) if (inbox.accountId === accountId) inbox.members.delete(userId);
      },
      ssoLink: async (userId) => {
        this.userOf(userId);
        const url = `https://chatwoot.invalid/app/login?email=${userId}&sso_auth_token=${this.token()}`;
        this.links.push({ userId, url });
        return url;
      },
    };
  }

  account(accountId: number, token: string): ChatwootAccount {
    const caller = (): FakeUser => {
      const account = this.accountOf(accountId);
      const user = [...this.users.values()].find((item) => item.token === token);
      if (!user || !account.users.has(user.id)) throw new ChatwootRequestError(401, "invalid_access_token");
      return user;
    };
    const admin = (): FakeUser => {
      const user = caller();
      if (this.accountOf(accountId).users.get(user.id) !== "administrator") {
        throw new ChatwootRequestError(401, "you_are_not_authorized_to_do_this_action");
      }
      return user;
    };
    const conversation = (id: number): FakeConversation => {
      const found = this.conversations.get(`${accountId}:${id}`);
      if (!found) throw new ChatwootRequestError(404, "resource_could_not_be_found");
      return found;
    };

    return {
      createApiInbox: async ({ name, webhookUrl, replyWindowHours }) => {
        admin();
        const id = this.id();
        const secret = this.token();
        this.inboxes.set(id, { id, accountId, name, secret, webhookUrl, window: replyWindowHours, members: new Set() });
        return { id, secret };
      },
      inbox: async (inboxId) => {
        admin();
        const inbox = this.inboxes.get(inboxId);
        if (!inbox || inbox.accountId !== accountId) throw new ChatwootRequestError(404, "resource_could_not_be_found");
        return { id: inbox.id, secret: inbox.secret };
      },
      addInboxMembers: async (inboxId, userIds) => {
        admin();
        const inbox = this.inboxes.get(inboxId);
        if (!inbox || inbox.accountId !== accountId) throw new ChatwootRequestError(404, "resource_could_not_be_found");
        for (const id of userIds) inbox.members.add(id);
      },
      findContact: async (identifier) => {
        caller();
        const found = [...this.contacts.values()].find(
          (contact) =>
            contact.accountId === accountId &&
            (contact.identifier === identifier || contact.phone === `+${identifier}`),
        );
        return found ? { id: found.id } : null;
      },
      createContact: async ({ name, phone, identifier }) => {
        caller();
        const taken = [...this.contacts.values()].some(
          (contact) =>
            contact.accountId === accountId && (contact.phone === phone || contact.identifier === identifier),
        );
        if (taken) throw new ChatwootRequestError(422, "phone_number_has_already_been_taken");
        const id = this.id();
        this.contacts.set(id, { id, accountId, name, phone, identifier });
        return { id };
      },
      deleteContact: async (contactId) => {
        admin();
        const contact = this.contacts.get(contactId);
        if (!contact || contact.accountId !== accountId)
          throw new ChatwootRequestError(404, "resource_could_not_be_found");
        this.contacts.delete(contactId);
        for (const [key, item] of this.conversations)
          if (item.accountId === accountId && item.contactId === contactId) this.conversations.delete(key);
      },
      createConversation: async ({ inboxId, contactId, status }) => {
        caller();
        const account = this.accountOf(accountId);
        if (!this.contacts.has(contactId)) throw new ChatwootRequestError(404, "resource_could_not_be_found");
        const id = account.nextConversation;
        account.nextConversation += 1;
        this.conversations.set(`${accountId}:${id}`, { id, accountId, inboxId, contactId, status });
        return { id };
      },
      deleteConversation: async (conversationId) => {
        admin();
        conversation(conversationId);
        this.conversations.delete(`${accountId}:${conversationId}`);
      },
      setConversationStatus: async (conversationId, status: ChatwootConversationStatus) => {
        caller();
        conversation(conversationId).status = status;
      },
      createMessage: async (conversationId, message: NewChatwootMessage) => {
        const user = caller();
        conversation(conversationId);
        const id = this.id();
        this.messages.push({
          id,
          accountId,
          conversationId,
          senderId: message.type === "outgoing" ? user.id : null,
          content: message.content,
          type: message.type,
          private: message.private === true,
          sourceId: message.sourceId ?? null,
          attachment: message.attachment
            ? {
                name: message.attachment.name,
                mime: message.attachment.mime,
                bytes: message.attachment.bytes.byteLength,
              }
            : null,
          status: "sent",
          externalError: null,
        });
        return { id };
      },
      setMessageStatus: async (conversationId, messageId, status, externalError) => {
        caller();
        conversation(conversationId);
        const message = this.messages.find((item) => item.id === messageId && item.accountId === accountId);
        if (!message) throw new ChatwootRequestError(404, "resource_could_not_be_found");
        message.status = status;
        message.externalError = externalError ?? null;
      },
    };
  }

  profile(userToken: string): ChatwootProfile {
    return {
      mergeUiSettings: async (settings) => {
        const user = [...this.users.values()].find((item) => item.token === userToken);
        if (!user) throw new ChatwootRequestError(401, "invalid_access_token");
        user.uiSettings = { ...user.uiSettings, ...settings };
      },
    };
  }

  // ---------- What a test reads and drives ----------

  /** The conversation of an account, as the panel shows it. */
  conversation(accountId: number, conversationId: number): FakeConversation | undefined {
    return this.conversations.get(`${accountId}:${conversationId}`);
  }

  messagesOf(accountId: number, conversationId: number): FakeMessage[] {
    return this.messages.filter((item) => item.accountId === accountId && item.conversationId === conversationId);
  }

  userByEmail(email: string): FakeUser | undefined {
    return [...this.users.values()].find((user) => user.email === email.toLowerCase());
  }

  /**
   * A person of the panel writes to the client: the message is kept, and the delivery the inbox's webhook would
   * carry is returned, signed with the inbox's secret.
   */
  personWrites(input: {
    accountId: number;
    conversationId: number;
    userId: number;
    content: string;
    attachments?: number;
  }) {
    const found = this.conversation(input.accountId, input.conversationId);
    if (!found) throw new Error("no such conversation");
    const id = this.id();
    this.messages.push({
      id,
      accountId: input.accountId,
      conversationId: input.conversationId,
      senderId: input.userId,
      content: input.content,
      type: "outgoing",
      private: false,
      sourceId: null,
      attachment: null,
      status: "sent",
      externalError: null,
    });
    const user = this.userOf(input.userId);
    return {
      messageId: id,
      ...this.delivery(found.inboxId, {
        event: "message_created",
        id,
        account: { id: input.accountId, name: this.accountOf(input.accountId).name },
        content: input.content,
        message_type: "outgoing",
        private: false,
        source_id: null,
        content_attributes: {},
        sender: { id: user.id, name: user.name, email: user.email, type: "user" },
        inbox: { id: found.inboxId },
        conversation: { id: found.id, inbox_id: found.inboxId, status: found.status },
        ...(input.attachments
          ? { attachments: Array.from({ length: input.attachments }, (_, index) => ({ id: index + 1 })) }
          : {}),
      }),
    };
  }

  /** A person changes the conversation's status in the panel: the delivery of `conversation_status_changed`. */
  personSetsStatus(input: {
    accountId: number;
    conversationId: number;
    status: "open" | "pending" | "resolved" | "snoozed";
  }) {
    const found = this.conversation(input.accountId, input.conversationId);
    if (!found) throw new Error("no such conversation");
    found.status = input.status;
    return this.delivery(found.inboxId, {
      event: "conversation_status_changed",
      id: found.id,
      inbox_id: found.inboxId,
      status: input.status,
      account: { id: input.accountId, name: this.accountOf(input.accountId).name },
      changed_attributes: [{ status: { current_value: input.status } }],
    });
  }

  /** The body and the headers of a delivery to an inbox's webhook, signed as `Webhooks::Trigger` signs it. */
  delivery(inboxId: number, payload: Record<string, unknown>, now = Math.floor(Date.now() / 1000)) {
    const inbox = this.inboxes.get(inboxId);
    if (!inbox) throw new Error("no such inbox");
    const rawBody = JSON.stringify(payload);
    const timestamp = String(now);
    const signature = `sha256=${createHmac("sha256", inbox.secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
    return { rawBody, timestamp, signature, url: inbox.webhookUrl };
  }

  private id(): number {
    const id = this.next;
    this.next += 1;
    return id;
  }

  private token(): string {
    return randomBytes(12).toString("hex");
  }

  private accountOf(accountId: number): FakeAccount {
    const account = this.accounts.get(accountId);
    if (!account || account.deleted) throw new ChatwootRequestError(404, "resource_could_not_be_found");
    return account;
  }

  private userOf(userId: number): FakeUser {
    const user = this.users.get(userId);
    if (!user) throw new ChatwootRequestError(404, "resource_could_not_be_found");
    return user;
  }
}
