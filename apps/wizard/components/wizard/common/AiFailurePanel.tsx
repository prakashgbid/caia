'use client';

/**
 * <AiFailurePanel> — friendly "the AI stumbled" panel.
 *
 * NEVER shows raw errors. Always frames the failure as a retry-able state.
 */

import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@caia/ui';

interface Props {
  onRetry?: () => void;
  message?: string;
}

export function AiFailurePanel({ onRetry, message }: Props): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5 flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Our AI hit a small snag.</div>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
          {message || 'The AI provider is a bit slow right now. Please click Try again — most of the time the second try goes through cleanly.'}
        </p>
        {onRetry && (
          <Button onClick={onRetry} variant="outline" size="sm" className="mt-3">
            <RefreshCw className="w-3.5 h-3.5 mr-2" />
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
