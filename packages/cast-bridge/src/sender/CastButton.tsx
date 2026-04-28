import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CastModal } from './CastModal';
import { useCastSession } from './useCastSession';
import type { PublicPokerState, PublicRouletteState } from '../filters/types';

interface CastButtonProps<S> {
  appName: string;
  publicViewPath: string;
  state: S;
  filterFn: (state: S) => PublicPokerState | PublicRouletteState;
}

export function CastButton<S>({
  appName,
  publicViewPath,
  state,
  filterFn,
}: CastButtonProps<S>) {
  const [showModal, setShowModal] = useState(false);
  const [tabOpened, setTabOpened] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { isCasting, roomId, openCastTab, stop, publishState } = useCastSession({
    publicViewPath,
  });

  // Publish filtered state on every state change (debounced 50ms)
  useEffect(() => {
    if (!isCasting) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      publishState(filterFn(state));
    }, 50);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [state, isCasting, filterFn, publishState]);

  const handleButtonClick = useCallback(() => {
    if (!isCasting) {
      openCastTab();
      setTabOpened(false);
      setShowModal(true);
    } else {
      setShowModal(true);
    }
  }, [isCasting, openCastTab]);

  const handleOpenTab = useCallback(() => {
    setTabOpened(true);
  }, []);

  const handleConfirm = useCallback(() => {
    setShowModal(false);
  }, []);

  const handleStop = useCallback(() => {
    stop();
    setShowModal(false);
    setTabOpened(false);
  }, [stop]);

  return (
    <>
      <button
        onClick={handleButtonClick}
        aria-label={isCasting ? 'Casting to TV — click to manage' : 'Cast to TV'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          borderRadius: 8,
          background: isCasting ? '#22c55e22' : 'transparent',
          border: isCasting ? '1px solid #22c55e' : '1px solid #666',
          color: isCasting ? '#22c55e' : '#ccc',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
          <line x1="2" y1="20" x2="2.01" y2="20" />
        </svg>
        {isCasting ? 'Casting' : 'Cast to TV'}
      </button>

      {showModal && roomId && (
        <CastModal
          appName={appName}
          roomId={roomId}
          onConfirm={handleConfirm}
          onOpenTab={handleOpenTab}
          onStop={handleStop}
          isCasting={isCasting && tabOpened}
        />
      )}
    </>
  );
}
