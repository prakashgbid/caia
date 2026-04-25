import React from 'react';

interface CastModalProps {
  appName: string;
  roomId: string;
  onConfirm: () => void;
  onOpenTab: () => void;
  onStop: () => void;
  isCasting: boolean;
}

export function CastModal({
  appName,
  roomId,
  onConfirm,
  onOpenTab,
  onStop,
  isCasting,
}: CastModalProps) {
  return (
    <div
      role="dialog"
      aria-label="Cast to TV"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: '#1a1a2e',
          color: '#fff',
          borderRadius: 12,
          padding: 32,
          maxWidth: 480,
          width: '90%',
        }}
      >
        <h2 style={{ marginTop: 0 }}>Cast {appName} to TV</h2>

        {!isCasting ? (
          <>
            <p>
              This opens a <strong>public view</strong> tab — your hole cards and balance stay
              private on this screen.
            </p>
            <ol style={{ paddingLeft: 20 }}>
              <li>
                Click <strong>"Open cast tab"</strong> below.
              </li>
              <li>
                In that tab's browser, open the menu (&#8942;) →{' '}
                <strong>Cast</strong> → pick your Chromecast / TV.
              </li>
              <li>
                Come back here and click <strong>"Done — I'm casting"</strong>.
              </li>
            </ol>
            <div style={{ marginTop: 8, fontSize: 12, color: '#aaa' }}>
              Room code: <code>{roomId}</code>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button
                onClick={onOpenTab}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  background: '#6c63ff',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 15,
                }}
              >
                Open cast tab
              </button>
              <button
                onClick={onConfirm}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  background: '#22c55e',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 15,
                }}
              >
                Done — I'm casting
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                background: 'rgba(99,255,99,0.1)',
                border: '1px solid #22c55e',
                borderRadius: 8,
                padding: 16,
                marginBottom: 24,
              }}
            >
              <strong>Casting to TV</strong> — public view is live on your TV.
            </div>
            <button
              onClick={onStop}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 15,
              }}
            >
              Stop casting
            </button>
          </>
        )}
      </div>
    </div>
  );
}
