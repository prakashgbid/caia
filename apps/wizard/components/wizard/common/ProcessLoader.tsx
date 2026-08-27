'use client';

/**
 * <ProcessLoader> — descriptive loader for long-running AI/backend calls.
 *
 * Shows the current status line and cycles through a set of "what's
 * happening" substep messages so the user knows CAIA is thinking, not stuck.
 */

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface Props {
  status: string;
  substeps?: string[];
  className?: string;
}

export function ProcessLoader({ status, substeps, className }: Props): React.JSX.Element {
  const [substepIdx, setSubstepIdx] = useState(0);
  useEffect(() => {
    if (!substeps || substeps.length === 0) return;
    const id = setInterval(() => setSubstepIdx((i) => (i + 1) % substeps.length), 2200);
    return () => clearInterval(id);
  }, [substeps]);

  return (
    <div
      className={`rounded-2xl border border-primary/30 bg-primary/5 p-5 flex items-start gap-3 ${className || ''}`}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="w-5 h-5 text-primary animate-spin flex-shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{status}</div>
        {substeps && substeps.length > 0 && (
          <div className="text-xs text-muted-foreground mt-1 h-4 overflow-hidden">
            <div
              key={substepIdx}
              className="animate-in fade-in slide-in-from-bottom-1 duration-500"
            >
              {substeps[substepIdx]}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
