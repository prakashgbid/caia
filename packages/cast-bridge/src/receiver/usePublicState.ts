import { useState, useEffect } from 'react';
import { BroadcastChannelTransport } from '../sender/transport/broadcast-channel';
import type { PublicPokerState, PublicRouletteState } from '../filters/types';

type PublicState = PublicPokerState | PublicRouletteState | null;

interface UsePublicStateResult {
  state: PublicState;
  stopped: boolean;
  lastUpdated: number | null;
}

const TIMEOUT_MS = 30_000;

export function usePublicState(roomId: string): UsePublicStateResult {
  const [state, setState] = useState<PublicState>(null);
  const [stopped, setStopped] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    const transport = new BroadcastChannelTransport(roomId);
    let timeoutId: ReturnType<typeof setTimeout>;

    const resetTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setStopped(true);
      }, TIMEOUT_MS);
    };

    resetTimeout();

    const unsubscribe = transport.onMessage((msg) => {
      if (msg.type === 'STATE') {
        setState(msg.state as PublicState);
        setLastUpdated(Date.now());
        resetTimeout();
      } else if (msg.type === 'STOP') {
        setStopped(true);
        clearTimeout(timeoutId);
      }
    });

    return () => {
      unsubscribe();
      transport.close();
      clearTimeout(timeoutId);
    };
  }, [roomId]);

  return { state, stopped, lastUpdated };
}
