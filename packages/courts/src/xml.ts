/**
 * A small XML reader for what a court's webservice answers: elements, their
 * attributes and their text, entities decoded. No namespaces, no DTD: the
 * answers read here have neither. It is lenient where a court is: a "<" that
 * cannot open a tag (Projudi writes "<{Operação Não Autorizada.}>" inside a
 * message) is text. It refuses what is not a document (an end tag that closes
 * nothing, an element never closed), so an answer cut on the way is never
 * read as a whole one.
 *
 * Pure: no I/O.
 */

export type XmlElement = {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** The element's own text, decoded, as written (not trimmed). */
  text: string;
};

/** What is not an XML document. */
export class XmlError extends Error {
  constructor(reason: string) {
    super(`xml: ${reason}`);
    this.name = "XmlError";
  }
}

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Text with its entities decoded; an entity it does not know stays as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return NAMED[entity] ?? whole;
  });
}

const NAME = /^[A-Za-z_][\w.:-]*/;
const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** The document's root element. */
export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: "#document", attributes: {}, children: [], text: "" };
  const open: XmlElement[] = [root];
  let at = 0;
  const current = () => open[open.length - 1];
  while (at < source.length) {
    const lt = source.indexOf("<", at);
    if (lt === -1) {
      current().text += decodeEntities(source.slice(at));
      break;
    }
    if (lt > at) current().text += decodeEntities(source.slice(at, lt));
    const rest = source.slice(lt);
    if (rest.startsWith("<?")) {
      const end = source.indexOf("?>", lt);
      if (end === -1) throw new XmlError("declaration not closed");
      at = end + 2;
    } else if (rest.startsWith("<!--")) {
      const end = source.indexOf("-->", lt);
      if (end === -1) throw new XmlError("comment not closed");
      at = end + 3;
    } else if (rest.startsWith("<![CDATA[")) {
      const end = source.indexOf("]]>", lt);
      if (end === -1) throw new XmlError("cdata not closed");
      current().text += source.slice(lt + 9, end);
      at = end + 3;
    } else if (rest.startsWith("<!")) {
      const end = source.indexOf(">", lt);
      if (end === -1) throw new XmlError("declaration not closed");
      at = end + 1;
    } else if (rest.startsWith("</")) {
      const end = source.indexOf(">", lt);
      const name = source.slice(lt + 2, end === -1 ? undefined : end).trim();
      if (end === -1 || !NAME.test(name)) throw new XmlError("end tag not readable");
      if (open.length === 1 || current().name !== name) throw new XmlError(`end tag ${name} closes nothing`);
      open.pop();
      at = end + 1;
    } else {
      const name = NAME.exec(source.slice(lt + 1))?.[0];
      // A "<" that cannot open a tag is text, as a court writes it.
      if (!name) {
        current().text += "<";
        at = lt + 1;
        continue;
      }
      const end = source.indexOf(">", lt);
      if (end === -1) throw new XmlError("tag not closed");
      const inside = source.slice(lt + 1 + name.length, end);
      const selfClosing = inside.trimEnd().endsWith("/");
      const attributes: Record<string, string> = {};
      for (const match of inside.matchAll(ATTRIBUTE)) attributes[match[1]] = decodeEntities(match[3] ?? match[4] ?? "");
      const element: XmlElement = { name, attributes, children: [], text: "" };
      current().children.push(element);
      if (!selfClosing) open.push(element);
      at = end + 1;
    }
  }
  if (open.length !== 1) throw new XmlError(`element ${current().name} not closed`);
  const elements = root.children;
  if (elements.length !== 1) throw new XmlError("not one root element");
  return elements[0];
}

/** The children of an element with a name. */
export const childrenNamed = (element: XmlElement | null | undefined, name: string): XmlElement[] =>
  element ? element.children.filter((child) => child.name === name) : [];

/** The first child of an element with a name, or null. */
export const childNamed = (element: XmlElement | null | undefined, name: string): XmlElement | null =>
  childrenNamed(element, name)[0] ?? null;

/** The trimmed text of the first child with a name; "" when there is none. */
export const textOf = (element: XmlElement | null | undefined, name: string): string =>
  (childNamed(element, name)?.text ?? "").replace(/\s+/g, " ").trim();
