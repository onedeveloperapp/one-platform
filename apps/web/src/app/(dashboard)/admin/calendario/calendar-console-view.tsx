"use client";

import {
  type CalendarResult,
  removeCalendarDay,
  removeCalendarYear,
  removeCourtNote,
  saveCalendarDay,
  saveCalendarYear,
  saveCourtNote,
  saveDeadlineAct,
} from "./actions";
import CourtSystemsCard from "./court-systems-card";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Grid,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import ComparisonTable from "@/components/product/comparison-table";
import DialogHeader from "@/components/product/dialog-header";
import EmptyState from "@/components/product/empty-state";
import PageHeader from "@/components/product/page-header";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import NiCalendar from "@/icons/nexture/ni-calendar";
import type {
  CalendarConsole,
  CalendarDayRecord,
  CalendarYearRecord,
  CourtNoteRecord,
  DeadlineActRecord,
} from "@/lib/admin/calendar";
import type { CourtSystemRefusal } from "@/lib/admin/court-systems";
import type { ConsoleState } from "@/lib/admin/session";
import { todayInBrasilia, weekdayOf } from "@/lib/deadlines/deadlines";
import { formatDayBr } from "@flyee/rules/person";

type State = ConsoleState<{ calendar: CalendarConsole; thisYear: number; systems: CourtSystemRefusal[] | null }>;

const KIND_LABEL: Record<CalendarDayRecord["kind"], string> = {
  closed: "Sem expediente",
  partial: "Expediente parcial",
  suspended: "Prazos suspensos",
};
const KIND_TONE: Record<CalendarDayRecord["kind"], StatusTone> = {
  closed: "neutral",
  partial: "attention",
  suspended: "info",
};
const SYSTEMS = ["projudi", "eproc", "pje", "esaj", "outro"] as const;
const CODE_TEXT: Record<string, string> = {
  forbidden: "Esta sessão não pode mudar o calendário.",
  court_not_found: "Tribunal não encontrado.",
  invalid_value: "Algum valor não foi aceito. Confira as datas, o endereço (https) e os nomes.",
  duplicate: "Esse dia já está no calendário com o mesmo nome.",
  not_found: "Não encontrado: a tela pode estar desatualizada.",
  unknown_court: "Tribunal não encontrado.",
  sources_unreadable:
    "Alguma fonte não foi lida. Use uma linha por fonte: descrição, depois o endereço que começa com https://.",
};
const failure = (code: string) => CODE_TEXT[code] ?? "Não foi possível salvar agora.";
const day = (value: string) => formatDayBr(value) ?? value;

/**
 * The forensic calendar every firm's deadlines are counted over. The
 * operator comes here when a court publishes its holidays for a year, or
 * decrees a day off or a suspension during it: success is every court the
 * firms work in with this year and the next checked against its act. A
 * change here has every open deadline of that court counted again, and a
 * confirmed one whose count changes is shown to its firm.
 */
export default function CalendarConsoleView({ state }: { state: State }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [editingYear, setEditingYear] = useState(false);
  const [addingDay, setAddingDay] = useState(false);
  const [editingAct, setEditingAct] = useState<DeadlineActRecord | "new" | null>(null);
  const [editingNote, setEditingNote] = useState<CourtNoteRecord | "new" | null>(null);
  const [removingNote, setRemovingNote] = useState<string | null>(null);

  if (state.kind !== "ready") {
    return (
      <Box className="flex flex-col gap-6">
        <PageHeader
          title="Calendário forense"
          crumbs={[{ label: "Admin", href: "/admin" }, { label: "Calendário forense" }]}
        />
        <Alert severity={state.kind === "error" ? "error" : "info"} className="neutral bg-background-paper/60!">
          {state.kind === "error"
            ? "Não foi possível ler o calendário agora."
            : "O console não está disponível nesta sessão."}
        </Alert>
      </Box>
    );
  }

  const { calendar, thisYear } = state;
  const checked = calendar.years.find((year) => year.court === calendar.court && year.year === calendar.year) ?? null;
  const go = (court: string, year: number) => router.push(`/admin/calendario?tribunal=${court}&ano=${year}`);
  const done = (result: CalendarResult, what: string) => {
    if (!result.ok) {
      setNotice({ tone: "error", text: failure(result.code) });
      return false;
    }
    const recounted = result.recounted ?? 0;
    setNotice({
      tone: "success",
      text: `${what}${recounted > 0 ? ` ${recounted} ${recounted === 1 ? "prazo aberto vai ser contado" : "prazos abertos vão ser contados"} de novo.` : ""}`,
    });
    refresh();
    return true;
  };

  const coverageCourts = calendar.courts.filter(
    (court) => court.acronym === calendar.court || calendar.years.some((year) => year.court === court.acronym),
  );

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title="Calendário forense"
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Calendário forense" }]}
        description="Os dias sem expediente, de prazos suspensos e de expediente parcial de cada tribunal, conferidos no ato do próprio tribunal. Os prazos dos escritórios são contados sobre eles."
      />

      {notice ? (
        <Alert
          severity={notice.tone}
          role="status"
          className="neutral bg-background-paper/60!"
          onClose={() => setNotice(null)}
        >
          {notice.text}
        </Alert>
      ) : null}

      <Card component="section" aria-labelledby="calendar-coverage">
        <CardContent className="flex flex-col gap-4">
          <Typography id="calendar-coverage" variant="h5" component="h2" className="mb-0">
            Anos conferidos
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            Um ano não conferido conta só os fins de semana, os feriados nacionais e a suspensão de 20/12 a 20/01, e o
            prazo diz isso a quem confirma.
          </Typography>
          <ComparisonTable
            caption="Anos do calendário conferidos por tribunal"
            rowHeader="Tribunal"
            columns={[thisYear, thisYear + 1].map((year) => ({ key: String(year), label: String(year) }))}
            rows={coverageCourts.map((court) => ({
              key: court.acronym,
              label: court.acronym,
              note: court.name,
              cells: [thisYear, thisYear + 1].map((year) => {
                const found = calendar.years.find((item) => item.court === court.acronym && item.year === year);
                return found
                  ? { primary: "Conferido", secondary: `em ${day(found.checkedOn)}` }
                  : { primary: "Não conferido" };
              }),
            }))}
          />
          <Box className="flex flex-wrap items-end gap-3">
            <TextField
              select
              size="small"
              label="Tribunal"
              value={calendar.court}
              onChange={(event) => go(event.target.value, calendar.year)}
              className="min-w-40"
            >
              {calendar.courts.map((court) => (
                <MenuItem key={court.acronym} value={court.acronym}>
                  {court.acronym}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Ano"
              value={calendar.year}
              onChange={(event) => go(calendar.court, Number(event.target.value))}
              className="min-w-28"
            >
              {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((year) => (
                <MenuItem key={year} value={year}>
                  {year}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        </CardContent>
      </Card>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 5 }} className="flex flex-col gap-3">
          <Card component="section" aria-labelledby="calendar-year">
            <CardContent className="flex flex-col gap-3">
              <Typography id="calendar-year" variant="h5" component="h2" className="mb-0">
                {calendar.court} em {calendar.year}
              </Typography>
              {checked ? (
                <>
                  <StatusChip tone="positive" label={`Conferido em ${day(checked.checkedOn)}`} />
                  <Typography variant="body2">
                    <a href={checked.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                      {checked.sourceTitle ?? checked.sourceUrl}
                    </a>
                  </Typography>
                  <Typography variant="body2">
                    {checked.allComarcas
                      ? "Traz os dias próprios de todas as comarcas."
                      : checked.comarcas.length > 0
                        ? `Traz os dias próprios destas comarcas: ${checked.comarcas.join(", ")}.`
                        : "Não traz os dias próprios de nenhuma comarca."}
                  </Typography>
                  {checked.note ? (
                    <Typography variant="body2" className="text-text-secondary">
                      {checked.note}
                    </Typography>
                  ) : null}
                  <Box className="flex flex-wrap gap-2">
                    <Button variant="outlined" color="grey" size="small" onClick={() => setEditingYear(true)}>
                      Editar a conferência
                    </Button>
                    <Button
                      variant="text"
                      color="grey"
                      size="small"
                      onClick={async () =>
                        done(await removeCalendarYear(calendar.court, calendar.year), "O ano voltou a não conferido.")
                      }
                    >
                      Tirar a conferência
                    </Button>
                  </Box>
                </>
              ) : (
                <EmptyState
                  icon={<NiCalendar size="large" />}
                  title={`O ano de ${calendar.year} do ${calendar.court} não foi conferido`}
                  description="Leia o ato do tribunal com os feriados e pontos facultativos do ano, registre os dias abaixo e então a conferência, com o endereço do ato."
                  action={{ label: "Registrar a conferência", onClick: () => setEditingYear(true) }}
                />
              )}
            </CardContent>
          </Card>

          <Card component="section" aria-labelledby="calendar-acts">
            <CardContent className="flex flex-col gap-3">
              <Box className="flex flex-wrap items-center gap-2">
                <Typography id="calendar-acts" variant="h5" component="h2" className="mb-0 min-w-0 flex-1">
                  Atos e seus prazos
                </Typography>
                <Button variant="outlined" color="grey" size="small" onClick={() => setEditingAct("new")}>
                  Adicionar ato
                </Button>
              </Box>
              <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
                {calendar.acts.map((act) => (
                  <Box
                    component="li"
                    key={act.slug}
                    className="border-grey-100 flex flex-wrap items-center gap-2 border-b pb-2"
                  >
                    <Box className="min-w-0 flex-1">
                      <Typography variant="body2" className="font-semibold">
                        {act.name} · {act.days} {act.counting === "business" ? "dias úteis" : "dias corridos"}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary">
                        {[
                          act.basis,
                          act.proceedingKinds.join(", ") || "juizado e vara",
                          act.active ? null : "fora da lista",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Typography>
                    </Box>
                    <Button variant="text" color="grey" size="small" onClick={() => setEditingAct(act)}>
                      Editar
                    </Button>
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>

          <Card component="section" aria-labelledby="calendar-notes" className="mt-6">
            <CardContent className="flex flex-col gap-3">
              <Box className="flex flex-wrap items-center gap-2">
                <Typography id="calendar-notes" variant="h5" component="h2" className="mb-0 min-w-0 flex-1">
                  Família dividida: o que cada tribunal decidiu
                </Typography>
                <Button variant="outlined" color="grey" size="small" onClick={() => setEditingNote("new")}>
                  Adicionar tribunal
                </Button>
              </Box>
              <Typography variant="body2" className="text-text-secondary">
                Dito ao advogado que escolhe dividir uma família entre juizado e vara cível, no tribunal do domicílio.
              </Typography>
              {calendar.notes.length === 0 ? (
                <Typography variant="body2" className="text-text-secondary">
                  Nenhum tribunal tem decisões registradas.
                </Typography>
              ) : (
                <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
                  {calendar.notes.map((note) => (
                    <Box
                      component="li"
                      key={note.court}
                      className="border-grey-100 flex flex-wrap items-center gap-2 border-b pb-2"
                    >
                      <Box className="min-w-0 flex-1">
                        <Typography variant="body2" className="font-semibold">
                          {note.court} · {note.stance === "against" ? "contra a divisão" : "decisões divergentes"}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          Lido em {day(note.readOn)} · {note.sources.length}{" "}
                          {note.sources.length === 1 ? "fonte" : "fontes"}
                        </Typography>
                      </Box>
                      <Button variant="text" color="grey" size="small" onClick={() => setEditingNote(note)}>
                        Editar
                      </Button>
                      {removingNote === note.court ? (
                        <Button
                          variant="text"
                          color="error"
                          size="small"
                          onClick={async () => {
                            setRemovingNote(null);
                            done(await removeCourtNote(note.court), "Decisões do tribunal removidas.");
                          }}
                        >
                          Confirmar remoção
                        </Button>
                      ) : (
                        <Button variant="text" color="grey" size="small" onClick={() => setRemovingNote(note.court)}>
                          Remover
                        </Button>
                      )}
                    </Box>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>

          <CourtSystemsCard refusals={state.systems} />
        </Grid>

        <Grid size={{ xs: 12, lg: 7 }}>
          <Card component="section" aria-labelledby="calendar-days">
            <CardContent className="flex flex-col gap-3">
              <Box className="flex flex-wrap items-center gap-2">
                <Typography id="calendar-days" variant="h5" component="h2" className="mb-0 min-w-0 flex-1">
                  Dias de {calendar.year}
                </Typography>
                <Button variant="contained" size="small" onClick={() => setAddingDay(true)}>
                  Adicionar dia ou período
                </Button>
              </Box>
              <Typography variant="body2" className="text-text-secondary">
                Os feriados nacionais fixados em lei federal já estão na regra e não precisam estar aqui.
              </Typography>
              {calendar.days.length === 0 ? (
                <EmptyState
                  icon={<NiCalendar size="large" />}
                  title="Nenhum dia registrado neste ano"
                  description="Registre os feriados do tribunal e das comarcas, o recesso, os pontos facultativos e as suspensões de prazo do ato."
                  action={{ label: "Adicionar dia ou período", onClick: () => setAddingDay(true) }}
                />
              ) : (
                <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
                  {calendar.days.map((entry) => (
                    <Box
                      component="li"
                      key={entry.id}
                      className="border-grey-100 flex flex-wrap items-center gap-2 border-b pb-2"
                    >
                      <Box className="min-w-0 flex-1">
                        <Typography variant="body2" className="font-semibold">
                          {day(entry.day)}, {weekdayOf(entry.day)} · {entry.label}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          {[
                            entry.proceedingKinds.length > 0 ? `só ${entry.proceedingKinds.join(" e ")}` : null,
                            entry.systems.length > 0 ? `só ${entry.systems.join(", ")}` : null,
                            entry.comarcas.length > 0 ? `comarcas: ${entry.comarcas.join(", ")}` : "todas as comarcas",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography>
                      </Box>
                      <StatusChip tone={KIND_TONE[entry.kind]} label={KIND_LABEL[entry.kind]} />
                      <Button
                        variant="text"
                        color="grey"
                        size="small"
                        onClick={async () => done(await removeCalendarDay(entry.id), "Dia removido.")}
                      >
                        Remover
                      </Button>
                    </Box>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {editingYear ? (
        <YearDialog
          court={calendar.court}
          year={calendar.year}
          checked={checked}
          onClose={() => setEditingYear(false)}
          onSave={async (input) => {
            const ok = done(await saveCalendarYear(input), "Conferência registrada.");
            if (ok) setEditingYear(false);
          }}
        />
      ) : null}
      {addingDay ? (
        <DayDialog
          court={calendar.court}
          year={calendar.year}
          onClose={() => setAddingDay(false)}
          onSave={async (input) => {
            const result = await saveCalendarDay(input);
            const ok = done(
              result,
              result.ok && (result.days ?? 1) > 1 ? `${result.days} dias registrados.` : "Dia registrado.",
            );
            if (ok) setAddingDay(false);
          }}
        />
      ) : null}
      {editingNote ? (
        <NoteDialog
          note={editingNote === "new" ? null : editingNote}
          // A new note is of a court that has none: one that has is edited from its line.
          courts={calendar.courts
            .map((court) => court.acronym)
            .filter((acronym) => editingNote !== "new" || !calendar.notes.some((note) => note.court === acronym))}
          today={todayInBrasilia()}
          onClose={() => setEditingNote(null)}
          onSave={async (input) => {
            const result = await saveCourtNote(input);
            if (!result.ok) return failure(result.code);
            done(result, "Decisões do tribunal salvas.");
            setEditingNote(null);
            return null;
          }}
        />
      ) : null}
      {editingAct ? (
        <ActDialog
          act={editingAct === "new" ? null : editingAct}
          onClose={() => setEditingAct(null)}
          onSave={async (input) => {
            const ok = done(await saveDeadlineAct(input), "Ato salvo.");
            if (ok) setEditingAct(null);
          }}
        />
      ) : null}
    </Box>
  );
}

function YearDialog({
  court,
  year,
  checked,
  onClose,
  onSave,
}: {
  court: string;
  year: number;
  checked: CalendarYearRecord | null;
  onClose: () => void;
  onSave: (input: Parameters<typeof saveCalendarYear>[0]) => Promise<void>;
}) {
  const [sourceUrl, setSourceUrl] = useState(checked?.sourceUrl ?? "");
  const [sourceTitle, setSourceTitle] = useState(checked?.sourceTitle ?? "");
  const [allComarcas, setAllComarcas] = useState(checked?.allComarcas ?? false);
  const [comarcas, setComarcas] = useState((checked?.comarcas ?? []).join(", "));
  const [checkedOn, setCheckedOn] = useState(checked?.checkedOn ?? todayInBrasilia());
  const [note, setNote] = useState(checked?.note ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="calendar-year-dialog">
      <DialogHeader
        id="calendar-year-dialog"
        title={`Conferência de ${year} do ${court}`}
        onClose={onClose}
        closeLabel="Fechar"
      />
      <DialogContent className="flex flex-col gap-3">
        <TextField
          size="small"
          label="Endereço do ato (https)"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
        />
        <TextField
          size="small"
          label="Nome do ato"
          value={sourceTitle}
          onChange={(event) => setSourceTitle(event.target.value)}
        />
        <TextField
          size="small"
          type="date"
          label="Conferido em"
          value={checkedOn}
          onChange={(event) => setCheckedOn(event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <FormControlLabel
          control={<Checkbox checked={allComarcas} onChange={(event) => setAllComarcas(event.target.checked)} />}
          label="O ato traz os dias próprios de todas as comarcas"
        />
        {!allComarcas ? (
          <TextField
            size="small"
            label="Comarcas cujos dias próprios o ato traz"
            helperText="Separadas por vírgula. Uma comarca fora da lista recebe o aviso de que os feriados municipais dela não estão no calendário."
            value={comarcas}
            multiline
            onChange={(event) => setComarcas(event.target.value)}
          />
        ) : null}
        <TextField
          size="small"
          label="Nota"
          value={note}
          multiline
          minRows={2}
          onChange={(event) => setNote(event.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={busy || !/^https:\/\//i.test(sourceUrl.trim())}
          onClick={async () => {
            setBusy(true);
            await onSave({ court, year, sourceUrl, sourceTitle, allComarcas, comarcas, checkedOn, note });
            setBusy(false);
          }}
        >
          Salvar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DayDialog({
  court,
  year,
  onClose,
  onSave,
}: {
  court: string;
  year: number;
  onClose: () => void;
  onSave: (input: Parameters<typeof saveCalendarDay>[0]) => Promise<void>;
}) {
  const [first, setFirst] = useState(`${year}-01-01`);
  const [last, setLast] = useState("");
  const [kind, setKind] = useState<CalendarDayRecord["kind"]>("closed");
  const [label, setLabel] = useState("");
  const [kinds, setKinds] = useState<string[]>([]);
  const [systems, setSystems] = useState<string[]>([]);
  const [comarcas, setComarcas] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="calendar-day-dialog">
      <DialogHeader
        id="calendar-day-dialog"
        title={`Dia ou período do ${court}`}
        onClose={onClose}
        closeLabel="Fechar"
      />
      <DialogContent className="flex flex-col gap-3">
        <Box className="flex flex-wrap gap-3">
          <TextField
            size="small"
            type="date"
            label="Dia"
            value={first}
            onChange={(event) => setFirst(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            type="date"
            label="Até (num período)"
            value={last}
            onChange={(event) => setLast(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>
        <TextField
          select
          size="small"
          label="O que é"
          value={kind}
          onChange={(event) => setKind(event.target.value as CalendarDayRecord["kind"])}
        >
          {(Object.keys(KIND_LABEL) as CalendarDayRecord["kind"][]).map((option) => (
            <MenuItem key={option} value={option}>
              {KIND_LABEL[option]}
            </MenuItem>
          ))}
        </TextField>
        <TextField size="small" label="Nome no ato" value={label} onChange={(event) => setLabel(event.target.value)} />
        <Box>
          <Typography variant="body2" className="font-semibold">
            Só para (vazio é todos os processos do tribunal)
          </Typography>
          {["juizado", "comum"].map((option) => (
            <FormControlLabel
              key={option}
              control={<Checkbox checked={kinds.includes(option)} onChange={() => setKinds(toggle(kinds, option))} />}
              label={option === "juizado" ? "Juizado" : "Vara cível"}
            />
          ))}
          {SYSTEMS.map((option) => (
            <FormControlLabel
              key={option}
              control={
                <Checkbox checked={systems.includes(option)} onChange={() => setSystems(toggle(systems, option))} />
              }
              label={option}
            />
          ))}
        </Box>
        <TextField
          size="small"
          label="Comarcas (vazio é todas)"
          helperText="Separadas por vírgula, como o ato as escreve."
          value={comarcas}
          onChange={(event) => setComarcas(event.target.value)}
        />
        <TextField
          size="small"
          label="Endereço do ato, quando não for o do ano"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={busy || label.trim().length < 2 || !first}
          onClick={async () => {
            setBusy(true);
            await onSave({
              court,
              day: first,
              lastDay: last || null,
              kind,
              label,
              proceedingKinds: kinds,
              systems,
              comarcas,
              sourceUrl,
            });
            setBusy(false);
          }}
        >
          Salvar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ActDialog({
  act,
  onClose,
  onSave,
}: {
  act: DeadlineActRecord | null;
  onClose: () => void;
  onSave: (input: Parameters<typeof saveDeadlineAct>[0]) => Promise<void>;
}) {
  const [slug, setSlug] = useState(act?.slug ?? "");
  const [name, setName] = useState(act?.name ?? "");
  const [days, setDays] = useState(String(act?.days ?? ""));
  const [counting, setCounting] = useState<"business" | "calendar">(act?.counting ?? "business");
  const [kinds, setKinds] = useState<string[]>(act?.proceedingKinds ?? []);
  const [basis, setBasis] = useState(act?.basis ?? "");
  const [position, setPosition] = useState(String(act?.position ?? 100));
  const [active, setActive] = useState(act?.active ?? true);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="calendar-act-dialog">
      <DialogHeader
        id="calendar-act-dialog"
        title={act ? act.name : "Novo ato"}
        onClose={onClose}
        closeLabel="Fechar"
      />
      <DialogContent className="flex flex-col gap-3">
        <TextField
          size="small"
          label="Identificador (minúsculas e _)"
          value={slug}
          disabled={Boolean(act)}
          onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
        />
        <TextField size="small" label="Nome" value={name} onChange={(event) => setName(event.target.value)} />
        <Box className="flex gap-3">
          <TextField
            size="small"
            label="Dias"
            value={days}
            onChange={(event) => setDays(event.target.value.replace(/\D/g, ""))}
          />
          <TextField
            select
            size="small"
            label="Contagem"
            value={counting}
            onChange={(event) => setCounting(event.target.value as "business" | "calendar")}
          >
            <MenuItem value="business">Dias úteis</MenuItem>
            <MenuItem value="calendar">Dias corridos</MenuItem>
          </TextField>
          <TextField
            size="small"
            label="Ordem"
            value={position}
            onChange={(event) => setPosition(event.target.value.replace(/\D/g, ""))}
          />
        </Box>
        <TextField size="small" label="Base legal" value={basis} onChange={(event) => setBasis(event.target.value)} />
        <Box>
          {["juizado", "comum"].map((option) => (
            <FormControlLabel
              key={option}
              control={
                <Checkbox
                  checked={kinds.includes(option)}
                  onChange={() =>
                    setKinds(kinds.includes(option) ? kinds.filter((item) => item !== option) : [...kinds, option])
                  }
                />
              }
              label={option === "juizado" ? "Juizado" : "Vara cível"}
            />
          ))}
          <FormControlLabel
            control={<Checkbox checked={active} onChange={(event) => setActive(event.target.checked)} />}
            label="Na lista"
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={busy || !slug || name.trim().length < 2 || !days}
          onClick={async () => {
            setBusy(true);
            await onSave({
              slug,
              name,
              days: Number(days),
              counting,
              proceedingKinds: kinds,
              basis,
              position: Number(position || "100"),
              active,
            });
            setBusy(false);
          }}
        >
          Salvar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** What the platform read of how a court decides a family split: the stance, a summary and each decision read. */
function NoteDialog({
  note,
  courts,
  today,
  onClose,
  onSave,
}: {
  note: CourtNoteRecord | null;
  courts: string[];
  today: string;
  onClose: () => void;
  /** Saves; the words of a refusal come back, to be said inside the dialog. */
  onSave: (input: Parameters<typeof saveCourtNote>[0]) => Promise<string | null>;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [court, setCourt] = useState(note?.court ?? "");
  const [stance, setStance] = useState<"against" | "divided">(note?.stance ?? "against");
  const [summary, setSummary] = useState(note?.summary ?? "");
  const [sources, setSources] = useState(
    (note?.sources ?? []).map((source) => `${source.label} | ${source.url}`).join("\n"),
  );
  const [readOn, setReadOn] = useState(note?.readOn ?? today);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth aria-labelledby="calendar-note-dialog">
      <DialogHeader
        id="calendar-note-dialog"
        title={note ? `Decisões do ${note.court}` : "Decisões de um tribunal"}
        onClose={onClose}
        closeLabel="Fechar"
      />
      <DialogContent className="flex flex-col gap-3">
        <Box className="flex gap-3">
          <TextField
            select
            size="small"
            label="Tribunal"
            value={court}
            disabled={Boolean(note)}
            onChange={(event) => setCourt(event.target.value)}
            className="min-w-32"
          >
            {courts.map((acronym) => (
              <MenuItem key={acronym} value={acronym}>
                {acronym}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Posição"
            value={stance}
            onChange={(event) => setStance(event.target.value as "against" | "divided")}
          >
            <MenuItem value="against">Contra a divisão</MenuItem>
            <MenuItem value="divided">Decisões divergentes</MenuItem>
          </TextField>
          <TextField
            size="small"
            type="date"
            label="Lido em"
            value={readOn}
            onChange={(event) => setReadOn(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>
        <TextField
          size="small"
          label="O que o tribunal decidiu"
          value={summary}
          multiline
          minRows={4}
          onChange={(event) => setSummary(event.target.value.slice(0, 2000))}
          helperText="Entre 40 e 2.000 caracteres, sem nome de parte."
        />
        <TextField
          size="small"
          label="Fontes, uma por linha: descrição | endereço"
          value={sources}
          multiline
          minRows={3}
          onChange={(event) => setSources(event.target.value)}
          helperText="Por exemplo: TJMT, 5ª Câmara de Direito Privado, 17/03/2026 | https://..."
        />
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {problem}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={busy || !court || summary.trim().length < 40 || !sources.includes("https://")}
          onClick={async () => {
            setBusy(true);
            setProblem(await onSave({ court, stance, summary, sources, readOn }));
            setBusy(false);
          }}
        >
          Salvar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
