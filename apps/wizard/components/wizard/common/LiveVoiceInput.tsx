'use client';

/**
 * <LiveVoiceInput> — thin wrapper around @caia/ui's VoiceInput that pushes
 * INTERIM transcripts into the value in real-time (not just final).
 *
 * The canonical VoiceInput calls onValueChange only when the speech engine
 * emits `isFinal`, which can take ~1-2 seconds of silence. That felt laggy.
 * This wrapper writes interim text on every event (~200ms updates) so the
 * user sees their words appear as they speak. When the final result lands,
 * it replaces the interim tail so we don't end up with duplicated text.
 */

import { useCallback, useRef } from 'react';
import { VoiceInput } from '@caia/ui';

interface Props {
  value: string;
  onValueChange: (v: string) => void;
  fieldLabel?: string;
  className?: string;
}

export function LiveVoiceInput({ value, onValueChange, fieldLabel, className }: Props): React.JSX.Element {
  // Remember what the value was before this dictation session started, so we
  // can replace interim tail cleanly on each partial update.
  const sessionBaseRef = useRef<string>('');

  const handleInterim = useCallback((interim: string) => {
    if (!interim) return;
    // If this is the first interim of a session, capture the current value as base.
    if (!sessionBaseRef.current || !value.startsWith(sessionBaseRef.current)) {
      sessionBaseRef.current = value ? value.trimEnd() + ' ' : '';
    }
    const composed = sessionBaseRef.current + interim.trim();
    onValueChange(composed);
  }, [value, onValueChange]);

  const handleFinal = useCallback((v: string) => {
    // VoiceInput has already produced a final concatenation via its own
    // onValueChange path; we let it own the settled value. Reset the session
    // base so the next partial starts fresh.
    onValueChange(v);
    sessionBaseRef.current = '';
  }, [onValueChange]);

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
