import "server-only";

import { MniFilingChannel } from "@flyee/courts/providers/mni";
import type { FilingChannel, FilingOutcome, LawsuitFiling } from "@flyee/courts/types";

/**
 * The channel ONE files a lawsuit through (migration 0101): the court's own
 * machine channel, the MNI, with the platform's credential at that court; or,
 * for a test case, the test court of 0061, which stands where the court
 * stands. Never a lawyer's login on the court's screen.
 */

/**
 * The test court: it files what it is given under the number it gives the lawsuit (`test_court_number`), with a
 * receipt that says on its face that no court received it. It checks nothing a court checks.
 */
export class TestCourtChannel implements FilingChannel {
  readonly name = "test_court";
  constructor(private readonly input: { number: string; receipt: (filing: LawsuitFiling) => Promise<Uint8Array> }) {}

  async fileLawsuit(filing: LawsuitFiling): Promise<FilingOutcome> {
    const receipt = await this.input.receipt(filing);
    return {
      kind: "filed",
      protocol: `TESTE-${this.input.number.slice(0, 7)}`,
      caseNumber: this.input.number,
      receipt,
      at: new Date(),
      message: "Recebido pelo tribunal de teste do ONE.",
    };
  }
}

/**
 * The court's MNI with the credential the court gave: the MNI grants access to an entity, a firm entering as a
 * "procuradoria". The pilot firm's is kept in the server's environment (`MNI_<COURT>_MANIFESTANTE`,
 * `MNI_<COURT>_SENHA`, such as `MNI_TJGO_SENHA`); once more than one firm files through ONE, each firm's goes to
 * its vault (`packages/connectors`), like a vendor's token, never a lawyer's password. Null while there is none.
 * A court that authenticates the platform by its ICP-Brasil certificate instead (a TLS client certificate) joins
 * here once it grants it (`packages/courts/README.md`).
 */
export function mniChannelFor(court: string, endpoint: string | null): FilingChannel | null {
  if (!endpoint) return null;
  const key = court.toUpperCase().replace(/[^A-Z]/g, "");
  const id = process.env[`MNI_${key}_MANIFESTANTE`]?.trim();
  const password = process.env[`MNI_${key}_SENHA`]?.trim();
  if (!id || !password) return null;
  return new MniFilingChannel({ endpoint, idManifestante: id, senhaManifestante: password });
}
