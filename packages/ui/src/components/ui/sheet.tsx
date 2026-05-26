import * as React from "react";
import { cn } from "../../lib/utils.js";

/**
 * Pure-Tailwind Sheet primitive (side-anchored Dialog). Promotes to
 * @radix-ui/react-dialog wrapper later; public surface stays stable.
 */

interface SheetCtx {
  open: boolean;
  setOpen: (open: boolean) => void;
}
const SheetContext = React.createContext<SheetCtx | null>(null);

export interface SheetProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function Sheet({ open: controlled, defaultOpen, onOpenChange, children }: SheetProps) {
  const [uncontrolled, setUncontrolled] = React.useState(!!defaultOpen);
  const open = controlled ?? uncontrolled;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (controlled === undefined) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange]
  );
  return <SheetContext.Provider value={{ open, setOpen }}>{children}</SheetContext.Provider>;
}

export const SheetTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ onClick, ...props }, ref) => {
    const ctx = React.useContext(SheetContext);
    if (!ctx) throw new Error("SheetTrigger must be inside Sheet");
    return (
      <button
        ref={ref}
        type="button"
        onClick={(e) => {
          ctx.setOpen(true);
          onClick?.(e);
        }}
        {...props}
      />
    );
  }
);
SheetTrigger.displayName = "SheetTrigger";

export interface SheetContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: "left" | "right" | "top" | "bottom";
}

const sideClasses: Record<NonNullable<SheetContentProps["side"]>, string> = {
  right: "inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
  left: "inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
  top: "inset-x-0 top-0 border-b",
  bottom: "inset-x-0 bottom-0 border-t",
};

export const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  ({ className, side = "right", children, ...props }, ref) => {
    const ctx = React.useContext(SheetContext);
    if (!ctx) throw new Error("SheetContent must be inside Sheet");
    if (!ctx.open) return null;
    return (
      <div className="fixed inset-0 z-50">
        <div
          aria-hidden="true"
          className="fixed inset-0 bg-background/80 backdrop-blur-sm"
          onClick={() => ctx.setOpen(false)}
        />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          className={cn("fixed z-50 gap-4 bg-background p-6 shadow-lg", sideClasses[side], className)}
          {...props}
        >
          {children}
        </div>
      </div>
    );
  }
);
SheetContent.displayName = "SheetContent";
