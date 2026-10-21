import { randomBytes } from "node:crypto";

import { CODE_ALPHABET, CODE_LENGTH } from "@flyee/documents/codes";

/** The largest multiple of the alphabet under 256: bytes above it are drawn again, so no letter is likelier. */
const UNBIASED = 256 - (256 % CODE_ALPHABET.length);

/** A new public code for a document, drawn from the system's randomness. */
export function generateVerifyCode(): string {
  let code = "";
  while (code.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH * 2)) {
      if (byte >= UNBIASED) continue;
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return code;
}
