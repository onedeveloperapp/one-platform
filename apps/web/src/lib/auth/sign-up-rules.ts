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

/** A password as the sign-up's field asks it: eight characters, upper and lower case, a character that is no letter or digit. */
export function passwordMeetsRules(password: string): boolean {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[^A-Za-z 0-9]/.test(password);
}
