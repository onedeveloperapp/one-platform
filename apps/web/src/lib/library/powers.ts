/**
 * What a power of attorney grants of the special powers the CPC asks to be written (art. 105): receiving and giving
 * discharge (what the client's money, when the court releases it to the firm, needs) and signing a declaration of
 * economic hardship (what free justice asked in the client's name needs). Read from the text of the firm's model, as
 * it is written: a power is granted only where its words are there. Pure; the screens say ONE read it and may err.
 */
export type AttorneyPowers = {
  /** "receber e dar quitação", or "dar quitação". */
  discharge: boolean;
  /** "declaração de hipossuficiência" (or "de pobreza", the older words). */
  hardship: boolean;
};

const plain = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");

export function attorneyPowers(body: string): AttorneyPowers {
  const text = plain(body ?? "");
  return {
    discharge: /\bdar (plena |geral )?quitacao\b/.test(text),
    hardship: /\b(declaracao|declaracoes|declarar)( de| a)? (hipossuficiencia|pobreza)\b/.test(text),
  };
}
