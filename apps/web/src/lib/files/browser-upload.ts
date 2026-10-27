import { FIRM_FILES_BUCKET } from "@/lib/files/bucket";
import { createClient } from "@supabase/supabase-js";

/**
 * Sends the bytes of a file from the browser straight to storage, to the
 * address a server action reserved and signed (lib/files/uploads.ts for a
 * person of a firm, lib/cases/client-link-actions.ts for a client). The
 * signed token is what authorizes it: no session is read or kept, so the
 * same helper serves the logged area and a client's link.
 */
export async function uploadToSignedUrl(input: {
  storagePath: string;
  uploadToken: string;
  file: Blob;
  contentType: string;
}): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  const storage = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).storage;
  const { error } = await storage
    .from(FIRM_FILES_BUCKET)
    .uploadToSignedUrl(input.storagePath, input.uploadToken, input.file, { contentType: input.contentType });
  return !error;
}

/**
 * The type a browser gives a file, or the one its name implies when the
 * browser gives none (some phones send a photo with no type). The backend
 * measures the bytes anyway: this only has to get the reservation right.
 */
export function mimeOf(file: { name: string; type: string }): string {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const byExtension: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return byExtension[extension] ?? "application/octet-stream";
}
