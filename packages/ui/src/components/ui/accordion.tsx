"use client";
import * as React from "react";
import { cn } from "../../lib/utils.js";

/**
 * Pure-Tailwind Accordion primitive. When @radix-ui/react-accordion lands in
 * the dep tree this becomes a thin wrapper around Radix; the public API of
 * Accordion/AccordionItem/AccordionTrigger/AccordionContent stays stable.
 */

interface AccordionCtx {
  open: Set<string>;
  toggle: (id: string) => void;
  type: "single" | "multiple";
}
const AccordionContext = React.createContext<AccordionCtx | null>(null);

export interface AccordionProps extends React.HTMLAttributes<HTMLDivElement> {
  type?: "single" | "multiple";
  defaultValue?: string | string[];
}

export const Accordion = React.forwardRef<HTMLDivElement, AccordionProps>(
  ({ className, type = "single", defaultValue, children, ...props }, ref) => {
    const initial = Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : [];
    const [open, setOpen] = React.useState<Set<string>>(new Set(initial));
    const toggle = React.useCallback(
      (id: string) => {
        setOpen((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else {
            if (type === "single") next.clear();
            next.add(id);
          }
          return next;
        });
      },
      [type]
    );
    return (
      <AccordionContext.Provider value={{ open, toggle, type }}>
        <div ref={ref} className={cn("w-full", className)} {...props}>
          {children}
        </div>
      </AccordionContext.Provider>
    );
  }
);
Accordion.displayName = "Accordion";

const ItemContext = React.createContext<{ value: string } | null>(null);

export interface AccordionItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export const AccordionItem = React.forwardRef<HTMLDivElement, AccordionItemProps>(
  ({ className, value, children, ...props }, ref) => (
    <ItemContext.Provider value={{ value }}>
      <div ref={ref} className={cn("border-b", className)} {...props}>
        {children}
      </div>
    </ItemContext.Provider>
  )
);
AccordionItem.displayName = "AccordionItem";

export const AccordionTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, ...props }, ref) => {
    const acc = React.useContext(AccordionContext);
    const item = React.useContext(ItemContext);
    if (!acc || !item) throw new Error("AccordionTrigger must be inside an AccordionItem inside an Accordion");
    const isOpen = acc.open.has(item.value);
    return (
      <button
        ref={ref}
        type="button"
        aria-expanded={isOpen}
        onClick={() => acc.toggle(item.value)}
        className={cn(
          "flex flex-1 items-center justify-between py-4 font-medium transition-all hover:underline",
          className
        )}
        {...props}
      >
        {children}
        <span aria-hidden="true" className={cn("ml-2 transition-transform", isOpen && "rotate-180")}>
          ▾
        </span>
      </button>
    );
  }
);
AccordionTrigger.displayName = "AccordionTrigger";

export const AccordionContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const acc = React.useContext(AccordionContext);
    const item = React.useContext(ItemContext);
    if (!acc || !item) throw new Error("AccordionContent must be inside an AccordionItem inside an Accordion");
    const isOpen = acc.open.has(item.value);
    if (!isOpen) return null;
    return (
      <div ref={ref} className={cn("overflow-hidden text-sm pb-4 pt-0", className)} {...props}>
        {children}
      </div>
    );
  }
);
AccordionContent.displayName = "AccordionContent";