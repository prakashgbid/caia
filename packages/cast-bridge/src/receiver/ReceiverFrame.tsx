import React from 'react';
import { usePublicState } from './usePublicState';

interface ReceiverFrameProps {
  appName: string;
  roomId: string;
  children: React.ReactNode;
}

export function ReceiverFrame({ appName, roomId, children }: ReceiverFrameProps) {
  const { stopped } = usePublicState(roomId);

  if (stopped) {
    return (
      <div
        style={{
          width: '100dvw',
          height: '100dvh',
          background: '#0a0a0f',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 16 }}>TV</div>
        <h2 style={{ margin: 0 }}>Casting ended</h2>
        <p style={{ color: '#888', marginTop: 8 }}>{appName} — public view</p>
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100dvw',
        height: '100dvh',
        background: '#0a0a0f',
        overflow: 'hidden',
        position: 'relative',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 100,
          background: 'rgba(0,0,0,0.6)',
          color: '#888',
          fontSize: 11,
          padding: '4px 10px',
          borderRadius: 4,
          letterSpacing: '0.05em',
        }}
      >
        PUBLIC VIEW — your cards stay on your device
      </div>
      {children}
    </div>
  );
}
