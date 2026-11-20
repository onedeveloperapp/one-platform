import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  captureScreen,
  COURT_SYSTEMS,
  courtSystemNames,
  courtSystemOf,
  locate,
  pageStep,
  redact,
  screenParams,
  stepOf,
} from "@/lib/court-extension/capture";

const NOW = new Date("2026-11-20T13:00:00Z");
const EPROC = {
  host: "eproc1g.tjrj.jus.br",
  pathname: "/eproc/controlador.php",
  search: "?acao=processo_ajuizamento&acao_origem=principal&hash=9f8e7d6c5b4a39281706",
};

// Every person, number and address here is invented.
const EPROC_FIRST_STEP = `
  <h1>Peticionamento Eletrônico (1 de 5) - Informações do processo</h1>
  <form id="frmProcesso">
    <fieldset><legend>Informações Preliminares</legend>
      <label for="selLocalidade">Desejo entrar com a ação em:</label>
      <select id="selLocalidade" name="selLocalidade" required>
        <option value="">Selecione</option>
        <option value="0001">Comarca da Capital</option>
        <option value="0021">Comarca de Niterói</option>
      </select>
      <label for="selClasse">Classe processual:</label>
      <select id="selClasse" name="selClasse"><option value="436">PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL</option></select>
      <label for="txtValorCausa">Valor da Causa: (R$) (Somente números)</label>
      <input id="txtValorCausa" name="txtValorCausa" type="text" value="1500000">
      <label><input type="checkbox" id="chkNaoSeAplica" name="chkNaoSeAplica" checked> Não se aplica</label>
      <a href="#" id="lnkIncluirAdvogado">+ Incluir outros advogados</a>
      <span>Advogado:</span>
      <select id="selAdvogado" name="selAdvogado"><option value="1">Ana Souza</option><option value="2">Rui Teste</option></select>
      <input type="hidden" name="hdnInfraHash" value="a1b2c3d4e5f6a7b8c9d0">
    </fieldset>
    <button type="button" id="btnProxima">Próxima &gt;</button>
  </form>
  <div style="display:none"><input id="txtEscondido" name="txtEscondido" type="text"></div>
`;

const EPROC_PARTIES = `
  <h1>Peticionamento Eletrônico (3 de 5) - Partes (autores)</h1>
  <label for="selTipoPessoa">Tipo Pessoa:</label>
  <select id="selTipoPessoa" name="selTipoPessoa"><option value="F">Pessoa Física</option><option value="J">Pessoa Jurídica</option></select>
  <label for="txtCpf">CPF:</label><input id="txtCpf" name="txtCpf" type="text" value="52998224725">
  <button type="button" id="btnConsultar">Consultar</button>
  <table id="tblResultado">
    <thead><tr><th>Pessoa</th><th>CPF / CNPJ</th><th>Nome / Razão Social</th><th>Ações</th></tr></thead>
    <tbody>
      <tr><td>Física</td><td>529.982.247-25</td><td><a href="/pessoa?id=77">RUI TESTE</a></td><td><button type="button" class="incluir">Incluir</button></td></tr>
      <tr><td>Física</td><td>111.444.777-35</td><td><a href="/pessoa?id=78">LIA TESTE</a></td><td><button type="button" class="incluir">Incluir</button></td></tr>
    </tbody>
  </table>
  <p>Contato: rui@teste.invalid</p>
`;

const PROJUDI_TABLE_FORM = `
  <table id="tabelaCadastro">
    <tr><td>Classe:</td><td><select name="Id_Classe"><option value="10">Procedimento do Juizado Especial Cível</option></select></td></tr>
    <tr><td>Comarca:</td><td><select name="Id_Comarca"><option value="1">Goiânia</option></select></td></tr>
  </table>
  <input type="submit" name="Salvar" value="Salvar">
`;

const json = (value: unknown) => JSON.stringify(value);

afterEach(() => {
  document.body.innerHTML = "";
  document.title = "";
});

describe("the map of a court's screen (the lawyer's extension)", () => {
  it("knows the systems it maps by their hosts, and the extension asks for those hosts alone", () => {
    expect(courtSystemOf("eproc1g.tjsp.jus.br")).toBe("eproc-tjsp");
    expect(courtSystemOf("projudi.tjgo.jus.br")).toBe("projudi-tjgo");
    expect(courtSystemOf("EPROC1G.TJRJ.JUS.BR")).toBe("eproc-tjrj");
    expect(courtSystemOf("projudi.tjgo.jus.br.evil.invalid")).toBeNull();
    expect(courtSystemOf("pje.tjrj.jus.br")).toBeNull();
    expect(courtSystemOf("esaj.tjsp.jus.br")).toBeNull();
    expect(courtSystemNames()).toBe("o eproc do TJSP, o Projudi do TJGO ou o eproc do TJRJ");
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "extension", "manifest.json"), "utf8")) as {
      host_permissions: string[];
      content_scripts: { matches: string[] }[];
    };
    const hosts = Object.values(COURT_SYSTEMS).map((system) => `https://${system.host}/*`);
    expect([...manifest.host_permissions].sort()).toEqual([...hosts].sort());
    expect([...manifest.content_scripts[0].matches].sort()).toEqual([...hosts].sort());
  });

  it("maps the fields, their labels, the system's own lists and the buttons of a step of the filing", () => {
    document.title = "eproc - TJRJ";
    document.body.innerHTML = EPROC_FIRST_STEP;
    const screen = captureScreen(document, EPROC, NOW);
    expect(screen.system).toBe("eproc-tjrj");
    expect(screen.params).toEqual({ acao: "processo_ajuizamento", acao_origem: "principal" });
    expect(screen.headings).toEqual([
      "Peticionamento Eletrônico (1 de 5) - Informações do processo",
      "Informações Preliminares",
    ]);
    const byId = (id: string) => screen.fields.find((field) => field.id === id);
    expect(byId("selLocalidade")).toMatchObject({
      kind: "select",
      label: "Desejo entrar com a ação em:",
      required: true,
      selector: "#selLocalidade",
      optionCount: 3,
      options: [
        { value: "", text: "Selecione" },
        { value: "0001", text: "Comarca da Capital" },
        { value: "0021", text: "Comarca de Niterói" },
      ],
    });
    expect(byId("selClasse")?.options).toEqual([{ value: "436", text: "PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL" }]);
    expect(byId("txtValorCausa")).toMatchObject({
      kind: "input",
      type: "text",
      label: "Valor da Causa: (R$) (Somente números)",
    });
    expect(byId("chkNaoSeAplica")).toMatchObject({ type: "checkbox", label: "Não se aplica" });
    expect(byId("lnkIncluirAdvogado")).toMatchObject({ kind: "link", label: "+ Incluir outros advogados" });
    expect(byId("btnProxima")).toMatchObject({ kind: "button", label: "Próxima >" });
    expect(byId("txtEscondido")?.visible).toBe(false);
  });

  it("never keeps what is written: no value, no hidden field, no token of the address, no list of people", () => {
    document.body.innerHTML = EPROC_FIRST_STEP;
    const screen = captureScreen(document, EPROC, NOW);
    const text = json(screen);
    expect(text).not.toContain("1500000");
    expect(text).not.toContain("hdnInfraHash");
    expect(text).not.toContain("a1b2c3d4e5f6a7b8c9d0");
    expect(text).not.toContain("9f8e7d6c5b4a39281706");
    // A list of the firm's lawyers keeps only its size.
    expect(screen.fields.find((field) => field.id === "selAdvogado")).toMatchObject({ options: null, optionCount: 2 });
    expect(text).not.toContain("Ana Souza");
  });

  it("keeps a table's column names and its size, never its rows, and a row's button once", () => {
    document.body.innerHTML = EPROC_PARTIES;
    const screen = captureScreen(document, EPROC, NOW);
    expect(screen.tables).toEqual([
      {
        selector: "#tblResultado",
        index: 0,
        headers: ["Pessoa", "CPF / CNPJ", "Nome / Razão Social", "Ações"],
        rows: 2,
      },
    ]);
    const text = json(screen);
    for (const kept of [
      "RUI TESTE",
      "LIA TESTE",
      "529.982.247-25",
      "52998224725",
      "111.444.777-35",
      "rui@teste.invalid",
    ]) {
      expect(text).not.toContain(kept);
    }
    expect(screen.fields.filter((field) => field.label === "Incluir")).toHaveLength(1);
    // "Tipo Pessoa" is the system's own list of kinds.
    expect(screen.fields.find((field) => field.id === "selTipoPessoa")?.options).toHaveLength(2);
  });

  it("reads a label from the cell before the field, as the court's forms in tables have it", () => {
    document.body.innerHTML = PROJUDI_TABLE_FORM;
    const screen = captureScreen(
      document,
      { host: "projudi.tjgo.jus.br", pathname: "/ProcessoCadastro", search: "?PaginaAtual=2&Id_Processo=123456789012" },
      NOW,
    );
    expect(screen.system).toBe("projudi-tjgo");
    expect(screen.params).toEqual({ PaginaAtual: "2" });
    expect(screen.fields.map((field) => [field.label, field.selector])).toEqual([
      ["Classe:", 'select[name="Id_Classe"]'],
      ["Comarca:", 'select[name="Id_Comarca"]'],
      ["Salvar", 'input[name="Salvar"]'],
    ]);
  });

  it("takes out of a text what could be a person's data", () => {
    expect(redact("  CPF   529.982.247-25 de rui@teste.invalid ")).toBe("CPF [número] de [e-mail]");
    expect(redact("Processo 2099.0000123-45.8.19.0001")).toBe("Processo [número]");
    expect(redact("Comarca 0021")).toBe("Comarca 0021");
    expect(screenParams("?acao=x&hash=abc&num_processo=20990001234&PaginaAtual=12345678901")).toEqual({ acao: "x" });
  });

  it("records the path without what was typed: which field was filled, the code chosen from the system's list", () => {
    document.body.innerHTML = EPROC_FIRST_STEP;
    const value = document.getElementById("txtValorCausa") as HTMLInputElement;
    value.value = "2500000";
    const filled = stepOf(new Event("change", { bubbles: true }), EPROC, NOW);
    expect(filled).toBeNull();
    value.dispatchEvent(new Event("change", { bubbles: true }));
    const typed = (() => {
      let step: ReturnType<typeof stepOf> = null;
      value.addEventListener("change", (event) => (step = stepOf(event, EPROC, NOW)));
      value.dispatchEvent(new Event("change", { bubbles: true }));
      return step as ReturnType<typeof stepOf>;
    })();
    expect(typed).toMatchObject({ event: "change", selector: "#txtValorCausa", option: null, checked: null });
    expect(json(typed)).not.toContain("2500000");

    const classe = document.getElementById("selClasse") as HTMLSelectElement;
    let chosen: ReturnType<typeof stepOf> = null;
    classe.addEventListener("change", (event) => (chosen = stepOf(event, EPROC, NOW)));
    classe.dispatchEvent(new Event("change", { bubbles: true }));
    expect(chosen).toMatchObject({ kind: "select", option: "436" });

    const lawyer = document.getElementById("selAdvogado") as HTMLSelectElement;
    lawyer.value = "2";
    let person: ReturnType<typeof stepOf> = null;
    lawyer.addEventListener("change", (event) => (person = stepOf(event, EPROC, NOW)));
    lawyer.dispatchEvent(new Event("change", { bubbles: true }));
    expect(person).toMatchObject({ kind: "select", option: null });

    let clickOnText: ReturnType<typeof stepOf> | undefined;
    value.addEventListener("click", (event) => (clickOnText = stepOf(event, EPROC, NOW)));
    value.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clickOnText).toBeNull();

    const next = document.getElementById("btnProxima") as HTMLButtonElement;
    let click: ReturnType<typeof stepOf> = null;
    next.addEventListener("click", (event) => (click = stepOf(event, EPROC, NOW)));
    next.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(click).toMatchObject({ event: "click", kind: "button", label: "Próxima >", selector: "#btnProxima" });

    expect(pageStep(EPROC, NOW)).toMatchObject({ event: "page", params: { acao: "processo_ajuizamento" } });
  });

  it("finds an element again by its id, its name, or its place", () => {
    document.body.innerHTML = `<div id="caixa"><span><input type="text"></span><span><input type="text"></span></div>
      <input type="text" name="campo"><input type="text" name="campo">`;
    const inputs = document.querySelectorAll("input");
    expect(locate(inputs[1])).toEqual({ selector: "#caixa > span:nth-of-type(2) > input", index: 0 });
    expect(locate(inputs[3])).toEqual({ selector: 'input[name="campo"]', index: 1 });
    expect(document.querySelectorAll(locate(inputs[1]).selector)[0]).toBe(inputs[1]);
  });
});
