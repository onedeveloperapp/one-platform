import "server-only";

import { agendaSweeps } from "@/lib/agenda/digest-work";
import { aiSweeps } from "@/lib/ai/jobs";
import { backupSweeps } from "@/lib/backup-jobs";
import { billingSweeps } from "@/lib/billing-jobs";
import { caseSweeps } from "@/lib/cases/jobs";
import { pieceSweeps } from "@/lib/cases/pieces-work";
import { connectionSweeps } from "@/lib/connections/jobs";
import { conversationSweeps } from "@/lib/conversations/jobs";
import { referralSweeps } from "@/lib/conversations/referral-work";
import { amountSweeps } from "@/lib/courts/amount-work";
import { courtSweeps } from "@/lib/courts/jobs";
import { outcomeSweeps } from "@/lib/courts/outcome-work";
import { deadlineSweeps } from "@/lib/deadlines/jobs";
import { fileSweeps } from "@/lib/files/jobs";
import { financeSweeps } from "@/lib/finance/jobs";
import { moneySweeps } from "@/lib/finance/money-work";
import { hearingBriefSweeps } from "@/lib/hearings/brief-work";
import { hearingSweeps } from "@/lib/hearings/jobs";
import { importSweeps } from "@/lib/import/jobs";
import type { Sweep } from "@/lib/jobs/schedule";
import { marketSweeps } from "@/lib/jurimetrics/capture";
import { leadSweeps } from "@/lib/lead-jobs";
import { librarySweeps } from "@/lib/library/jobs";
import { maintenanceSweeps } from "@/lib/maintenance-jobs";
import { moduleSweeps } from "@/lib/modules/jobs";
import { newsletterSweeps } from "@/lib/newsletter-jobs";
import { noticeSweeps } from "@/lib/notices/jobs";
import { publicationActionSweeps } from "@/lib/publications/action-work";
import { publicationSweeps } from "@/lib/publications/jobs";
import { signatureSweeps } from "@/lib/signatures/jobs";
import { whatsappSweeps } from "@/lib/whatsapp/jobs";

/**
 * Every sweep of the platform, in one list: the clock (`lib/jobs/tick.ts`) and a round while ONE is used
 * (`lib/jobs/while-used.ts`) run from it. A sweep missing from this list never runs, whatever its file declares.
 */
export const SWEEPS: readonly Sweep[] = [
  ...whatsappSweeps,
  ...conversationSweeps,
  ...referralSweeps,
  ...caseSweeps,
  ...pieceSweeps,
  ...marketSweeps,
  ...noticeSweeps,
  ...deadlineSweeps,
  ...hearingSweeps,
  ...hearingBriefSweeps,
  ...publicationSweeps,
  ...publicationActionSweeps,
  ...courtSweeps,
  ...librarySweeps,
  ...signatureSweeps,
  ...aiSweeps,
  ...fileSweeps,
  ...connectionSweeps,
  ...importSweeps,
  ...financeSweeps,
  ...outcomeSweeps,
  ...amountSweeps,
  ...agendaSweeps,
  ...moneySweeps,
  ...billingSweeps,
  ...leadSweeps,
  ...newsletterSweeps,
  ...maintenanceSweeps,
  ...backupSweeps,
  // The sweeps of the modules installed (lib/modules/jobs.ts).
  ...moduleSweeps,
];
