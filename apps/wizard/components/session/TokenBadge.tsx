'use client';

/**
 * <TokenBadge> — pill shown in the WizardShell header that renders the
 * user's current token balance. Listens for 'caia:session-change' events
 * and animates when the number drops.
 */

import { useEffect, useState } from 'react';
import { Coins } from 'lucide-react';
import { readSession, STARTING_TOKENS } from '../../lib/session/tokens';

export function TokenBadge(): React.JSX.Element {
  const [tokens, setTokens] = useState<number>(STARTING_TOKENS);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const s = readSession();
    setTokens(s.tokens);
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tokens: number }>).detail;
      if (detail && typeof detail.tokens === 'number') {
        setTokens((prev) => {
          if (detail.tokens !== prev) {
            setPulse(true);
            setTimeout(() => setPulse(false), 500);
          }
          return detail.tokens;
        });
      }
    };
    window.addEventListener('caia:session-change', handler);
    return () => window.removeEventListener('caia:session-change', handler);
  }, []);

  const empty = tokens <= 0;
  const low = tokens > 0 && tokens < 10;

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 h-8 rounded-full text-xs font-semibold border transition-all ${
        pulse ? 'scale-110' : ''
      } ${
        empty
          ? 'bg-destructive/15 border-destructive/40 text-destructive'
          : low
            ? 'bg-warning/15 border-warning/40 text-warning'
            : 'bg-primary/10 border-primary/30 text-primary'
      }`}
      title={`${tokens} CAIA tokens remaining`}
      data-testid="token-badge"
    >
      <Coins className="w-3.5 h-3.5" />
      <span className="tabular-nums">{tokens}</span>
    </div>
  );
}
