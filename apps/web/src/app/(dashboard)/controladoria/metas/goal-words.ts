import type { useTranslations } from "next-intl";

import { type ClosingGoal, monthLabel, ORIGIN_KEY, wholeMonth } from "@/lib/controladoria/goals";
import type { ModuleCard } from "@/lib/modules/offer";
import { caseKindLabelKey } from "@/lib/modules/registry";
import { formatDayBr } from "@flyee/rules/person";

/**
 * How a closing goal is said on the screens (its list and the controladoria's card): its period (a whole month by its
 * name, with a capital only where it stands alone, else its first and last days) and the part of the cases it is of
 * (the module where the page reads several, the kind of problem, the agency or the origin), or every case of the firm.
 */
export function goalWords(t: ReturnType<typeof useTranslations>, modules: ModuleCard[], scope: ModuleCard | null) {
  const periodOf = (goal: ClosingGoal, inSentence = false) =>
    wholeMonth(goal.startsOn, goal.endsOn)
      ? monthLabel(goal.startsOn, inSentence)
      : t("goals-period-range", {
          from: formatDayBr(goal.startsOn) ?? goal.startsOn,
          until: formatDayBr(goal.endsOn) ?? goal.endsOn,
        });
  const scopeOf = (goal: ClosingGoal) => {
    const parts = [
      goal.module && modules.length > 1 && !scope
        ? (modules.find((module) => module.key === goal.module)?.name ?? null)
        : null,
      goal.incident ? t(caseKindLabelKey(goal.incident) ?? "case-incident-other") : null,
      goal.partner ? t("goals-scope-partner", { name: goal.partner }) : goal.origin ? t(ORIGIN_KEY[goal.origin]) : null,
    ].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(" · ") : t("goals-scope-all");
  };
  return { periodOf, scopeOf };
}
