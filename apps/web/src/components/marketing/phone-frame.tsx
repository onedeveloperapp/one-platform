import NiBatteryFull from "@/icons/nexture/ni-battery-full";
import NiSignalUp from "@/icons/nexture/ni-signal-up";
import { cn } from "@/lib/utils";

/**
 * A phone around a product screen: the client's side of ONE (the
 * conversation on the firm's WhatsApp, the link of the case), where
 * <ProductFrame> is the firm's browser. Chrome only, drawn with tokens: a
 * bezel in the deep band's neutral (dark under any palette and theme), the
 * island and the status line. The screen is real localized content passed as
 * children, never a picture of a phone, so it follows the theme and reads.
 *
 * It sits as the `frame` of a <ProductComposition>, whose satellites overlap
 * its edges; give the composition a narrow width (`max-w-md`) so they do.
 */
export default function PhoneFrame({
  time = "9:41",
  className,
  children,
}: {
  /** The clock of the status line. */
  time?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("bg-background-deep shadow-darker-md mx-auto w-full max-w-72 rounded-4xl p-2", className)}>
      <div className="bg-background relative flex flex-col overflow-hidden rounded-3xl">
        <div
          aria-hidden
          className="text-text-primary relative flex h-9 items-center justify-between px-6 text-xs font-bold"
        >
          <span>{time}</span>
          <span className="bg-background-deep absolute top-2 left-1/2 h-5 w-20 -translate-x-1/2 rounded-full" />
          <span className="flex items-center gap-1">
            <NiSignalUp size="tiny" />
            <NiBatteryFull size="tiny" />
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
