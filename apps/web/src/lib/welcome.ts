import "server-only";

import { memberUrl } from "@/lib/messages/format";
import { readRecipients } from "@/lib/messages/recipients";
import { notifyLocalized } from "@/lib/notifications";
import { createServiceClient } from "@flyee/auth/service";
import { sendMemberWelcomeEmail } from "@flyee/email";

const HOME = "/inicio";

/**
 * How old an account can be and still be welcomed. A confirmation link is
 * followed within hours; a week covers a slow inbox, and keeps an old account
 * that signs in through a recovery link from being greeted as new.
 */
const WELCOME_WINDOW_MS = 7 * 86_400_000;

export function isNewAccount(createdAt: string | null | undefined, now: number = Date.now()): boolean {
  const created = createdAt ? Date.parse(createdAt) : Number.NaN;
  return Number.isFinite(created) && now - created < WELCOME_WINDOW_MS;
}

/**
 * "Your account is ready": one bell notice and one e-mail, the first time a
 * new account reaches the app.
 *
 * The bell row is the fence. Its key is unique per member, so a second
 * confirmation link, a sign-in from another browser or a retry writes nothing
 * and, finding nothing new, sends nothing. Never throws: a welcome that could
 * not be sent must not stand between a new member and the app.
 */
export async function welcomeOnce(userId: string): Promise<void> {
  try {
    const bell = await notifyLocalized([userId], (copy) => copy.welcome(), {
      type: "system",
      href: HOME,
      sourceKey: "welcome",
    });
    if ((bell.created ?? 0) === 0) return;
    const [reader] = await readRecipients(createServiceClient(), [userId]);
    if (!reader) return;
    await sendMemberWelcomeEmail(reader.email, {
      locale: reader.locale,
      name: reader.name,
      appUrl: memberUrl(HOME),
    });
  } catch (error) {
    console.error("welcome_failed", { userId, message: error instanceof Error ? error.message : String(error) });
  }
}
