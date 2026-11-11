"use client";

import { readOabXray } from "../xray-actions";
import { type ReactNode, useState } from "react";

import { Alert, Box, Button, MenuItem, TextField, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import InfoHint from "@/components/product/info-hint";
import MetricBars from "@/components/product/metric-bars";
import { formatNumber } from "@/lib/admin/format";
import type { Xray } from "@/lib/publications/xray";

const UFS = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
];

const FAILURE: Record<string, string> = {
  off: "Este ambiente não lê o DJEN, então o raio-x não consulta nada aqui.",
  invalid: "Essa inscrição não é uma inscrição válida.",
  too_many: "A inscrição tem publicações demais para uma leitura: tente menos dias.",
  rate_limited: "O DJEN limitou as consultas agora. Tente de novo em um minuto.",
  unavailable: "O DJEN não respondeu agora.",
  forbidden: "Só o operador lê o raio-x.",
};

/**
 * The x-ray by the OAB (M6): what the DJEN published of one registration at the bar in the last days, in numbers only
 * (communications, lawsuits, by court, kind of lawsuit, month and the airline the texts name), to show a firm what its
 * portfolio looks like before it arrives, or to plan its migration. Read at that moment; nothing is kept.
 */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box className="flex flex-col gap-2">
      <Typography variant="subtitle2" component="h3">
        {title}
      </Typography>
      {children}
    </Box>
  );
}

export default function OabXrayCard() {
  const [uf, setUf] = useState("GO");
  const [number, setNumber] = useState("");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [xray, setXray] = useState<{ xray: Xray; days: number } | null>(null);

  const read = async () => {
    setBusy(true);
    setProblem(null);
    setXray(null);
    const answer = await readOabXray(uf, number, days).catch(() => ({ ok: false as const, code: "unavailable" }));
    setBusy(false);
    if (answer.ok) setXray({ xray: answer.xray, days: answer.days });
    else setProblem(FAILURE[answer.code] ?? FAILURE.unavailable!);
  };

  return (
    <CollapsibleCard
      id="ai-oab-xray"
      title="Raio-x pela OAB"
      chip={
        <InfoHint label="Lê no DJEN as publicações de uma inscrição na OAB nos últimos dias e mostra só números: processos, tribunais, tipos de ação, meses e companhias. Nada é guardado." />
      }
      summary="Os processos de um advogado pelo DJEN, para planejar a migração de um escritório"
      bodyClassName="gap-4"
    >
      <Box className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <TextField
          select
          size="small"
          label="UF"
          value={uf}
          onChange={(event) => setUf(event.target.value)}
          className="sm:w-28"
        >
          {UFS.map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Número da inscrição"
          value={number}
          onChange={(event) => setNumber(event.target.value.replace(/[^0-9A-Za-z]/g, "").slice(0, 10))}
          className="sm:w-56"
        />
        <TextField
          select
          size="small"
          label="Período"
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
          className="sm:w-40"
        >
          {[15, 30, 60, 90].map((option) => (
            <MenuItem key={option} value={option}>
              {`${option} dias`}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" disabled={busy || number.length < 2} onClick={() => void read()}>
          {busy ? "Lendo o DJEN" : "Ler o raio-x"}
        </Button>
      </Box>
      {problem ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {problem}
        </Alert>
      ) : null}
      {xray ? (
        <Box className="flex flex-col gap-4">
          <Typography variant="body1">
            {`${formatNumber(xray.xray.lawsuits)} processos e ${formatNumber(xray.xray.communications)} publicações de ${uf} ${number} nos últimos ${xray.days} dias.`}
          </Typography>
          {xray.xray.lawsuits > 0 ? (
            <>
              <Group title="Por tipo de ação">
                <MetricBars
                  items={[
                    { key: "juizado", label: "Juizado especial", value: xray.xray.byKind.juizado },
                    { key: "comum", label: "Vara cível", value: xray.xray.byKind.comum },
                    { key: "other", label: "Outro ou não dito", value: xray.xray.byKind.other, tone: "empty" },
                  ]}
                />
              </Group>
              <Group title="Por tribunal">
                <MetricBars
                  total={xray.xray.lawsuits}
                  items={xray.xray.byCourt
                    .slice(0, 8)
                    .map((row) => ({ key: row.court, label: row.court, value: row.lawsuits }))}
                />
              </Group>
              {xray.xray.byAirline.length > 0 ? (
                <Group title="Por companhia que os textos nomeiam">
                  <MetricBars
                    total={xray.xray.lawsuits}
                    items={xray.xray.byAirline
                      .slice(0, 8)
                      .map((row) => ({ key: row.iata, label: row.name, value: row.lawsuits }))}
                  />
                </Group>
              ) : null}
              <Group title="Publicações por mês">
                <MetricBars
                  whole={false}
                  items={xray.xray.byMonth.map((row) => ({
                    key: row.month,
                    label: row.month.split("-").reverse().join("/"),
                    value: row.communications,
                  }))}
                />
              </Group>
            </>
          ) : null}
        </Box>
      ) : null}
    </CollapsibleCard>
  );
}
