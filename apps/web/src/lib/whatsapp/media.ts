import "server-only";

import { supabaseFileStore } from "@/lib/files/store";
import { readWhatsAppSettings } from "@/lib/whatsapp/config";
import { providerFor } from "@/lib/whatsapp/provider";
import { measureFile } from "@flyee/documents/measure";
import type { WhatsAppProvider } from "@flyee/whatsapp/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Bringing what a person sent (a photo, a PDF, a voice message) from the
 * vendor into the firm's files (migrations 0018 and 0019).
 *
 * A message arrives with the vendor's id of its media, which the vendor keeps
 * for seven days. The backend claims the message (`claim_wa_media`), fetches
 * the bytes with the firm's token, measures them (what the bytes are, never
 * what the vendor says they are) and keeps them under the `whatsapp` purpose,
 * which only the backend writes. What cannot be kept (a type the purpose does
 * not list, a file too large, a media that is gone) is recorded on the
 * message with its reason; the message itself stays. What could not be
 * fetched NOW (the vendor did not answer, asked to slow down, the token could
 * not be opened) is not recorded as anything: the message stays claimed and
 * is taken again, until the vendor's seven days end.
 */

/** The purpose of `platform_settings.files` that lists what WhatsApp media is kept. */
const PURPOSE = "whatsapp";

type Claimed = {
  message_id: string;
  org_id: string;
  number_id: string;
  media_wa_id: string | null;
  media_mime: string | null;
  media_filename: string | null;
  kind: string;
  provider: string;
  phone_number_id: string;
  connection_id: string;
};

/** `waiting`: left for another pass, because what stopped it may pass. */
export type MediaReport = { claimed: number; stored: number; failed: number; waiting: number };

const EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
};

/** `audio/ogg; codecs=opus` is `audio/ogg`: the list of the purpose names types, not their parameters. */
const baseMime = (mime: string): string => mime.split(";")[0].trim().toLowerCase();

/** The name the file shows with: the one it came with, or one made from what it is. */
function nameOf(row: Claimed, mime: string): string {
  // A name is shown on screen and recorded with the file: no control character stays in it.
  const given = [...(row.media_filename ?? "")]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim();
  if (given) return given.slice(0, 200);
  return `${row.kind}-${row.message_id.slice(0, 8)}.${EXTENSION[mime] ?? "bin"}`;
}

/** A problem that will be the same on every try: there is no vendor to fetch from. Any other may pass later. */
const DEFINITE_PROBLEMS = new Set(["simulator_off", "unknown_provider"]);

export async function fetchPendingMedia(service: SupabaseClient, limit = 10): Promise<MediaReport> {
  const { data, error } = await service.rpc("claim_wa_media", { target_limit: limit });
  if (error) throw new Error(`claim_wa_media failed: ${error.message}`);
  const rows = Array.isArray(data) ? (data as Claimed[]) : [];
  const report: MediaReport = { claimed: rows.length, stored: 0, failed: 0, waiting: 0 };
  if (rows.length === 0) return report;

  const settings = await readWhatsAppSettings(service);
  const store = supabaseFileStore(service);
  const providers = new Map<string, WhatsAppProvider | { problem: string }>();

  for (const row of rows) {
    // Settled: the file is kept, or it is certain that it never will be.
    const settle = async (fileId: string | null, code: string | null) => {
      const { error: setError } = await service.rpc("set_wa_media", {
        target_org: row.org_id,
        target_message: row.message_id,
        target_file: fileId,
        target_error_code: code,
      });
      // Not recorded: the message stays `fetching` and is claimed again in ten minutes.
      if (setError) console.error("whatsapp_set_media_failed", { state: setError.code ?? null });
      if (fileId) report.stored += 1;
      else report.failed += 1;
    };
    // Not settled: the message stays claimed and is taken again in ten minutes, until the
    // vendor's seven days end. A media is never given up for something that may pass.
    const wait = () => {
      report.waiting += 1;
    };

    try {
      if (!row.media_wa_id) {
        await settle(null, "media_unavailable");
        continue;
      }
      if (!providers.has(row.number_id)) {
        const access = await providerFor(
          {
            provider: row.provider,
            orgId: row.org_id,
            connectionId: row.connection_id,
            phoneNumberId: row.phone_number_id,
            wabaId: "",
          },
          settings,
          "whatsapp.media",
        );
        providers.set(row.number_id, access.ok ? access.provider : { problem: access.code });
      }
      const provider = providers.get(row.number_id)!;
      if ("problem" in provider) {
        // No vault keys here, a token that could not be opened: another pass, or another environment, may have them.
        if (DEFINITE_PROBLEMS.has(provider.problem)) await settle(null, provider.problem);
        else wait();
        continue;
      }

      const media = await provider.fetchMedia(row.media_wa_id);
      if (media.kind === "later") {
        wait();
        continue;
      }
      if (media.kind === "gone" || media.bytes.byteLength === 0) {
        await settle(null, "media_unavailable");
        continue;
      }

      const mime = baseMime(media.mime || row.media_mime || "");
      const reserved = await store.reserve({
        orgId: row.org_id,
        purpose: PURPOSE,
        name: nameOf(row, mime),
        mime,
        bytes: media.bytes.byteLength,
      });
      if (!reserved.ok) {
        // A type the purpose does not list, a file too large: the same file would be refused again.
        await settle(null, reserved.code);
        continue;
      }

      await store.put(reserved.storagePath, media.bytes, mime);
      const confirmed = await store.confirm(reserved.fileId, await measureFile(media.bytes));
      if (!confirmed.ok) {
        // What was rejected does not stay in the bucket.
        await store.remove([reserved.storagePath]).catch(() => undefined);
        await settle(null, confirmed.reason ?? confirmed.code);
        continue;
      }
      await settle(reserved.fileId, null);
    } catch {
      // The database or the storage did not answer: nothing is decided about this file, and one
      // message that could not be handled never stops the others of the pass.
      wait();
    }
  }
  return report;
}
