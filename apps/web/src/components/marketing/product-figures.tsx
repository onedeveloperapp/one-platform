import { getTranslations } from "next-intl/server";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import DeadlineCount from "@/components/deadlines/deadline-count";
import {
  EXAMPLE_DEADLINE,
  EXAMPLE_PACKAGE_NAMES,
  EXAMPLE_PERSON,
  EXAMPLE_SYSTEM,
} from "@/components/marketing/product-examples";
import MessageBubble from "@/components/product/message-bubble";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import { formatDayBr } from "@flyee/rules/person";

/**
 * Figures of the product for the public home, drawn with the product's own components and fixed data (the
 * demonstration guide of the sales-page skill: its first choice, `componentes`). Each one shows one thing the
 * product does today, cut to the control that does it, and what is computed is computed by the product's own rule
 * (the deadline by `prazo-v1`, the package's names by `planFiling`, in product-examples.ts), so the figure changes
 * when the rule does, and a test holds the words that describe it to what the rule gives.
 *
 * Every figure is a picture: one name for a screen reader (`role="img"`), its inside inert, and no heading of the
 * product enters the page's outline. The data are invented, and the section that shows a figure says so in its
 * caption ("Exemplo fictício").
 */

const weekdayOf = (day: string): string =>
  new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

/** The client's documents on the link of her case: one accepted, one whose photo came too dark to read. */
export async function DocumentsFigure({ label }: { label: string }) {
  const t = await getTranslations("product");
  return (
    <div role="img" aria-label={label}>
      <Card inert>
        <CardContent>
          <Box component="ul" className="divide-grey-100 m-0 flex list-none flex-col divide-y p-0">
            <Box component="li" className="py-3 first:pt-0">
              <StateLine tone="done" status={t("case-document-status-accepted")}>
                <span className="font-semibold">{t("case-document-identity")}</span>
              </StateLine>
            </Box>
            <Box component="li" className="flex flex-col gap-2 py-3 last:pb-0">
              <StateLine tone="attention" status={t("client-documents-needed")}>
                <span className="font-semibold">{t("case-document-boarding-pass")}</span>
              </StateLine>
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                <Typography variant="body2" component="p" className="mb-1 font-semibold">
                  {t("client-photo-poor-title")}
                </Typography>
                <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
                  <Typography component="li" variant="body2">
                    {t("client-photo-too-dark")}
                  </Typography>
                </Box>
                <Box className="flex flex-wrap gap-2 pt-3">
                  <Button variant="contained" size="small" tabIndex={-1}>
                    {t("client-photo-retake")}
                  </Button>
                  <Button variant="outlined" color="grey" size="small" tabIndex={-1}>
                    {t("client-photo-insist")}
                  </Button>
                </Box>
              </Alert>
            </Box>
          </Box>
        </CardContent>
      </Card>
    </div>
  );
}

/** The filing package of a lawsuit: its files in the order of the filing, under the names the rule gives them. */
export async function PackageFigure({ label }: { label: string }) {
  const t = await getTranslations("product");
  return (
    <div role="img" aria-label={label}>
      <div inert className="bg-grey-25 flex flex-col gap-3 rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Typography variant="body2" component="span" className="text-text-secondary font-semibold">
            {EXAMPLE_SYSTEM}
          </Typography>
          <StatusChip tone="positive" label={t("filing-status-ready")} />
        </div>
        <Box component="ol" className="m-0 flex list-none flex-col gap-2 p-0">
          {EXAMPLE_PACKAGE_NAMES.map((name) => (
            <Box component="li" key={name} className="flex items-start gap-2">
              <NiDocumentFull size="small" className="text-primary mt-0.5 flex-none" />
              <Typography variant="body2" className="text-text-primary min-w-0 break-words">
                {name}
              </Typography>
            </Box>
          ))}
        </Box>
      </div>
    </div>
  );
}

/** A deadline as ONE counted it: the day it ends, and how the rule got there, in the product's own words. */
export async function DeadlineFigure({ label }: { label: string }) {
  if (!EXAMPLE_DEADLINE.ok) return null;
  const t = await getTranslations("product");
  const due = EXAMPLE_DEADLINE.result.dueOn;
  return (
    <div role="img" aria-label={label}>
      <div inert className="flex flex-col gap-3">
        <Typography variant="h4" component="div" className="text-text-primary mb-0">
          {t("deadline-due-on", { day: formatDayBr(due) ?? due, weekday: weekdayOf(due) })}
        </Typography>
        <DeadlineCount count={EXAMPLE_DEADLINE.result} checked={[]} />
      </div>
    </div>
  );
}

/** A client's question in the firm's conversation, answered by ONE from what the case holds. */
export async function ConversationFigure({
  label,
  question,
  answer,
  time,
}: {
  label: string;
  question: string;
  answer: string;
  /** When both were said: ONE answers at once. */
  time: string;
}) {
  const t = await getTranslations("product");
  return (
    <div role="img" aria-label={label} className="w-full">
      <Card inert>
        <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-4 sm:p-5">
          <MessageBubble
            side="in"
            sideLabel={t("inbox-said-person", { name: EXAMPLE_PERSON })}
            meta={
              <>
                <span>{time}</span>
                <span>{t("inbox-by-client")}</span>
              </>
            }
          >
            {question}
          </MessageBubble>
          <MessageBubble
            side="out"
            sideLabel={t("inbox-said-firm")}
            meta={
              <>
                <span>{time}</span>
                <span>{t("inbox-by-one-ai")}</span>
                <StatusChip label={t("inbox-status-delivered")} tone="neutral" />
              </>
            }
          >
            {answer}
          </MessageBubble>
        </Box>
      </Card>
    </div>
  );
}
