/**
 * The popup the lawyer opens on the court's page: map this screen, record the path, save the map as a file, start
 * again. Its words follow the product's rules: plain Portuguese, no dash, no exclamation.
 */
import { chromeApi } from "./chrome";

import { COURT_SYSTEMS, courtSystemOf } from "@/lib/court-extension/capture";

const ext = chromeApi();

type Status = {
  ok: boolean;
  recording?: boolean;
  screens?: number;
  steps?: number;
  last?: string | null;
  code?: string;
};

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const where = element<HTMLParagraphElement>("where");
const court = element<HTMLElement>("court");
const said = element<HTMLParagraphElement>("said");
const counts = element<HTMLParagraphElement>("counts");
const mapButton = element<HTMLButtonElement>("map");
const recordButton = element<HTMLButtonElement>("record");
const downloadButton = element<HTMLButtonElement>("download");
const clearButton = element<HTMLButtonElement>("clear");

const ask = (message: Record<string, unknown>) => ext.runtime.sendMessage(message) as Promise<Status>;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function show(status: Status) {
  const screens = status.screens ?? 0;
  const steps = status.steps ?? 0;
  counts.textContent = `${plural(screens, "tela mapeada", "telas mapeadas")} · ${plural(steps, "passo gravado", "passos gravados")}`;
  recordButton.textContent = status.recording ? "Parar de gravar" : "Gravar o caminho";
  downloadButton.disabled = screens === 0 && steps === 0;
  clearButton.disabled = screens === 0 && steps === 0;
}

async function start() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  const system = tab?.url ? courtSystemOf(new URL(tab.url).host) : null;
  if (system && typeof tab?.id === "number") {
    where.textContent = `${COURT_SYSTEMS[system].name}. Entre com o seu login e vá até a tela que quer mapear.`;
    court.hidden = false;
  } else {
    where.textContent = "Abra o Projudi do TJGO ou o eproc do TJRJ e entre com o seu login.";
  }
  show(await ask({ type: "status" }));

  mapButton.addEventListener("click", async () => {
    mapButton.disabled = true;
    const answer = await ask({ type: "capture", tabId: tab?.id });
    mapButton.disabled = false;
    said.textContent = answer.ok
      ? `Tela mapeada${answer.last ? `: ${answer.last}` : ""}.`
      : "Não encontrei uma tela do tribunal nesta aba. Recarregue a página e tente de novo.";
    show(await ask({ type: "status" }));
  });

  recordButton.addEventListener("click", async () => {
    const status = await ask({ type: "status" });
    const answer = await ask({ type: "record", tabId: tab?.id, on: !status.recording });
    said.textContent = answer.recording
      ? "Gravando o caminho: cada clique e cada campo preenchido, sem o que foi digitado."
      : "Gravação parada.";
    show(await ask({ type: "status" }));
  });

  downloadButton.addEventListener("click", async () => {
    const answer = (await ext.runtime.sendMessage({ type: "export" })) as { ok: boolean; file?: unknown };
    if (!answer.ok || !answer.file) return;
    const blob = new Blob([JSON.stringify(answer.file, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `one-mapa-de-telas-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    said.textContent = "Mapa baixado. Envie o arquivo ao ONE.";
  });

  clearButton.addEventListener("click", async () => {
    if (!window.confirm("Apagar as telas mapeadas e o caminho gravado?")) return;
    await ask({ type: "clear" });
    said.textContent = "Mapa apagado.";
    show(await ask({ type: "status" }));
  });
}

void start();
