/**
 * The panel beside the court's screen (version 0.2): the lawyer links the extension to their ONE account with the code
 * ONE showed them, sees the batches they approved in ONE for their extension, and starts one on the court's tab where
 * they are logged in with their own login. ONE then files the batch there (`runBatch`): the panel says what it does,
 * asks the lawyer's word before the first button that may send while ONE learns the system, and pauses for what only
 * the lawyer can do. Below, the diagnosis of version 0.1: mapping a screen to a file, never sent by itself.
 *
 * Its words follow the product's rules: plain Portuguese, no dash, no exclamation.
 */
import { chromeApi, type ChromeTab } from "./chrome";
import { tabDriver } from "./driver";

import { type BatchRunEnd, runBatch, type RunPanel } from "@/lib/court-extension/batch-run";
import { COURT_SYSTEMS, courtSystemNames, courtSystemOf } from "@/lib/court-extension/capture";
import { oneApi } from "@/lib/court-extension/one-api";
import type {
  ExtensionBatch,
  ExtensionFile,
  ExtensionFiling,
  ExtensionSystem,
} from "@/lib/filing-ways/extension-protocol";

/** ONE's address, written by `build.mjs`. */
declare const __ONE_URL__: string;

const ext = chromeApi();

type Link = { token: string; lawyer: string; firm: string };
let link: Link | null = null;

const api = oneApi(
  __ONE_URL__,
  () => link?.token ?? null,
  (url, init) => fetch(url, init),
);

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const VIEWS = ["loading", "link", "home", "run", "end"] as const;
type View = (typeof VIEWS)[number];

function show(view: View) {
  for (const name of VIEWS) element(`view-${name}`).hidden = name !== view;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** A lawsuit's twenty digits as the CNJ writes them. */
const cnjOf = (digits: string | null) =>
  digits && digits.length === 20
    ? `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16)}`
    : null;

const caseName = (filing: ExtensionFiling) =>
  [filing.caseSeq ? `Caso ${filing.caseSeq}` : "Ação", filing.client].filter(Boolean).join(" · ");

// ---------- Linking ----------

const LINK_KEY = "oneLink";

async function loadLink(): Promise<Link | null> {
  const stored = (await ext.storage.local.get(LINK_KEY))[LINK_KEY] as Partial<Link> | undefined;
  return stored?.token ? { token: stored.token, lawyer: stored.lawyer ?? "", firm: stored.firm ?? "" } : null;
}

async function forget(said: string) {
  link = null;
  await ext.storage.local.remove(LINK_KEY);
  element("link-said").textContent = said;
  show("link");
}

element("link-go").addEventListener("click", async () => {
  const button = element<HTMLButtonElement>("link-go");
  const code = element<HTMLInputElement>("link-code").value;
  button.disabled = true;
  element("link-said").textContent = "Ligando.";
  const answer = await api.link(code, "Chrome");
  button.disabled = false;
  if (!answer.ok) {
    element("link-said").textContent =
      answer.error === "invalid_code"
        ? "Este código não vale: ele pode ter passado dos 10 minutos. Peça outro em ONE."
        : "Não deu para falar com o ONE agora. Confira sua conexão e tente de novo.";
    return;
  }
  link = answer.value;
  await ext.storage.local.set({ [LINK_KEY]: link });
  element<HTMLInputElement>("link-code").value = "";
  element("link-said").textContent = "";
  await loadHome();
});

// ---------- The batches ----------

async function activeTab(): Promise<ChromeTab | null> {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

const hostOf = (tab: ChromeTab | null) => {
  try {
    return tab?.url ? new URL(tab.url).host : "";
  } catch {
    return "";
  }
};

function batchBox(batch: ExtensionBatch): HTMLElement {
  const box = document.createElement("div");
  box.className = "box";
  const title = document.createElement("h2");
  title.textContent = batch.system.name;
  const count = document.createElement("p");
  count.textContent =
    batch.left === batch.packages
      ? plural(batch.packages, "ação para protocolar", "ações para protocolar")
      : `${plural(batch.left, "ação falta", "ações faltam")} de ${batch.packages}`;
  box.append(title, count);
  if (batch.learning) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = `O ONE ainda aprende o ${batch.system.name}: cada ação para antes de enviar, para você confirmar.`;
    box.append(note);
  }
  if (batch.status === "awaiting_confirmation" || batch.status === "running") {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "Este lote parou no meio de um protocolo. Pare o lote em ONE, em Protocolo, e aprove de novo.";
    box.append(note);
    return box;
  }
  const row = document.createElement("div");
  row.className = "row";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary";
  button.textContent = "Protocolar";
  button.addEventListener("click", () => void startBatch(batch));
  row.append(button);
  box.append(row);
  return box;
}

async function loadHome(said = "") {
  show("loading");
  const answer = await api.situation();
  if (!answer.ok) {
    if (answer.error === "invalid_token" || answer.error === "missing_token") {
      await forget("A extensão foi desligada da sua conta. Ligue de novo com um código novo.");
      return;
    }
    show("home");
    element("home-who").textContent = link ? `Ligada a ${[link.lawyer, link.firm].filter(Boolean).join(" · ")}` : "";
    element("home-batches").replaceChildren();
    element("home-said").textContent = "Não deu para falar com o ONE agora. Confira sua conexão e toque em Atualizar.";
    return;
  }
  const { lawyer, firm, batches } = answer.value;
  element("home-who").textContent = `Ligada a ${[lawyer, firm].filter(Boolean).join(" · ")}`;
  const list = element("home-batches");
  list.replaceChildren();
  if (batches.length === 0) {
    const empty = document.createElement("p");
    empty.textContent =
      "Nenhum lote para protocolar. Aprove os pacotes prontos em ONE, em Protocolo, e eles aparecem aqui.";
    list.append(empty);
  } else {
    for (const batch of batches) list.append(batchBox(batch));
  }
  element("home-said").textContent = said;
  show("home");
}

element("home-refresh").addEventListener("click", () => void loadHome());
element("home-unlink").addEventListener("click", async () => {
  if (!window.confirm("Desligar a extensão desta conta? Para desligar de vez, desligue também em ONE.")) return;
  await forget("Extensão desligada neste navegador.");
});

// ---------- Filing a batch ----------

let stopping = false;
let pendingWord: ((word: "go" | "stop") => void) | null = null;
let pendingPause: ((word: "continue" | "stop") => void) | null = null;

const log = (text: string) => {
  const item = document.createElement("li");
  item.textContent = text;
  element("run-log").append(item);
};

function pauseText(kind: string, question: string | null, system: ExtensionSystem): string {
  if (kind === "login")
    return `O ${system.name} pediu o login. Entre com o seu login na tela do tribunal e toque em Continuar.`;
  if (kind === "code") {
    return `O ${system.name} pediu o código de verificação. Digite o código na tela do tribunal e toque em Continuar.`;
  }
  if (kind === "court_error") {
    return `O tribunal não aceitou um dado${question ? `: ${question}` : ""}. Corrija na tela do tribunal e toque em Continuar.`;
  }
  if (kind === "question") {
    return `O ONE precisa de você${question ? `: ${question}` : ""}. Resolva na tela do tribunal e toque em Continuar.`;
  }
  return "O ONE não conseguiu seguir nesta tela. Faça este passo na tela do tribunal e toque em Continuar.";
}

const STOP_WORDS: Record<string, string> = {
  by_lawyer: "Você parou o lote. As ações que não foram enviadas voltaram para a fila em ONE.",
  not_confirmed: "Você parou o lote antes de enviar. As ações que não foram enviadas voltaram para a fila em ONE.",
  batch_not_running: "O lote foi parado em ONE.",
  not_found: "O lote foi parado em ONE.",
  not_working: "O lote foi parado em ONE.",
  package_outdated: "Um pacote mudou depois de aprovado. Aprove o lote de novo em ONE.",
  package_not_ready: "Um pacote deixou de estar pronto. Veja em ONE, em Protocolo.",
  already_filed: "Uma ação do lote já foi protocolada. Veja em ONE, em Protocolo.",
  not_signed: "Os arquivos de uma ação ainda não estão assinados. Veja em ONE, no caso.",
  not_a_signer: "Você não assina uma das ações do lote. Veja em ONE, em Protocolo.",
  too_many_screens: "O ONE leu telas demais nesta ação e parou. Fale com o suporte do ONE.",
  offline: "Não deu para falar com o ONE. Confira sua conexão; o que não foi enviado volta para a fila em ONE.",
  unavailable: "Não deu para falar com o ONE. Confira sua conexão; o que não foi enviado volta para a fila em ONE.",
};

function showEnd(system: ExtensionSystem, end: BatchRunEnd) {
  element("end-title").textContent =
    end.stopped === null ? `Lote protocolado no ${system.name}` : `O lote parou no ${system.name}`;
  const filed = end.filed > 0 ? `${plural(end.filed, "ação protocolada", "ações protocoladas")}. ` : "";
  element("end-text").textContent =
    end.stopped === null
      ? `${filed}O número e o recibo de cada uma estão no caso, em ONE.`
      : `${filed}${STOP_WORDS[end.stopped] ?? "O lote parou antes do fim. Veja em ONE, em Protocolo."}`;
  element("end-look").hidden = !end.lookFor;
  if (end.lookFor) {
    element("end-look-text").textContent =
      `Não deu para ler a resposta do tribunal depois do envio de ${caseName(end.lookFor)}. Confira no ${system.name} ` +
      "se ela foi distribuída e diga em ONE, no caso, o que encontrou. Nada dela é enviado de novo antes disso.";
  }
  show("end");
}

async function fetchFile(file: ExtensionFile) {
  try {
    const answer = await fetch(file.url);
    if (!answer.ok) return null;
    return { name: file.name, type: file.type, bytes: new Uint8Array(await answer.arrayBuffer()) };
  } catch {
    return null;
  }
}

async function startBatch(batch: ExtensionBatch) {
  const tab = await activeTab();
  if (!tab?.id || hostOf(tab) !== batch.system.host) {
    element("home-said").textContent =
      `Abra o ${batch.system.name} nesta janela, entre com o seu login e toque em Protocolar de novo.`;
    return;
  }
  const started = await api.start(batch.id);
  if (!started.ok) {
    await loadHome(
      started.error === "interrupted"
        ? "Este lote parou no meio de um protocolo. Pare o lote em ONE, em Protocolo, e aprove de novo."
        : started.error === "not_available"
          ? "Este lote já está sendo protocolado, ou acabou. Toque em Atualizar."
          : "Não deu para começar o lote agora. Toque em Atualizar e tente de novo.",
    );
    return;
  }

  stopping = false;
  element("run-title").textContent = `Protocolando no ${batch.system.name}`;
  element("run-now").textContent = "Começando.";
  element("run-log").replaceChildren();
  element("run-word").hidden = true;
  element("run-pause").hidden = true;
  element<HTMLButtonElement>("run-stop").disabled = false;
  show("run");

  const tabId = tab.id;
  const panel: RunPanel = {
    tell(news) {
      if (news.kind === "filing") {
        element("run-now").textContent = `O ONE está preenchendo ${caseName(news.filing)}.`;
      } else if (news.kind === "filed") {
        const number = cnjOf(news.number);
        log(`${caseName(news.filing)}: protocolada${number ? `, processo ${number}` : ""}.`);
      } else {
        element("run-now").textContent = `${caseName(news.filing)} espera a sua palavra.`;
      }
    },
    askWord(point) {
      element("run-word-text").textContent =
        `É um protocolo do ONE no ${batch.system.name} enquanto ele aprende o sistema. Confira a tela do tribunal ao ` +
        `lado: o ONE preencheu ${caseName(point.filing)} e parou antes de apertar ${point.botao || "o botão que envia"}.`;
      element("run-word").hidden = false;
      const word = new Promise<"go" | "stop">((resolve) => {
        pendingWord = resolve;
        if (stopping) resolve("stop");
      });
      return {
        word,
        close: () => {
          pendingWord = null;
          element("run-word").hidden = true;
        },
      };
    },
    pause(pause) {
      element("run-pause-text").textContent = pauseText(pause.kind, pause.question, batch.system);
      element("run-pause").hidden = false;
      return new Promise<"continue" | "stop">((resolve) => {
        pendingPause = (word) => {
          pendingPause = null;
          element("run-pause").hidden = true;
          resolve(word);
        };
        if (stopping) pendingPause("stop");
      });
    },
  };

  let end: BatchRunEnd;
  try {
    end = await runBatch({
      api,
      driver: tabDriver(ext, tabId, () => stopping),
      batchId: batch.id,
      system: batch.system,
      started: started.value,
      fetchFile,
      panel,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      every: (ms, work) => {
        const timer = setInterval(work, ms);
        return () => clearInterval(timer);
      },
    });
  } catch {
    end = { filed: 0, unknown: 0, stopped: "unavailable", lookFor: null };
  }
  showEnd(batch.system, end);
}

element("run-word-go").addEventListener("click", () => pendingWord?.("go"));
element("run-word-stop").addEventListener("click", () => pendingWord?.("stop"));
element("run-pause-go").addEventListener("click", () => pendingPause?.("continue"));
element("run-pause-stop").addEventListener("click", () => pendingPause?.("stop"));
element("run-stop").addEventListener("click", () => {
  stopping = true;
  element<HTMLButtonElement>("run-stop").disabled = true;
  element("run-now").textContent = "Parando o lote.";
  pendingWord?.("stop");
  pendingPause?.("stop");
});
element("end-back").addEventListener("click", () => void loadHome());

// ---------- The diagnosis of version 0.1: mapping a screen to a file ----------

type MapStatus = { ok: boolean; recording?: boolean; screens?: number; steps?: number; last?: string | null };
const ask = (message: Record<string, unknown>) => ext.runtime.sendMessage(message) as Promise<MapStatus>;

function showMap(status: MapStatus) {
  const screens = status.screens ?? 0;
  const steps = status.steps ?? 0;
  element("diag-counts").textContent =
    `${plural(screens, "tela mapeada", "telas mapeadas")} · ${plural(steps, "passo gravado", "passos gravados")}`;
  element("diag-record").textContent = status.recording ? "Parar de gravar" : "Gravar o caminho";
  element<HTMLButtonElement>("diag-download").disabled = screens === 0 && steps === 0;
  element<HTMLButtonElement>("diag-clear").disabled = screens === 0 && steps === 0;
}

async function diagnosisTab() {
  const tab = await activeTab();
  const system = courtSystemOf(hostOf(tab));
  element("diag-where").textContent =
    system && typeof tab?.id === "number"
      ? `${COURT_SYSTEMS[system].name}. Vá até a tela que quer mapear.`
      : `Abra ${courtSystemNames()} nesta janela e entre com o seu login.`;
  return system && typeof tab?.id === "number" ? tab.id : null;
}

element("diagnosis").addEventListener("toggle", async () => {
  if (!element<HTMLDetailsElement>("diagnosis").open) return;
  await diagnosisTab();
  showMap(await ask({ type: "status" }));
});

element("diag-map").addEventListener("click", async () => {
  const tabId = await diagnosisTab();
  if (tabId === null) return;
  const answer = await ask({ type: "capture", tabId });
  element("diag-said").textContent = answer.ok
    ? `Tela mapeada${answer.last ? `: ${answer.last}` : ""}.`
    : "Não encontrei uma tela do tribunal nesta aba. Recarregue a página e tente de novo.";
  showMap(await ask({ type: "status" }));
});

element("diag-record").addEventListener("click", async () => {
  const tabId = await diagnosisTab();
  const status = await ask({ type: "status" });
  const answer = await ask({ type: "record", tabId, on: !status.recording });
  element("diag-said").textContent = answer.recording
    ? "Gravando o caminho: cada clique e cada campo preenchido, sem o que foi digitado."
    : "Gravação parada.";
  showMap(await ask({ type: "status" }));
});

element("diag-download").addEventListener("click", async () => {
  const answer = (await ext.runtime.sendMessage({ type: "export" })) as { ok: boolean; file?: unknown };
  if (!answer.ok || !answer.file) return;
  const blob = new Blob([JSON.stringify(answer.file, null, 2)], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `one-mapa-de-telas-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 10_000);
  element("diag-said").textContent = "Mapa baixado.";
});

element("diag-clear").addEventListener("click", async () => {
  if (!window.confirm("Apagar as telas mapeadas e o caminho gravado?")) return;
  await ask({ type: "clear" });
  element("diag-said").textContent = "Mapa apagado.";
  showMap(await ask({ type: "status" }));
});

// ---------- Opening ----------

async function open() {
  link = await loadLink();
  if (!link) {
    show("link");
    return;
  }
  await loadHome();
}

void open();
