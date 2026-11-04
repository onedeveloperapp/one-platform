import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";
import { runBackup } from "@flyee/backup";

/**
 * The nightly logical backup (`@flyee/backup`): every public table to the
 * private `backups` bucket, at 00:00 in Brasília (03:00 UTC). A backup asked
 * for from /admin/backups runs right after the operator's answer instead.
 */
export const backupSweeps: Sweep[] = [
  {
    key: "backup",
    when: { daily: { hour: 3, minute: 0 } },
    run: async () => {
      const result = await runBackup({ trigger: "cron" });
      if (!result.ok) throw new Error(result.hint);
      return { tables: result.tables, rows: result.rows, bytes: result.bytes };
    },
  },
];
