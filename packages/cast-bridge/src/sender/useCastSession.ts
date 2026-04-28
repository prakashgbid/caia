import { useState, useEffect, useRef, useCallback } from 'react';
import { BroadcastChannelTransport } from './transport/broadcast-channel';
import { generateRoomCode } from '../room/code';
import type { CastMessage, Transport, PublicPokerState, PublicRouletteState } from '../filters/types';

export interface CastSessionOptions {
  publicViewPath: string;
  onStateRequest?: () => unknown;
}

export interface CastSession {
  isCasting: boolean;
  roomId: string | null;
  openCastTab: () => void;
  stop: () => void;
  publishState: (publicState: PublicPokerState | PublicRouletteState) => void;
}

export function useCastSession(options: CastSessionOptions): CastSession {
  const [isCasting, setIsCasting] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const transportRef = useRef<Transport | null>(null);
  const castTabRef = useRef<Window | null>(null);

  const openCastTab = useCallback(() => {
    const code = generateRoomCode();
    setRoomId(code);
    const transport = new BroadcastChannelTransport(code);
    transportRef.current = transport;

    const castUrl = `${options.publicViewPath}/${code}`;
    const tab = window.open(castUrl, 'cast-tab', 'noopener=no,noreferrer=no');
    castTabRef.current = tab;
    setIsCasting(true);
  }, [options.publicViewPath]);

  const stop = useCallback(() => {
    if (transportRef.current) {
      transportRef.current.send({ type: 'STOP' });
      transportRef.current.close();
      transportRef.current = null;
    }
    if (castTabRef.current && !castTabRef.current.closed) {
      castTabRef.current.close();
    }
    setIsCasting(false);
    setRoomId(null);
  }, []);

  const publishState = useCallback(
    (publicState: PublicPokerState | PublicRouletteState) => {
      if (transportRef.current) {
        const msg: CastMessage = { type: 'STATE', state: publicState };
        transportRef.current.send(msg);
      }
    },
    []
  );

  useEffect(() => {
    return () => {
      if (transportRef.current) {
        transportRef.current.close();
      }
    };
  }, []);

  return { isCasting, roomId, openCastTab, stop, publishState };
}
