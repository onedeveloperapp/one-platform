import { IconButton, Tooltip } from "@mui/material";

import NiPause from "@/icons/nexture/ni-pause";
import NiPlay from "@/icons/nexture/ni-play";

/**
 * The pause and play of an example that changes by itself (<SourceRadar>,
 * <TypingLine>): what moves for more than five seconds beside other content
 * can be paused (WCAG 2.2, 2.2.2). Pressed while it runs, it pauses; once it
 * stopped, it plays the examples again from where they are.
 */
export default function AutoplayButton({
  running,
  onToggle,
  pauseLabel,
  playLabel,
  className,
}: {
  running: boolean;
  onToggle: () => void;
  pauseLabel: string;
  playLabel: string;
  className?: string;
}) {
  const label = running ? pauseLabel : playLabel;
  return (
    <Tooltip title={label}>
      <IconButton size="small" aria-label={label} onClick={onToggle} className={className}>
        {running ? <NiPause size="small" /> : <NiPlay size="small" />}
      </IconButton>
    </Tooltip>
  );
}
