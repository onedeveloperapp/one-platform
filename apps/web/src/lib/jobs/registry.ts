import "server-only";

import { aiSweeps } from "@/lib/ai/jobs";
import { backupSweeps } from "@/lib/backup-jobs";
import { billingSweeps } from "@/lib/billing-jobs";
import { caseSweeps } from "@/lib/cases/jobs";
import { connectionSweeps } from "@/lib/connections/jobs";
import { conversationSweeps } from "@/lib/conversations/jobs";
import { courtSweeps } from "@/lib/courts/jobs";
import { deadlineSweeps } from "@/lib/deadlines/jobs";
import { fileSweeps } from "@/lib/files/jobs";
import { hearingSweeps } from "@/lib/hearings/jobs";
import { importSweeps } from "@/lib/import/jobs";
import type { Sweep } from "@/lib/jobs/schedule";
import { leadSweeps } from "@/lib/lead-jobs";
import { librarySweeps } from "@/lib/library/jobs";
import { maintenanceSweeps } from "@/lib/maintenance-jobs";
import { moduleSweeps } from "@/lib/modules/jobs";
import { newsletterSweeps } from "@/lib/newsletter-jobs";
import { noticeSweeps } from "@/lib/notices/jobs";
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
  ...caseSweeps,
  ...noticeSweeps,
  ...deadlineSweeps,
  ...hearingSweeps,
  ...publicationSweeps,
  ...courtSweeps,
  ...librarySweeps,
  ...signatureSweeps,
  ...aiSweeps,
  ...fileSweeps,
  ...connectionSweeps,
  ...importSweeps,
  ...billingSweeps,
  ...leadSweeps,
  ...newsletterSweeps,
  ...maintenanceSweeps,
  ...backupSweeps,
  // The sweeps of the modules installed (lib/modules/jobs.ts).
  ...moduleSweeps,
];
