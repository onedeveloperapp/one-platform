"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import OnboardingChecklist from "@/components/product/onboarding-checklist";
import { type ActivationFacts, buildOnboardingSteps, isActivated } from "@/lib/onboarding";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { dismissFlow, type FlowKey, type OnboardingStateRow } from "@flyee/onboarding";

/**
 * The firm's setup checklist on the home. The page reads, under the person's
 * session, what the firm has in place (`firm_setup_facts`) and whether this
 * person dismissed the card, and hands both over: each step is done when the
 * thing exists, never because somebody clicked it. It renders nothing once
 * everything is in place or the person dismissed it, so it is safe to mount
 * whenever the page has the facts.
 */
export default function OnboardingChecklistCard({
  flowKey,
  state,
  facts,
  title,
  className,
}: {
  flowKey: FlowKey;
  state: OnboardingStateRow;
  facts: ActivationFacts;
  title?: string;
  className?: string;
}) {
  const t = useTranslations("product");
  const [dismissed, setDismissed] = useState(state.dismissed);

  if (dismissed || state.completedAt || isActivated(facts)) return null;

  // Step titles are message keys declared with the steps (lib/onboarding.ts).
  const steps = buildOnboardingSteps(facts).map((step) => ({
    ...step,
    title: t(step.title),
    description: step.description ? t(step.description) : undefined,
  }));

  const handleDismiss = () => {
    setDismissed(true);
    // What the person chose is kept for them alone; the firm's facts are untouched.
    if (isSupabaseConfigured) void dismissFlow(createClient(), flowKey);
  };

  return (
    <OnboardingChecklist
      title={title}
      steps={steps}
      state={{ ...state, dismissed }}
      onDismiss={handleDismiss}
      className={className}
    />
  );
}
