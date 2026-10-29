// Background work here is cut into steps: a send to the list is one step per
// batch of 100 readers, a document or a statement is one step each. Most take
// seconds; the one that does not is a model hearing a client's audio (a
// transcription of a quarter of an hour was measured between one and three
// minutes in the previous product), so a step has the most the Vercel Hobby
// plan accepts. A step that still runs out goes back to the line by itself.
export const maxDuration = 300;

import { aiFunctions } from "@/lib/ai/jobs";
import { billingFunctions } from "@/lib/billing-jobs";
import { caseFunctions } from "@/lib/cases/jobs";
import { connectionFunctions } from "@/lib/connections/jobs";
import { conversationFunctions } from "@/lib/conversations/jobs";
import { courtFunctions } from "@/lib/courts/jobs";
import { deadlineFunctions } from "@/lib/deadlines/jobs";
import { fileFunctions } from "@/lib/files/jobs";
import { hearingFunctions } from "@/lib/hearings/jobs";
import { importFunctions } from "@/lib/import/jobs";
import { leadFunctions } from "@/lib/lead-jobs";
import { libraryFunctions } from "@/lib/library/jobs";
import { maintenanceFunctions } from "@/lib/maintenance-jobs";
import { moduleJobs } from "@/lib/modules/jobs";
import { newsletterFunctions } from "@/lib/newsletter-jobs";
import { noticeFunctions } from "@/lib/notices/jobs";
import { publicationFunctions } from "@/lib/publications/jobs";
import { signatureFunctions } from "@/lib/signatures/jobs";
import { whatsappFunctions } from "@/lib/whatsapp/jobs";
import { backupFunctions } from "@flyee/backup/jobs";
import { inngest } from "@flyee/jobs";
import { serve } from "@flyee/jobs/next";

// Every Inngest function of the platform. A function that is not listed here
// never runs, whatever its file declares.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    ...billingFunctions,
    ...leadFunctions,
    ...newsletterFunctions,
    ...maintenanceFunctions,
    ...aiFunctions,
    ...connectionFunctions,
    ...fileFunctions,
    ...signatureFunctions,
    ...caseFunctions,
    ...courtFunctions,
    ...importFunctions,
    ...deadlineFunctions,
    ...hearingFunctions,
    ...noticeFunctions,
    ...conversationFunctions,
    ...publicationFunctions,
    ...libraryFunctions,
    ...whatsappFunctions,
    ...backupFunctions,
    // The jobs of the modules installed (lib/modules/jobs.ts).
    ...moduleJobs,
  ],
});
