'use client';
// CACHE-001 — Cache monitoring page.
//
// Polls /api/cache/stats every 5 s and shows:
//   - LLM prompt-cache hit rate + routing breakdown
//   - Node-cache (in-process) hit/miss/set/delete counters + reset
//   - Redis configuration summary + connectivity test

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

const REFRESH_MS = 5_000;

interface LlmCacheStats {
  totalCalls: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  localCalls: number;
  claudeCalls: number;
  avgDurationMs: number;
  savedUsd: number;
}

interface NodeCacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRatioPct: number | null;
}

interface RedisConfig {
  host: string;
  port: number;
  dbIndex: number;
  keyPrefix: string;
  ttlSeconds: number;
  maxEntries: number | null;
  enabled: boolean;
  scope: string;
}

interface CacheStats {
  llmCache: LlmCacheStats;
  nodeCache: NodeCacheStats;
  redis: RedisConfig | null;
}

interface PingResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

const card: React.CSSProperties = {
  background: '#1a202c',
  border: '1px solid #2d3748',
  borderRadius: 8,
  padding: 20,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color: '#718096',
};

const bigStat: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 700,
  color: '#90cdf4',
  marginTop: 4,
};

const sub: React.CSSProperties = {
  fontSize: 11,
  color: '#718096',
  marginTop: 2,
};

const sectionHeading: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 13,
  fontWeight: 700,
  color: '#a0aec0',
  textTransform: 'uppercase',
  letterSpacing: 1,
};

function pct(x: number): string {
  if (!Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

function formatUsd(x: number): string {
  if (!Number.isFinite(x) || x === 0) return '$0.0000';
  return `$${x.toFixed(4)}`;
}

function HitRateBar({ rate }: { rate: number }) {
  const pctVal = Math.min(100, Math.max(0, rate * 100));
  const color = pctVal >= 50 ? '#68d391' : pctVal >= 20 ? '#f6e05e' : '#fc8181';
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ height: 6, background: '#2d3748', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pctVal}%`,
            background: color,
            borderRadius: 3,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
    </div>
  );
}

export default function CachePage() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [ping, setPing] = useState<PingResult | null>(null);
  const [pinging, setPinging] = useState(false);
  const [resetting, setResetting] = useState(false);

  const fetchStats = useCallback(() => {
    fetch('/api/cache/stats')
      .then((r) => r.json())
      .then((data: unknown) => {
        if (data && typeof data === 'object' && 'llmCache' in data) {
          setStats(data as CacheStats);
          setError(null);
          setLastUpdated(new Date());
        } else {
          setError('orchestrator unreachable');
        }
      })
      .catch(() => setError('orchestrator unreachable'));
  }, []);

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchStats]);

  const testPing = useCallback(() => {
    setPinging(true);
    fetch('/api/redis/ping')
      .then((r) => r.json())
      .then((data: unknown) => {
        setPing(data as PingResult);
        setPinging(false);
      })
      .catch(() => {
        setPing({ ok: false, error: 'fetch failed' });
        setPinging(false);
      });
  }, []);

  const resetNodeCache = useCallback(() => {
    setResetting(true);
    fetch('/api/cache/node-cache-reset', { method: 'POST' })
      .then(() => {
        setResetting(false);
        fetchStats();
      })
      .catch(() => setResetting(false));
  }, [fetchStats]);

  const llm = stats?.llmCache;
  const nc = stats?.nodeCache;
  const redis = stats?.redis;

  return (
    <div style={{ padding: 24, maxWidth: 960, color: '#e2e8f0', fontFamily: 'monospace' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
            🗄️ Cache
          </h1>
          <div style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>
            {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString()} · auto-refreshes every ${REFRESH_MS / 1000}s`
              : error ?? 'loading…'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link
            href="/keyv"
            style={{
              background: '#2d3748',
              border: '1px solid #4a5568',
              color: '#90cdf4',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 12,
              cursor: 'pointer',
              textDecoration: 'none',
            }}
          >
            🗂️ Browse keys
          </Link>
          <button
            type="button"
            onClick={fetchStats}
            style={{
              background: '#2d3748',
              border: '1px solid #4a5568',
              color: '#e2e8f0',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && !stats && (
        <div style={{ ...card, color: '#fc8181', marginBottom: 20 }}>
          {error} — is the orchestrator running?
        </div>
      )}

      {/* ── Node-cache (in-process) ── */}
      <section style={{ marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <h2 style={sectionHeading}>Node-cache (in-process)</h2>
          <button
            type="button"
            onClick={resetNodeCache}
            disabled={resetting}
            style={{
              background: 'transparent',
              border: '1px solid #4a5568',
              color: resetting ? '#718096' : '#a0aec0',
              borderRadius: 6,
              padding: '4px 12px',
              fontSize: 11,
              cursor: resetting ? 'not-allowed' : 'pointer',
            }}
          >
            {resetting ? 'Resetting…' : 'Reset counters'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {/* Hit ratio */}
          <div style={card}>
            <div style={labelStyle}>Hit ratio</div>
            <div
              style={{
                ...bigStat,
                color:
                  nc?.hitRatioPct == null
                    ? '#4a5568'
                    : nc.hitRatioPct >= 50
                    ? '#68d391'
                    : nc.hitRatioPct >= 20
                    ? '#f6e05e'
                    : '#fc8181',
              }}
            >
              {nc?.hitRatioPct != null ? `${nc.hitRatioPct}%` : '—'}
            </div>
            {nc && nc.hitRatioPct != null && (
              <HitRateBar rate={nc.hitRatioPct / 100} />
            )}
            <div style={sub}>
              {nc ? `${nc.hits + nc.misses} lookups` : 'waiting…'}
            </div>
          </div>

          {/* Hits */}
          <div style={card}>
            <div style={labelStyle}>Hits</div>
            <div style={{ ...bigStat, color: '#68d391' }}>{nc?.hits ?? '—'}</div>
            <div style={sub}>cache returns</div>
          </div>

          {/* Misses */}
          <div style={card}>
            <div style={labelStyle}>Misses</div>
            <div style={{ ...bigStat, color: '#fc8181' }}>{nc?.misses ?? '—'}</div>
            <div style={sub}>cache misses</div>
          </div>

          {/* Sets */}
          <div style={card}>
            <div style={labelStyle}>Sets</div>
            <div style={bigStat}>{nc?.sets ?? '—'}</div>
            <div style={sub}>entries written</div>
          </div>

          {/* Deletes */}
          <div style={card}>
            <div style={labelStyle}>Deletes</div>
            <div style={bigStat}>{nc?.deletes ?? '—'}</div>
            <div style={sub}>entries removed</div>
          </div>
        </div>
      </section>

      {/* ── LLM prompt cache ── */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={sectionHeading}>LLM prompt cache</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <div style={card}>
            <div style={labelStyle}>Hit rate</div>
            <div
              style={{
                ...bigStat,
                color: !llm
                  ? '#90cdf4'
                  : llm.cacheHitRate >= 0.5
                  ? '#68d391'
                  : llm.cacheHitRate >= 0.2
                  ? '#f6e05e'
                  : '#fc8181',
              }}
            >
              {llm ? pct(llm.cacheHitRate) : '—'}
            </div>
            {llm && <HitRateBar rate={llm.cacheHitRate} />}
            <div style={sub}>
              {llm ? `${llm.cacheHits} hits / ${llm.totalCalls} total` : 'waiting…'}
            </div>
          </div>

          <div style={card}>
            <div style={labelStyle}>Cache hits</div>
            <div style={{ ...bigStat, color: '#68d391' }}>{llm?.cacheHits ?? '—'}</div>
            <div style={sub}>{llm ? `${llm.cacheMisses} misses` : ''}</div>
          </div>

          <div style={card}>
            <div style={labelStyle}>Avg latency</div>
            <div style={bigStat}>{llm ? `${Math.round(llm.avgDurationMs)}ms` : '—'}</div>
            <div style={sub}>across all calls</div>
          </div>

          <div style={card}>
            <div style={labelStyle}>Saved (USD)</div>
            <div style={{ ...bigStat, color: '#68d391' }}>
              {llm ? formatUsd(llm.savedUsd) : '—'}
            </div>
            <div style={sub}>vs all-Claude baseline</div>
          </div>
        </div>
      </section>

      {/* ── Routing breakdown ── */}
      {llm && llm.totalCalls > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={sectionHeading}>Routing breakdown</h2>
          <div style={{ ...card, display: 'flex', gap: 40, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#a0aec0', marginBottom: 6 }}>
                Local vs Cached vs Claude
              </div>
              <div
                style={{
                  height: 24,
                  background: '#2d3748',
                  borderRadius: 4,
                  overflow: 'hidden',
                  display: 'flex',
                }}
              >
                <div
                  title={`Local: ${llm.localCalls}`}
                  style={{
                    height: '100%',
                    width: `${(llm.localCalls / llm.totalCalls) * 100}%`,
                    background: '#68d391',
                  }}
                />
                <div
                  title={`Cached: ${llm.cacheHits}`}
                  style={{
                    height: '100%',
                    width: `${(llm.cacheHits / llm.totalCalls) * 100}%`,
                    background: '#90cdf4',
                  }}
                />
                <div
                  title={`Claude: ${llm.claudeCalls}`}
                  style={{ height: '100%', flex: 1, background: '#fc8181' }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 20,
                  marginTop: 8,
                  fontSize: 11,
                  color: '#a0aec0',
                }}
              >
                <span>
                  <span style={{ color: '#68d391' }}>■</span> Local{' '}
                  {pct(llm.localCalls / llm.totalCalls)}
                </span>
                <span>
                  <span style={{ color: '#90cdf4' }}>■</span> Cached {pct(llm.cacheHitRate)}
                </span>
                <span>
                  <span style={{ color: '#fc8181' }}>■</span> Claude{' '}
                  {pct(llm.claudeCalls / llm.totalCalls)}
                </span>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '8px 24px',
                fontSize: 13,
              }}
            >
              <div style={{ color: '#718096' }}>Total</div>
              <div style={{ color: '#718096' }}>Local</div>
              <div style={{ color: '#718096' }}>Claude</div>
              <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{llm.totalCalls}</div>
              <div style={{ color: '#68d391', fontWeight: 600 }}>{llm.localCalls}</div>
              <div style={{ color: '#fc8181', fontWeight: 600 }}>{llm.claudeCalls}</div>
            </div>
          </div>
        </section>
      )}

      {/* ── Redis configuration ── */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={sectionHeading}>Redis configuration</h2>

        {redis ? (
          <div style={card}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '12px 24px',
                marginBottom: 16,
              }}
            >
              <div>
                <div style={labelStyle}>Host</div>
                <div style={{ fontSize: 14, marginTop: 2 }}>
                  {redis.host}:{redis.port}
                </div>
              </div>
              <div>
                <div style={labelStyle}>Database</div>
                <div style={{ fontSize: 14, marginTop: 2 }}>db{redis.dbIndex}</div>
              </div>
              <div>
                <div style={labelStyle}>Status</div>
                <div
                  style={{
                    fontSize: 14,
                    marginTop: 2,
                    color: redis.enabled ? '#68d391' : '#fc8181',
                  }}
                >
                  {redis.enabled ? '● enabled' : '○ disabled'}
                </div>
              </div>
              <div>
                <div style={labelStyle}>Key prefix</div>
                <div style={{ fontSize: 14, marginTop: 2 }}>{redis.keyPrefix || '(none)'}</div>
              </div>
              <div>
                <div style={labelStyle}>TTL</div>
                <div style={{ fontSize: 14, marginTop: 2 }}>
                  {Math.round(redis.ttlSeconds / 86400)}d ({redis.ttlSeconds}s)
                </div>
              </div>
              <div>
                <div style={labelStyle}>Max entries</div>
                <div style={{ fontSize: 14, marginTop: 2 }}>{redis.maxEntries ?? '∞'}</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <button
                type="button"
                onClick={testPing}
                disabled={pinging}
                style={{
                  background: pinging ? '#2d3748' : '#2b4c7e',
                  border: '1px solid #4a5568',
                  color: pinging ? '#718096' : '#90cdf4',
                  borderRadius: 6,
                  padding: '6px 14px',
                  fontSize: 12,
                  cursor: pinging ? 'not-allowed' : 'pointer',
                }}
              >
                {pinging ? 'Testing…' : 'Test connection'}
              </button>

              {ping && (
                <span style={{ fontSize: 12, color: ping.ok ? '#68d391' : '#fc8181' }}>
                  {ping.ok
                    ? `● connected (${ping.latencyMs}ms)`
                    : `○ unreachable — ${ping.error ?? 'unknown error'}`}
                </span>
              )}

              <Link
                href="/settings"
                style={{ fontSize: 12, color: '#718096', textDecoration: 'none', marginLeft: 'auto' }}
              >
                Edit in Settings →
              </Link>
            </div>
          </div>
        ) : (
          <div style={{ ...card, color: '#718096' }}>
            No global Redis configuration found.{' '}
            <Link href="/settings" style={{ color: '#90cdf4' }}>
              Add one in Settings →
            </Link>
          </div>
        )}
      </section>

      {/* No calls yet */}
      {stats && llm?.totalCalls === 0 && nc?.sets === 0 && (
        <div
          style={{
            ...card,
            color: '#718096',
            fontSize: 13,
            textAlign: 'center',
            padding: 32,
          }}
        >
          No cache activity yet. Metrics will appear once the pipeline starts processing.
        </div>
      )}
    </div>
  );
}
