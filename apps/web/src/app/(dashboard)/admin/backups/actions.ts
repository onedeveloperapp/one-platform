"use server";

import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";
import { isBackupConfigured, runBackup } from "@flyee/backup";

export type BackupActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function isCallerSuperadmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("is_superadmin").eq("id", user.id).maybeSingle();
  return Boolean(data?.is_superadmin);
}

/**
 * Kick off a backup, inline: the operator waits for it. Bounded by the
 * function's time (five minutes), which suits the size of ONE's database
 * today; the nightly backup runs from the clock's sweep (lib/backup-jobs.ts).
 */
export async function triggerBackup(): Promise<BackupActionResult<{ mode: "queued" | "inline" }>> {
  if (!(await isCallerSuperadmin())) return { ok: false, error: "forbidden" };
  if (!isBackupConfigured()) {
    return { ok: false, error: "Defina DATABASE_URL e SUPABASE_SERVICE_ROLE_KEY para habilitar os backups." };
  }

  const result = await runBackup({ trigger: "manual" });
  if (!result.ok) return { ok: false, error: result.hint };
  return { ok: true, data: { mode: "inline" } };
}

export type BackupFile = { name: string; url: string };

/** Signed download URLs (1h) for every archive in a run's folder. */
export async function getBackupFiles(prefix: string): Promise<BackupActionResult<BackupFile[]>> {
  if (!(await isCallerSuperadmin())) return { ok: false, error: "forbidden" };
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY é necessária para assinar os links de download." };
  }

  const storage = createServiceClient().storage.from("backups");
  const { data: files, error } = await storage.list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) return { ok: false, error: error.message };

  const signed: BackupFile[] = [];
  for (const file of files ?? []) {
    const path = `${prefix}/${file.name}`;
    const { data } = await storage.createSignedUrl(path, 3600);
    if (data?.signedUrl) signed.push({ name: file.name, url: data.signedUrl });
  }
  return { ok: true, data: signed };
}
