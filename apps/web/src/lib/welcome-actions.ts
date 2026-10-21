"use server";

import { after } from "next/server";

import { isNewAccount, welcomeOnce } from "@/lib/welcome";
import { createClient } from "@flyee/auth/server";

/**
 * The welcome of an account that got its session at sign-up itself: when the
 * project does not ask for an e-mail confirmation there is no confirmation
 * link, so `/auth/callback` (where the welcome normally goes out) never runs.
 * The sign-up page calls this instead. The same once-only key applies, and
 * the message goes out after the answer, so the page does not wait on it.
 */
export async function welcomeNewMember(): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isNewAccount(user.created_at)) return;
    const newMember = user.id;
    after(() => welcomeOnce(newMember));
  } catch {
    // A welcome is never worth failing a sign-up for.
  }
}
