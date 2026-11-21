import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * The text of the firm's site, read once, only where the person gave its address (decision 5 of the plan "o
 * escritório preparado antes do primeiro atendimento", 2026-11-20), for ONE to write the firm's profile from. The
 * address is a stranger's to the server: only http and https on their own ports, never an address of a private or
 * reserved network (checked again at each redirect, at most three), a few seconds and a few hundred kilobytes at most,
 * and only a page's text kept (no script, no style, no mark), cut to a size the model reads.
 */

const MOST_BYTES = 600_000;
const MOST_CHARS = 8000;
const TIMEOUT_MS = 8000;

/** Whether an IP address is of a private, local or reserved network: never one the server reads. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower);
  }
  return true;
}

/** The text a page shows, as plain words. */
export function siteTextOf(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|article|header|footer|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(
      /&(nbsp|amp|lt|gt|quot|#39|apos);/g,
      (_, entity: string) =>
        ({ nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" })[entity] ?? " ",
    )
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, MOST_CHARS);
}

/** Whether the server may read an address: http or https, its own port, a name that leads to no private network. */
async function readable(address: URL): Promise<boolean> {
  if (address.protocol !== "https:" && address.protocol !== "http:") return false;
  if (address.port && address.port !== "80" && address.port !== "443") return false;
  if (address.username || address.password) return false;
  const host = address.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return !isPrivateAddress(host);
  try {
    const found = await lookup(host, { all: true, verbatim: true });
    return found.length > 0 && found.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}

/** The text of the firm's site, or null where it could not be read (refused, out of reach, not a page). */
export async function readSiteText(url: string): Promise<string | null> {
  let address: URL;
  try {
    address = new URL(url);
  } catch {
    return null;
  }
  for (let hop = 0; hop <= 3; hop += 1) {
    if (!(await readable(address))) return null;
    let response: Response;
    try {
      response = await fetch(address, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "text/html,text/plain", "user-agent": "Mozilla/5.0 (compatible; leitor-de-site)" },
      });
    } catch {
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) return null;
      try {
        address = new URL(next, address);
      } catch {
        return null;
      }
      continue;
    }
    if (!response.ok || !response.body) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!/text\/(html|plain)/i.test(type)) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      size += value.byteLength;
      chunks.push(value);
      if (size >= MOST_BYTES) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks).subarray(0, MOST_BYTES));
    const text = siteTextOf(html);
    return text || null;
  }
  return null;
}
