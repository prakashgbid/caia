import * as React from "react";
import { cn } from "../../lib/utils.js";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0..100 */
  value?: number;
  max?: number;
}

/**
 * Thin Progress primitive. When the wave that pulls in @radix-ui/react-progress
 * lands, this becomes a wrapper around Radix's Progress.Root/Indicator. Until
 * then it is the pure-Tailwind version (no Radix dep) so consumers can already
 * adopt the API.
 */
export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, max = 100, ...props }, ref) => {
    const clamped = Math.min(Math.max(value, 0), max);
    const pct = (clamped / max) * 100;
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={max}
        className={cn("relative h-4 w-full overflow-hidden rounded-full bg-secondary", className)}
        {...props}
      >
        <div
          className="h-full w-full flex-1 bg-primary transition-all"
          style={{ transform: `translateX(-${100 - pct}%)` }}
        />
      </div>
    );
  }
);
Progress.displayName = "Progress";
