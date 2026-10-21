/**
 * The id of a hearing's event in the firm's calendar: the 16 bytes of the
 * hearing's own id in base32hex (RFC 4648, section 7), lower case and with
 * no padding. Google takes as an event's id "lowercase letters a-v and digits
 * 0-9", of 5 to 1024 characters, unique per calendar (the reference of
 * events.insert, read on 2026-10-11): 26 characters of that alphabet, one per
 * hearing, the same each time, so writing a hearing again replaces its event.
 */

const ALPHABET = "0123456789abcdefghijklmnopqrstuv";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The event's id of a hearing's id (a uuid); throws for anything that is not one. */
export function eventIdOf(uuid: string): string {
  if (!UUID.test(uuid)) throw new Error("not a uuid");
  const hex = uuid.replace(/-/g, "").toLowerCase();
  let bits = 0;
  let value = 0;
  let out = "";
  for (let index = 0; index < hex.length; index += 2) {
    value = (value << 8) | Number.parseInt(hex.slice(index, index + 2), 16);
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** True for an id an event may have: base32hex, 5 to 1024 characters. */
export const isEventId = (value: string): boolean => /^[0-9a-v]{5,1024}$/.test(value);
