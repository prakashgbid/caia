import * as React from "react";
import { cn } from "../../lib/utils.js";

/**
 * Pure-Tailwind ScrollArea primitive. Promotes to @radix-ui/react-scroll-area
 * wrapper later; public surface stays stable.
 */
export const ScrollArea = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn("relative overflow-auto", className)} {...props}>
      {children}
    </div>
  )
);
ScrollArea.displayName = "ScrollArea";
