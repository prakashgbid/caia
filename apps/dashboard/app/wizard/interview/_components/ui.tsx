/**
 * Minimal shadcn/ui-API-compatible primitives.
 *
 * The dashboard's package.json does not yet ship the shadcn/ui runtime
 * (sibling wizard-shell task is responsible for installing it). To keep
 * step 3 self-contained and unblocked we ship local primitives that
 * mirror the shadcn/ui component contracts (Card / Button / Input /
 * ScrollArea). When the sibling task lands, replace the import path
 * with `@/components/ui/*` — the public API is intentionally identical.
 */
import * as React from 'react';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

const cardStyle: React.CSSProperties = {
  background: '#161a23',
  border: '1px solid #2d3748',
  borderRadius: 8,
  padding: 0,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

export function Card({ style, ...rest }: DivProps) {
  return <div data-slot="card" style={{ ...cardStyle, ...style }} {...rest} />;
}

export function CardHeader({ style, ...rest }: DivProps) {
  return (
    <div
      data-slot="card-header"
      style={{
        padding: '12px 16px',
        borderBottom: '1px solid #2d3748',
        fontWeight: 600,
        color: '#f0f4f8',
        ...style,
      }}
      {...rest}
    />
  );
}

export function CardContent({ style, ...rest }: DivProps) {
  return (
    <div
      data-slot="card-content"
      style={{
        padding: 16,
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
      {...rest}
    />
  );
}

export function CardFooter({ style, ...rest }: DivProps) {
  return (
    <div
      data-slot="card-footer"
      style={{
        padding: 12,
        borderTop: '1px solid #2d3748',
        display: 'flex',
        gap: 8,
        ...style,
      }}
      {...rest}
    />
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function Button({
  variant = 'primary',
  style,
  disabled,
  ...rest
}: ButtonProps) {
  const palette: Record<NonNullable<ButtonProps['variant']>, React.CSSProperties> = {
    primary: { background: '#3b82f6', color: '#fff', border: '1px solid #2563eb' },
    secondary: { background: '#1f2937', color: '#e2e8f0', border: '1px solid #374151' },
    ghost: { background: 'transparent', color: '#cbd5e0', border: '1px solid transparent' },
  };
  return (
    <button
      data-slot="button"
      disabled={disabled}
      style={{
        padding: '8px 14px',
        borderRadius: 6,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontSize: 14,
        ...palette[variant],
        ...style,
      }}
      {...rest}
    />
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ style, ...rest }, ref) {
  return (
    <input
      ref={ref}
      data-slot="input"
      style={{
        background: '#0f1117',
        color: '#e2e8f0',
        border: '1px solid #2d3748',
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 14,
        width: '100%',
        ...style,
      }}
      {...rest}
    />
  );
});

interface ScrollAreaProps extends DivProps {
  maxHeight?: number | string;
}

export function ScrollArea({
  maxHeight = '100%',
  style,
  children,
  ...rest
}: ScrollAreaProps) {
  return (
    <div
      data-slot="scroll-area"
      style={{
        overflowY: 'auto',
        maxHeight,
        flex: 1,
        minHeight: 0,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
