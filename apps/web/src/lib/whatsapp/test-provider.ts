import "server-only";

import { randomUUID } from "node:crypto";

import type {
  AccountTemplate,
  MediaResult,
  SendResult,
  TemplateCreated,
  WhatsAppProvider,
} from "@flyee/whatsapp/types";

/**
 * Who stands where the vendor stands for a firm's test chat (migration 0047):
 * nothing leaves ONE. A message sent is only kept, and the test chat's page
 * reads it from the conversation; a template submitted is approved at once,
 * as the test chat approves everything; a media the page sent is read back
 * from where the page put it. Honoured in production, since it reaches
 * nobody: the database keeps a test number apart from a real one.
 */
export class TestChatProvider implements WhatsAppProvider {
  readonly name = "test" as const;

  constructor(
    private readonly options: {
      /** The templates ONE submitted to the test chat's account, as the platform keeps them. */
      templates?: AccountTemplate[];
      /** Reads back a media the page sent, by the id it gave it. */
      fetchStaged?: (mediaId: string) => Promise<MediaResult>;
    } = {},
  ) {}

  async send(): Promise<SendResult> {
    return { ok: true, providerMessageId: `test.${randomUUID()}` };
  }

  async fetchMedia(mediaId: string): Promise<MediaResult> {
    return this.options.fetchStaged ? this.options.fetchStaged(mediaId) : { kind: "gone" };
  }

  async listTemplates(): Promise<AccountTemplate[]> {
    return this.options.templates ?? [];
  }

  async createTemplate(): Promise<TemplateCreated> {
    return { ok: true, id: `test-template-${randomUUID()}`, status: "approved", category: "utility" };
  }
}
