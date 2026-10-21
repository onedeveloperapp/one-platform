import { createHash } from "node:crypto";

import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

/**
 * What a certificate in PEM says of its holder: read for the screen (whose
 * signature the lawyer authorized, until when) and for the checks before
 * anything is signed with it. An ICP-Brasil certificate of a person writes
 * the holder's CPF in its subject's alternative name, under the OID
 * 2.16.76.1.3.1, after the 8 positions of the birth date (DOC-ICP-04); a
 * company's (e-CNPJ) writes its CNPJ under 2.16.76.1.3.3 and no CPF of a
 * person there. Most also write the CPF in the common name, as "NOME:CPF",
 * which is read apart and never taken for the ICP-Brasil field. Nothing here
 * checks the certificate's chain: the court's system does, and ONE never
 * decides that a certificate is valid, only reads what it says.
 */

export type CertificateFacts = {
  /** The holder's name, as the certificate writes it. */
  holderName: string;
  /** The holder's CPF as ICP-Brasil writes it of a person (2.16.76.1.3.1), 11 digits that check; null otherwise. */
  cpf: string | null;
  /** The CPF the common name carries ("NOME:CPF"), when it carries one that checks. */
  commonNameCpf: string | null;
  /** A company's CNPJ (2.16.76.1.3.3), when the certificate is a company's. */
  cnpj: string | null;
  validFrom: Date;
  validUntil: Date;
  /** The certificate's serial number, in hexadecimal. */
  serialHex: string;
  /** Who issued it: the issuer's common name, or its organization. */
  issuerName: string;
  /** The certificate of an authority (its basic constraints say CA): an AC of the chain, never a holder's. */
  authority: boolean;
  /** The SHA-256 of the certificate's DER, in hexadecimal: this very certificate, whatever else shares its serial. */
  sha256Hex: string;
};

const PERSON_DATA = "2.16.76.1.3.1";
const COMPANY_CNPJ = "2.16.76.1.3.3";
const SUBJECT_ALT_NAME = "2.5.29.17";
const BASIC_CONSTRAINTS = "2.5.29.19";
const COMMON_NAME = "2.5.4.3";
const ORGANIZATION = "2.5.4.10";

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+?)-----END CERTIFICATE-----/;
const PEM_BLOCKS = /-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+?-----END CERTIFICATE-----/g;

/** The DER of the first certificate of a PEM, read strictly: whole base64, and one value with nothing after it. */
function derOfPem(pem: string): ArrayBuffer {
  const block = PEM_BLOCK.exec(pem);
  if (!block) throw new Error("certificate: no certificate in the PEM");
  const text = block[1].replace(/\s+/g, "");
  const bytes = Buffer.from(text, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== text) throw new Error("certificate: the base64 is not whole");
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const parsed = asn1js.fromBER(copy);
  if (parsed.offset === -1 || parsed.offset !== bytes.length) throw new Error("certificate: not one DER value");
  return copy;
}

/** True when the 11 digits pass the two check digits of the CPF (and are not one digit repeated). */
export function cpfChecks(digits: string): boolean {
  if (!/^[0-9]{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const digit = (length: number) => {
    let total = 0;
    for (let index = 0; index < length; index += 1) total += Number(digits[index]) * (length + 1 - index);
    const rest = total % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return digit(9) === Number(digits[9]) && digit(10) === Number(digits[10]);
}

const nameValue = (names: pkijs.RelativeDistinguishedNames, type: string): string => {
  const found = names.typesAndValues.find((item) => item.type === type);
  const value = found?.value.valueBlock.value;
  return typeof value === "string" ? value.trim() : "";
};

const isTag = (block: asn1js.AsnType | undefined, tagClass: number, tagNumber: number): boolean =>
  !!block && block.idBlock.tagClass === tagClass && block.idBlock.tagNumber === tagNumber;

/** The text of a value an otherName carries: an OCTET STRING of characters, or a string type (told by its tag). */
function textOf(block: asn1js.AsnType | undefined): string {
  if (!block) return "";
  if (isTag(block, 1, 4)) {
    return Buffer.from((block as asn1js.OctetString).valueBlock.valueHexView).toString("latin1");
  }
  const value = (block as { valueBlock?: { value?: unknown } }).valueBlock?.value;
  return typeof value === "string" ? value : "";
}

/** The values of the otherNames of the alternative name, by their OID. */
function otherNames(certificate: pkijs.Certificate): Map<string, string> {
  const found = new Map<string, string>();
  const extension = certificate.extensions?.find((item) => item.extnID === SUBJECT_ALT_NAME);
  const names = (extension?.parsedValue as pkijs.AltName | undefined)?.altNames ?? [];
  for (const name of names) {
    if (name.type !== 0) continue;
    const parts = (name.value as asn1js.Constructed).valueBlock?.value ?? [];
    const oid = isTag(parts[0], 1, 6) ? (parts[0] as asn1js.ObjectIdentifier).valueBlock.toString() : "";
    const inner = (parts[1] as asn1js.Constructed | undefined)?.valueBlock?.value?.[0];
    if (oid && !found.has(oid)) found.set(oid, textOf(inner));
  }
  return found;
}

export function certificateFacts(pem: string): CertificateFacts {
  const der = derOfPem(pem);
  const certificate = pkijs.Certificate.fromBER(der);
  const commonName = nameValue(certificate.subject, COMMON_NAME);
  const split = /^(.*?):\s*([0-9]{11}|[0-9]{14})$/.exec(commonName);
  const others = otherNames(certificate);
  // The birth date takes positions 1 to 8 (as digits, zeros or spaces) and the CPF the 11 after: never moved.
  const personData = others.get(PERSON_DATA) ?? "";
  const icpCpf = personData.length >= 19 ? personData.slice(8, 19) : "";
  const companyData = (others.get(COMPANY_CNPJ) ?? "").replace(/\s+$/, "");
  const nameCpf = split && split[2].length === 11 ? split[2] : "";
  return {
    holderName: (split ? split[1] : commonName).trim(),
    cpf: cpfChecks(icpCpf) ? icpCpf : null,
    commonNameCpf: cpfChecks(nameCpf) ? nameCpf : null,
    cnpj: /^[0-9]{14}$/.test(companyData) ? companyData : null,
    validFrom: certificate.notBefore.value,
    validUntil: certificate.notAfter.value,
    serialHex: Buffer.from(certificate.serialNumber.valueBlock.valueHexView).toString("hex"),
    issuerName: nameValue(certificate.issuer, COMMON_NAME) || nameValue(certificate.issuer, ORGANIZATION),
    authority:
      (
        certificate.extensions?.find((item) => item.extnID === BASIC_CONSTRAINTS)?.parsedValue as
          | pkijs.BasicConstraints
          | undefined
      )?.cA === true,
    sha256Hex: createHash("sha256").update(new Uint8Array(der)).digest("hex"),
  };
}

/**
 * Of what a PSC hands for one certificate (the holder's, maybe with the chain
 * of its AC, in any order), the holder's: the first certificate that is no
 * authority. Line breaks written as the two characters backslash and "n"
 * are read as line breaks. With none that reads as a holder's, the first one,
 * which the checks then refuse; null when there is no certificate at all.
 */
export function holderPemOf(text: string): string | null {
  const blocks = text.replace(/\\r/g, "\r").replace(/\\n/g, "\n").match(PEM_BLOCKS) ?? [];
  for (const block of blocks) {
    try {
      if (!certificateFacts(block).authority) return block;
    } catch {
      // A block that does not read is nobody's certificate.
    }
  }
  return blocks[0] ?? null;
}
