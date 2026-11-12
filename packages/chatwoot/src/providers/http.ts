import {
  type ChatwootAccount,
  type ChatwootAttachment,
  type ChatwootConversationStatus,
  type ChatwootInbox,
  type ChatwootMessageStatus,
  type ChatwootPlatform,
  type ChatwootProfile,
  type ChatwootProvider,
  ChatwootRequestError,
  ChatwootUnavailableError,
  type ChatwootUser,
  type NewChatwootMessage,
} from "@flyee/chatwoot/types";

/**
 * Chatwoot over its HTTP API. Every call sends the token as `Authorization: Bearer` (Chatwoot reads it there as
 * well as in `api_access_token`, and a proxy may drop a header with an underscore), waits at most `timeoutMs`,
 * and turns what came back into a value or into one of the adapter's errors: 429 and 5xx, a time out or no
 * answer are `ChatwootUnavailableError`; any other refusal is `ChatwootRequestError` with Chatwoot's status.
 * Nothing of a request's body is written to an error.
 */

export type HttpChatwootConfig = {
  /** The instance the server reaches, with no path: `https://atendimento.example`. */
  url: string;
  /** The Platform App's token. */
  platformToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type Body = Record<string, unknown> | FormData | undefined;

const trim = (url: string): string => url.replace(/\/+$/, "");

function codeOf(body: unknown): string {
  const value = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const raw = value.error ?? value.message ?? (Array.isArray(value.errors) ? value.errors[0] : null) ?? "refused";
  return (
    String(typeof raw === "object" ? JSON.stringify(raw) : raw)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "refused"
  );
}

async function call<T>(
  config: Required<Pick<HttpChatwootConfig, "fetchImpl" | "timeoutMs">>,
  method: string,
  url: string,
  token: string,
  body?: Body,
): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: "application/json" };
  let payload: RequestInit["body"] | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await config.fetchImpl(url, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw new ChatwootUnavailableError(
      error instanceof Error && error.name === "TimeoutError" ? "timeout" : "no_answer",
    );
  }
  const text = await response.text().catch(() => "");
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (response.status === 429 || response.status >= 500) {
    throw new ChatwootUnavailableError(`http_${response.status}`);
  }
  if (!response.ok) throw new ChatwootRequestError(response.status, codeOf(parsed));
  return parsed as T;
}

const idOf = (value: unknown): number => {
  const id = value && typeof value === "object" ? (value as Record<string, unknown>).id : null;
  if (typeof id !== "number" || !Number.isSafeInteger(id)) throw new ChatwootRequestError(200, "no_id_in_answer");
  return id;
};

function userOf(body: unknown): ChatwootUser {
  const value = (body ?? {}) as Record<string, unknown>;
  const accounts = Array.isArray(value.accounts) ? value.accounts : [];
  return {
    id: idOf(value),
    accessToken: typeof value.access_token === "string" && value.access_token ? value.access_token : null,
    accounts: accounts
      .map((item) => item as Record<string, unknown>)
      .filter((item) => typeof item.id === "number")
      .map((item) => ({ id: item.id as number, role: String(item.role ?? "") })),
  };
}

function inboxOf(body: unknown): ChatwootInbox {
  const value = (body ?? {}) as Record<string, unknown>;
  return { id: idOf(value), secret: typeof value.secret === "string" && value.secret ? value.secret : null };
}

export class HttpChatwootProvider implements ChatwootProvider {
  readonly platform: ChatwootPlatform;
  private readonly root: string;
  private readonly settings: Required<Pick<HttpChatwootConfig, "fetchImpl" | "timeoutMs">>;

  constructor(config: HttpChatwootConfig) {
    if (!/^https?:\/\//.test(config.url)) throw new Error("chatwoot url must be http(s)");
    this.root = trim(config.url);
    this.settings = { fetchImpl: config.fetchImpl ?? fetch, timeoutMs: config.timeoutMs ?? 10_000 };
    const token = config.platformToken;
    const at = (path: string) => `${this.root}/platform/api/v1/${path}`;
    const send = <T>(method: string, path: string, body?: Body) =>
      call<T>(this.settings, method, at(path), token, body);

    this.platform = {
      createAccount: async ({ name, features }) => ({
        id: idOf(await send("POST", "accounts", { name, locale: "pt_BR", features })),
      }),
      deleteAccount: async (accountId) => {
        await send("DELETE", `accounts/${Number(accountId)}`);
      },
      createUser: async ({ name, email, password }) => ({
        id: idOf(await send("POST", "users", { name, display_name: name, email, password })),
      }),
      user: async (userId) => userOf(await send("GET", `users/${Number(userId)}`)),
      updateUser: async (userId, fields) => {
        await send("PATCH", `users/${Number(userId)}`, fields);
      },
      addAccountUser: async (accountId, userId, role) => {
        await send("POST", `accounts/${Number(accountId)}/account_users`, { user_id: userId, role });
      },
      removeAccountUser: async (accountId, userId) => {
        await send("DELETE", `accounts/${Number(accountId)}/account_users?user_id=${Number(userId)}`);
      },
      ssoLink: async (userId) => {
        const answer = await send<{ url?: unknown }>("GET", `users/${Number(userId)}/login`);
        if (typeof answer?.url !== "string" || !/^https?:\/\//.test(answer.url)) {
          throw new ChatwootRequestError(200, "no_link_in_answer");
        }
        return answer.url;
      },
    };
  }

  account(accountId: number, token: string): ChatwootAccount {
    const base = `${this.root}/api/v1/accounts/${Number(accountId)}`;
    const send = <T>(method: string, path: string, body?: Body) =>
      call<T>(this.settings, method, `${base}/${path}`, token, body);

    return {
      createApiInbox: async ({ name, webhookUrl, replyWindowHours }) =>
        inboxOf(
          await send("POST", "inboxes", {
            name,
            channel: {
              type: "api",
              webhook_url: webhookUrl,
              additional_attributes: { agent_reply_time_window: replyWindowHours },
            },
          }),
        ),
      inbox: async (inboxId) => inboxOf(await send("GET", `inboxes/${Number(inboxId)}`)),
      addInboxMembers: async (inboxId, userIds) => {
        if (userIds.length === 0) return;
        await send("POST", "inbox_members", { inbox_id: inboxId, user_ids: userIds });
      },
      findContact: async (identifier) => {
        const answer = await send<{ payload?: unknown }>(
          "GET",
          `contacts/search?q=${encodeURIComponent(identifier)}&page=1`,
        );
        const found = (Array.isArray(answer?.payload) ? answer.payload : [])
          .map((item) => item as Record<string, unknown>)
          .find((item) => item.identifier === identifier || item.phone_number === `+${identifier}`);
        return found ? { id: idOf(found) } : null;
      },
      createContact: async ({ inboxId, name, phone, identifier }) => {
        const answer = await send<{ payload?: { contact?: unknown } }>("POST", "contacts", {
          inbox_id: inboxId,
          name,
          phone_number: phone,
          identifier,
        });
        return { id: idOf(answer?.payload?.contact) };
      },
      deleteContact: async (contactId) => {
        await send("DELETE", `contacts/${Number(contactId)}`);
      },
      createConversation: async ({ inboxId, contactId, status }) => ({
        id: idOf(await send("POST", "conversations", { inbox_id: inboxId, contact_id: contactId, status })),
      }),
      deleteConversation: async (conversationId) => {
        await send("DELETE", `conversations/${Number(conversationId)}`);
      },
      agentBot: async (name) => {
        const bots = await send<unknown>("GET", "agent_bots");
        const found = (Array.isArray(bots) ? bots : [])
          .map((item) => item as Record<string, unknown>)
          .find((item) => item.name === name && item.account_id !== null);
        if (found) return { id: idOf(found) };
        // No outgoing address: the robot is only who the conversation is with, and Chatwoot posts it nothing.
        return { id: idOf(await send("POST", "agent_bots", { name, description: name, outgoing_url: "" })) };
      },
      assignToBot: async (conversationId, botId) => {
        await send("POST", `conversations/${Number(conversationId)}/assignments`, {
          assignee_type: "AgentBot",
          assignee_id: botId,
        });
      },
      setConversationStatus: async (conversationId, status: ChatwootConversationStatus) => {
        await send("POST", `conversations/${Number(conversationId)}/toggle_status`, { status });
      },
      createMessage: async (conversationId, message: NewChatwootMessage) => {
        const path = `conversations/${Number(conversationId)}/messages`;
        if (message.attachment) return { id: idOf(await send("POST", path, formOf(message, message.attachment))) };
        return {
          id: idOf(
            await send("POST", path, {
              content: message.content,
              message_type: message.type,
              private: message.private === true,
              ...(message.sourceId ? { source_id: message.sourceId } : {}),
            }),
          ),
        };
      },
      setMessageStatus: async (conversationId, messageId, status: ChatwootMessageStatus, externalError) => {
        await send("PATCH", `conversations/${Number(conversationId)}/messages/${Number(messageId)}`, {
          status,
          ...(externalError ? { external_error: externalError } : {}),
        });
      },
    };
  }

  profile(userToken: string): ChatwootProfile {
    const url = `${this.root}/api/v1/profile`;
    return {
      mergeUiSettings: async (settings) => {
        const current = await call<{ ui_settings?: Record<string, unknown> }>(this.settings, "GET", url, userToken);
        await call(this.settings, "PUT", url, userToken, {
          profile: { ui_settings: { ...(current?.ui_settings ?? {}), ...settings } },
        });
      },
    };
  }
}

/** A message with its file goes as a form, the file in `attachments[]` (`Messages::MessageBuilder#process_attachments`). */
function formOf(message: NewChatwootMessage, attachment: ChatwootAttachment): FormData {
  const form = new FormData();
  form.set("content", message.content);
  form.set("message_type", message.type);
  form.set("private", message.private === true ? "true" : "false");
  if (message.sourceId) form.set("source_id", message.sourceId);
  const bytes = new Uint8Array(attachment.bytes);
  form.append("attachments[]", new Blob([bytes], { type: attachment.mime }), attachment.name);
  return form;
}
