"use client";

import type { CaseDocument, CasePerson } from "../case-types";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Box, Button, ButtonBase, Typography } from "@mui/material";

import SidePanel from "@/components/product/side-panel";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import { openCaseFile } from "@/lib/cases/actions";
import { PERSON_FIELD_KEY } from "@/lib/cases/cases";
import type { PersonField } from "@/lib/cases/forms";
import { type ReadFields } from "@/lib/cases/read-fields";
import { cn } from "@/lib/utils";
import { formatCpf } from "@flyee/fields";
import { formatDayBr } from "@flyee/rules/person";

/** The address of a person in one line, as the court and the papers name it. */
export function addressLine(person: CasePerson): string | null {
  const street = [person.street, person.address_number].filter(Boolean).join(", ");
  const place = [person.city, person.uf].filter(Boolean).join("/");
  const line = [street, person.complement, person.district, place, person.postal_code ? cep(person.postal_code) : null]
    .filter(Boolean)
    .join(", ");
  return line || null;
}

const cep = (digits: string) => (/^\d{8}$/.test(digits) ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits);

export const ADDRESS_FIELDS: readonly PersonField[] = [
  "postal_code",
  "street",
  "address_number",
  "complement",
  "district",
  "city",
  "uf",
];

/** Each thing ONE read of a person, with the document it came from. */
type ReadFact = { key: string; label: string; value: string; document: string; kind: string };

/** The words of a document by its kind, for its tab and for "· da identidade". */
export const SOURCE_KEY: Record<string, { tab: string; from: string }> = {
  identity: { tab: "case-person-check-doc-identity", from: "case-person-read-source-identity" },
  address_proof: { tab: "case-person-check-doc-address", from: "case-person-read-source-address" },
};
const OTHER_SOURCE = { tab: "case-person-check-doc-other", from: "case-person-read-source-other" };
export const sourceOf = (kind: string) => SOURCE_KEY[kind] ?? OTHER_SOURCE;

/** What ONE read of a person, one fact per line (the address as one), in the order of the form. */
export function readFacts(person: CasePerson, marks: ReadFields, label: (field: PersonField) => string): ReadFact[] {
  const facts: ReadFact[] = [];
  const one = (field: PersonField, value: string | null) => {
    const mark = marks[field];
    if (mark && value) facts.push({ key: field, label: label(field), value, document: mark.document, kind: mark.kind });
  };
  one("full_name", person.full_name);
  one("cpf", person.cpf ? formatCpf(person.cpf) : null);
  one("birth_date", person.birth_date ? formatDayBr(person.birth_date) : null);
  one("nationality", person.nationality);
  const addressMark = ADDRESS_FIELDS.map((field) => marks[field]).find(Boolean);
  const address = addressLine(person);
  if (addressMark && address) {
    facts.push({ key: "address", label: "", value: address, document: addressMark.document, kind: addressMark.kind });
  }
  return facts;
}

/**
 * What ONE read of a person, checked with the documents in front of the person (the owner, 2026-11-12: "não
 * entendi onde ser feito"): each document the reading came from, shown as the client sent it, and each fact read
 * beside it with the document it came from. "Corrigir" opens the person's data; "Tudo confere" says the firm agrees
 * (0094), which is what the card's line asks. A "Conferi com o documento" with no document in sight asked the
 * person to confirm what they could not see.
 */
export default function PersonReadCheck({
  person,
  marks,
  documents,
  busy,
  onConfirm,
  onCorrect,
  onClose,
}: {
  person: CasePerson;
  marks: ReadFields;
  documents: CaseDocument[];
  busy: boolean;
  onConfirm: () => void;
  onCorrect: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("product");
  const facts = readFacts(person, marks, (field) => t(PERSON_FIELD_KEY[field]));
  const addressWord = t("case-person-fact-address");
  // The documents the reading came from, in the order their facts come.
  const sources = [...new Map(facts.map((fact) => [fact.document, fact.kind])).entries()].map(([id, kind]) => ({
    id,
    kind,
    document: documents.find((document) => document.id === id) ?? null,
  }));
  const [shown, setShown] = useState(sources[0]?.id ?? null);
  const current = sources.find((source) => source.id === shown) ?? null;
  const [file, setFile] = useState<{ id: string; url: string | null; failed: boolean } | null>(null);

  useEffect(() => {
    const document = current?.document;
    if (!document) return;
    let live = true;
    void openCaseFile(document.fileId).then((link) => {
      if (live) setFile({ id: document.id, url: link.ok ? link.url : null, failed: !link.ok });
    });
    return () => {
      live = false;
    };
  }, [current?.document]);

  const loaded = file && current?.document && file.id === current.document.id ? file : null;

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("case-person-check-close")}
      title={t("case-person-check-title", { name: person.full_name })}
      description={t("case-person-check-description")}
      icon={<NiDocumentFull size="medium" />}
      busy={busy}
      wide
      actions={
        <>
          <Button variant="contained" onClick={onConfirm} loading={busy} disabled={busy}>
            {t("case-person-check-confirm")}
          </Button>
          <Button variant="outlined" color="grey" onClick={onClose} disabled={busy}>
            {t("case-person-check-later")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        {sources.length > 1 ? (
          <Box role="tablist" aria-label={t("case-person-check-docs")} className="flex flex-wrap gap-2">
            {sources.map((source) => (
              <Button
                key={source.id}
                role="tab"
                aria-selected={source.id === shown}
                variant={source.id === shown ? "pastel" : "outlined"}
                color={source.id === shown ? "primary" : "grey"}
                size="small"
                onClick={() => setShown(source.id)}
              >
                {t(sourceOf(source.kind).tab)}
              </Button>
            ))}
          </Box>
        ) : null}

        <Box className="border-grey-100 bg-grey-25 flex min-h-64 items-center justify-center overflow-hidden rounded-xl border">
          {!current?.document ? (
            <Typography variant="body2" className="text-text-secondary p-6 text-center">
              {t("case-person-check-missing-doc")}
            </Typography>
          ) : !loaded ? (
            <Typography variant="body2" role="status" className="text-text-secondary p-6">
              {t("case-person-check-loading")}
            </Typography>
          ) : loaded.failed || !loaded.url ? (
            <Typography variant="body2" className="text-text-secondary p-6 text-center">
              {t("case-person-check-failed")}
            </Typography>
          ) : current.document.pdf ? (
            <Box
              component="iframe"
              src={loaded.url}
              title={t("case-person-check-alt", { document: t(sourceOf(current.kind).tab), name: person.full_name })}
              className="h-[28rem] w-full border-0"
            />
          ) : (
            // A signed address of the firm's storage, shown as it is: next/image would fetch it through the app.

            <img
              src={loaded.url}
              alt={t("case-person-check-alt", { document: t(sourceOf(current.kind).tab), name: person.full_name })}
              className="max-h-[28rem] w-full object-contain"
            />
          )}
        </Box>
        {loaded?.url ? (
          <Button
            component="a"
            href={loaded.url}
            target="_blank"
            rel="noopener noreferrer"
            variant="text"
            color="grey"
            size="small"
            className="self-start"
          >
            {t("case-person-check-open")}
          </Button>
        ) : null}

        <Box component="ul" className="border-grey-100 m-0 flex list-none flex-col rounded-xl border p-0">
          {facts.map((fact, index) => (
            <Box
              component="li"
              key={fact.key}
              className={cn("flex items-center gap-3 px-4 py-3", index > 0 && "border-grey-100 border-t")}
            >
              <ButtonBase
                onClick={() => setShown(fact.document)}
                className="flex min-w-0 flex-1 flex-col items-start rounded-lg text-left"
              >
                <Typography variant="caption" className="text-text-secondary">
                  {t("case-person-check-from", {
                    field: fact.key === "address" ? addressWord : fact.label,
                    source: t(sourceOf(fact.kind).from),
                  })}
                </Typography>
                <Typography variant="body2" className="font-semibold break-words">
                  {fact.value}
                </Typography>
              </ButtonBase>
              <Button variant="text" color="grey" size="small" onClick={onCorrect} disabled={busy}>
                {t("case-person-check-correct")}
              </Button>
            </Box>
          ))}
        </Box>
      </Box>
    </SidePanel>
  );
}
