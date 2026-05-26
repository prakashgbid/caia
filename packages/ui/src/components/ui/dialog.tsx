import * as React from "react";
import { cn } from "../../lib/utils.js";

/**
 * Pure-Tailwind Dialog primitive. Promotes to @radix-ui/react-dialog wrapper
 * once Radix lands in the dep tree. Public surface stays stable.
 */

interface DialogCtx {
  open: boolean;
  setOpen: (open: boolean) => void;
}
const DialogContext = React.createContext<DialogCtx | null>(null);

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open: controlled, defaultOpen, onOpenChange, children }: DialogProps) {
  const [uncontrolled, setUncontrolled] = React.useState(!!defaultOpen);
  const open = controlled ?? uncontrolled;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (controlled === undefined) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange]
  );
  return <DialogContext.Provider value={{ open, setOpen }}>{children}</DialogContext.Provider>;
}

export const DialogTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ onClick, ...props }, ref) => {
    const ctx = React.useContext(DialogContext);
    if (!ctx) throw new Error("DialogTrigger must be inside Dialog");
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
DialogTrigger.displayName = "DialogTrigger";

export interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, ...props }, ref) => {
    const ctx = React.useContext(DialogContext);
    if (!ctx) throw new Error("DialogContent must be inside Dialog");
    if (!ctx.open) return null;
    return (
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center">
        <div
          aria-hidden="true"
          className="fixed inset-0 bg-background/80 backdrop-blur-sm"
          onClick={() => ctx.setOpen(false)}
        />
        <div
          ref={ref}
          className={cn(
            "relative z-50 grid w-full max-w-lg gap-4 border bg-background p-6 shadow-lg sm:rounded-lg",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </div>
    );
  }
);
DialogContent.displayName = "DialogContent";

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);

export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);

export const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
  )
);
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
);
DialogDescription.displayName = "DialogDescription";
