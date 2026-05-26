import * as React from "react";
import { cn } from "../../lib/utils.js";

/**
 * Minimal Form primitive set — Label, Field, ErrorMessage, FormDescription.
 * Will be augmented with a react-hook-form adapter once that dep lands;
 * the primitive surface (Label/Field/ErrorMessage/FormDescription) stays stable.
 */

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    />
  )
);
Label.displayName = "Label";

export const FormField = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("space-y-2", className)} {...props} />
  )
);
FormField.displayName = "FormField";

export const FormDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
);
FormDescription.displayName = "FormDescription";

export const FormErrorMessage = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, children, ...props }, ref) => {
    if (!children) return null;
    return (
      <p ref={ref} role="alert" className={cn("text-sm font-medium text-destructive", className)} {...props}>
        {children}
      </p>
    );
  }
);
FormErrorMessage.displayName = "FormErrorMessage";
