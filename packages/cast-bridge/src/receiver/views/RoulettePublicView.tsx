import React from 'react';
import { usePublicState } from '../usePublicState';
import type { PublicRouletteState } from '../../filters/types';

interface RoulettePublicViewProps {
  roomId: string;
}

export function RoulettePublicView({ roomId }: RoulettePublicViewProps) {
  const { state } = usePublicState(roomId);

  if (!state) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#555',
        }}
      >
        Waiting for game data...
      </div>
    );
  }

  const rouletteState = state as PublicRouletteState;
  const numColor =
    rouletteState.wheelColor === 'red'
      ? '#ef4444'
      : rouletteState.wheelColor === 'black'
      ? '#222'
      : '#22c55e';

  return (
    <div
      style={{
        padding: 24,
        color: '#fff',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div
          style={{
            fontSize: 13,
            color: '#888',
            textTransform: 'uppercase',
          }}
        >
          {rouletteState.phase}
        </div>
        {rouletteState.wheelNumber !== null && (
          <div
            style={{
              display: 'inline-flex',
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: numColor,
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 36,
              fontWeight: 'bold',
              margin: '12px auto',
              border: '3px solid #555',
            }}
          >
            {rouletteState.wheelNumber}
          </div>
        )}
        <div style={{ fontSize: 20 }}>
          Pot: ${rouletteState.totalPot.toLocaleString()}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
          Recent numbers:
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {rouletteState.spinHistory.slice(-10).map((s, i) => (
            <div
              key={i}
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background:
                  s.color === 'red'
                    ? '#ef4444'
                    : s.color === 'black'
                    ? '#333'
                    : '#22c55e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 'bold',
                border: '1px solid #555',
              }}
            >
              {s.number}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
