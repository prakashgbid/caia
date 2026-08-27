'use client';

/**
 * <StageExplainer> — shown at the top of every wizard stage.
 *
 * Explains WHAT the stage does and WHY it matters, in plain language a
 * non-technical founder understands. Uses a soft brand-tinted card so it
 * reads as guidance, not error/warning.
 */

import { Info } from 'lucide-react';

interface Props {
  title: string;
  body: string;
  why?: string;
}

export function StageExplainer({ title, body, why }: Props): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5 mb-4 sm:mb-6">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-brand-gradient flex items-center justify-center flex-shrink-0 shadow-md shadow-primary/20">
          <Info className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm sm:text-base leading-snug">{title}</div>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{body}</p>
          {why && (
            <p className="text-xs text-muted-foreground/80 mt-2 leading-relaxed">
              <span className="text-primary font-medium">Why:</span> {why}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
