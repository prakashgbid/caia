export default function EnforcementLoading() {
  return (
    <div>
      {/* Header skeleton */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            width: 260,
            height: 26,
            background: '#1a1f2e',
            borderRadius: 6,
            marginBottom: 8,
          }}
        />
        <div
          style={{
            width: 200,
            height: 14,
            background: '#1a1f2e',
            borderRadius: 4,
          }}
        />
      </div>

      {/* KPI cards skeleton */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {[1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            style={{
              background: '#1a1f2e',
              border: '1px solid #2d3748',
              borderRadius: 8,
              padding: '16px 20px',
              flex: '1 1 140px',
              minWidth: 130,
            }}
          >
            <div
              style={{
                width: 48,
                height: 28,
                background: '#2d3748',
                borderRadius: 4,
                marginBottom: 10,
              }}
            />
            <div
              style={{
                width: '80%',
                height: 12,
                background: '#2d3748',
                borderRadius: 4,
              }}
            />
          </div>
        ))}
      </div>

      {/* Middle row skeleton */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.8fr)',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {[1, 2].map(i => (
          <div
            key={i}
            style={{
              background: '#1a1f2e',
              border: '1px solid #2d3748',
              borderRadius: 8,
              padding: 20,
              height: 200,
            }}
          >
            <div
              style={{
                width: 140,
                height: 16,
                background: '#2d3748',
                borderRadius: 4,
                marginBottom: 20,
              }}
            />
            {[1, 2, 3, 4].map(j => (
              <div
                key={j}
                style={{
                  height: 14,
                  background: '#2d3748',
                  borderRadius: 4,
                  marginBottom: 10,
                  width: `${60 + j * 8}%`,
                }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Full table skeleton */}
      <div
        style={{
          background: '#1a1f2e',
          border: '1px solid #2d3748',
          borderRadius: 8,
          padding: 20,
        }}
      >
        <div
          style={{
            width: 100,
            height: 16,
            background: '#2d3748',
            borderRadius: 4,
            marginBottom: 16,
          }}
        />
        <div
          style={{
            height: 32,
            background: '#161b28',
            borderRadius: 4,
            marginBottom: 2,
          }}
        />
        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
          <div
            key={i}
            style={{
              height: 38,
              background: i % 2 === 0 ? '#161b28' : 'transparent',
              borderRadius: 2,
              marginBottom: 1,
              display: 'flex',
              alignItems: 'center',
              padding: '0 10px',
              gap: 16,
            }}
          >
            <div
              style={{
                width: 80,
                height: 12,
                background: '#2d3748',
                borderRadius: 3,
                flexShrink: 0,
              }}
            />
            <div
              style={{
                width: 140,
                height: 12,
                background: '#2d3748',
                borderRadius: 3,
                flexShrink: 0,
              }}
            />
            <div
              style={{
                flex: 1,
                height: 12,
                background: '#2d3748',
                borderRadius: 3,
              }}
            />
            <div
              style={{
                width: 60,
                height: 18,
                background: '#2d3748',
                borderRadius: 12,
                flexShrink: 0,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
