import type { FlightRecordSource, VraMonth } from "@flyee/flights/types";
import { VraFormatError, VraMonthReader, vraMonthUrl, type VraWanted } from "@flyee/flights/vra";

/**
 * ANAC's official record of the flights operated in Brazil, a month at a
 * time, from the public file ANAC publishes (`@flyee/flights/vra` says what
 * one holds). No key: the address is a pattern the platform's settings hold.
 *
 * A file of a month is some 30 MB: it is read as it arrives and never held
 * whole, keeping the flights asked and the legs no schedule foresaw. Its
 * encoding is told by its first line: UTF-8 in the files of 2021 on, Latin-1
 * (Windows-1252) in older ones. What comes of a month:
 *
 *   read          the flights asked and the legs no schedule foresaw;
 *   missing       ANAC answered 404: a month not out yet, or never published;
 *   unavailable   no answer (`anac_no_answer`), another status (`anac_http_<n>`), a file of another
 *                 shape (`anac_format`), one cut on the way (`anac_cut`), or one with nothing (`anac_empty`).
 */

export const VRA_URL_PATTERN = "https://siros.anac.gov.br/siros/registros/diversos/vra/{ano}/VRA_{ano}_{mes}.csv";

export type AnacVraConfig = {
  /** The address of a month's file, with {ano} and {mes}. */
  urlPattern?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** The most bytes read before the first line ends: a header is a few hundred. */
const MOST_HEADER_BYTES = 64 * 1024;

/** Whether bytes are UTF-8, a character cut at their end allowed. */
function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  }
}

function joined(first: Uint8Array, second: Uint8Array): Uint8Array {
  const both = new Uint8Array(first.length + second.length);
  both.set(first);
  both.set(second, first.length);
  return both;
}

export class AnacVraSource implements FlightRecordSource {
  private readonly config: AnacVraConfig;

  constructor(config: AnacVraConfig = {}) {
    this.config = config;
  }

  async readMonth(month: string, wanted: VraWanted): Promise<VraMonth> {
    const url = vraMonthUrl(this.config.urlPattern ?? VRA_URL_PATTERN, month);
    const run = this.config.fetch ?? fetch;
    let response: Response;
    try {
      response = await run(url, { signal: AbortSignal.timeout(this.config.timeoutMs ?? 120_000) });
    } catch {
      return { kind: "unavailable", code: "anac_no_answer" };
    }
    if (response.status === 404) return { kind: "missing" };
    if (!response.ok || !response.body) return { kind: "unavailable", code: `anac_http_${response.status}` };

    const reader = new VraMonthReader(wanted);
    const bytes = response.body.getReader();
    let decoder: InstanceType<typeof TextDecoder> | null = null;
    let waiting: Uint8Array = new Uint8Array(0);
    let rest = "";
    const lines = (text: string) => {
      rest += text;
      const found = rest.split(/\r?\n/);
      rest = found.pop() ?? "";
      for (const line of found) reader.take(line);
    };
    try {
      for (;;) {
        const { done, value } = await bytes.read();
        if (decoder === null) {
          // The encoding is told by the first line, read whole first.
          if (value) waiting = joined(waiting, value);
          const end = waiting.indexOf(10);
          if (end === -1 && !done && waiting.length < MOST_HEADER_BYTES) continue;
          decoder = new TextDecoder(isUtf8(end === -1 ? waiting : waiting.subarray(0, end)) ? "utf-8" : "windows-1252");
          lines(decoder.decode(waiting, { stream: !done }));
        } else if (value) {
          lines(decoder.decode(value, { stream: true }));
        }
        if (done) break;
      }
      lines(decoder?.decode() ?? "");
      if (rest) reader.take(rest);
      if (!reader.started) return { kind: "unavailable", code: "anac_empty" };
      return reader.finish();
    } catch (error) {
      // A header without what a flight is read from, or lines that are none, is a file of another shape.
      if (error instanceof VraFormatError) return { kind: "unavailable", code: "anac_format" };
      return { kind: "unavailable", code: "anac_cut" };
    }
  }
}
