import { afterEach, describe, expect, it, vi } from "vitest";

import { act, bytesOf, frameText, lineByWords, plainWords, targetIn, watchChanges } from "@/lib/court-extension/act";

// A step of an eproc as the extension meets it. Every person, number and address here is invented.
const STEP = `
  <h1>Peticionamento Eletrônico (1 de 5) - Informações do processo</h1>
  <form id="frm">
    <label for="selClasse">Classe processual:</label>
    <select id="selClasse" name="selClasse">
      <option value="">Selecione</option>
      <option value="436">PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL</option>
      <option value="7">PROCEDIMENTO COMUM CÍVEL</option>
    </select>
    <label for="selAssunto">Assunto:</label>
    <select id="selAssunto" name="selAssunto">
      <option value="">Selecione</option>
      <option value="10441">Atraso de voo (transporte aéreo)</option>
      <option value="10442">Cancelamento de voo (transporte aéreo)</option>
      <option value="12345678901">Indenização por Dano Moral</option>
    </select>
    <label for="txtValor">Valor da causa</label>
    <input id="txtValor" name="txtValor" type="text">
    <input id="txtTravado" name="txtTravado" type="text" readonly>
    <input id="pwdSenha" name="pwdSenha" type="password">
    <input id="hdnToken" name="hdnToken" type="hidden" value="t0k3n">
    <label><input type="checkbox" id="chkRenuncia" name="chkRenuncia"> Renuncia ao excedente</label>
    <input type="file" id="arquivo" name="arquivo">
    <button type="button" id="btnProxima">Próxima</button>
    <button type="button" id="btnDesligado" disabled>Finalizar</button>
  </form>
`;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ONE's extension acting on a court's screen", () => {
  it("types a value through the field's own setter and tells the page as typing does", () => {
    document.body.innerHTML = STEP;
    const seen: string[] = [];
    const field = document.getElementById("txtValor") as HTMLInputElement;
    for (const type of ["input", "keyup", "change", "blur"]) field.addEventListener(type, () => seen.push(type));
    expect(act(document, { op: "fill", selector: "#txtValor", index: 0, value: "10.000,00" })).toBe(true);
    expect(field.value).toBe("10.000,00");
    expect(seen).toEqual(["input", "keyup", "change", "blur"]);
  });

  it("never types in a password, a hidden or a read-only field", () => {
    document.body.innerHTML = STEP;
    expect(act(document, { op: "fill", selector: "#pwdSenha", index: 0, value: "x" })).toBe(false);
    expect(act(document, { op: "fill", selector: "#hdnToken", index: 0, value: "x" })).toBe(false);
    expect(act(document, { op: "fill", selector: "#txtTravado", index: 0, value: "x" })).toBe(false);
    expect((document.getElementById("hdnToken") as HTMLInputElement).value).toBe("t0k3n");
  });

  it("picks a line of the system's list by its code, also as the map masked a long one", () => {
    document.body.innerHTML = STEP;
    const changed = vi.fn();
    document.getElementById("selClasse")?.addEventListener("change", changed);
    expect(act(document, { op: "select", selector: "#selClasse", index: 0, code: "436" })).toBe(true);
    expect((document.getElementById("selClasse") as HTMLSelectElement).value).toBe("436");
    expect(changed).toHaveBeenCalledOnce();
    expect(act(document, { op: "select", selector: "#selAssunto", index: 0, code: "[número]" })).toBe(true);
    expect((document.getElementById("selAssunto") as HTMLSelectElement).value).toBe("12345678901");
    expect(act(document, { op: "select", selector: "#selClasse", index: 0, code: "999" })).toBe(false);
  });

  it("picks a line by the words of a fact, and none when the words do not tell one line", () => {
    document.body.innerHTML = STEP;
    expect(
      act(document, {
        op: "select",
        selector: "#selAssunto",
        index: 0,
        text: "Cancelamento de voo (transporte aereo)",
      }),
    ).toBe(true);
    expect((document.getElementById("selAssunto") as HTMLSelectElement).value).toBe("10442");
    const options = Array.from((document.getElementById("selAssunto") as HTMLSelectElement).options);
    expect(lineByWords(options, "voo")).toBeNull();
    expect(lineByWords(options, "dano moral")?.value).toBe("12345678901");
    expect(plainWords("  Atraso  de VOO ")).toBe("atraso de voo");
  });

  it("ticks a box with a click, as a person's, and never presses a disabled button", () => {
    document.body.innerHTML = STEP;
    const pressed = vi.fn();
    document.getElementById("btnProxima")?.addEventListener("click", pressed);
    expect(act(document, { op: "check", selector: "#chkRenuncia", index: 0, on: true })).toBe(true);
    expect((document.getElementById("chkRenuncia") as HTMLInputElement).checked).toBe(true);
    expect(act(document, { op: "check", selector: "#chkRenuncia", index: 0, on: true })).toBe(true);
    expect(act(document, { op: "click", selector: "#btnProxima", index: 0 })).toBe(true);
    expect(pressed).toHaveBeenCalledOnce();
    expect(act(document, { op: "click", selector: "#btnDesligado", index: 0 })).toBe(false);
  });

  it("attaches a package's file to a file field and tells the page", () => {
    document.body.innerHTML = STEP;
    const field = document.getElementById("arquivo") as HTMLInputElement;
    const changed = vi.fn();
    field.addEventListener("change", changed);
    let given: File | null = null;
    // jsdom has no DataTransfer: a stand-in list of one file, as the browser's would be.
    const listOf = (file: File) => {
      given = file;
      const list = { 0: file, length: 1, item: (index: number) => (index === 0 ? file : null) };
      return list as unknown as FileList;
    };
    Object.defineProperty(field, "files", { configurable: true, writable: true, value: null });
    const pdf = btoa("%PDF-1.4 stand-in");
    expect(
      act(
        document,
        {
          op: "upload",
          selector: "#arquivo",
          index: 0,
          name: "01-peticao-inicial.pdf",
          type: "application/pdf",
          base64: pdf,
        },
        listOf,
      ),
    ).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
    expect((given as File | null)?.name).toBe("01-peticao-inicial.pdf");
    expect((given as File | null)?.type).toBe("application/pdf");
    expect(Array.from(bytesOf(pdf).slice(0, 4))).toEqual([37, 80, 68, 70]);
    // A field that is not a file field takes no file.
    expect(
      act(
        document,
        { op: "upload", selector: "#txtValor", index: 0, name: "x.pdf", type: "application/pdf", base64: pdf },
        listOf,
      ),
    ).toBe(false);
  });

  it("finds nothing for a selector the page cannot read or an element that is not there", () => {
    document.body.innerHTML = STEP;
    expect(targetIn(document, "#[bad", 0)).toBeNull();
    expect(targetIn(document, "#btnProxima", 3)).toBeNull();
    expect(act(document, { op: "click", selector: "#naoExiste", index: 0 })).toBe(false);
  });

  it("reads the frame's text for the receipt, and how long the frame has been still", async () => {
    document.body.innerHTML = "<h1>Processo distribuído</h1><p>Processo 1000123-07.2099.8.26.0100</p>";
    expect(frameText(document)).toContain("1000123-07.2099.8.26.0100");
    let clock = 1_000;
    const watched = watchChanges(document, () => clock);
    clock = 1_500;
    expect(watched.stillFor()).toBe(500);
    document.body.append(document.createElement("p"));
    await Promise.resolve();
    expect(watched.stillFor()).toBe(0);
  });

  it("brings each element into view before acting on it, as a person scrolls to a field (2026-11-26)", () => {
    document.body.innerHTML = STEP;
    const scrolled: string[] = [];
    // jsdom draws nothing, so it has no scrolling of its own: each element says it was asked.
    for (const element of Array.from(document.querySelectorAll("input, select, button"))) {
      (element as HTMLElement).scrollIntoView = () => scrolled.push(element.id);
    }
    act(document, { op: "fill", selector: "#txtValor", index: 0, value: "10.000,00" });
    act(document, { op: "select", selector: "#selClasse", index: 0, code: "436" });
    act(document, { op: "check", selector: "#chkRenuncia", index: 0, on: true });
    act(document, { op: "click", selector: "#btnProxima", index: 0 });
    expect(scrolled).toEqual(["txtValor", "selClasse", "chkRenuncia", "btnProxima"]);
    // Nothing it may not act on is scrolled to: a password stays where it is.
    act(document, { op: "fill", selector: "#pwdSenha", index: 0, value: "x" });
    expect(scrolled).not.toContain("pwdSenha");
  });

  it("leaves a list as a person's hand does: taken, changed, left, so a page that reloads the next list does", () => {
    document.body.innerHTML = STEP;
    const seen: string[] = [];
    const list = document.getElementById("selClasse") as HTMLSelectElement;
    for (const type of ["focus", "input", "change", "blur"]) list.addEventListener(type, () => seen.push(type));
    expect(act(document, { op: "select", selector: "#selClasse", index: 0, code: "436" })).toBe(true);
    expect(seen).toEqual(["focus", "input", "change", "blur"]);
  });
});
