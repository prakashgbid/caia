'use client';

/**
 * <LiveVoiceInput> — wrapper around @caia/ui VoiceInput that pushes INTERIM
 * transcripts into the value in real-time (so words appear as they're spoken),
 * then handles the final transcript without duplicating the interim text.
 *
 * The trick: we track the "session base" (what the value was when the user
 * started speaking). Every interim update composes base + interim.
 * Final transcript overwrites the interim with the same base + final.
 * When listening stops, we reset the session base for the next session.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { VoiceInput } from '@caia/ui';

interface Props {
  value: string;
  onValueChange: (v: string) => void;
  fieldLabel?: string;
  className?: string;
}

export function LiveVoiceInput({ value, onValueChange, fieldLabel, className }: Props): React.JSX.Element {
  const sessionBaseRef = useRef<string | null>(null);
  const lastInterimRef = useRef<string>('');
  const [_, setTick] = useState(0);

  const captureBaseIfNeeded = useCallback(() => {
    if (sessionBaseRef.current === null) {
      sessionBaseRef.current = value ? value.trimEnd() + ' ' : '';
      setTick((t) => t + 1);
    }
  }, [value]);

  const handleInterim = useCallback((interim: string) => {
    if (!interim) return;
    captureBaseIfNeeded();
    const base = sessionBaseRef.current || '';
    lastInterimRef.current = interim;
    onValueChange(base + interim.trim());
  }, [onValueChange, captureBaseIfNeeded]);

  const handleFinal = useCallback((v: string) => {
    // VoiceInput's own final path already produced a composed value.
    // We reset our session base so the next dictation session starts fresh.
    // If v ends with our last interim, keep v (it's the "clean" final).
    onValueChange(v);
    sessionBaseRef.current = null;
    lastInterimRef.current = '';
  }, [onValueChange]);

  // Reset session base if value changes externally (user typed manually)
  useEffect(() => {
    if (sessionBaseRef.current !== null && !value.startsWith(sessionBaseRef.current)) {
      sessionBaseRef.current = null;
      lastInterimRef.current = '';
    }
  }, [value]);

  return (
    <VoiceInput
      value={value}
      onValueChange={handleFinal}
      onInterimChange={handleInterim}
      fieldLabel={fieldLabel}
      className={className}
    />
  );
}
