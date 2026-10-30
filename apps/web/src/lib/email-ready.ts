"use server";

import { isEmailConfigured } from "@flyee/email";

/**
 * Whether ONE can send an e-mail where it runs (`RESEND_API_KEY`, `packages/email`): an invitation offers its
 * e-mail only then, and its link always, so nobody types an address to learn afterwards that nothing left. Says
 * nothing of the key itself.
 */
export async function emailReady(): Promise<boolean> {
  return isEmailConfigured;
}
