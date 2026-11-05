/**
 * What needs somebody of the firm today, as the home reads it: the answer of
 * `firm_today` (migration 0020), counted by the database for the person who
 * asks, and the pure rule of what the home shows from it and in which order.
 */

export type FirmToday = {
  /** Answers of the AI waiting for a decision this person's function may make. */
  approvalsMine: number;
  /** Every answer waiting in the firm's queue. */
  approvalsWaiting: number;
  /** Conversations where the person wrote last and nobody answered. */
  conversationsWaiting: number;
  /** Of those, the ones whose 24-hour window is about to close. */
  conversationsClosing: number;
  /** Messages of the last day that did not go out. */
  sendsFailed: number;
  whatsapp: "active" | "disconnected" | "none";
  /** Files a client or a colleague added to a case that nobody accepted or refused yet. */
  documentsToReview: number;
  /** Cases still waiting for the client whose client said they sent everything. */
  clientsFinished: number;
  /** Cases where a client said the chronology is wrong and nobody asked for another yet. */
  chronologiesContested: number;
  /** Cases whose complaint passed the day its answer was due and still waits. */
  complaintsOverdue: number;
  /** Filing packages that are built and wait for a lawyer to file them. */
  filingsReady: number;
  /** Drafts of pieces that wait for a lawyer outside the queue, that the AI could not write, or whose PDF was not made. */
  draftsWaiting: number;
  /** Publications of the courts nobody of the firm said what they are yet. */
  publicationsNew: number;
  /** Publications a court cancelled after somebody had triaged them, that nobody said they saw. */
  publicationsCancelled: number;
  /** Publications the AI triaged that wait for a person's check (0035). */
  publicationsToReview: number;
  /**
   * Registrations at the bar of the firm whose reading of the DJEN is late, or that no reading has seen for that long.
   * Read, never a need of the firm: a reading that is late is ONE's own work (2026-11-05, see `todayNeeds`).
   */
  djenLate: number;
  /** Registrations whose last reading left out a communication it could not keep. */
  djenIncomplete: number;
  /** Readings that stopped (nobody holds the registration anymore) for a lawyer still on record in a lawsuit. */
  djenStopped: number;
  /** Lawsuits with movements of the court nobody of the firm said they saw yet. */
  movementsNew: number;
  /** Lawsuits whose reading of the court was given up: a person asks again. */
  trackingFailed: number;
  /** Deadlines the rule counted that wait for who runs the deadlines to confirm them. */
  deadlinesToConfirm: number;
  /** Open deadlines due today or in the next few days (the setting says how many). */
  deadlinesSoon: number;
  /** Open deadlines past their day, with nobody having said the act was done. */
  deadlinesOverdue: number;
  /** Open deadlines to look at again: the publication was cancelled, the count changed, or it could not be counted. */
  deadlinesReview: number;
  /** Publications somebody triaged as a deadline, in the last days, that no deadline came from. */
  publicationsWithoutDeadline: number;
  /**
   * Publications somebody triaged as a hearing, in the last days, that still owe it: what ONE left to a person
   * (migration 0040), or what a person did not write (0037).
   */
  publicationsWithoutHearing: number;
  /** Hearings to come in the next days (the setting's). */
  hearingsSoon: number;
  /** Hearings past their time with nobody having said what came of them. */
  hearingsUnresolved: number;
  /** The firm's calendar of hearings in Google stopped taking them. */
  calendarLost: number;
  /** Hearings of the next days whose client will not be reminded of them on WhatsApp (migration 0038). */
  hearingsUnwarned: number;
  /** Cases where a claimant said no to the civil court of a lawsuit planned there (migration 0025). */
  civilCourtDeclined: number;
};

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

/** The database's answer, checked. Null when it is not what was expected: the home then says it could not read. */
export function readFirmToday(raw: unknown): FirmToday | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const answer = raw as Record<string, unknown>;
  const approvalsMine = count(answer.approvals_mine);
  const approvalsWaiting = count(answer.approvals_waiting);
  const conversationsWaiting = count(answer.conversations_waiting);
  const conversationsClosing = count(answer.conversations_closing);
  const sendsFailed = count(answer.sends_failed);
  const documentsToReview = count(answer.documents_to_review);
  const clientsFinished = count(answer.clients_finished);
  const chronologiesContested = count(answer.chronologies_contested);
  const complaintsOverdue = count(answer.complaints_overdue);
  const filingsReady = count(answer.filings_ready);
  const draftsWaiting = count(answer.drafts_waiting);
  const publicationsNew = count(answer.publications_new);
  const publicationsCancelled = count(answer.publications_cancelled);
  const publicationsToReview = count(answer.publications_to_review);
  const djenLate = count(answer.djen_late);
  const djenIncomplete = count(answer.djen_incomplete);
  const djenStopped = count(answer.djen_stopped);
  const movementsNew = count(answer.movements_new);
  const trackingFailed = count(answer.tracking_failed);
  const deadlinesToConfirm = count(answer.deadlines_to_confirm);
  const deadlinesSoon = count(answer.deadlines_soon);
  const deadlinesOverdue = count(answer.deadlines_overdue);
  const deadlinesReview = count(answer.deadlines_review);
  const publicationsWithoutDeadline = count(answer.publications_without_deadline);
  const publicationsWithoutHearing = count(answer.publications_without_hearing);
  const hearingsSoon = count(answer.hearings_soon);
  const hearingsUnresolved = count(answer.hearings_unresolved);
  const calendarLost = count(answer.calendar_lost);
  const hearingsUnwarned = count(answer.hearings_unwarned);
  const civilCourtDeclined = count(answer.civil_court_declined);
  const whatsapp = answer.whatsapp;
  if (
    documentsToReview === null ||
    clientsFinished === null ||
    chronologiesContested === null ||
    complaintsOverdue === null ||
    filingsReady === null ||
    draftsWaiting === null ||
    publicationsNew === null ||
    publicationsCancelled === null ||
    publicationsToReview === null ||
    djenLate === null ||
    djenIncomplete === null ||
    djenStopped === null ||
    movementsNew === null ||
    trackingFailed === null ||
    deadlinesToConfirm === null ||
    deadlinesSoon === null ||
    deadlinesOverdue === null ||
    deadlinesReview === null ||
    publicationsWithoutDeadline === null ||
    publicationsWithoutHearing === null ||
    hearingsSoon === null ||
    hearingsUnresolved === null ||
    calendarLost === null ||
    hearingsUnwarned === null ||
    civilCourtDeclined === null ||
    approvalsMine === null ||
    approvalsWaiting === null ||
    conversationsWaiting === null ||
    conversationsClosing === null ||
    sendsFailed === null ||
    (whatsapp !== "active" && whatsapp !== "disconnected" && whatsapp !== "none")
  ) {
    return null;
  }
  return {
    approvalsMine,
    approvalsWaiting,
    conversationsWaiting,
    conversationsClosing,
    sendsFailed,
    whatsapp,
    documentsToReview,
    clientsFinished,
    chronologiesContested,
    complaintsOverdue,
    filingsReady,
    draftsWaiting,
    publicationsNew,
    publicationsCancelled,
    publicationsToReview,
    djenLate,
    djenIncomplete,
    djenStopped,
    movementsNew,
    trackingFailed,
    deadlinesToConfirm,
    deadlinesSoon,
    deadlinesOverdue,
    deadlinesReview,
    publicationsWithoutDeadline,
    publicationsWithoutHearing,
    hearingsSoon,
    hearingsUnresolved,
    calendarLost,
    hearingsUnwarned,
    civilCourtDeclined,
  };
}

/**
 * One thing that needs somebody, with where it is done:
 *
 *   overdue    deadlines past their day with nobody having said the act was done: what nobody may miss
 *              was missed, or was done and not said;
 *   closing    conversations about to lose the 24 hours;
 *   due        deadlines due today or in the next few days;
 *   confirm    deadlines the rule counted that wait for who runs the deadlines;
 *   untimed    publications triaged as a deadline that no deadline came from: a time runs in each;
 *   unwritten  publications triaged as a hearing that no hearing came from: what ONE left to a person, or a
 *              person did not write; a hearing nobody goes to may end the lawsuit;
 *   hearings   hearings to come in the next days: who goes, and how;
 *   unwarned   hearings of the next days whose client will not be reminded of them on WhatsApp: no number,
 *              no agreement, asked to stop, or the reminder cannot go; anybody of the firm fixes the first two;
 *   unresolved hearings past their time with no word on what came of them;
 *   calendar   the firm's calendar of hearings in Google stopped by itself: shown to who manages the firm,
 *              who brings it back;
 *   recheck    deadlines to look at again: a publication the court cancelled, a count that changed after
 *              it was confirmed, one the rule could not count;
 *   waiting    the other conversations nobody answered;
 *   approvals  answers of the AI this person decides;
 *   clients    clients who said, on their link, that they sent everything;
 *   civil      claimants who said no to the civil court of a lawsuit planned there: no package is built
 *              until somebody talks it over with them, or a lawyer splits the family;
 *   documents  files added to a case that nobody accepted or refused yet;
 *   contested  clients who said the chronology of what they told is wrong;
 *   complaints complaints whose answer is overdue: the attempt to settle is over;
 *   filings    filing packages built and waiting for a lawyer to file them;
 *   moved      lawsuits where the court did something nobody of the firm said they saw yet, and the ones
 *              whose reading of the court was given up;
 *   drafts     pieces that wait for a lawyer on their case: a text to review that is not in the queue,
 *              one the AI could not write, or an approved one whose PDF was not made;
 *   cancelled  publications a court took back after somebody had triaged them: what was done about them
 *              (a time counted, a hearing noted) is to be looked at again;
 *   publications  what the courts published and nobody said what it is: a time may be running in one;
 *   checks     what the AI triaged and was chosen for a person's check;
 *   reading    registrations at the bar whose reading of the DJEN is late, left a communication out or
 *              stopped for a lawyer still on record: a day with nothing new means something only when
 *              the reading is up to date and whole;
 *   failed     messages that did not go out;
 *   queue      answers that wait for somebody of another function: nothing for
 *              this person to do, and worth knowing that they wait.
 */
export type TodayNeed = {
  key:
    | "overdue"
    | "closing"
    | "due"
    | "confirm"
    | "untimed"
    | "unwritten"
    | "hearings"
    | "unwarned"
    | "unresolved"
    | "calendar"
    | "recheck"
    | "waiting"
    | "approvals"
    | "filings"
    | "drafts"
    | "moved"
    | "publications"
    | "checks"
    | "cancelled"
    | "reading"
    | "skipped"
    | "clients"
    | "civil"
    | "documents"
    | "contested"
    | "complaints"
    | "failed"
    | "queue";
  count: number;
  href: string;
};

/** Who is looking: what a person may not act on is not shown as theirs to do. */
export type TodayViewer = {
  /** The person says what a publication is: who signs, or who runs the firm's deadlines. */
  triagesPublications: boolean;
  /** The person works on deadlines (proposes, completes, corrects them): who signs, or runs them. */
  worksDeadlines: boolean;
  /** The person confirms deadlines: a partner or the controladoria. */
  confirmsDeadlines: boolean;
  /** The person manages the firm: its connections (the calendar in Google among them) are theirs to fix. */
  managesFirm: boolean;
};

/**
 * Who is looking, from their place in the firm: who signs (sócio, advocacia) and who runs the deadlines
 * (controladoria) work on the courts' publications and deadlines; a partner or the controladoria confirms a
 * deadline; who manages the firm account fixes its connections.
 */
export function todayViewerOf(firm: { role: string | null; firmFunction: string | null }): TodayViewer {
  const fn = firm.firmFunction;
  const signsOrRuns = fn === "socio" || fn === "advogado" || fn === "controladoria";
  return {
    triagesPublications: signsOrRuns,
    worksDeadlines: signsOrRuns,
    confirmsDeadlines: fn === "socio" || fn === "controladoria",
    managesFirm: firm.role === "owner" || firm.role === "admin",
  };
}

const EVERYTHING: TodayViewer = {
  triagesPublications: true,
  worksDeadlines: true,
  confirmsDeadlines: true,
  managesFirm: true,
};

/**
 * What the home shows, most urgent first. Nothing that is zero is shown,
 * and what the courts published is shown to who works on it: for anybody
 * else it would be a count with nothing behind it to do.
 */
export function todayNeeds(today: FirmToday, viewer: TodayViewer = EVERYTHING): TodayNeed[] {
  const deadlines = (need: TodayNeed, shown: boolean): TodayNeed[] => (shown ? [need] : []);
  const published: TodayNeed[] = viewer.triagesPublications
    ? [
        { key: "cancelled", count: today.publicationsCancelled, href: "/publicacoes?ver=canceladas" },
        // A time may be running in one of them: right after what has a clock of its own.
        { key: "publications", count: today.publicationsNew, href: "/publicacoes" },
        { key: "checks", count: today.publicationsToReview, href: "/publicacoes?ver=conferir" },
        // Of the reading of the DJEN, only what a person of the firm puts right (2026-11-05): a reading that stopped
        // for a lawyer still on record (the registration back on the team, or another lawyer on the lawsuit), and a
        // communication the reading could not keep (read at the DJEN by its certificate). A reading that is late is
        // ONE's own work, which the operator watches (`admin_djen_health`) and /publicacoes says: where the DJEN is
        // not read at all, every registration would be late for good, with nothing for the firm to do.
        { key: "reading", count: today.djenStopped, href: "/publicacoes#leitura" },
        { key: "skipped", count: today.djenIncomplete, href: "/publicacoes" },
      ]
    : [];
  const needs: TodayNeed[] = [
    // A deadline past its day is the one thing nothing else may come before.
    ...deadlines(
      { key: "overdue", count: today.deadlinesOverdue, href: "/prazos?ver=vencidos" },
      viewer.worksDeadlines,
    ),
    { key: "closing", count: today.conversationsClosing, href: "/atendimento" },
    ...deadlines({ key: "due", count: today.deadlinesSoon, href: "/prazos?ver=proximos" }, viewer.worksDeadlines),
    ...deadlines({ key: "hearings", count: today.hearingsSoon, href: "/agenda" }, viewer.worksDeadlines),
    // Anybody of the firm records a client's WhatsApp or agreement: the client of a hearing coming is told then.
    { key: "unwarned", count: today.hearingsUnwarned, href: "/agenda" },
    ...deadlines({ key: "confirm", count: today.deadlinesToConfirm, href: "/prazos" }, viewer.confirmsDeadlines),
    ...deadlines(
      { key: "untimed", count: today.publicationsWithoutDeadline, href: "/prazos#sem-prazo" },
      viewer.worksDeadlines,
    ),
    ...deadlines(
      { key: "unwritten", count: today.publicationsWithoutHearing, href: "/agenda#sem-audiencia" },
      viewer.worksDeadlines,
    ),
    // The ones about to close are counted above: here, the rest of who waits.
    {
      key: "waiting",
      count: Math.max(today.conversationsWaiting - today.conversationsClosing, 0),
      href: "/atendimento",
    },
    ...published,
    ...deadlines({ key: "recheck", count: today.deadlinesReview, href: "/prazos?ver=rever" }, viewer.worksDeadlines),
    ...deadlines(
      { key: "unresolved", count: today.hearingsUnresolved, href: "/agenda?ver=sem_resultado" },
      viewer.worksDeadlines,
    ),
    // Who manages the firm brings the calendar back, whatever their function: it is a connection of the firm.
    ...deadlines({ key: "calendar", count: today.calendarLost, href: "/settings/connections" }, viewer.managesFirm),
    { key: "approvals", count: today.approvalsMine, href: "/aprovacoes" },
    { key: "moved", count: today.movementsNew + today.trackingFailed, href: "/casos?ver=andamento" },
    { key: "drafts", count: today.draftsWaiting, href: "/casos?ver=pecas" },
    { key: "filings", count: today.filingsReady, href: "/protocolo" },
    { key: "clients", count: today.clientsFinished, href: "/casos?ver=cliente-terminou" },
    { key: "civil", count: today.civilCourtDeclined, href: "/casos?ver=vara-civel" },
    { key: "documents", count: today.documentsToReview, href: "/casos?ver=documentos" },
    { key: "contested", count: today.chronologiesContested, href: "/casos?ver=cronologia" },
    { key: "complaints", count: today.complaintsOverdue, href: "/casos?ver=reclamacao" },
    { key: "failed", count: today.sendsFailed, href: "/atendimento" },
    { key: "queue", count: Math.max(today.approvalsWaiting - today.approvalsMine, 0), href: "/aprovacoes" },
  ];
  return needs.filter((need) => need.count > 0);
}

/** True when something waits for THIS person: what waits for another function does not count. */
export const somethingForMe = (needs: readonly TodayNeed[]): boolean => needs.some((need) => need.key !== "queue");
