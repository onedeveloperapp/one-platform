import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FakeChatwootProvider } from "./fake.ts";
import { HttpChatwootProvider } from "./providers/http.ts";
import { type ChatwootProvider, ChatwootRequestError, ChatwootUnavailableError, isChatwootNotFound } from "./types.ts";
import { accountOfDelivery, oneSourceId, parseChatwootDelivery, verifyChatwootSignature } from "./webhook.ts";

/**
 * What any Chatwoot provider does, run against the fake and against the HTTP provider talking to a stand-in that
 * answers in the shapes of Chatwoot 4.19.1 (read in its code on 2026-11-12): the Platform API's accounts, users,
 * account users and login link; the Application API's inboxes (`secret` only to an administrator), contacts
 * (`payload.contact` when created, `payload` when searched), conversations (`display_id` as `id`), messages and
 * their status, and the profile. The stand-in keeps its state in a fake, so both runs meet the same rules. The
 * HTTP provider was also run once against the platform's instance on the same day, in a throwaway account.
 */

type Route = { method: string; path: string; query: URLSearchParams; token: string; body: unknown };

/** Chatwoot's HTTP API over a fake: each route answers with the JSON Chatwoot's views write. */
function chatwootStandIn(state: FakeChatwootProvider, platformToken: string) {
  const calls: Route[] = [];
  let failNext: number | null = null;

  const handle = async (route: Route): Promise<{ status: number; body?: unknown }> => {
    const { method, path, token, body } = route;
    const input = (body ?? {}) as Record<string, unknown>;
    let match: RegExpExecArray | null;

    if (path.startsWith("/platform/api/v1/")) {
      if (token !== platformToken) return { status: 401, body: { error: "Invalid access_token" } };
      const rest = path.slice("/platform/api/v1/".length);
      if (method === "POST" && rest === "accounts") {
        const { id } = await state.platform.createAccount({
          name: String(input.name),
          features: input.features as Record<string, boolean>,
        });
        return { status: 200, body: { id, name: input.name, locale: input.locale } };
      }
      if ((match = /^accounts\/(\d+)$/.exec(rest)) && method === "DELETE") {
        await state.platform.deleteAccount(Number(match[1]));
        return { status: 200 };
      }
      if (method === "POST" && rest === "users") {
        const { id } = await state.platform.createUser({
          name: String(input.name),
          email: String(input.email),
          password: String(input.password),
        });
        return { status: 200, body: await userView(id) };
      }
      if ((match = /^users\/(\d+)$/.exec(rest))) {
        if (method === "GET") return { status: 200, body: await userView(Number(match[1])) };
        if (method === "PATCH") {
          await state.platform.updateUser(Number(match[1]), input as { name?: string });
          return { status: 200, body: await userView(Number(match[1])) };
        }
      }
      if ((match = /^users\/(\d+)\/login$/.exec(rest)) && method === "GET") {
        return { status: 200, body: { url: await state.platform.ssoLink(Number(match[1])) } };
      }
      if ((match = /^accounts\/(\d+)\/account_users$/.exec(rest))) {
        if (method === "POST") {
          await state.platform.addAccountUser(Number(match[1]), Number(input.user_id), input.role as "agent");
          return { status: 200, body: { account_id: Number(match[1]), user_id: input.user_id, role: input.role } };
        }
        if (method === "DELETE") {
          await state.platform.removeAccountUser(Number(match[1]), Number(route.query.get("user_id")));
          return { status: 200 };
        }
      }
      return { status: 404, body: { error: "not found" } };
    }

    if (path === "/api/v1/profile") {
      const user = [...state.users.values()].find((item) => item.token === token);
      if (!user) return { status: 401, body: { errors: ["You need to sign in or sign up before continuing."] } };
      if (method === "GET") return { status: 200, body: { id: user.id, ui_settings: user.uiSettings } };
      if (method === "PUT") {
        await state
          .profile(token)
          .mergeUiSettings(((input.profile as Record<string, unknown>)?.ui_settings ?? {}) as Record<string, unknown>);
        return { status: 200, body: { id: user.id, ui_settings: user.uiSettings } };
      }
    }

    if ((match = /^\/api\/v1\/accounts\/(\d+)\/(.+)$/.exec(path))) {
      const account = state.account(Number(match[1]), token);
      const rest = match[2]!;
      let inner: RegExpExecArray | null;
      if (method === "POST" && rest === "inboxes" && !(input.channel as Record<string, unknown>).webhook_url) {
        // An inbox of the team: no webhook, nobody assigned by rotation.
        if (input.enable_auto_assignment !== false) return { status: 422, body: { error: "rotation_on" } };
        const { id } = await account.createTeamInbox({ name: String(input.name) });
        return { status: 200, body: { id, name: input.name, channel_type: "Channel::Api" } };
      }
      if ((inner = /^inboxes\/(\d+)$/.exec(rest)) && method === "PATCH") {
        await account.renameInbox(Number(inner[1]), String(input.name));
        return { status: 200, body: { id: Number(inner[1]), name: input.name } };
      }
      if (method === "PATCH" && rest === "inbox_members") {
        await account.setInboxMembers(Number(input.inbox_id), (input.user_ids as number[]) ?? []);
        return { status: 200, body: { payload: [] } };
      }
      if ((inner = /^contacts\/(\d+)$/.exec(rest)) && method === "PUT") {
        await account.renameContact(Number(inner[1]), String(input.name));
        return { status: 200, body: { payload: { id: Number(inner[1]), name: input.name } } };
      }
      if ((inner = /^conversations\/(\d+)$/.exec(rest)) && method === "GET") {
        const status = await account.conversationStatus(Number(inner[1]));
        return { status: 200, body: { id: Number(inner[1]), status } };
      }
      if ((inner = /^conversations\/(\d+)\/participants$/.exec(rest))) {
        const ids = (input.user_ids as number[]) ?? [];
        if (method === "PATCH") {
          await account.setParticipants(Number(inner[1]), ids);
          return { status: 200, body: ids.map((id) => ({ id })) };
        }
        if (method === "DELETE") {
          await account.removeParticipants(Number(inner[1]), ids);
          return { status: 200 };
        }
      }
      if (method === "POST" && rest === "inboxes") {
        const channel = input.channel as Record<string, unknown>;
        const attributes = (channel.additional_attributes ?? {}) as Record<string, unknown>;
        const inbox = await account.createApiInbox({
          name: String(input.name),
          webhookUrl: String(channel.webhook_url),
          replyWindowHours: Number(attributes.agent_reply_time_window),
        });
        return {
          status: 200,
          body: { id: inbox.id, name: input.name, channel_type: "Channel::Api", secret: inbox.secret },
        };
      }
      if ((inner = /^inboxes\/(\d+)$/.exec(rest)) && method === "GET") {
        const inbox = await account.inbox(Number(inner[1]));
        return { status: 200, body: { id: inbox.id, channel_type: "Channel::Api", secret: inbox.secret } };
      }
      if (method === "POST" && rest === "inbox_members") {
        await account.addInboxMembers(Number(input.inbox_id), (input.user_ids as number[]) ?? []);
        return { status: 200, body: { payload: [] } };
      }
      if (rest === "contacts/search" && method === "GET") {
        const q = route.query.get("q") ?? "";
        const found = await account.findContact(q);
        const contact = found ? state.contacts.get(found.id)! : null;
        return {
          status: 200,
          body: {
            meta: { count: contact ? 1 : 0 },
            payload: contact ? [{ id: contact.id, identifier: contact.identifier, phone_number: contact.phone }] : [],
          },
        };
      }
      if (method === "POST" && rest === "contacts") {
        const { id } = await account.createContact({
          inboxId: Number(input.inbox_id),
          name: String(input.name),
          phone: typeof input.phone_number === "string" ? input.phone_number : null,
          identifier: String(input.identifier),
        });
        return {
          status: 200,
          body: { payload: { contact: { id, name: input.name }, contact_inbox: { inbox: { id: input.inbox_id } } } },
        };
      }
      if ((inner = /^contacts\/(\d+)$/.exec(rest)) && method === "DELETE") {
        await account.deleteContact(Number(inner[1]));
        return { status: 200 };
      }
      if (method === "POST" && rest === "conversations") {
        const { id } = await account.createConversation({
          inboxId: Number(input.inbox_id),
          contactId: Number(input.contact_id),
          status: input.status as "open",
        });
        return { status: 200, body: { id, inbox_id: input.inbox_id, status: input.status } };
      }
      if ((inner = /^conversations\/(\d+)$/.exec(rest)) && method === "DELETE") {
        await account.deleteConversation(Number(inner[1]));
        return { status: 200 };
      }
      if (rest === "agent_bots" && method === "GET") {
        return {
          status: 200,
          body: state.bots
            .filter((bot) => bot.accountId === Number(match![1]))
            .map((bot) => ({ id: bot.id, name: bot.name, account_id: bot.accountId, outgoing_url: null })),
        };
      }
      if (rest === "agent_bots" && method === "POST") {
        const { id } = await account.agentBot(String(input.name));
        return {
          status: 200,
          body: { id, name: input.name, account_id: Number(match![1]), outgoing_url: input.outgoing_url },
        };
      }
      if ((inner = /^conversations\/(\d+)\/assignments$/.exec(rest)) && method === "POST") {
        await account.assignToBot(Number(inner[1]), Number(input.assignee_id));
        return { status: 200, body: { id: input.assignee_id, name: "ONE" } };
      }
      if ((inner = /^conversations\/(\d+)\/toggle_status$/.exec(rest)) && method === "POST") {
        await account.setConversationStatus(Number(inner[1]), input.status as "open");
        return {
          status: 200,
          body: {
            meta: {},
            payload: { success: true, current_status: input.status, conversation_id: Number(inner[1]) },
          },
        };
      }
      if ((inner = /^conversations\/(\d+)\/messages$/.exec(rest)) && method === "POST") {
        const form = body instanceof FormData ? body : null;
        const file = form?.get("attachments[]");
        const value = (key: string) => (form ? form.get(key) : input[key]);
        const { id } = await account.createMessage(Number(inner[1]), {
          content: String(value("content") ?? ""),
          type: value("message_type") as "incoming",
          private: String(value("private")) === "true",
          sourceId: (value("source_id") as string | null) ?? null,
          attachment:
            file instanceof Blob
              ? {
                  name: (file as File).name ?? "file",
                  mime: file.type,
                  bytes: new Uint8Array(await file.arrayBuffer()),
                }
              : null,
        });
        return {
          status: 200,
          body: { id, content: value("content"), message_type: value("message_type") === "incoming" ? 0 : 1 },
        };
      }
      if ((inner = /^conversations\/(\d+)\/messages\/(\d+)$/.exec(rest)) && method === "PATCH") {
        await account.setMessageStatus(
          Number(inner[1]),
          Number(inner[2]),
          input.status as "sent",
          (input.external_error as string) ?? null,
        );
        return { status: 200, body: { id: Number(inner[2]), status: input.status } };
      }
    }
    return { status: 404, body: { error: "not found" } };
  };

  async function userView(id: number) {
    const user = await state.platform.user(id);
    return {
      id: user.id,
      access_token: user.accessToken,
      email: state.users.get(id)?.email,
      accounts: user.accounts.map((item) => ({ id: item.id, name: "x", role: item.role })),
    };
  }

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    let body: unknown = init?.body ?? null;
    if (typeof body === "string") body = JSON.parse(body);
    const route: Route = {
      method: init?.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      token: auth.replace(/^Bearer /, ""),
      body,
    };
    calls.push(route);
    if (failNext !== null) {
      const status = failNext;
      failNext = null;
      return new Response(JSON.stringify({ error: "down" }), { status });
    }
    try {
      const answer = await handle(route);
      return new Response(answer.body === undefined ? "" : JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      if (error instanceof ChatwootRequestError)
        return new Response(JSON.stringify({ error: error.code }), { status: error.status });
      throw error;
    }
  }) as typeof fetch;

  return { fetchImpl, calls, failWith: (status: number) => (failNext = status) };
}

const PLATFORM_TOKEN = "platform-token-of-the-test";

function runs(): {
  name: string;
  make: () => { provider: ChatwootProvider; fake: FakeChatwootProvider; standIn?: ReturnType<typeof chatwootStandIn> };
}[] {
  return [
    {
      name: "fake",
      make: () => {
        const fake = new FakeChatwootProvider();
        return { provider: fake, fake };
      },
    },
    {
      name: "http",
      make: () => {
        const fake = new FakeChatwootProvider();
        const standIn = chatwootStandIn(fake, PLATFORM_TOKEN);
        const provider = new HttpChatwootProvider({
          url: "https://chatwoot.invalid/",
          platformToken: PLATFORM_TOKEN,
          fetchImpl: standIn.fetchImpl,
        });
        return { provider, fake, standIn };
      },
    },
  ];
}

for (const run of runs()) {
  describe(`chatwoot provider (${run.name})`, () => {
    async function firm(provider: ChatwootProvider) {
      const { id: accountId } = await provider.platform.createAccount({
        name: "Escritório de teste",
        features: { campaigns: false },
      });
      const { id: serviceId } = await provider.platform.createUser({
        name: "ONE",
        email: "servico-1@one.invalid",
        password: "Xx1!aaaaaaaa",
      });
      await provider.platform.addAccountUser(accountId, serviceId, "administrator");
      const service = await provider.platform.user(serviceId);
      assert.ok(service.accessToken, "the platform returns the token of a person its app created");
      assert.deepEqual(service.accounts, [{ id: accountId, role: "administrator" }]);
      const account = provider.account(accountId, service.accessToken!);
      const inbox = await account.createApiInbox({
        name: "WhatsApp",
        webhookUrl: "https://one.invalid/api/webhooks/chatwoot",
        replyWindowHours: 24,
      });
      return { accountId, serviceId, token: service.accessToken!, account, inbox };
    }

    it("creates an account with its service person and an API inbox whose secret only an administrator reads", async () => {
      const { provider } = run.make();
      const { account, inbox, accountId } = await firm(provider);
      assert.ok(inbox.secret, "the inbox is created with the secret its webhook is signed with");
      assert.equal((await account.inbox(inbox.id)).secret, inbox.secret);

      const { id: agentId } = await provider.platform.createUser({
        name: "Ana",
        email: "ana@escritorio.invalid",
        password: "Xx1!aaaaaaaa",
      });
      await provider.platform.addAccountUser(accountId, agentId, "agent");
      const agent = await provider.platform.user(agentId);
      await assert.rejects(
        provider.account(accountId, agent.accessToken!).inbox(inbox.id),
        (error: unknown) => error instanceof ChatwootRequestError && error.status === 401,
      );
    });

    it("returns the person who already has the e-mail, and takes a person out of an account only", async () => {
      const { provider } = run.make();
      const { accountId } = await firm(provider);
      const first = await provider.platform.createUser({
        name: "Ana",
        email: "Ana@Escritorio.invalid",
        password: "Xx1!aaaaaaaa",
      });
      const again = await provider.platform.createUser({
        name: "Ana B",
        email: "ana@escritorio.invalid",
        password: "Xx1!bbbbbbbb",
      });
      assert.equal(again.id, first.id);
      await provider.platform.addAccountUser(accountId, first.id, "agent");
      assert.deepEqual((await provider.platform.user(first.id)).accounts, [{ id: accountId, role: "agent" }]);
      await provider.platform.removeAccountUser(accountId, first.id);
      assert.deepEqual((await provider.platform.user(first.id)).accounts, []);
      const link = await provider.platform.ssoLink(first.id);
      assert.match(link, /^https:\/\//);
    });

    it("keeps one contact per number: a second one is refused and found by its identifier", async () => {
      const { provider } = run.make();
      const { account, inbox } = await firm(provider);
      const contact = await account.createContact({
        inboxId: inbox.id,
        name: "Cliente",
        phone: "+5562999990000",
        identifier: "5562999990000",
      });
      await assert.rejects(
        account.createContact({
          inboxId: inbox.id,
          name: "Cliente",
          phone: "+5562999990000",
          identifier: "5562999990000",
        }),
        (error: unknown) => error instanceof ChatwootRequestError && error.status === 422,
      );
      assert.deepEqual(await account.findContact("5562999990000"), { id: contact.id });
      assert.equal(await account.findContact("5562999991111"), null);
    });

    it("writes a conversation's messages, keeps the status of what went, and changes the conversation's status", async () => {
      const { provider, fake } = run.make();
      const { account, inbox, accountId } = await firm(provider);
      const contact = await account.createContact({
        inboxId: inbox.id,
        name: "Cliente",
        phone: "+5562999990000",
        identifier: "5562999990000",
      });
      const conversation = await account.createConversation({
        inboxId: inbox.id,
        contactId: contact.id,
        status: "pending",
      });
      assert.equal(conversation.id, 1, "the id is the account's own number of the conversation");

      const incoming = await account.createMessage(conversation.id, {
        content: "Meu voo foi cancelado",
        type: "incoming",
        sourceId: oneSourceId("m1"),
      });
      const outgoing = await account.createMessage(conversation.id, {
        content: "Sinto muito. Qual era o voo?",
        type: "outgoing",
        sourceId: oneSourceId("m2"),
      });
      const photo = await account.createMessage(conversation.id, {
        content: "Foto",
        type: "incoming",
        sourceId: oneSourceId("m3"),
        attachment: { name: "cartao.jpg", mime: "image/jpeg", bytes: new Uint8Array([255, 216, 255, 224]) },
      });
      const note = await account.createMessage(conversation.id, {
        content: "O ONE chamou uma pessoa",
        type: "outgoing",
        private: true,
      });
      await account.setMessageStatus(conversation.id, outgoing.id, "failed", "A janela de 24 horas fechou.");
      await account.setConversationStatus(conversation.id, "open");

      const kept = fake.messagesOf(accountId, conversation.id);
      assert.deepEqual(
        kept.map((item) => [item.id, item.type, item.private, item.sourceId]),
        [
          [incoming.id, "incoming", false, "one:m1"],
          [outgoing.id, "outgoing", false, "one:m2"],
          [photo.id, "incoming", false, "one:m3"],
          [note.id, "outgoing", true, null],
        ],
      );
      assert.deepEqual(kept[2]!.attachment, { name: "cartao.jpg", mime: "image/jpeg", bytes: 4 });
      assert.equal(kept[1]!.status, "failed");
      assert.equal(kept[1]!.externalError, "A janela de 24 horas fechou.");
      assert.equal(fake.conversation(accountId, conversation.id)!.status, "open");
    });

    it("makes the account's robot once and gives it a conversation, which waits as pending", async () => {
      const { provider, fake } = run.make();
      const { account, inbox, accountId } = await firm(provider);
      const bot = await account.agentBot("ONE");
      assert.deepEqual(await account.agentBot("ONE"), bot);
      const contact = await account.createContact({
        inboxId: inbox.id,
        name: "Cliente",
        phone: "+5562999990000",
        identifier: "5562999990000",
      });
      const conversation = await account.createConversation({
        inboxId: inbox.id,
        contactId: contact.id,
        status: "open",
      });
      await account.assignToBot(conversation.id, bot.id);
      assert.equal(fake.conversation(accountId, conversation.id)!.status, "pending");
      assert.equal(fake.conversation(accountId, conversation.id)!.botId, bot.id);
      assert.equal(fake.bots.filter((item) => item.accountId === accountId).length, 1);
    });

    it("takes out a conversation and a contact, and says plainly what is not there", async () => {
      const { provider } = run.make();
      const { account, inbox } = await firm(provider);
      const contact = await account.createContact({
        inboxId: inbox.id,
        name: "Cliente",
        phone: "+5562999990000",
        identifier: "5562999990000",
      });
      const conversation = await account.createConversation({
        inboxId: inbox.id,
        contactId: contact.id,
        status: "open",
      });
      await account.deleteConversation(conversation.id);
      await assert.rejects(account.setConversationStatus(conversation.id, "pending"), isChatwootNotFound);
      await account.deleteContact(contact.id);
      assert.equal(await account.findContact("5562999990000"), null);
    });

    it("makes a room of the team: its people in its inbox and its conversation, renamed, emptied and brought back", async () => {
      const { provider, fake } = run.make();
      const { account, accountId } = await firm(provider);
      const people: number[] = [];
      for (const name of ["Ana", "Bia", "Caio"]) {
        const { id } = await provider.platform.createUser({
          name,
          email: `${name.toLowerCase()}@sala.invalid`,
          password: "Xx1!aaaaaaaa",
        });
        await provider.platform.addAccountUser(accountId, id, "agent");
        people.push(id);
      }
      const [ana, bia, caio] = people as [number, number, number];
      const inbox = await account.createTeamInbox({ name: "Sala: Comercial" });
      const contact = await account.createContact({
        inboxId: inbox.id,
        name: "Sala: Comercial",
        identifier: "sala:1",
      });
      const second = await account.createContact({ inboxId: inbox.id, name: "Sala: Prazos", identifier: "sala:2" });
      assert.notEqual(second.id, contact.id, "two contacts with no phone are two");
      const room = await account.createConversation({ inboxId: inbox.id, contactId: contact.id, status: "open" });
      assert.equal(fake.inboxes.get(inbox.id)!.team, true);
      assert.equal(fake.inboxes.get(inbox.id)!.webhookUrl, "", "nothing written in a room goes anywhere");
      assert.equal(fake.contacts.get(contact.id)!.phone, null);

      await assert.rejects(
        account.setParticipants(room.id, [ana]),
        (error: unknown) => error instanceof ChatwootRequestError && error.status === 422,
        "only who is in the inbox takes part",
      );
      await account.setInboxMembers(inbox.id, [ana, bia]);
      await account.setParticipants(room.id, [ana, bia]);
      assert.deepEqual([...fake.inboxes.get(inbox.id)!.members].sort(), [ana, bia].sort());
      assert.deepEqual([...fake.conversation(accountId, room.id)!.participants].sort(), [ana, bia].sort());

      await account.setInboxMembers(inbox.id, [ana, caio]);
      await account.setParticipants(room.id, [ana, caio]);
      assert.deepEqual([...fake.inboxes.get(inbox.id)!.members].sort(), [ana, caio].sort());
      assert.deepEqual([...fake.conversation(accountId, room.id)!.participants].sort(), [ana, caio].sort());

      await account.renameInbox(inbox.id, "Sala: Vendas");
      await account.renameContact(contact.id, "Sala: Vendas");
      assert.equal(fake.inboxes.get(inbox.id)!.name, "Sala: Vendas");
      assert.equal(fake.contacts.get(contact.id)!.name, "Sala: Vendas");

      await account.removeParticipants(room.id, [ana, caio]);
      await account.setInboxMembers(inbox.id, []);
      await account.setConversationStatus(room.id, "resolved");
      assert.equal(fake.inboxes.get(inbox.id)!.members.size, 0);
      assert.equal(fake.conversation(accountId, room.id)!.participants.size, 0);
      assert.equal(await account.conversationStatus(room.id), "resolved");

      await account.setInboxMembers(inbox.id, [bia]);
      await account.setParticipants(room.id, [bia]);
      await account.setConversationStatus(room.id, "open");
      assert.equal(await account.conversationStatus(room.id), "open");
      await assert.rejects(account.setParticipants(room.id, []), ChatwootRequestError, "the last ones are taken out, never set to none");
    });

    it("joins a person's preferences of the panel to the ones they have", async () => {
      const { provider, fake } = run.make();
      const { accountId } = await firm(provider);
      const { id } = await provider.platform.createUser({
        name: "Ana",
        email: "ana@escritorio.invalid",
        password: "Xx1!aaaaaaaa",
      });
      await provider.platform.addAccountUser(accountId, id, "agent");
      const token = (await provider.platform.user(id)).accessToken!;
      await provider.profile(token).mergeUiSettings({ a: 1 });
      await provider.profile(token).mergeUiSettings({ conversations_filter_by: { status: "all" } });
      assert.deepEqual(fake.users.get(id)!.uiSettings, { a: 1, conversations_filter_by: { status: "all" } });
    });
  });
}

describe("chatwoot provider (http) on failures", () => {
  it("says an outage or a limit is temporary, and a refusal is Chatwoot's with its status", async () => {
    const fake = new FakeChatwootProvider();
    const standIn = chatwootStandIn(fake, PLATFORM_TOKEN);
    const provider = new HttpChatwootProvider({
      url: "https://chatwoot.invalid",
      platformToken: PLATFORM_TOKEN,
      fetchImpl: standIn.fetchImpl,
    });
    standIn.failWith(502);
    await assert.rejects(
      provider.platform.createAccount({ name: "x", features: {} }),
      (error: unknown) => error instanceof ChatwootUnavailableError && error.code === "http_502",
    );
    standIn.failWith(429);
    await assert.rejects(provider.platform.user(1), ChatwootUnavailableError);
    await assert.rejects(
      new HttpChatwootProvider({
        url: "https://chatwoot.invalid",
        platformToken: "wrong",
        fetchImpl: standIn.fetchImpl,
      }).platform.user(1),
      (error: unknown) => error instanceof ChatwootRequestError && error.status === 401,
    );
    const down = new HttpChatwootProvider({
      url: "https://chatwoot.invalid",
      platformToken: PLATFORM_TOKEN,
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    await assert.rejects(
      down.platform.user(1),
      (error: unknown) => error instanceof ChatwootUnavailableError && error.code === "no_answer",
    );
  });

  it("sends the token as a bearer and never in the address", async () => {
    const fake = new FakeChatwootProvider();
    const standIn = chatwootStandIn(fake, PLATFORM_TOKEN);
    const provider = new HttpChatwootProvider({
      url: "https://chatwoot.invalid",
      platformToken: PLATFORM_TOKEN,
      fetchImpl: standIn.fetchImpl,
    });
    await provider.platform.createAccount({ name: "x", features: {} });
    assert.ok(
      standIn.calls.every((call) => call.token === PLATFORM_TOKEN && !call.query.toString().includes(PLATFORM_TOKEN)),
    );
  });
});

describe("the inbox's webhook", () => {
  async function conversationWithPerson() {
    const fake = new FakeChatwootProvider();
    const { id: accountId } = await fake.platform.createAccount({ name: "Escritório", features: {} });
    const { id: serviceId } = await fake.platform.createUser({
      name: "ONE",
      email: "servico@one.invalid",
      password: "x",
    });
    await fake.platform.addAccountUser(accountId, serviceId, "administrator");
    const account = fake.account(accountId, (await fake.platform.user(serviceId)).accessToken!);
    const inbox = await account.createApiInbox({
      name: "WhatsApp",
      webhookUrl: "https://one.invalid/api/webhooks/chatwoot",
      replyWindowHours: 24,
    });
    const contact = await account.createContact({
      inboxId: inbox.id,
      name: "Cliente",
      phone: "+5562999990000",
      identifier: "5562999990000",
    });
    const conversation = await account.createConversation({
      inboxId: inbox.id,
      contactId: contact.id,
      status: "pending",
    });
    const { id: personId } = await fake.platform.createUser({
      name: "Ana",
      email: "ana@escritorio.invalid",
      password: "x",
    });
    await fake.platform.addAccountUser(accountId, personId, "agent");
    return { fake, accountId, inbox, conversation, personId, account };
  }

  it("takes a delivery signed with the inbox's secret within five minutes, and nothing else", async () => {
    const { fake, accountId, conversation, personId, inbox } = await conversationWithPerson();
    const delivery = fake.personWrites({
      accountId,
      conversationId: conversation.id,
      userId: personId,
      content: "Bom dia",
    });
    const now = Number(delivery.timestamp);
    const secret = inbox.secret!;
    assert.equal(verifyChatwootSignature({ ...delivery, secret, now }), true);
    assert.equal(verifyChatwootSignature({ ...delivery, secret, now: now + 301 }), false, "a replay past five minutes");
    assert.equal(verifyChatwootSignature({ ...delivery, secret: "another", now }), false);
    assert.equal(
      verifyChatwootSignature({ ...delivery, rawBody: delivery.rawBody.replace("Bom dia", "Boa tarde"), secret, now }),
      false,
    );
    assert.equal(verifyChatwootSignature({ ...delivery, signature: null, secret, now }), false);
    assert.equal(accountOfDelivery(JSON.parse(delivery.rawBody)), accountId);
  });

  it("acts on what a person wrote to the client and on a change of status, and on nothing else", async () => {
    const { fake, accountId, conversation, personId, inbox, account } = await conversationWithPerson();
    const written = fake.personWrites({
      accountId,
      conversationId: conversation.id,
      userId: personId,
      content: "Bom dia",
    });
    assert.deepEqual(parseChatwootDelivery(JSON.parse(written.rawBody)), {
      type: "person_message",
      accountId,
      inboxId: inbox.id,
      conversationId: conversation.id,
      messageId: written.messageId,
      senderId: personId,
      content: "Bom dia",
      attachments: 0,
      sourceId: null,
    });
    const status = fake.personSetsStatus({ accountId, conversationId: conversation.id, status: "resolved" });
    assert.deepEqual(parseChatwootDelivery(JSON.parse(status.rawBody)), {
      type: "status",
      accountId,
      inboxId: inbox.id,
      conversationId: conversation.id,
      status: "resolved",
    });

    const base = JSON.parse(written.rawBody) as Record<string, unknown>;
    assert.equal(parseChatwootDelivery({ ...base, private: true }).type, "ignored");
    assert.equal(parseChatwootDelivery({ ...base, message_type: "incoming" }).type, "ignored");
    assert.equal(parseChatwootDelivery({ ...base, source_id: oneSourceId("x") }).type, "ignored");
    assert.equal(parseChatwootDelivery({ ...base, sender: { id: 9, type: "agent_bot" } }).type, "ignored");
    assert.equal(parseChatwootDelivery({ ...base, content_attributes: { automation_rule_id: 3 } }).type, "ignored");
    assert.equal(parseChatwootDelivery({ ...base, event: "conversation_updated" }).type, "ignored");
    assert.equal(parseChatwootDelivery("nothing").type, "ignored");
    void account;
  });
});
