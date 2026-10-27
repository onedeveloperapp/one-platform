import Band from "@/components/marketing/band";
import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";

/**
 * Funnel stage: trust. Without real client logos, names render as muted
 * wordmarks; derived projects replace `items` with SVG logos (token-tinted).
 * Never a client who is not one: ONE's home lists the systems it works with,
 * and its label says so.
 *
 * `band` lays the strip on a full-bleed contrast band tilted a degree (the
 * page's breakout), where the default sits on the page's own background.
 */
export default function LogoCloud({
  label,
  items,
  band = false,
  track,
}: {
  label: string;
  items: { name: string; logo?: React.ReactNode }[];
  band?: boolean;
  /** The section's key in the measurement (`section_view`). */
  track?: string;
}) {
  const strip = (
    <Reveal className="flex flex-col items-center gap-6">
      <p className="text-text-secondary text-center text-sm">{label}</p>
      <ul className="flex flex-row flex-wrap items-center justify-center gap-x-10 gap-y-4 md:gap-x-16">
        {items.map((item) => (
          <li key={item.name} className="text-text-muted font-heading text-2xl font-bold tracking-tight">
            {item.logo ?? item.name}
          </li>
        ))}
      </ul>
    </Reveal>
  );

  if (band) {
    return (
      <Band angle={-1} spacing="tight" background="contrast" className="my-6" track={track}>
        {strip}
      </Band>
    );
  }
  return (
    <Section spacing="compact" track={track}>
      {strip}
    </Section>
  );
}
