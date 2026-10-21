import "server-only";

import { type BellCopy, bellCopyFor, type BellLocale, type BellText, toBellLocale } from "@/lib/messages/bell-copy";
import { createServiceClient } from "@flyee/auth/service";

export type NotificationInput = {
  /** Icon family in the bell: system | team | billing | <project-defined>. */
  type?: string;
  title: string;
  body?: string;
  /** Destination opened on click (internal path or full URL). */
  href?: string;
  /**
   * Idempotency key for notifications a scheduled job may produce twice (a
   * daily digest, a retry). `notifications.source_key` is unique across the
   * table, so the user id is appended here — the caller's key names the
   * EVENT ("admin-watch:2026-09-18"), not the row. A second attempt inserts
   * nothing and is reported as `created: 0`, which is also how a caller knows
   * not to send the matching e-mail again.
   */
  sourceKey?: string;
};

export type NotifyResult = {
  sent: boolean;
  created?: number;
  /** Who actually received a new row — the ones a matching e-mail should go to. */
  createdFor?: string[];
  error?: string;
};

/**
 * Creates in-app notifications (header bell) for a set of users. Server-only:
 * inserts go through the service role because RLS blocks users from writing
 * each other's notifications. Returns { sent: false } without throwing when
 * Supabase is not configured — notifications are always best-effort.
 *
 * Database-side events (e.g. "member joined") use triggers instead; see
 * migration 0012_notifications.sql.
 */
export async function notifyUsers(userIds: string[], input: NotificationInput): Promise<NotifyResult> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { sent: false };
  }
  if (userIds.length === 0) return { sent: true };

  const service = createServiceClient();
  const row = (userId: string) => ({
    user_id: userId,
    type: input.type ?? "system",
    title: input.title,
    body: input.body ?? null,
    href: input.href ?? null,
  });

  // With a key, one row at a time: a bulk insert is atomic, so one user who
  // already has today's digest would block everybody else's.
  if (input.sourceKey) {
    const createdFor: string[] = [];
    for (const userId of userIds) {
      const { error } = await service
        .from("notifications")
        .insert({ ...row(userId), source_key: `${input.sourceKey}:${userId}` });
      // 23505: this exact notification already exists — the point of the key.
      if (error && error.code !== "23505") {
        return { sent: false, created: createdFor.length, createdFor, error: error.message };
      }
      if (!error) createdFor.push(userId);
    }
    return { sent: true, created: createdFor.length, createdFor };
  }

  const { error } = await service.from("notifications").insert(userIds.map(row));
  if (error) return { sent: false, created: 0, createdFor: [], error: error.message };
  return { sent: true, created: userIds.length, createdFor: userIds };
}

export const notifyUser = (userId: string, input: NotificationInput) => notifyUsers([userId], input);

/**
 * The same notice for several people, each in the language they read.
 *
 * A notification is stored text, so its language is decided when it is
 * written: this reads `profiles.locale` of every recipient and writes one
 * group per language with the copy of that language (lib/messages/bell-copy.ts).
 * `write` picks the notice from the copy; it runs once per language.
 *
 * Best-effort like `notifyUsers`. A notice whose words differ per person (a
 * session time on the reader's own clock) is written with `notifyUser` and
 * `bellCopyFor` instead.
 */
export async function notifyLocalized(
  userIds: string[],
  write: (copy: BellCopy, locale: BellLocale) => BellText,
  options: Pick<NotificationInput, "type" | "href" | "sourceKey"> = {},
): Promise<NotifyResult> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { sent: false };
  }
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return { sent: true, created: 0, createdFor: [] };

  const { data: profiles, error } = await createServiceClient().from("profiles").select("id, locale").in("id", unique);
  if (error) return { sent: false, created: 0, createdFor: [], error: error.message };

  const localeOf = new Map(
    (profiles ?? []).map((row) => [row.id as string, toBellLocale(row.locale as string | null)]),
  );
  const groups = new Map<BellLocale, string[]>();
  for (const userId of unique) {
    const locale = localeOf.get(userId) ?? "pt-BR";
    groups.set(locale, [...(groups.get(locale) ?? []), userId]);
  }

  const merged: NotifyResult = { sent: true, created: 0, createdFor: [] };
  for (const [locale, group] of groups) {
    const result = await notifyUsers(group, { ...options, ...write(bellCopyFor(locale), locale) });
    merged.created = (merged.created ?? 0) + (result.created ?? 0);
    merged.createdFor = [...(merged.createdFor ?? []), ...(result.createdFor ?? [])];
    if (!result.sent) {
      merged.sent = false;
      merged.error = result.error;
    }
  }
  return merged;
}
