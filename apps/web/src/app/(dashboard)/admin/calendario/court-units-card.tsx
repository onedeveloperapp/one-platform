"use client";

import { findCourtUnits, saveCourtUnitProfile } from "./court-unit-actions";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import type { CourtUnit } from "@/lib/admin/court-units";

const KIND_LABEL: Record<CourtUnit["kind"], string> = { juizado: "Juizado especial", comum: "Vara cível" };
const PROFILE_LABEL: Record<string, string> = {
  required: "Pede reclamação antes da ação",
  not_required: "Não pede reclamação",
  none: "Sem perfil",
};
const CODE_TEXT: Record<string, string> = {
  forbidden: "Esta sessão não pode mudar as unidades.",
  invalid_value: "Algum valor não foi aceito.",
  note_required: "Diga onde o perfil foi lido (as decisões da unidade), com pelo menos 8 letras.",
  not_found: "Unidade não encontrada.",
  invalid_profile: "Perfil não aceito.",
};

/**
 * The units of each comarca (migrations 0179 and 0180): ONE addresses each planned lawsuit to the unit of its comarca
 * and kind, and a unit whose profile says it asks a complaint before the lawsuit holds the piece until the client made
 * one. The operator finds a comarca's units, writes whether each asks it, with where that was read, and marks a unit
 * checked against the court's acts. Reference data: nothing of a firm.
 */
export default function CourtUnitsCard({ profiled }: { profiled: CourtUnit[] | null }) {
  const router = useRouter();
  const [court, setCourt] = useState("TJGO");
  const [comarca, setComarca] = useState("");
  const [found, setFound] = useState<CourtUnit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const search = async () => {
    setSearching(true);
    setNotice(null);
    const rows = await findCourtUnits(court.trim().toUpperCase(), comarca);
    setSearching(false);
    if (rows === null) setNotice({ tone: "error", text: "Não foi possível ler as unidades agora." });
    setFound(rows ?? []);
  };

  return (
    <Card component="section" aria-labelledby="court-units">
      <CardContent className="flex flex-col gap-4">
        <Box>
          <Typography id="court-units" variant="h6" component="h2" className="mb-1">
            Unidades e reclamação prévia
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            O ONE endereça cada processo à unidade da comarca. Onde a unidade pede reclamação antes da ação, a peça
            espera o cliente fazer a reclamação no consumidor.gov.br.
          </Typography>
        </Box>
        {notice ? (
          <Alert severity={notice.tone} className="neutral bg-background-paper/60!" onClose={() => setNotice(null)}>
            {notice.text}
          </Alert>
        ) : null}
        <Box
          component="form"
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <TextField
            size="small"
            label="Tribunal"
            value={court}
            onChange={(event) => setCourt(event.target.value)}
            className="w-28"
          />
          <TextField
            size="small"
            label="Comarca"
            value={comarca}
            onChange={(event) => setComarca(event.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="outlined" color="grey" disabled={searching}>
            {searching ? "Buscando" : "Buscar"}
          </Button>
        </Box>
        {found !== null ? (
          found.length === 0 ? (
            <Typography variant="body2" className="text-text-secondary">
              Nenhuma unidade com esse começo de comarca.
            </Typography>
          ) : (
            <Box className="flex flex-col gap-2">
              {found.map((unit) => (
                <UnitRow
                  key={unit.id}
                  unit={unit}
                  onSaved={(text) => {
                    setNotice({ tone: "success", text });
                    router.refresh();
                    void search();
                  }}
                  onFailed={(text) => setNotice({ tone: "error", text })}
                />
              ))}
            </Box>
          )
        ) : null}
        <Box className="flex flex-col gap-2">
          <Typography variant="subtitle2" component="h3" className="mb-0">
            Unidades com perfil escrito
          </Typography>
          {profiled === null ? (
            <Typography variant="body2" className="text-text-secondary">
              Não foi possível ler os perfis agora.
            </Typography>
          ) : profiled.length === 0 ? (
            <Typography variant="body2" className="text-text-secondary">
              Nenhuma unidade tem perfil ainda: nenhuma pede reclamação antes da ação.
            </Typography>
          ) : (
            profiled.map((unit) => (
              <Box key={unit.id} className="flex flex-wrap items-center justify-between gap-2">
                <Typography variant="body2">
                  {unit.court} · {unit.name}
                </Typography>
                <StatusChip
                  tone={unit.priorComplaint === "required" ? "attention" : "info"}
                  label={PROFILE_LABEL[unit.priorComplaint ?? "none"] ?? ""}
                />
              </Box>
            ))
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

function UnitRow({
  unit,
  onSaved,
  onFailed,
}: {
  unit: CourtUnit;
  onSaved: (text: string) => void;
  onFailed: (text: string) => void;
}) {
  const [profile, setProfile] = useState<string>(unit.priorComplaint ?? "none");
  const [note, setNote] = useState(unit.profileNote ?? "");
  const [confirmed, setConfirmed] = useState(unit.confirmed);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const result = await saveCourtUnitProfile({
      unitId: unit.id,
      priorComplaint: profile === "required" || profile === "not_required" ? profile : null,
      note,
      confirmed,
    });
    setBusy(false);
    if (result.ok) onSaved(`${unit.name}: salvo.`);
    else onFailed(CODE_TEXT[result.code] ?? "Não foi possível salvar agora.");
  };

  return (
    <Box className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-3">
      <Box className="flex flex-wrap items-start justify-between gap-2">
        <Box className="flex min-w-0 flex-col">
          <Typography variant="body2" className="font-semibold">
            {unit.name}
          </Typography>
          <Typography variant="caption" className="text-text-secondary">
            {KIND_LABEL[unit.kind]} · {unit.confirmed ? "Conferida nos atos do tribunal" : "Não conferida"}
          </Typography>
        </Box>
      </Box>
      <Box className="flex flex-wrap gap-2">
        <TextField
          select
          size="small"
          label="Perfil"
          value={profile}
          onChange={(event) => setProfile(event.target.value)}
          className="min-w-56"
        >
          {Object.entries(PROFILE_LABEL).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Onde foi lido"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="min-w-0 flex-1"
          slotProps={{ htmlInput: { maxLength: 2000 } }}
        />
      </Box>
      <Box className="flex flex-wrap items-center justify-between gap-2">
        <FormControlLabel
          control={<Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />}
          label="Unidade conferida nos atos do tribunal"
        />
        <Button variant="contained" size="small" disabled={busy} onClick={() => void save()}>
          {busy ? "Salvando" : "Salvar"}
        </Button>
      </Box>
    </Box>
  );
}
