import React from 'react';
import { usePublicState } from '../usePublicState';
import type { PublicPokerState, PublicPlayer, FaceDownCards, PublicCard } from '../../filters/types';

interface PokerPublicViewProps {
  roomId: string;
}

export function PokerPublicView({ roomId }: PokerPublicViewProps) {
  const { state, lastUpdated } = usePublicState(roomId);

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

  const pokerState = state as PublicPokerState;

  return (
    <div
      style={{
        padding: 24,
        color: '#fff',
        height: '100%',
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div
          style={{
            fontSize: 13,
            color: '#888',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          {pokerState.street}
        </div>
        <div style={{ fontSize: 28, marginTop: 4 }}>
          Pot: ${pokerState.pot.toLocaleString()}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'center',
          marginBottom: 24,
        }}
      >
        {pokerState.communityCards.map((card, i) => (
          <div
            key={i}
            style={{
              width: 48,
              height: 68,
              background: '#fff',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 'bold',
              color: card.suit === 'H' || card.suit === 'D' ? '#e22' : '#111',
            }}
          >
            {card.rank}
            {card.suit === 'S'
              ? '\u2660'
              : card.suit === 'H'
              ? '\u2665'
              : card.suit === 'D'
              ? '\u2666'
              : '\u2663'}
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          justifyContent: 'center',
        }}
      >
        {pokerState.players.map((player) => (
          <PlayerCard key={player.seatIndex} player={player} />
        ))}
      </div>

      {lastUpdated && (
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            right: 12,
            fontSize: 10,
            color: '#333',
          }}
        >
          Updated {new Date(lastUpdated).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

function PlayerCard({ player }: { player: PublicPlayer }) {
  const isFaceDown = 'faceDown' in player.cards;

  return (
    <div
      style={{
        background: player.isActing
          ? 'rgba(108,99,255,0.2)'
          : 'rgba(255,255,255,0.05)',
        border: `1px solid ${player.isActing ? '#6c63ff' : '#333'}`,
        borderRadius: 8,
        padding: '10px 14px',
        minWidth: 120,
        opacity: player.isFolded ? 0.4 : 1,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>{player.name}</div>
      <div style={{ fontSize: 12, color: '#888' }}>${player.stack.toLocaleString()}</div>
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        {isFaceDown
          ? Array.from({
              length: (player.cards as FaceDownCards).count,
            }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 24,
                  height: 34,
                  background: '#2a2a4a',
                  borderRadius: 3,
                  border: '1px solid #444',
                }}
              />
            ))
          : (player.cards as PublicCard[]).map((card, i) => (
              <div
                key={i}
                style={{
                  width: 24,
                  height: 34,
                  background: '#fff',
                  borderRadius: 3,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 'bold',
                  color: card.suit === 'H' || card.suit === 'D' ? '#e22' : '#111',
                }}
              >
                {card.rank}
              </div>
            ))}
      </div>
      {player.isDealer && (
        <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 4 }}>
          Dealer
        </div>
      )}
    </div>
  );
}
