import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalCitation,
  citationGap,
  distinctCitations,
  extractCitations,
  isCovered,
  ISSUED_KINDS,
  LIBRARY_KINDS,
  SHARED_CLASSES,
  sourceKey,
  type SourceRef,
} from "./citations.ts";

/** The keys a text cites, in order. */
const keys = (text: string) => extractCitations(text).map((citation) => citation.key);
/** The keys a text cites, each with a mark when nobody can check it as written. */
const read = (text: string) =>
  extractCitations(text).map((citation) => `${citation.key}${citationGap(citation) ? "!" : ""}`);
const table = (forms: [string, string[]][], by: (text: string) => string[] = keys) => {
  for (const [text, expected] of forms) assert.deepEqual(by(text), expected, text);
};
const char = (code: number) => String.fromCodePoint(code);

describe("what a piece cites", () => {
  it("reads a law by its number or by its name, as the same law", () => {
    table([
      ["nos termos da Lei nº 8.078/1990.", ["lei::8078"]],
      ["a Lei 8.078/90 protege", ["lei::8078"]],
      ["a Lei n. 8.078, de 11 de setembro de 1990, dispõe", ["lei::8078"]],
      ["a lei 9099 de 1995 rege os juizados", ["lei::9099"]],
      ["o Código de Defesa do Consumidor impõe", ["lei::8078"]],
      ["o Código de Proteção e Defesa do Consumidor impõe", ["lei::8078"]],
      ["segundo o CDC e o Código Civil", ["lei::8078", "lei::10406"]],
      ["o CPC/2015 e o NCPC", ["lei::13105", "lei::13105"]],
      ["a Lei dos Juizados Especiais Cíveis", ["lei::9099"]],
      ["o Código Brasileiro de Aeronáutica (CBA)", ["lei::7565", "lei::7565"]],
      ["a Lei Complementar nº 123/2006", ["lei_complementar::123"]],
      ["a LC 123/2006", ["lei_complementar::123"]],
      ["a Constituição Federal garante", ["constituicao::1988"]],
      ["a CF/88 e a CRFB", ["constituicao::1988", "constituicao::1988"]],
      ["segundo a Carta Magna", ["constituicao::1988"]],
      ["segundo a Constituição", ["constituicao::1988"]],
      ["a Convenção de Montreal limita", ["decreto::5910/2006"]],
      ["as Convenções de Varsóvia e Montreal", ["decreto::20704/1931", "decreto::5910/2006"]],
      ["o Decreto nº 5.910, de 27 de setembro de 2006, promulgou", ["decreto::5910/2006"]],
      ["o Decreto nº 5.910, de 27.9.2006", ["decreto::5910/2006"]],
      ["o Decreto 5.910/06", ["decreto::5910/2006"]],
      // A decree-law is a decree, and not also a law.
      ["o Decreto-Lei nº 4.657/1942", ["decreto::4657/1942"]],
      // A decree with no year cannot be told from another of the same number.
      ["o Decreto nº 5.910 promulgou", ["decreto::5910"]],
    ]);
  });

  it("reads a code that was replaced as its own law, never as the one in force", () => {
    table([
      ["o art. 85 do CPC/73", ["lei::5869#85"]],
      ["o Código de Processo Civil de 1973", ["lei::5869"]],
      ["o art. 186 do Código Civil de 1916", ["lei::3071#186"]],
      ["o CC/16", ["lei::3071"]],
      ["a Constituição Federal de 1967", ["constituicao::1967"]],
      ["o CPC/15 e o Código Civil de 2002", ["lei::13105", "lei::10406"]],
    ]);
  });

  it("reads an article with the norm it is of, written before or after it", () => {
    table([
      ["o art. 14 do CDC responsabiliza", ["lei::8078#14"]],
      ["o artigo 14 do Código de Defesa do Consumidor", ["lei::8078#14"]],
      ["o art. 14, caput, da Lei 8.078/90", ["lei::8078#14"]],
      ["o art. 14, § 1º, do CDC", ["lei::8078#14"]],
      ["o art. 14, §3º, II, do Código de Defesa do Consumidor", ["lei::8078#14"]],
      ["o art. 6.º, VIII, do CDC", ["lei::8078#6"]],
      ["o art. 6º, VIII, do CDC inverte o ônus", ["lei::8078#6"]],
      ["o artigo 6º, inciso VIII, do Código de Defesa do Consumidor", ["lei::8078#6"]],
      ["o art. 42, p. único, do CDC", ["lei::8078#42"]],
      ["o art. 319 e seguintes do CPC", ["lei::13105#319"]],
      ["os arts. 186 e 927 do Código Civil", ["lei::10406#186", "lei::10406#927"]],
      ["os arts. 186 e 927, ambos do Código Civil", ["lei::10406#186", "lei::10406#927"]],
      ["os artigos 734, 737 e 741 do CC", ["lei::10406#734", "lei::10406#737", "lei::10406#741"]],
      ["o art. 5º, incisos V e X, da Constituição Federal", ["constituicao::1988#5"]],
      ["o art. 5º, X, da Constituição", ["constituicao::1988#5"]],
      ["o art. 373, II, do CPC", ["lei::13105#373"]],
      ["o art. 1.036 do CPC", ["lei::13105#1036"]],
      ["o art. 1.036-A do CPC", ["lei::13105#1036A"]],
      ["o art. 22 da Convenção de Montreal", ["decreto::5910/2006#22"]],
      ["o artigo 21 da Resolução nº 400/2016 da ANAC", ["resolucao:ANAC:400#21"]],
      ["os arts. 26 e 27 da Resolução ANAC nº 400", ["resolucao:ANAC:400#26", "resolucao:ANAC:400#27"]],
      ["o CDC, em seu art. 14, responsabiliza", ["lei::8078#14"]],
      ["o CDC prevê em seu art. 14", ["lei::8078#14"]],
      ["a Lei 9.099/95, no seu art. 3º, fixa", ["lei::9099#3"]],
      ["o Código Civil (arts. 186 e 927) obriga", ["lei::10406#186", "lei::10406#927"]],
      ["o art. 14 do CDC e o art. 927 do Código Civil", ["lei::8078#14", "lei::10406#927"]],
      // With no word between the article and its norm.
      ["(art. 14, CDC)", ["lei::8078#14"]],
      ["(art. 373, I, CPC)", ["lei::13105#373"]],
      ["conforme o art. 14 CDC", ["lei::8078#14"]],
    ]);
  });

  it("reads every article of a list, and the articles of the norm that follows", () => {
    table([
      ["os artigos 6º, VI e VIII, e 14 do CDC", ["lei::8078#14", "lei::8078#6"]],
      ["arts. 5º, V e X, e 37, § 6º, da Constituição Federal", ["constituicao::1988#37", "constituicao::1988#5"]],
      ["arts. 14; 22 e 42 do CDC", ["lei::8078#14", "lei::8078#22", "lei::8078#42"]],
      ["CDC, arts. 6º, VI, e 14", ["lei::8078#14", "lei::8078#6"]],
      ["arts. 186 e 927 do CC e 14 do CDC", ["lei::10406#186", "lei::10406#927", "lei::8078#14"]],
      ["arts. 186 c/c 927 do CC", ["lei::10406#186", "lei::10406#927"]],
    ]);
  });

  it("reads an article written as a heading under its own citation as that same article", () => {
    const text = 'Dispõe o art. 14 do CDC, in verbis:\n\n"Art. 14. O fornecedor de serviços responde pela reparação dos danos."';
    assert.deepEqual(keys(text), ["lei::8078#14", "lei::8078#14"]);
    // With no citation of it before, the words of an article name no norm.
    assert.deepEqual(read('"Art. 14. O fornecedor de serviços responde pela reparação dos danos."'), ["artigo::#14!"]);
  });

  it("reports an article with no norm beside it as a citation nobody can check", () => {
    assert.deepEqual(keys("conforme o art. 14 do referido diploma"), ["artigo::#14"]);
    assert.deepEqual(keys("o artigo 927, já citado,"), ["artigo::#927"]);
    // "e" joins two things: it does not tie the article to the norm that follows.
    assert.deepEqual(keys("o art. 14, e da Lei 9.099/95 decorre"), ["artigo::#14", "lei::9099"]);
    // A norm named far before, with other words between, is not the article's.
    assert.deepEqual(keys("O CDC protege o consumidor. Além disso, vale lembrar o art. 14."), ["lei::8078", "artigo::#14"]);
    // What is not a number of an article is not read as one.
    assert.deepEqual(keys("o referido artigo dispõe, e a parte autora tinha 14 anos"), []);
  });

  it("reads a súmula, a theme and an enunciado with who issued it", () => {
    table([
      ["a Súmula 387 do STJ", ["sumula:STJ:387"]],
      ["a Súmula nº 54/STJ", ["sumula:STJ:54"]],
      ["a Súmula Nº 387 do STJ", ["sumula:STJ:387"]],
      ["a Súmula 7 do Superior Tribunal de Justiça", ["sumula:STJ:7"]],
      ["a Súmula STJ 362", ["sumula:STJ:362"]],
      ["a súmula 479 (STJ)", ["sumula:STJ:479"]],
      ["a Súmula 362 do c. STJ", ["sumula:STJ:362"]],
      ["a Súmula 362 do colendo Superior Tribunal de Justiça", ["sumula:STJ:362"]],
      ["a Súmula 32 do TJGO", ["sumula:TJGO:32"]],
      ["a Súmula 32 do TJ-GO", ["sumula:TJGO:32"]],
      ["a Súmula 150 do TRF-4", ["sumula:TRF4:150"]],
      ["a Súmula 150 do TRF da 4ª Região", ["sumula:TRF4:150"]],
      ["a Súmula 45 da TNU", ["sumula:TNU:45"]],
      ["o enunciado n. 362 da Súmula do STJ", ["sumula:STJ:362"]],
      ["o verbete sumular 362 do STJ", ["sumula:STJ:362"]],
      ["a Súmula Vinculante 10", ["sumula_vinculante:STF:10"]],
      // No court beside it: a súmula of nobody, which no library entry answers.
      ["a Súmula 387 consolidou", ["sumula::387"]],
      // A court named later in the sentence is another subject.
      ["a Súmula 387 foi editada. O STF, por sua vez,", ["sumula::387"]],
      ["o Tema 1.417 do STF", ["tema:STF:1417"]],
      ["o Tema 210/STF", ["tema:STF:210"]],
      ["o Tema nº 1.240 da repercussão geral", ["tema:STF:1240"]],
      ["o Tema de Repercussão Geral 210", ["tema:STF:210"]],
      ["o Tema 1.417/RG", ["tema:STF:1417"]],
      ["o Tema Repetitivo 1.068", ["tema:STJ:1068"]],
      ["o Tema 1.068 dos recursos repetitivos", ["tema:STJ:1068"]],
      ["o Tema 1.068 do Superior Tribunal de Justiça", ["tema:STJ:1068"]],
      ["o Enunciado 161 do FONAJE", ["enunciado:FONAJE:161"]],
      ["o Enunciado 161 do Fonaje", ["enunciado:FONAJE:161"]],
      ["o Enunciado FONAJE 161", ["enunciado:FONAJE:161"]],
      ["o Enunciado Cível 161 do FONAJE", ["enunciado:FONAJE:161"]],
      ["a Resolução nº 400, de 13 de dezembro de 2016, da ANAC", ["resolucao:ANAC:400"]],
      ["a Resolução Normativa nº 400 da ANAC", ["resolucao:ANAC:400"]],
      // A body this reader has no name for is read as bodies are written: in capitals, after "do" or "da".
      ["o Enunciado 135 do FPPC", ["enunciado:FPPC:135"]],
      ["a Resolução CONTRAN nº 400", ["resolucao:CONTRAN:400"]],
      ["a Resolução nº 400 do CONTRAN", ["resolucao:CONTRAN:400"]],
      // A regional court with no region is nobody.
      ["a Súmula 150 do TRF", ["sumula::150"]],
    ]);
  });

  it("reads a list in the plural, each number with the body that issued them all", () => {
    table([
      ["as Súmulas 37 e 387 do STJ", ["sumula:STJ:37", "sumula:STJ:387"]],
      ["incidência das Súmulas n. 5 e 7/STJ", ["sumula:STJ:5", "sumula:STJ:7"]],
      ["as Súmulas 43, 54 e 362, todas do STJ", ["sumula:STJ:362", "sumula:STJ:43", "sumula:STJ:54"]],
      // The same list under a head in the singular, which is how many pieces write it.
      ["a Súmula 54 e 362 do STJ", ["sumula:STJ:362", "sumula:STJ:54"]],
      ["os Temas 210 e 1.240 do STF", ["tema:STF:1240", "tema:STF:210"]],
      ["os Enunciados 20 e 161 do FONAJE", ["enunciado:FONAJE:161", "enunciado:FONAJE:20"]],
      ["as Leis 8.078/90 e 9.099/95", ["lei::8078", "lei::9099"]],
      ["as Resoluções 141 e 400 da ANAC", ["resolucao:ANAC:141", "resolucao:ANAC:400"]],
      // With no body after it, a number after "e" under a head in the singular is no súmula.
      ["a Súmula 7 e 5 anos de espera", ["sumula::7"]],
    ]);
  });

  it("reads a heading or an ementa in capitals like any other text", () => {
    table([
      ["DA INVERSÃO DO ÔNUS DA PROVA (ART. 6º, VIII, DO CDC)", ["lei::8078#6"]],
      ["RESPONSABILIDADE OBJETIVA. ART. 14 DO CDC. DANO MORAL CONFIGURADO. SÚMULA 7/STJ.", ["lei::8078#14", "sumula:STJ:7"]],
      ["ARTIGO 14 DO CÓDIGO DE DEFESA DO CONSUMIDOR", ["lei::8078#14"]],
      ["DA SÚMULA 387 DO STJ", ["sumula:STJ:387"]],
      ["DA VIOLAÇÃO À RESOLUÇÃO Nº 400/2016 DA ANAC", ["resolucao:ANAC:400"]],
      ["DA CONVENÇÃO DE MONTREAL E DA CONSTITUIÇÃO FEDERAL", ["decreto::5910/2006", "constituicao::1988"]],
      // In capitals a word and an acronym cannot be told apart: only the bodies this reader knows are read there.
      ["DA SÚMULA 7 DO TRIBUNAL", ["sumula::7"]],
    ]);
    // A text whose accents came apart from their letters is read like any other.
    assert.deepEqual(keys("a Súmula 387 do STJ".normalize("NFD")), ["sumula:STJ:387"]);
  });

  it("reads a decision by the class that carries its number", () => {
    table([
      ["STJ, REsp 1.584.465/MG, Rel. Min.", ["precedente::RESP 1584465"]],
      ["REsp nº 1.584.465", ["precedente::RESP 1584465"]],
      ["REsp Nº 1.584.465/MG", ["precedente::RESP 1584465"]],
      ["REsp. 1.842.066/RS", ["precedente::RESP 1842066"]],
      ["Resp 1842066", ["precedente::RESP 1842066"]],
      ["REsp repetitivo n. 1.251.331/RS", ["precedente::RESP 1251331"]],
      ["AgInt no AREsp 1.234.567/SP", ["precedente::ARESP 1234567"]],
      ["EDcl no AgRg no REsp 987.654/RJ", ["precedente::RESP 987654"]],
      ["EAREsp 676.608/RS", ["precedente::EARESP 676608"]],
      ["RE 636.331", ["precedente::RE 636331"]],
      ["RE 201.819-8/RJ", ["precedente::RE 201819"]],
      ["ARE 766.618", ["precedente::ARE 766618"]],
      // The class written in full, as the court's own heading has it.
      ["o Recurso Especial nº 1.584.465/MG", ["precedente::RESP 1584465"]],
      ["RECURSO ESPECIAL Nº 1.584.465 - MG (2015/0006691-2)", ["precedente::RESP 1584465"]],
      ["Recurso Extraordinário 636.331", ["precedente::RE 636331"]],
      ["Agravo em Recurso Especial nº 1.234.567", ["precedente::ARESP 1234567"]],
      // As a legal database prints one.
      ["(STJ - REsp: 1584465 MG 2015/0006691-2, Relator: Ministra NANCY ANDRIGHI)", ["precedente::RESP 1584465"]],
      ["(STJ - AgInt no AREsp: 1234567 SP 2018/0012345-6, Relator: X)", ["precedente::ARESP 1234567"]],
      ["(STF - RE: 636331 RJ, Relator: X)", ["precedente::RE 636331"]],
      // The same letters with no number are the Civil Code, and a heading's number is not a decision's.
      ["o art. 927 do CC", ["lei::10406#927"]],
      ["nos termos do art. 927 do CC.\n2. DO DANO MORAL", ["lei::10406#927"]],
      // A case of a court below, by the number the CNJ gives it, however its marks are written.
      ["TJGO, Apelação Cível 5123456-13.2099.8.09.0051", ["processo::51234561320998090051"]],
      ["Apelação Cível nº 5123456.13.2099.8.09.0051", ["processo::51234561320998090051"]],
      [`Recurso Inominado nº 5123456${char(0x2011)}13.2099.8.09.0051`, ["processo::51234561320998090051"]],
      ["processo 51234561320998090051", ["processo::51234561320998090051"]],
      ["(TJ-GO - AC: 51234561320998090051, Relator: X)", ["processo::51234561320998090051"]],
    ]);
  });

  it("reads a decision of a class more than one court has as its court's, or as nobody's", () => {
    table(
      [
        ["(STJ, HC 123.456/SP, Rel. Min. X)", ["precedente:STJ:HC 123456"]],
        ["HC 123.456/SP (STF)", ["precedente:STF:HC 123456"]],
        ["STF - HC: 123456 SP, Relator: X", ["precedente:STF:HC 123456"]],
        ["MS 30.000 do STF", ["precedente:STF:MS 30000"]],
        ["IRDR nº 5 do TJGO", ["precedente:TJGO:IRDR 5"]],
        ["IRDR 5 do TJSP", ["precedente:TJSP:IRDR 5"]],
        ["IAC 5/STJ", ["precedente:STJ:IAC 5"]],
        ["o CC 148.519/MT, do STJ, definiu", ["precedente:STJ:CC 148519"]],
        ["Conflito de Competência n. 148.519 do STJ", ["precedente:STJ:CC 148519"]],
        // With no court beside it, nobody can say whose it is.
        ["HC 123.456/SP", ["precedente::HC 123456!"]],
        ["o CC 148.519/MT definiu", ["precedente::CC 148519!"]],
        ["AgRg no Ag 1.234.567/SP", ["precedente::AG 1234567!"]],
        // One decision, with or without zeros before its number.
        ["IRDR 0012345 do TJGO e IRDR 12345 do TJGO", ["precedente:TJGO:IRDR 12345", "precedente:TJGO:IRDR 12345"]],
        // A class of one court is of that court by its name.
        ["REsp 1.584.465/MG", ["precedente::RESP 1584465"]],
        ["RE 636.331/RJ", ["precedente::RE 636331"]],
      ],
      read,
    );
    for (const name of ["HC", "MS", "CC", "IRDR", "IAC", "AI", "RCL", "AG"]) assert.ok(SHARED_CLASSES.includes(name), name);
    for (const name of ["RESP", "ARESP", "RE", "ARE", "ADI"]) assert.ok(!SHARED_CLASSES.includes(name), name);
  });

  it("reads the other norms of the Union and of the European Union it has a key for", () => {
    table(
      [
        ["a Medida Provisória nº 925/2020", ["norma::MP 925/2020"]],
        ["a MP 925/2020", ["norma::MP 925/2020"]],
        ["a MP nº 925, de 18 de março de 2020", ["norma::MP 925/2020"]],
        ["o art. 3º da Medida Provisória nº 925/2020", ["norma::MP 925/2020#3"]],
        ["a Emenda Constitucional nº 45/2004", ["norma::EC 45"]],
        ["a EC nº 45", ["norma::EC 45"]],
        ["o Decreto Legislativo nº 59, de 18 de abril de 2006", ["norma::DLG 59/2006"]],
        [
          "aprovada pelo Decreto Legislativo nº 59, de 18 de abril de 2006, e promulgada pelo Decreto nº 5.910, de 27 de setembro de 2006",
          ["norma::DLG 59/2006", "decreto::5910/2006"],
        ],
        ["a Portaria ANAC nº 2.050/2018", ["norma:ANAC:PORTARIA 2050/2018"]],
        ["a Portaria nº 2.050/2018 da ANAC", ["norma:ANAC:PORTARIA 2050/2018"]],
        ["a Instrução Normativa nº 39/2016 do TST", ["norma:TST:IN 39/2016"]],
        // The regulation of the European Union on the rights of air passengers.
        ["o Regulamento (CE) nº 261/2004", ["norma::REGCE 261/2004"]],
        ["o art. 7º do Regulamento (CE) n. 261/2004", ["norma::REGCE 261/2004#7"]],
        // With no year, or with nobody named as who issued it, nobody can check one.
        ["a Medida Provisória nº 925", ["norma::MP 925!"]],
        ["a Portaria nº 676/GC-5 do Comando da Aeronáutica", ["norma::PORTARIA 676!"]],
        ["a Instrução Normativa nº 39 do TST", ["norma:TST:IN 39!"]],
        // "O MP" is also a body: its acronym names a norm only with "nº" or a year.
        ["o MP opinou em 3 dias", []],
      ],
      read,
    );
  });

  it("reads nothing where there is no citation", () => {
    table([
      // A state, a postal code and a registration at the bar are not decisions.
      ["Fulana de Tal\nOAB/MS 12.345", []],
      ["Campo Grande/MS 79002-000", []],
      // A flight is named by its airline's code and a number, and a bank account by "CC".
      ["o voo AI 123 da Air India e o voo MS 800 da Egyptair", []],
      ["o voo RE 1234 da companhia", []],
      ["Banco do Brasil, Ag 1234-5, CC 12345-6", []],
      // The words of a narrative.
      ["a reclamação ficou sem resolução em 10 dias", []],
      ["o prazo para resolução de 10 dias", []],
      ["publicação da súmula em 10/02/2020", []],
      ["PUBLICAÇÃO DA SÚMULA EM 10/02/2020", []],
      ["interpôs Recurso Especial 3 dias depois", []],
      ["o pedido administrativo foi julgado em 10/02/2020", []],
      ["a Reclamação nº 123456 no consumidor.gov.br", []],
      ["CPF 123.456.789-09, CNPJ 11.222.333/0001-81, telefone (62) 99999-8888, R$ 10.000,00, em 10/02/2020", []],
      ["o voo G3 1234, o bilhete 1272345678901 e o protocolo 2026.10/000123", []],
      ["o tema central e o artigo de jornal sobre a resolução do contrato", []],
      ["o resp 1584465 e o re 636331", []],
    ]);
  });

  it("fails closed: what is written as a citation and read into no source blocks", () => {
    table(
      [
        // A numbered instrument of a kind this reader has no key for.
        ["o Provimento nº 61 do CNJ", ["ilegivel::provimento nº 61!"]],
        ["a Resolução Conjunta nº 5", ["ilegivel::resolução conjunta nº 5!"]],
        ["o Informativo 593 do STJ", ["ilegivel::informativo 593!"]],
        ["o Enunciado Administrativo nº 3 do STJ", ["ilegivel::enunciado administrativo nº 3!"]],
        // A law of a state or of a city is of who issued it, and no key holds that.
        ["a Lei Estadual nº 20.756/2020", ["ilegivel::lei estadual nº 20.756/2020!"]],
        ["o art. 5º da Lei Municipal nº 9.861/2016", ["ilegivel::lei municipal nº 9.861/2016#5!"]],
        ["o Decreto Estadual nº 9.999/2020", ["ilegivel::decreto estadual nº 9.999/2020!"]],
        // A decision told by its reporter and its day, with no number that was read: how a model invents one.
        [
          '"APELAÇÃO CÍVEL. ATRASO DE VOO." (TJGO, 3ª Câmara Cível, Rel. Des. Fulano de Tal, julgado em 10/02/2021, DJe de 12/02/2021)',
          ["ilegivel::(tjgo, 3ª câmara cível, rel. des. fulano de tal, julgado em 10/02/2021, dje de 12/02/2021)!"],
        ],
        ["(STJ, Terceira Turma, Rel. Min. Nancy Andrighi, DJe 21/11/2018)", ["ilegivel::(stj, terceira turma, rel. min. nancy andrighi, dje 21/11/2018)!"]],
        ["(TJSP, j. 10.02.2021)", ["ilegivel::(tjsp, j. 10.02.2021)!"]],
        // An appeal of a court below by a number that is not the CNJ's.
        ["TJRS, Apelação Cível 70079999999", ["ilegivel::apelação cível 70079999999!"]],
        ["Apelação Cível n. 2015.01.2.345678-9", ["ilegivel::apelação cível n. 2015.01.2.345678-9!"]],
      ],
      read,
    );
    // The same reporter beside a number that was read is that decision, said once.
    assert.deepEqual(read("REsp 1.584.465/MG (Rel. Min. Nancy Andrighi, Terceira Turma, julgado em 13/11/2018, DJe 21/11/2018)"), [
      "precedente::RESP 1584465",
    ]);
    assert.deepEqual(read("(TJGO, Apelação Cível 5123456-13.2099.8.09.0051, Rel. Des. Fulano, julgado em 10/02/2021)"), [
      "processo::51234561320998090051",
    ]);
    // The decision of the paragraph before is another: it does not answer for this one.
    assert.deepEqual(
      read("(STJ, REsp 1.584.465/MG, Rel. Min. X, DJe 21/11/2018)\n\n(TJGO, 3ª Câmara Cível, Rel. Des. Y, julgado em 10/02/2021)"),
      ["precedente::RESP 1584465", "ilegivel::(tjgo, 3ª câmara cível, rel. des. y, julgado em 10/02/2021)!"],
    );
    // What blocks is never in a library, whatever the library holds.
    const unread = extractCitations("o Provimento nº 61 do CNJ")[0];
    assert.equal(isCovered(unread, new Set([unread.key])), false);
  });

  it("keeps what was written and where, and counts a source cited twice as two citations", () => {
    const text = "Nos termos do art. 14 do CDC e da Súmula 387 do STJ, e de novo o art. 14 do CDC.";
    const found = extractCitations(text);
    assert.deepEqual(
      found.map((citation) => [citation.key, citation.raw]),
      [
        ["lei::8078#14", "art. 14 do CDC"],
        ["sumula:STJ:387", "Súmula 387 do STJ"],
        ["lei::8078#14", "art. 14 do CDC"],
      ],
    );
    assert.ok(found.every((citation) => text.slice(citation.index).startsWith(citation.raw.split(" ")[0])));
    assert.deepEqual(
      distinctCitations(found).map((citation) => citation.key),
      ["lei::8078#14", "sumula:STJ:387"],
    );
    assert.deepEqual(extractCitations(""), []);
    assert.deepEqual(extractCitations("Texto sem nenhuma citação, de uma pessoa que perdeu um voo."), []);
  });

  it("reads a piece as firms write one, whole", () => {
    // Invented people, an invented case number, and one decision invented the way a model invents them.
    const piece = [
      "2. DA INVERSÃO DO ÔNUS DA PROVA (ART. 6º, VIII, DO CDC)",
      "A relação é de consumo, nos termos dos arts. 2º e 3º do CDC. O ônus da prova é da ré (art. 373, II, CPC).",
      'Dispõe o art. 14 do Código de Defesa do Consumidor, in verbis:\n\n"Art. 14. O fornecedor de serviços responde pela reparação dos danos."',
      "No mesmo sentido os arts. 734 e 737 do Código Civil. A Resolução nº 400/2016 da ANAC, em seus arts. 21, 26 e 27, impõe a assistência material, e as Convenções de Varsóvia e Montreal não afastam o dano moral (Temas 210 e 1.240 do STF).",
      "O Superior Tribunal de Justiça decidiu, no Recurso Especial nº 1.584.465/MG, que o atraso gera o dever de indenizar. No mesmo sentido:",
      "RECURSO ESPECIAL. TRANSPORTE AÉREO. ART. 14 DO CDC. SÚMULA 7/STJ. (STJ - REsp: 1796716 MG 2018/0166098-4, Relator: Ministra NANCY ANDRIGHI, Data de Julgamento: 27/08/2019)",
      "APELAÇÃO CÍVEL. CANCELAMENTO DE VOO. (TJGO, 3ª Câmara Cível, Rel. Des. Fulano de Tal, julgado em 10/02/2021)",
      "Os juros seguem as Súmulas 54 e 362 do STJ.",
      "Campo Grande/MS, 9 de outubro de 2026.\n\nFulana de Tal\nOAB/MS 12.345",
    ].join("\n\n");
    assert.deepEqual(
      distinctCitations(extractCitations(piece)).map((citation) => `${citation.key}${citationGap(citation) ? "!" : ""}`),
      [
        "lei::8078#6",
        "lei::8078#2",
        "lei::8078#3",
        "lei::13105#373",
        "lei::8078#14",
        "lei::10406#734",
        "lei::10406#737",
        "resolucao:ANAC:400#21",
        "resolucao:ANAC:400#26",
        "resolucao:ANAC:400#27",
        "decreto::20704/1931",
        "decreto::5910/2006",
        "tema:STF:1240",
        "tema:STF:210",
        "precedente::RESP 1584465",
        "sumula:STJ:7",
        "precedente::RESP 1796716",
        "ilegivel::(tjgo, 3ª câmara cível, rel. des. fulano de tal, julgado em 10/02/2021)!",
        "sumula:STJ:362",
        "sumula:STJ:54",
      ],
    );
  });

  it("reads a long text, also one made to be slow, in the time of a click", () => {
    const fill = (unit: string, length: number) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
    const paragraph =
      "A responsabilidade é objetiva (art. 14 do Código de Defesa do Consumidor) e o STJ decidiu no REsp 1.584.465/MG (Rel. Min. X, DJe 21/11/2018). ";
    for (const unit of [
      paragraph,
      "RE no ",
      "EDcl nos ",
      "art. 1 CC ",
      "CDC Lei 1 ",
      "Apelação Cível 70079999999, ",
      "(TJGO, Rel. Des. Fulano, julgado em 10/02/2021) ",
      "Rel. Min. Fulano, DJe 10/02/2021, ",
      "Provimento nº 61 do CNJ, ",
      "((Rel. Min. X) ",
      "(STJ, HC 123.456/SP) e IRDR nº 5 do TJGO, ",
    ]) {
      const started = performance.now();
      extractCitations(fill(unit, 150_000));
      assert.ok(performance.now() - started < 3000, `${JSON.stringify(unit)} took ${Math.round(performance.now() - started)} ms`);
    }
    const spaces = `Lei 8.078${" ".repeat(100_000)}`;
    const started = performance.now();
    extractCitations(spaces);
    assert.ok(performance.now() - started < 3000, "a run of white space after a number");
  });
});

describe("what a library verifies", () => {
  const library = new Set([
    sourceKey({ kind: "lei", issuer: "", number: "8078", article: "14" }),
    sourceKey({ kind: "lei", issuer: "", number: "10406", article: null }),
    sourceKey({ kind: "sumula", issuer: "stj", number: "387", article: null }),
  ]);
  const cited = (text: string) => extractCitations(text)[0];

  it("answers an article by an entry of that very article, and a norm by an entry of it or of any article of it", () => {
    assert.equal(isCovered(cited("art. 14 do CDC"), library), true);
    // In capitals too: an article in a heading is that article, never the whole law.
    assert.equal(isCovered(cited("ART. 6º DO CDC"), library), false);
    // Another article of the same law is another citation: an entry of art. 14 says nothing of it.
    assert.equal(isCovered(cited("art. 6º do CDC"), library), false);
    // The law, with no article: the firm verified an article of it.
    assert.equal(isCovered(cited("o CDC"), library), true);
    // The whole norm in the library does not answer for an article nobody read.
    assert.equal(isCovered(cited("art. 927 do Código Civil"), library), false);
    assert.equal(isCovered(cited("o Código Civil"), library), true);
    assert.equal(isCovered(cited("Súmula 387 do STJ"), library), true);
    assert.equal(isCovered(cited("Súmula 387 do STF"), library), false);
    assert.equal(isCovered(cited("Súmula 387"), library), false);
    assert.equal(isCovered(cited("REsp 1.584.465/MG"), library), false);
    // An article with no norm is never verified.
    assert.equal(isCovered(cited("o art. 14 do referido diploma"), library), false);
  });

  it("says why a citation cannot be checked as written", () => {
    const gaps: [string, ReturnType<typeof citationGap>][] = [
      ["art. 14 do CDC", null],
      ["o art. 14 do referido diploma", "no_norm"],
      ["Súmula 387 do STJ", null],
      ["Súmula 387", "no_issuer"],
      ["Tema 1.417", "no_issuer"],
      ["Tema 1.417 da repercussão geral", null],
      ["Resolução nº 400", "no_issuer"],
      ["Resolução nº 400 da ANAC", null],
      ["Enunciado 161", "no_issuer"],
      ["Enunciado 161 do FONAJE", null],
      ["HC 123.456/SP", "no_issuer"],
      ["HC 123.456/SP, STJ", null],
      ["Portaria nº 2.050/2018", "no_issuer"],
      // A decree, and every norm numbered again each year, is of its year.
      ["Decreto nº 5.910", "no_year"],
      ["Decreto nº 5.910/2006", null],
      ["Medida Provisória nº 925", "no_year"],
      ["Portaria nº 2.050 da ANAC", "no_year"],
      // A law and a decision of a class of one court are what they are by their number alone.
      ["Lei nº 9.099", null],
      ["REsp 1.584.465/MG", null],
      ["Súmula Vinculante 10", null],
      ["Emenda Constitucional nº 45", null],
      ["o Provimento nº 61 do CNJ", "unreadable"],
      ["a Lei Estadual nº 20.756/2020", "unreadable"],
    ];
    for (const [text, gap] of gaps) assert.equal(citationGap(cited(text)), gap, text);
    // What a citation with a gap is read into is never in a library: the gap is why.
    assert.equal(isCovered(cited("Súmula 387"), library), false);
    for (const kind of ISSUED_KINDS) assert.ok((LIBRARY_KINDS as readonly string[]).includes(kind), kind);
  });

  it("writes one key for one source, whatever the case of its issuer", () => {
    assert.equal(sourceKey({ kind: "sumula", issuer: "stj", number: "387", article: null }), "sumula:STJ:387");
    assert.equal(sourceKey({ kind: "resolucao", issuer: "ANAC", number: "400", article: "21" }), "resolucao:ANAC:400#21");
    assert.ok(!(LIBRARY_KINDS as readonly string[]).includes("artigo"));
    assert.ok(!(LIBRARY_KINDS as readonly string[]).includes("ilegivel"));
  });
});

describe("how a source is written", () => {
  /** One source of each kind and shape a library holds, and the words it is written in. */
  const sources: [SourceRef, string][] = [
    [{ kind: "lei", issuer: "", number: "8078", article: null }, "Lei nº 8.078"],
    [{ kind: "lei", issuer: "", number: "8078", article: "14" }, "art. 14 da Lei nº 8.078"],
    [{ kind: "lei", issuer: "", number: "8078", article: "6" }, "art. 6º da Lei nº 8.078"],
    [{ kind: "lei", issuer: "", number: "8078", article: "42A" }, "art. 42-A da Lei nº 8.078"],
    [{ kind: "lei", issuer: "", number: "13105", article: "1036" }, "art. 1.036 da Lei nº 13.105"],
    [{ kind: "lei", issuer: "", number: "13105", article: "1036A" }, "art. 1.036-A da Lei nº 13.105"],
    [{ kind: "lei_complementar", issuer: "", number: "123", article: null }, "Lei Complementar nº 123"],
    [{ kind: "lei_complementar", issuer: "", number: "123", article: "3" }, "art. 3º da Lei Complementar nº 123"],
    [{ kind: "constituicao", issuer: "", number: "1988", article: null }, "Constituição Federal"],
    [{ kind: "constituicao", issuer: "", number: "1988", article: "5" }, "art. 5º da Constituição Federal"],
    [{ kind: "decreto", issuer: "", number: "5910/2006", article: null }, "Decreto nº 5.910/2006"],
    [{ kind: "decreto", issuer: "", number: "5910/2006", article: "19" }, "art. 19 do Decreto nº 5.910/2006"],
    [{ kind: "resolucao", issuer: "ANAC", number: "400", article: null }, "Resolução nº 400 da ANAC"],
    [{ kind: "resolucao", issuer: "ANAC", number: "400", article: "21" }, "art. 21 da Resolução nº 400 da ANAC"],
    [{ kind: "resolucao", issuer: "CNJ", number: "125", article: null }, "Resolução nº 125 do CNJ"],
    [{ kind: "resolucao", issuer: "CONTRAN", number: "400", article: null }, "Resolução nº 400 do CONTRAN"],
    [{ kind: "sumula", issuer: "STJ", number: "387", article: null }, "Súmula 387 do STJ"],
    [{ kind: "sumula", issuer: "TJGO", number: "32", article: null }, "Súmula 32 do TJGO"],
    [{ kind: "sumula", issuer: "TRF4", number: "150", article: null }, "Súmula 150 do TRF4"],
    [{ kind: "sumula", issuer: "TNU", number: "45", article: null }, "Súmula 45 da TNU"],
    [{ kind: "sumula_vinculante", issuer: "STF", number: "10", article: null }, "Súmula Vinculante 10"],
    [{ kind: "tema", issuer: "STF", number: "1417", article: null }, "Tema 1.417 do STF"],
    [{ kind: "tema", issuer: "STJ", number: "1068", article: null }, "Tema 1.068 do STJ"],
    [{ kind: "enunciado", issuer: "FONAJE", number: "161", article: null }, "Enunciado 161 do FONAJE"],
    [{ kind: "precedente", issuer: "", number: "RESP 1584465", article: null }, "REsp 1.584.465"],
    [{ kind: "precedente", issuer: "", number: "ARESP 1234567", article: null }, "AREsp 1.234.567"],
    [{ kind: "precedente", issuer: "", number: "EARESP 676608", article: null }, "EAREsp 676.608"],
    [{ kind: "precedente", issuer: "", number: "RE 636331", article: null }, "RE 636.331"],
    [{ kind: "precedente", issuer: "", number: "ARE 766618", article: null }, "ARE 766.618"],
    [{ kind: "precedente", issuer: "STJ", number: "HC 123456", article: null }, "HC 123.456 do STJ"],
    [{ kind: "precedente", issuer: "STF", number: "MS 30000", article: null }, "MS 30.000 do STF"],
    [{ kind: "precedente", issuer: "TJGO", number: "IRDR 5", article: null }, "IRDR 5 do TJGO"],
    [{ kind: "precedente", issuer: "STJ", number: "CC 148519", article: null }, "CC 148.519 do STJ"],
    [{ kind: "precedente", issuer: "STJ", number: "RCL 12345", article: null }, "Rcl 12.345 do STJ"],
    [{ kind: "processo", issuer: "", number: "51234564920998090051", article: null }, "5123456-49.2099.8.09.0051"],
    [{ kind: "norma", issuer: "", number: "MP 925/2020", article: null }, "Medida Provisória nº 925/2020"],
    [{ kind: "norma", issuer: "", number: "MP 925/2020", article: "3" }, "art. 3º da Medida Provisória nº 925/2020"],
    [{ kind: "norma", issuer: "", number: "EC 45", article: null }, "Emenda Constitucional nº 45"],
    [{ kind: "norma", issuer: "", number: "DLG 59/2006", article: null }, "Decreto Legislativo nº 59/2006"],
    [{ kind: "norma", issuer: "", number: "DLG 59/2006", article: "1" }, "art. 1º do Decreto Legislativo nº 59/2006"],
    [{ kind: "norma", issuer: "ANAC", number: "PORTARIA 2050/2018", article: null }, "Portaria nº 2.050/2018 da ANAC"],
    [{ kind: "norma", issuer: "TST", number: "IN 39/2016", article: null }, "Instrução Normativa nº 39/2016 do TST"],
    [{ kind: "norma", issuer: "", number: "REGCE 261/2004", article: null }, "Regulamento (CE) nº 261/2004"],
    [{ kind: "norma", issuer: "", number: "REGCE 261/2004", article: "7" }, "art. 7º do Regulamento (CE) nº 261/2004"],
  ];

  it("writes each kind of source as lawyers do", () => {
    for (const [ref, written] of sources) assert.equal(canonicalCitation(ref), written, sourceKey(ref));
    for (const kind of LIBRARY_KINDS) assert.ok(sources.some(([ref]) => ref.kind === kind), kind);
  });

  it("reads back, into the same key, what it writes: alone, in a sentence, at its end and in a list", () => {
    for (const [ref] of sources) {
      const written = canonicalCitation(ref);
      const key = sourceKey(ref);
      for (const text of [
        written,
        `Conforme ${written}, a companhia responde.`,
        `A companhia responde, conforme ${written}.`,
        `(${written})`,
        `Aplica-se: ${written}; e nada mais.\n\n2. DOS PEDIDOS`,
      ]) {
        assert.deepEqual(read(text), [key], text);
      }
    }
  });
});
