/**
 * Minimal shadcn/ui-API-compatible primitives — architecture step.
 *
 * Duplicates the interview step's local stubs so each route directory
 * is self-contained per ownership rules. When the sibling wizard-shell
 * task installs the real shadcn/ui runtime, both step's imports flip
 * from `./ui` to `@/components/ui/*` without API churn.
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
      style={{ padding: 16, ...style }}
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
    primary: { background: '#10b981', color: '#fff', border: '1px solid #059669' },
    secondary: { background: '#1f2937', color: '#e2e8f0', border: '1px solid #374151' },
    ghost: { background: 'transparent', color: '#cbd5e0', border: '1px solid transparent' },
  };
  return (
    <button
      data-slot="button"
      disabled={disabled}
      style={{
        padding: '10px 16px',
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

// ─── Accordion (shadcn/ui-shaped contract) ─────────────────────────────

export interface AccordionItemProps {
  readonly value: string;
  readonly title: string;
  readonly children: React.ReactNode;
  readonly defaultOpen?: boolean;
  readonly badge?: string | number;
}

export function Accordion({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-slot="accordion"
      data-testid="accordion"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {children}
    </div>
  );
}

export function AccordionItem({
  value,
  title,
  children,
  defaultOpen = false,
  badge,
}: AccordionItemProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div
      data-slot="accordion-item"
      data-testid={`accordion-item-${value}`}
      data-state={open ? 'open' : 'closed'}
      style={{
        background: '#161a23',
        border: '1px solid #2d3748',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        data-testid={`accordion-trigger-${value}`}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          padding: '12px 16px',
          background: 'transparent',
          color: '#f0f4f8',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>{title}</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {badge !== undefined ? (
            <span
              data-testid={`accordion-badge-${value}`}
              style={{
                background: '#1f2937',
                color: '#cbd5e0',
                padding: '2px 8px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              {badge}
            </span>
          ) : null}
          <span aria-hidden style={{ color: '#94a3b8' }}>{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open ? (
        <div
          data-testid={`accordion-content-${value}`}
          style={{
            padding: '12px 16px',
            borderTop: '1px solid #2d3748',
            background: '#0f1117',
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
