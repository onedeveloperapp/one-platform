import "server-only";

import { PHOTO_POOR, type PhotoProblem, readQuality } from "@/lib/cases/document-quality";
import { judgeArrivedPhoto } from "@/lib/cases/document-quality-work";
import { supabaseFileStore } from "@/lib/files/store";
import { takeBackFile } from "@flyee/documents/files";
import { measureFile } from "@flyee/documents/measure";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of what a client sends through their link (migrations
 * 0022 and 0024): the second half of an upload, and the taking back of a
 * photo the client did not send. `asClient` speaks as the client (the token
 * is the credential, and what the client does is recorded as the client's);
 * `service` is the backend, which measures and keeps.
 *
 * Every answer here is a code: `failed` for what did not work now and may
 * work at the next request, never a code that would say the upload is gone.
 * Nothing throws for what a database or a storage did.
 */

/** What became of the second half of an upload. `problems` come with `photo_poor`. */
export type UploadFinished =
  | { ok: true; code: string }
  | { ok: false; code: string; problems?: readonly PhotoProblem[] };

type UploadToFinish = {
  kind: string;
  status: string;
  quality: unknown;
  fileId: string;
  storagePath: string;
  fileStatus: string;
};

const failed = { ok: false as const, code: "failed" };

/** What the database says of an upload of this link, or why it hands nothing over. */
async function uploadToFinish(
  service: SupabaseClient,
  token: string,
  documentId: string,
): Promise<({ ok: true } & UploadToFinish) | { ok: false; code: string }> {
  try {
    const { data, error } = await service.rpc("client_link_upload_to_finish", {
      target_token: token,
      target_document: documentId,
    });
    if (error) return failed;
    const answer = (data ?? {}) as Record<string, unknown>;
    if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
    return {
      ok: true,
      kind: String(answer.kind ?? ""),
      status: String(answer.status ?? ""),
      quality: answer.quality ?? null,
      fileId: String(answer.file_id ?? ""),
      storagePath: String(answer.storage_path ?? ""),
      fileStatus: String(answer.file_status ?? ""),
    };
  } catch {
    return failed;
  }
}

/**
 * The second half of an upload: the backend measures what arrived (only a
 * file this link reserved and has not sent yet), keeps it or refuses it, and
 * the database turns it into a document the firm receives, or tells the
 * client why not.
 *
 * The photo of a paper to be read is measured for how well it can be read
 * before it is kept: one nobody will read is said now (`photo_poor`, with
 * what is wrong with it), while the client still has the paper in hand. The
 * client takes another, or sends this one all the same (`insist`): the rule
 * measures, and the firm, which then sees the photo beside its measure,
 * decides.
 *
 * A photo is measured once, and what was measured is on record before anybody
 * is told: every later request answers from the record, a request that came
 * at the same moment included. So `insist` is taken only from a client the
 * record says was told, and what the firm then reads ("the client was told
 * and sent it all the same") is true.
 */
export async function finishLinkUpload(
  asClient: SupabaseClient,
  service: SupabaseClient,
  token: string,
  documentId: string,
  options?: { insist?: boolean },
): Promise<UploadFinished> {
  const insist = options?.insist === true;
  let upload = await uploadToFinish(service, token, documentId);
  if (!upload.ok) return upload;

  if (upload.status === "uploading" && upload.fileStatus === "reserved") {
    // What this photo was already said to be: the client hears the same again, with nothing read again.
    const told = readQuality(upload.quality);
    if (told && told.problems.length > 0 && !insist) return { ok: false, code: PHOTO_POOR, problems: told.problems };
    const store = supabaseFileStore(service);
    const bytes = await store.get(upload.storagePath);
    // A photo with a measure on record was there to be measured: not finding it now is the storage's failure,
    // and the client is not told it never arrived.
    if (!bytes) return told ? failed : { ok: false, code: "not_uploaded" };
    const measure = await measureFile(bytes);
    for (let look = 0; ; look += 1) {
      const photo = await judgeArrivedPhoto(service, {
        documentId,
        kind: upload.kind,
        quality: upload.quality,
        // A request that found no measure on record is not the answer of a client who was told: whatever it
        // asks, it is told what the record says now.
        insist: insist && look === 0,
        mime: measure.detectedMime,
        bytes,
      });
      if (photo.say === "poor") return { ok: false, code: PHOTO_POOR, problems: photo.problems };
      if (photo.say === "failed") return failed;
      if (photo.say === "nothing") break;
      // Another request measured this photo first: the record is read again, and answers.
      if (look > 0) return failed;
      const again = await uploadToFinish(service, token, documentId);
      if (!again.ok) return again;
      upload = again;
      if (upload.status !== "uploading" || upload.fileStatus !== "reserved") break;
    }
    if (upload.status === "uploading" && upload.fileStatus === "reserved") {
      try {
        const confirmed = await store.confirm(upload.fileId, measure);
        // What was refused does not stay in the bucket. Only what this very answer refused: a file another
        // request already kept has its bytes where its record says.
        if (!confirmed.ok && confirmed.code === "rejected") {
          await store.remove([upload.storagePath]).catch(() => undefined);
        }
      } catch {
        return failed;
      }
    }
  }

  try {
    const { data, error } = await asClient.rpc("client_link_finish_upload", {
      target_token: token,
      target_document: documentId,
    });
    if (error) return failed;
    const answer = (data ?? {}) as { ok?: boolean; code?: string };
    return answer.ok
      ? { ok: true, code: String(answer.code ?? "received") }
      : { ok: false, code: String(answer.code ?? "failed") };
  } catch {
    return failed;
  }
}

/**
 * A client takes back a photo they did not send (told it is hard to read,
 * they took another): the link's own function lets go of the upload that
 * waited and of the record of its file, and the backend then removes the
 * bytes, which are nobody's by then, so that nothing of the photo stays in
 * storage until a reservation runs out. Bytes that could not be removed now
 * are the upkeep's.
 */
export async function takeBackClientUpload(
  asClient: SupabaseClient,
  service: SupabaseClient,
  token: string,
  documentId: string,
): Promise<{ ok: boolean; code: string }> {
  try {
    const { data, error } = await asClient.rpc("client_link_discard_upload", {
      target_token: token,
      target_document: documentId,
    });
    if (error) return failed;
    const answer = (data ?? {}) as { ok?: boolean; code?: string; file_id?: string; storage_path?: string };
    if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
    if (answer.file_id && answer.storage_path) {
      await takeBackFile(supabaseFileStore(service), answer.file_id, answer.storage_path);
    }
    return { ok: true, code: "discarded" };
  } catch {
    return failed;
  }
}
