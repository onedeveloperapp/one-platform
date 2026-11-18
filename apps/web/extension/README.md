# ONE's browser extension: filing in the lawyer's own session

The owner's choice of 2026-11-18: ONE's robot on a court's screen runs **in the lawyer's own browser, on the session the lawyer opened with their own login, password and second factor**, never on ONE's servers with the lawyer's credentials. The TJGO writes that the password and the key are "de uso pessoal e intransferível" (Resolução TJGO 59/2016, art. 11), the courts ask a second factor at every login (Projudi: a code by e-mail; eproc of TJRJ: an authenticator app), and a credential handed to ONE would be a credential transferred, whatever the lawyer consented to. In the lawyer's browser nothing of the login passes through ONE: the lawyer enters, and the extension does the typing.

It lives inside `apps/web` as the clock does (`apps/web/clock/`): its logic is the app's code (`src/lib/court-extension/`, tested by vitest in jsdom), its glue is here, and `build.mjs` bundles it with esbuild.

## Version 0.1: mapping the screens

The filing itself is written against each system's real screen, which ONE has not seen: v0.1 only maps it, while a lawyer files by hand.

- **Map this screen** (`Mapear esta tela`): the structure of the page in every frame (the Projudi draws some screens in frames): each field with its label, type, id, name and a selector to find it again; each select's own list (codes and names); each button and each step link; each table's column names and its number of rows; the headings; the parameters of the address that name the screen (`acao`, `PaginaAtual`).
- **Record the path** (`Gravar o caminho`): each click on a button, a link, a checkbox or a file field, and each change, in order: which field, the code chosen from a system's own list, whether a box was left ticked. A text field says only that it was filled.
- **Save the map** (`Baixar o mapa`): a JSON file the lawyer sends to ONE. The extension talks to no server.

What is never kept, as code (`capture.ts`, and its tests): a field's value; a hidden field (they carry the session's tokens); a list of people (a select whose label or name speaks of a party, a lawyer, a user: only its size); a row of a table; a link inside a table or that names a file; a hash, a token or a number in the address; and, in any text kept, an e-mail or a run of ten digits or more (a CPF, a CNPJ, a lawsuit's number).

### Build, load, check

1. `node apps/web/extension/build.mjs` writes `apps/web/extension/dist/` (git-ignored).
2. In Chrome, `chrome://extensions`, turn on the developer mode, "Carregar sem compactação", and choose `dist/`. To send it to a lawyer, zip `dist/` (`Compress-Archive apps/web/extension/dist one-extensao.zip`).
3. `node apps/web/extension/smoke.mjs` loads `dist/` in Playwright's Chromium and drives it against a stand-in of the eproc's first step served in place of `eproc1g.tjrj.jus.br` (no request reaches the court), with a frame: both frames mapped, the path recorded without what was typed, nothing of a value, a token or a person in the file, nothing recorded once stopped.

The hosts it may touch are only the systems it knows: `manifest.json` and `COURT_SYSTEMS` in `capture.ts` say the same (a test checks it). Its permissions are `storage` (the map being made, in the browser's session) and `scripting` (reading the frames when the lawyer asks).

## The systems

- **Projudi of TJGO** (`projudi.tjgo.jus.br`): the lawyer enters with CPF and password and a code of six characters sent to their e-mail (valid five minutes), with the PDPJ, or with a certificate. Its screens for a new lawsuit are not in any manual found: the first map is the pilot firm's filing of 2026-11-20. The files go already signed (`.p7s`), which ONE does with the lawyer's cloud signature (`package-signature-work.ts`).
- **eproc of TJRJ** (`eproc1g.tjrj.jus.br`): login, password and an authenticator app's code, with "Não usar o 2FA neste dispositivo e navegador" for a trusted device. From TJRJ's own manual for lawyers (v1.0): the menu "Petição inicial", then "Peticionamento Eletrônico" in five steps: (1) Informações do processo ("Desejo entrar com a ação em", "Rito", "Área", "Classe processual", "Nível de Sigilo do Processo", "Valor da Causa" or "Não se aplica", "+ Incluir outros advogados" by login or OAB), (2) Assuntos (a tree, "Assuntos Selecionados", "Incluir"), (3) Partes autores and (4) Partes réus (a search by "Tipo Pessoa", CPF or CNPJ, "Consultar", "Incluir"; a person the court does not know is registered in "Cadastro de Pessoa Física" with address and contacts), (5) Documentos ("Informações de Custas" with the GRERJ or the "Motivo para não recolhimento", "Informações Adicionais" with the priorities and "Opção por Juízo 100% Digital", "Conciliação", one "Escolher arquivo" per document with its "Tipo" and "Sigilo", "Confirmar seleção de documentos"), and then "Finalizar", which gives the receipt, or "Salvar para Distribuição Futura". eproc takes plain PDFs: the act is the login's. The civil courts are on eproc; TJRJ's small-claims courts move to it by groups (Aviso Conjunto TJ/CGJ 38/2026: some units of the Capital on 2026-10-29, others on 2027-01-22), the rest staying on the legacy DCP until then, where the filing stays assisted.

## The courts' written rules (checked before a screen is automated)

- **The CNJ, for every court:** "O Conselho Nacional de Justiça, o Conselho da Justiça Federal, o Conselho Superior da Justiça do Trabalho e os tribunais a eles vinculados poderão limitar ou bloquear o acesso a sistemas ou serviços, via API ou não, caso identificado comportamento inautêntico ou consumo abusivo de dados por parte do usuário", inauthentic being, among others, "utilização de rotinas automatizadas que simulem o comportamento humano" and "uso de técnicas ou soluções projetadas para burlar regras e restrições do sistema" (Portaria Presidência 316/2024, art. 9, § 1, II and V; the act's object is the CNJ's datalake, but this article speaks of any system). It does not forbid; it lets the court block the lawyer's access. Version 0.1 is outside it: it reads the page when the lawyer clicks and sends the court nothing. It bears on the filing: see "Next".
- **TJGO:** the credentials are personal and non-transferable (Resolução 59/2016, art. 11), which the extension never touches; no rule of the TJGO's own against automation was found, and the tribunal blocks by behaviour.
- **TJRJ:** the credentials are personal and non-transferable (Ato Normativo TJ 9/2010, for the court's systems, and the security page of the portal); no written rule on robots was found. The act that rules eproc's use and governance, **Aviso Normativo Conjunto TJ/CGJ 19/2026**, sits behind a check of the TJRJ's site that a script cannot pass and was not read: it is read before the TJRJ filing is turned on.

## Next: the filing (version 0.2, after the maps)

Written once the maps exist, never against a guess:

- The lawyer links the extension to their ONE account once (a code shown in ONE, at the second factor), revocable there; the extension holds that link and nothing of the court's login.
- ONE lists to the extension the packages ready for that lawyer in that system; the lawyer confirms the batch.
- Each filing is claimed in ONE before the first field is typed (`filing_submissions`, as the MNI does): one that may have reached the court with no answer read is `unknown`, never sent again until the lawyer says the court's system does not have it.
- The extension fills and sends the whole batch by itself once the lawyer confirms it (the owner's choice of 2026-11-18, accepting the risk of art. 9 above: a court may limit or block the lawyer's access). It never disguises itself nor works around a court's restrictions (no captcha solved, no limit dodged, nothing made to look like a person: item V); its pace is set by what the court's system takes. It attaches the package's files and brings the number and the receipt back to the case, and a screen that is not the mapped one stops it, with what it found.
