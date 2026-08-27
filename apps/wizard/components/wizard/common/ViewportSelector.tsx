'use client';

/**
 * <ViewportSelector> — Phone / Tablet / Desktop toggle above a preview iframe.
 *
 * Returns width/height for the parent to size the iframe container.
 */

import { Monitor, Smartphone, Tablet } from 'lucide-react';

export type Viewport = 'phone' | 'tablet' | 'desktop';

export const VIEWPORTS: Record<Viewport, { w: number; h: number; name: string; icon: React.ComponentType<{ className?: string }> }> = {
  phone:   { w: 390,  h: 844,  name: 'Phone',   icon: Smartphone },
  tablet:  { w: 768,  h: 1024, name: 'Tablet',  icon: Tablet },
  desktop: { w: 1440, h: 900,  name: 'Desktop', icon: Monitor },
};

interface Props { value: Viewport; onChange: (v: Viewport) => void; className?: string; }

export function ViewportSelector({ value, onChange, className }: Props): React.JSX.Element {
  return (
    <div className={`inline-flex rounded-md border border-border/60 bg-card p-0.5 ${className || ''}`}>
      {(Object.keys(VIEWPORTS) as Viewport[]).map((k) => {
        const V = VIEWPORTS[k];
        const Icon = V.icon;
        const active = value === k;
        return (
          <button key={k} type="button" onClick={() => onChange(k)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-all ${active ? 'bg-brand-gradient text-white' : 'text-muted-foreground hover:text-foreground'}`}
            aria-pressed={active}
            title={`${V.name} · ${V.w}×${V.h}`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{V.name}</span>
          </button>
        );
      })}
    </div>
  );
}
