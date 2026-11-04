/**
 * The rules a sign-up is checked by, on the page and in the server action that signs up by an invitation, so the
 * two never differ. Pure.
 */

/** An invitation a sign-up began at: the team's (`/convite/<token>`) or a partner's (`/parceria/<token>`). */
export type InvitationNext = { kind: "firm" | "partner"; token: string };

const INVITATION_PATH = /^\/(convite|parceria)\/([^/?#]+)\/?(?:[?#].*)?$/;
// The tokens ONE mints are 32 random bytes in base64url (lib/firm/actions.ts, lib/partners/actions.ts).
const TOKEN = /^[A-Za-z0-9_-]{16,200}$/;

/**
 * The invitation a `?next=` leads back to, when it is one: the sign-up then takes its e-mail from the invitation
 * and the person never types it (the owner, 2026-11-03: an agency retyped the address it had been invited at).
 */
export function invitationOfNext(next: string | null | undefined): InvitationNext | null {
  if (!next) return null;
  const match = INVITATION_PATH.exec(next.trim());
  if (!match) return null;
  let token: string;
  try {
    token = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  if (!TOKEN.test(token)) return null;
  return { kind: match[1] === "convite" ? "firm" : "partner", token };
}

/** A name of a person: three characters at least, as the sign-up's field asks. */
export function nameMeetsRules(name: string): boolean {
  return name.trim().length >= 3;
}

/** Why the provider of the accounts refused a sign-up, by the words the sign-up has for it. */
export type SignUpRefusal = "registered" | "email_limit" | "email_unavailable" | "failed";

/**
 * Reads the provider's refusal of a sign-up. Every sign-up sends a link to confirm the address, so the e-mail the
 * provider could not send is said as that: its own sender sends a few an hour and only to the addresses its
 * project allows (`over_email_send_rate_limit`, `email_address_not_authorized`), which read as "check your
 * connection" until 2026-11-04, when an agency's sign-up from its invitation met the limit.
 */
export function signUpRefusal(error: { code?: string | null; message?: string | null }): SignUpRefusal {
  const code = error.code ?? "";
  if (code === "user_already_exists" || code === "email_exists") return "registered";
  if (code === "over_email_send_rate_limit") return "email_limit";
  if (code === "email_address_not_authorized" || /sending confirmation (e-?mail|mail)/i.test(error.message ?? "")) {
    return "email_unavailable";
  }
  return "failed";
}

/** A password as the sign-up's field asks it: eight characters, upper and lower case, a character that is no letter or digit. */
export function passwordMeetsRules(password: string): boolean {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[^A-Za-z 0-9]/.test(password);
}
