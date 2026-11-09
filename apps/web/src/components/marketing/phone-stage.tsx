import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import { TONE, type Tone } from "@/components/marketing/tone";
import { cn } from "@/lib/utils";

export type StageCard = {
  /** MEANINGFUL icon: the concept of the card, in its family hue. */
  icon: React.ReactNode;
  tone: Tone;
  /** Up to six words. */
  title: string;
  /** One short sentence: a card is glanced at, never read. */
  body: string;
};

/** One short dark card beside the phone: the hue on the icon's disc, the words in the contrast text. */
function Card({ card }: { card: StageCard }) {
  return (
    <li className="bg-background-deep flex flex-col gap-2.5 rounded-2xl p-5">
      <span
        aria-hidden
        className={cn(
          "bg-text-contrast/10 flex h-10 w-10 items-center justify-center rounded-xl [&_svg]:h-5 [&_svg]:w-5",
          TONE[card.tone].text,
        )}
      >
        {card.icon}
      </span>
      <h3 className="font-heading text-text-contrast text-base leading-5 font-bold">{card.title}</h3>
      <p className="text-text-contrast/75 text-sm leading-5">{card.body}</p>
    </li>
  );
}

/**
 * Funnel stage: desire. The pain answered in the object it happens in: a large phone in the centre, two short dark cards
 * on each side and the client's own words as the title, so the point lands before a word is read (the pain of the
 * sales-page model). Closest entries: <Showcase> pairs a whole chapter of copy with its evidence and leaves the words
 * doing the work; here the phone leads and the words stay beside it. On a phone the phone comes first and the cards
 * follow it.
 */
export default function PhoneStage({
  id,
  track,
  eyebrow,
  title,
  subtitle,
  phone,
  caption,
  left,
  right,
  background,
}: {
  id?: string;
  /** The section's key in the measurement (`section_view`). */
  track?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** The phone: a <PhoneFrame> with what the client sees, marked as a picture by whoever passes it. */
  phone: React.ReactNode;
  /** Under the phone: whose data it is. */
  caption?: string;
  /** The two cards on its left at md+. */
  left: StageCard[];
  /** The two cards on its right at md+. */
  right: StageCard[];
  background?: React.ComponentProps<typeof Section>["background"];
}) {
  return (
    <Section id={id} track={track} background={background}>
      <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <Reveal className="grid grid-cols-1 items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,21rem)_minmax(0,1fr)] md:gap-8">
        <figure className="m-0 flex min-w-0 flex-col gap-3 md:order-2">
          {phone}
          {caption ? <figcaption className="text-text-secondary text-center text-xs">{caption}</figcaption> : null}
        </figure>
        <ul className="m-0 flex list-none flex-col gap-4 p-0 md:order-1">
          {left.map((card) => (
            <Card key={card.title} card={card} />
          ))}
        </ul>
        <ul className="m-0 flex list-none flex-col gap-4 p-0 md:order-3">
          {right.map((card) => (
            <Card key={card.title} card={card} />
          ))}
        </ul>
      </Reveal>
    </Section>
  );
}
