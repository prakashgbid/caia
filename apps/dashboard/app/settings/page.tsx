'use client';
import { useEffect, useState, useCallback } from 'react';

/**
 * DASH-313 — Real settings page.
 *
 * Reads orchestrator config from `/api/executor/status` (which embeds
 * the executor_config singleton + daemon liveness) and lets the user
 * toggle pause/resume + adjust max_concurrent / circuit_breaker_threshold
 * via PATCH /api/executor/config.
 *
 * Backend wiring (apps/orchestrator/src/api/routes/executor.ts):
 *   POST /executor/pause | /executor/resume   — flips enabled
 *   PATCH /executor/config                    — accepts max_concurrent,
 *                                               circuit_breaker_threshold,
 *                                               poll_interval_ms, max_turns
 *
 * Redis wiring (apps/orchestrator/src/api/routes/redis.ts):
 *   GET  /redis/config   — returns current RedisCacheOptions
 *   PATCH /redis/config  — updates connection/TTL settings
 *   GET  /redis/ping     — returns { ok, latencyMs? }
 */

interface ExecutorStatus {
  enabled: boolean;
  daemon_alive: boolean;
  daemon_pid: number | null;
  last_heartbeat_at: string | null;
  running: number;
  queued: number;
  paused: number;
  completed_24h: number;
  config: {
    enabled: boolean;
    maxConcurrent: number;
    circuitBreakerThreshold: number;
    pollIntervalMs: number;
    maxTurns: number;
  };
}

// Shape returned by GET /api/redis/config (Drizzle camelCase, array)
interface RedisRow {
  id: string;
  name: string;
  projectId: string | null;
  host: string;
  port: number;
  dbIndex: number;
  password: string | null;
  keyPrefix: string;
  ttlSeconds: number;
  maxEntries: number | null;
  enabled: boolean;
  scope: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface NodeCacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRatioPct: number | null;
}

const EMPTY_FORM = {
  name: '',
  host: 'localhost',
  port: 6379,
  dbIndex: 0,
  password: '',
  keyPrefix: '',
  ttlDays: 1,
  maxEntries: '',
  enabled: true,
  scope: 'global' as 'global' | 'project-specific',
};

export default function SettingsPage() {
  const [status, setStatus] = useState<ExecutorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState<number>(3);
  const [breakerThreshold, setBreakerThreshold] = useState<number>(3);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Redis state
  const [redisConnectionMode, setRedisConnectionMode] = useState<'url' | 'hostport'>('hostport');
  const [redisUrl, setRedisUrl] = useState('');
  const [redisHost, setRedisHost] = useState('127.0.0.1');
  const [redisPort, setRedisPort] = useState(6379);
  const [redisPassword, setRedisPassword] = useState('');
  const [redisDb, setRedisDb] = useState(0);
  const [redisKeyPrefix, setRedisKeyPrefix] = useState('');
  const [redisTtlDays, setRedisTtlDays] = useState(30);
  const [redisEnabled, setRedisEnabled] = useState(true);
  const [redisBusy, setRedisBusy] = useState(false);
  const [redisMsg, setRedisMsg] = useState<string | null>(null);
  const [redisMsgOk, setRedisMsgOk] = useState(true);
  const [redisPingStatus, setRedisPingStatus] = useState<'idle' | 'pinging' | 'ok' | 'error'>('idle');
  const [redisPingMs, setRedisPingMs] = useState<number | null>(null);

  // Node-cache stats state
  const [ncStats, setNcStats] = useState<NodeCacheStats | null>(null);
  const [ncBusy, setNcBusy] = useState(false);
  const [ncMsg, setNcMsg] = useState<string | null>(null);

  // Named configs state
  const [rcoList, setRcoList] = useState<RedisRow[]>([]);
  const [rcoFormVisible, setRcoFormVisible] = useState(false);
  const [rcoEditId, setRcoEditId] = useState<string | null>(null);
  const [rcoForm, setRcoForm] = useState({ ...EMPTY_FORM });
  const [rcoBusy, setRcoBusy] = useState(false);
  const [rcoMsg, setRcoMsg] = useState<string | null>(null);
  const [rcoMsgOk, setRcoMsgOk] = useState(true);
  const [rcoTestStatus, setRcoTestStatus] = useState<Record<string, 'idle' | 'pinging' | 'ok' | 'error'>>({});
  const [rcoTestMs, setRcoTestMs] = useState<Record<string, number | null>>({});

  const loadNodeCacheStats = useCallback(async () => {
    try {
      const res = await fetch('/api/cache/stats', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json() as { nodeCache?: NodeCacheStats };
      if (data.nodeCache) setNcStats(data.nodeCache);
    } catch { /* silent */ }
  }, []);

  const resetNodeCache = async () => {
    setNcBusy(true);
    setNcMsg(null);
    try {
      const res = await fetch('/api/node-cache/reset', { method: 'POST' });
      if (res.ok) {
        setNcMsg('Stats reset');
        await loadNodeCacheStats();
      } else {
        setNcMsg('Reset failed');
      }
    } catch {
      setNcMsg('Orchestrator unreachable');
    } finally {
      setNcBusy(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/executor/status');
      if (res.ok) {
        const data = await res.json() as ExecutorStatus;
        setStatus(data);
        if (data.config) {
          setMaxConcurrent(data.config.maxConcurrent);
          setBreakerThreshold(data.config.circuitBreakerThreshold);
        }
      }
    } catch { /* silent */ }
    setLoading(false);
  };

  const loadRedis = useCallback(async () => {
    try {
      const res = await fetch('/api/redis/config');
      if (!res.ok) return;
      const rows = await res.json() as RedisRow[];
      const all = Array.isArray(rows) ? rows : [];
      setRcoList(all);
      // Populate global singleton fields from the first global row
      const globalRow = all.find(r => r.scope === 'global') ?? all[0] ?? null;
      if (!globalRow) return;
      setRedisHost(globalRow.host ?? '127.0.0.1');
      setRedisPort(globalRow.port ?? 6379);
      setRedisDb(globalRow.dbIndex ?? 0);
      setRedisKeyPrefix(globalRow.keyPrefix ?? '');
      setRedisTtlDays(globalRow.ttlSeconds ? Math.round(globalRow.ttlSeconds / 86400) : 30);
      setRedisEnabled(globalRow.enabled ?? true);
      // Don't populate password — backend masks it as '***'
    } catch { /* silent */ }
  }, []);

  useEffect(() => { void load(); void loadRedis(); void loadNodeCacheStats(); }, [loadRedis, loadNodeCacheStats]);

  const pingRedis = async () => {
    setRedisPingStatus('pinging');
    setRedisPingMs(null);
    try {
      const res = await fetch('/api/redis/ping');
      const data = await res.json() as { ok: boolean; latencyMs?: number; error?: string };
      if (data.ok) {
        setRedisPingStatus('ok');
        setRedisPingMs(data.latencyMs ?? null);
      } else {
        setRedisPingStatus('error');
      }
    } catch {
      setRedisPingStatus('error');
    }
  };

  const openAddForm = () => {
    setRcoEditId(null);
    setRcoForm({ ...EMPTY_FORM });
    setRcoMsg(null);
    setRcoFormVisible(true);
  };

  const openEditForm = (row: RedisRow) => {
    setRcoEditId(row.id);
    setRcoForm({
      name: row.name,
      host: row.host,
      port: row.port,
      dbIndex: row.dbIndex,
      password: '',
      keyPrefix: row.keyPrefix,
      ttlDays: Math.max(1, Math.round(row.ttlSeconds / 86400)),
      maxEntries: row.maxEntries !== null ? String(row.maxEntries) : '',
      enabled: row.enabled,
      scope: row.scope === 'project-specific' ? 'project-specific' : 'global',
    });
    setRcoMsg(null);
    setRcoFormVisible(true);
  };

  const cancelRcoForm = () => {
    setRcoFormVisible(false);
    setRcoEditId(null);
    setRcoMsg(null);
  };

  const saveRco = async () => {
    if (!rcoForm.name.trim()) {
      setRcoMsg('Name is required');
      setRcoMsgOk(false);
      return;
    }
    setRcoBusy(true);
    setRcoMsg(null);
    try {
      const body: Record<string, unknown> = {
        name: rcoForm.name.trim(),
        host: rcoForm.host,
        port: rcoForm.port,
        db_index: rcoForm.dbIndex,
        key_prefix: rcoForm.keyPrefix,
        ttl_seconds: rcoForm.ttlDays * 86400,
        max_entries: rcoForm.maxEntries !== '' ? Number(rcoForm.maxEntries) : null,
        enabled: rcoForm.enabled,
        scope: rcoForm.scope,
        ...(rcoForm.password ? { password: rcoForm.password } : {}),
      };
      const url = rcoEditId ? `/api/redis/config/${rcoEditId}` : '/api/redis/config';
      const method = rcoEditId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setRcoMsg(rcoEditId ? 'Config updated' : 'Config created');
        setRcoMsgOk(true);
        setRcoFormVisible(false);
        setRcoEditId(null);
        await loadRedis();
      } else {
        const err = await res.json() as { error?: string };
        setRcoMsg(err.error ?? 'Save failed');
        setRcoMsgOk(false);
      }
    } catch {
      setRcoMsg('Save failed — orchestrator unreachable');
      setRcoMsgOk(false);
    } finally {
      setRcoBusy(false);
    }
  };

  const pingConfig = async (id: string) => {
    setRcoTestStatus(s => ({ ...s, [id]: 'pinging' }));
    setRcoTestMs(s => ({ ...s, [id]: null }));
    try {
      const res = await fetch(`/api/redis/ping/${id}`);
      const data = await res.json() as { ok: boolean; latencyMs?: number };
      setRcoTestStatus(s => ({ ...s, [id]: data.ok ? 'ok' : 'error' }));
      if (data.ok) setRcoTestMs(s => ({ ...s, [id]: data.latencyMs ?? null }));
    } catch {
      setRcoTestStatus(s => ({ ...s, [id]: 'error' }));
    }
  };

  const deleteRco = async (id: string) => {
    if (!confirm('Delete this Redis config?')) return;
    setRcoBusy(true);
    try {
      await fetch(`/api/redis/config/${id}`, { method: 'DELETE' });
      await loadRedis();
    } finally {
      setRcoBusy(false);
    }
  };

  const saveRedis = async () => {
    setRedisBusy(true);
    setRedisMsg(null);
    try {
      let connFields: Record<string, unknown>;
      if (redisConnectionMode === 'url' && redisUrl) {
        try {
          const parsed = new URL(redisUrl);
          connFields = {
            host: parsed.hostname || '127.0.0.1',
            port: parsed.port ? parseInt(parsed.port, 10) : 6379,
            db_index: parsed.pathname && parsed.pathname !== '/' ? parseInt(parsed.pathname.slice(1), 10) || 0 : 0,
            ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
          };
        } catch {
          setRedisMsg('Invalid Redis URL format');
          setRedisMsgOk(false);
          setRedisBusy(false);
          return;
        }
      } else {
        connFields = {
          host: redisHost,
          port: redisPort,
          db_index: redisDb,
          ...(redisPassword ? { password: redisPassword } : {}),
        };
      }
      const body: Record<string, unknown> = {
        ...connFields,
        key_prefix: redisKeyPrefix,
        ttl_seconds: redisTtlDays * 86400,
        enabled: redisEnabled,
      };
      const res = await fetch('/api/redis/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setRedisMsg('Redis config saved');
        setRedisMsgOk(true);
      } else {
        setRedisMsg('Save failed — check orchestrator logs');
        setRedisMsgOk(false);
      }
    } catch {
      setRedisMsg('Save failed — orchestrator unreachable');
      setRedisMsgOk(false);
    } finally {
      setRedisBusy(false);
    }
  };

  const togglePauseResume = async () => {
    if (!status) return;
    setBusy(true);
    try {
      const path = status.enabled ? '/api/executor/pause' : '/api/executor/resume';
      await fetch(path, { method: 'POST' });
      setStatusMsg(status.enabled ? 'Executor paused' : 'Executor resumed');
      await load();
    } finally { setBusy(false); }
  };

  const saveConfig = async () => {
    setBusy(true);
    try {
      await fetch('/api/executor/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          max_concurrent: maxConcurrent,
          circuit_breaker_threshold: breakerThreshold,
        }),
      });
      setStatusMsg('Config saved');
      await load();
    } finally { setBusy(false); }
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 16px', fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>⚙️ Settings</h1>

      {loading ? (
        <p style={{ color: '#718096' }}>Loading executor status…</p>
      ) : !status ? (
        <p style={{ color: '#fc8181' }}>Could not reach orchestrator. Is the API up at <code>localhost:7776</code>?</p>
      ) : (
        <>
          {/* Backend connection card */}
          <div style={{ marginBottom: 20, background: '#1a1f2e', borderRadius: 8, padding: 16, border: '1px solid #2d3748', maxWidth: 600 }}>
            <div style={{ fontSize: 12, color: '#718096', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Backend</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#a0aec0' }}>API URL</span>
              <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#63b3ed', marginLeft: 'auto' }}>http://localhost:7776</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 13, color: '#a0aec0' }}>WebSocket</span>
              <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#63b3ed', marginLeft: 'auto' }}>ws://localhost:7776/events</span>
            </div>
          </div>

          {/* Executor controls */}
          <div data-test-region="executor-controls" style={{ marginBottom: 20, background: '#1a1f2e', borderRadius: 8, padding: 16, border: '1px solid #2d3748', maxWidth: 600 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 12, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Executor</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: status.daemon_alive ? '#68d391' : '#fc8181' }}>
                {status.daemon_alive ? `● daemon alive (pid ${status.daemon_pid})` : '○ daemon dead'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 13, color: '#a0aec0' }}>State</span>
              <span style={{
                marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 4,
                background: status.enabled ? '#22543d' : '#742a2a', color: status.enabled ? '#9ae6b4' : '#feb2b2',
              }}>{status.enabled ? 'RUNNING' : 'PAUSED'}</span>
              <button
                onClick={togglePauseResume}
                disabled={busy}
                aria-label={status.enabled ? 'Pause executor' : 'Resume executor'}
                style={{
                  background: status.enabled ? '#742a2a' : '#22543d', border: 'none', color: '#e2e8f0',
                  borderRadius: 4, padding: '6px 14px', fontSize: 12, fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
                }}
              >
                {status.enabled ? 'Pause' : 'Resume'}
              </button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label htmlFor="max-concurrent" style={{ fontSize: 13, color: '#a0aec0', display: 'block', marginBottom: 4 }}>
                Max concurrent workers: <strong style={{ color: '#e2e8f0' }}>{maxConcurrent}</strong>
              </label>
              <input
                id="max-concurrent"
                type="range" min={1} max={10} step={1}
                value={maxConcurrent}
                onChange={e => setMaxConcurrent(parseInt(e.target.value, 10))}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label htmlFor="breaker-threshold" style={{ fontSize: 13, color: '#a0aec0', display: 'block', marginBottom: 4 }}>
                Circuit-breaker threshold (consecutive failures): <strong style={{ color: '#e2e8f0' }}>{breakerThreshold}</strong>
              </label>
              <input
                id="breaker-threshold"
                type="range" min={1} max={10} step={1}
                value={breakerThreshold}
                onChange={e => setBreakerThreshold(parseInt(e.target.value, 10))}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={saveConfig}
                disabled={busy}
                style={{
                  background: '#2b6cb0', border: 'none', color: '#e2e8f0',
                  borderRadius: 4, padding: '6px 14px', fontSize: 12, fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
                }}
              >Save config</button>
              {statusMsg && <span style={{ color: '#68d391', fontSize: 11 }}>{statusMsg}</span>}
            </div>
          </div>

          {/* Live counters */}
          <div style={{ background: '#1a1f2e', borderRadius: 8, padding: 16, border: '1px solid #2d3748', maxWidth: 600 }}>
            <div style={{ fontSize: 12, color: '#718096', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Live counters</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, fontSize: 13 }}>
              <div><div style={{ color: '#a0aec0' }}>Running</div><div style={{ fontSize: 18, color: '#e2e8f0', fontWeight: 700 }}>{status.running}</div></div>
              <div><div style={{ color: '#a0aec0' }}>Queued</div><div style={{ fontSize: 18, color: '#e2e8f0', fontWeight: 700 }}>{status.queued}</div></div>
              <div><div style={{ color: '#a0aec0' }}>Paused</div><div style={{ fontSize: 18, color: '#f6ad55', fontWeight: 700 }}>{status.paused}</div></div>
              <div><div style={{ color: '#a0aec0' }}>Done 24h</div><div style={{ fontSize: 18, color: '#68d391', fontWeight: 700 }}>{status.completed_24h}</div></div>
            </div>
          </div>
        </>
      )}

      {/* Redis configuration */}
      <div data-test-region="redis-config" style={{ marginTop: 20, background: '#1a1f2e', borderRadius: 8, padding: 16, border: '1px solid #2d3748', maxWidth: 600 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Redis</span>
          {redisPingStatus === 'ok' && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#68d391' }}>
              ● connected{redisPingMs !== null ? ` (${redisPingMs}ms)` : ''}
            </span>
          )}
          {redisPingStatus === 'error' && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#fc8181' }}>○ unreachable</span>
          )}
          {redisPingStatus === 'pinging' && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#f6ad55' }}>pinging…</span>
          )}
        </div>

        {/* Connection mode toggle */}
        <div style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 13, color: '#a0aec0', marginRight: 8 }}>Connection mode</span>
          <button
            onClick={() => setRedisConnectionMode('hostport')}
            style={{
              background: redisConnectionMode === 'hostport' ? '#2b6cb0' : '#2d3748',
              border: 'none', color: '#e2e8f0', borderRadius: '4px 0 0 4px',
              padding: '5px 12px', fontSize: 12, cursor: 'pointer',
            }}
          >Host / Port</button>
          <button
            onClick={() => setRedisConnectionMode('url')}
            style={{
              background: redisConnectionMode === 'url' ? '#2b6cb0' : '#2d3748',
              border: 'none', color: '#e2e8f0', borderRadius: '0 4px 4px 0',
              padding: '5px 12px', fontSize: 12, cursor: 'pointer',
            }}
          >URL</button>
        </div>

        {redisConnectionMode === 'url' ? (
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="redis-url" style={{ fontSize: 13, color: '#a0aec0', display: 'block', marginBottom: 4 }}>
              Redis URL
            </label>
            <input
              id="redis-url"
              type="text"
              value={redisUrl}
              onChange={e => setRedisUrl(e.target.value)}
              placeholder="redis://:password@127.0.0.1:6379/0"
              style={{
                width: '100%', boxSizing: 'border-box', background: '#2d3748', border: '1px solid #4a5568',
                borderRadius: 4, color: '#e2e8f0', fontSize: 13, padding: '6px 10px',
              }}
            />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 60px', gap: 10, marginBottom: 14 }}>
            <div>
              <label htmlFor="redis-host" style={{ fontSize: 12, color: '#a0aec0', display: 'block', marginBottom: 4 }}>Host</label>
              <input
                id="redis-host"
                type="text"
                value={redisHost}
                onChange={e => setRedisHost(e.target.value)}
                placeholder="127.0.0.1"
                style={{
                  width: '100%', boxSizing: 'border-box', background: '#2d3748', border: '1px solid #4a5568',
                  borderRadius: 4, color: '#e2e8f0', fontSize: 13, padding: '6px 8px',
                }}
              />
            </div>
            <div>
              <label htmlFor="redis-port" style={{ fontSize: 12, color: '#a0aec0', display: 'block', marginBottom: 4 }}>Port</label>
              <input
                id="redis-port"
                type="number"
                min={1} max={65535}
                value={redisPort}
                onChange={e => setRedisPort(parseInt(e.target.value, 10) || 6379)}
                style={{
                  width: '100%', boxSizing: 'border-box', background: '#2d3748', border: '1px solid #4a5568',
                  borderRadius: 4, color: '#e2e8f0', fontSize: 13, padding: '6px 8px',
                }}
              />
            </div>
            <div>
              <label htmlFor="redis-db" style={{ fontSize: 12, color: '#a0aec0', display: 'block', marginBottom: 4 }}>DB</label>
              <input
                id="redis-db"
                type="number"
                min={0} max={15}
                value={redisDb}
                onChange={e => setRedisDb(parseInt(e.target.value, 10) || 0)}
                style={{
                  width: '100%', boxSizing: 'border-box', background: '#2d3748', border: '1px solid #4a5568',
                  borderRadius: 4, color: '#e2e8f0', fontSize: 13, padding: '6px 8px',
                }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="redis-password" style={{ fontSize: 12, color: '#a0aec0', display: 'block', marginBottom: 4 }}>Password (optional)</label>
              <input
                id="redis-password"
                type="password"
                value={redisPassword}
                onChange={e => setRedisPassword(e.target.value)}
                placeholder="leave blank if none"
                style={{
                  width: '100%', boxSizing: 'border-box', background: '#2d3748', border: '1px solid #4a5568',
                  borderRadius: 4, color: '#e2e8f0', fontSize: 13, padding: '6px 10px',
                }}
              />
            </div>
          </div>
        )}

        {/* Key prefix */}
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="redis-key-prefix" style={{ fontSize: 13, color: '#a0aec0', display: 'block', marginBottom: 4 }}>
            Key prefix <span style={{ color: '#718096', fontSize: 11 }}>(optional — e.g. &quot;caia&quot;)</span>
          </label>
          <input
            id="redis-key-prefix"
            type="text"
            value={redisKeyPrefix}
            onChange={e => setRedisKeyPrefix(e.target.value)}
            placeholder="caia"
            style={{
              width: '100%', boxSizing: 'border-box', background: '#2d3748', border: '1px solid #4a5568',
              borderRadius: 4, color: '#e2e8f0', fontSize: 13, padding: '6px 10px',
            }}
          />
        </div>

        {/* Default TTL slider */}
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="redis-ttl" style={{ fontSize: 13, color: '#a0aec0', display: 'block', marginBottom: 4 }}>
            Default TTL: <strong style={{ color: '#e2e8f0' }}>{redisTtlDays} day{redisTtlDays !== 1 ? 's' : ''}</strong>
            <span style={{ color: '#718096', fontSize: 11, marginLeft: 6 }}>({redisTtlDays * 86400} s)</span>
          </label>
          <input
            id="redis-ttl"
            type="range"
            min={1} max={90} step={1}
            value={redisTtlDays}
            onChange={e => setRedisTtlDays(parseInt(e.target.value, 10))}
            style={{ width: '100%' }}
          />
        </div>

        {/* Enabled toggle */}
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: '#a0aec0' }}>Enabled</span>
          <button
            onClick={() => setRedisEnabled(e => !e)}
            style={{
              background: redisEnabled ? '#22543d' : '#742a2a',
              border: 'none', color: redisEnabled ? '#9ae6b4' : '#feb2b2',
              borderRadius: 4, padding: '4px 12px', fontSize: 12, fontWeight: 700,
              cursor: 'pointer',
            }}
          >{redisEnabled ? 'ON' : 'OFF'}</button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={saveRedis}
            disabled={redisBusy}
            style={{
              background: '#2b6cb0', border: 'none', color: '#e2e8f0',
              borderRadius: 4, padding: '6px 14px', fontSize: 12, fontWeight: 600,
              cursor: redisBusy ? 'not-allowed' : 'pointer', opacity: redisBusy ? 0.5 : 1,
            }}
          >Save config</button>
          <button
            onClick={pingRedis}
            disabled={redisPingStatus === 'pinging'}
            style={{
              background: '#2d3748', border: '1px solid #4a5568', color: '#e2e8f0',
              borderRadius: 4, padding: '6px 14px', fontSize: 12, fontWeight: 600,
              cursor: redisPingStatus === 'pinging' ? 'not-allowed' : 'pointer',
              opacity: redisPingStatus === 'pinging' ? 0.5 : 1,
            }}
          >Test connection</button>
          {redisMsg && (
            <span style={{ fontSize: 11, color: redisMsgOk ? '#68d391' : '#fc8181' }}>{redisMsg}</span>
          )}
        </div>
      </div>

      {/* Named Redis configurations */}
      <div data-test-region="redis-named-configs" style={{ marginTop: 20, background: '#1a1f2e', borderRadius: 8, padding: 16, border: '1px solid #2d3748', maxWidth: 600 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Redis Named Configurations</span>
          <button
            onClick={openAddForm}
            style={{
              marginLeft: 'auto', background: '#2b6cb0', border: 'none', color: '#e2e8f0',
              borderRadius: 4, padding: '4px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >+ Add Config</button>
        </div>

        {rcoMsg && !rcoFormVisible && (
          <div style={{ fontSize: 11, color: rcoMsgOk ? '#68d391' : '#fc8181', marginBottom: 10 }}>{rcoMsg}</div>
        )}

        {/* List */}
        {rcoList.length === 0 ? (
          <p style={{ fontSize: 13, color: '#718096', margin: 0 }}>No configs yet. Click &ldquo;+ Add Config&rdquo; to create one.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rcoList.map(row => (
              <div
                key={row.id}
                style={{ background: '#0f1117', borderRadius: 6, padding: '10px 12px', border: '1px solid #2d3748', fontSize: 12 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{row.name}</span>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 3,
                    background: row.scope === 'global' ? '#2b4c7e' : '#44337a',
                    color: row.scope === 'global' ? '#90cdf4' : '#d6bcfa',
                  }}>{row.scope}</span>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 3,
                    background: row.enabled ? '#22543d' : '#742a2a',
                    color: row.enabled ? '#9ae6b4' : '#feb2b2',
                  }}>{row.enabled ? 'enabled' : 'disabled'}</span>
                  {rcoTestStatus[row.id] === 'ok' && (
                    <span style={{ fontSize: 10, color: '#68d391' }}>
                      ● ok{rcoTestMs[row.id] !== null ? ` (${rcoTestMs[row.id]}ms)` : ''}
                    </span>
                  )}
                  {rcoTestStatus[row.id] === 'error' && (
                    <span style={{ fontSize: 10, color: '#fc8181' }}>○ unreachable</span>
                  )}
                  {rcoTestStatus[row.id] === 'pinging' && (
                    <span style={{ fontSize: 10, color: '#f6ad55' }}>pinging…</span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => void pingConfig(row.id)}
                      disabled={rcoTestStatus[row.id] === 'pinging'}
                      style={{ background: '#2d3748', border: '1px solid #4a5568', color: '#e2e8f0', borderRadius: 3, padding: '3px 10px', fontSize: 11, cursor: rcoTestStatus[row.id] === 'pinging' ? 'not-allowed' : 'pointer', opacity: rcoTestStatus[row.id] === 'pinging' ? 0.5 : 1 }}
                    >Test</button>
                    <button
                      onClick={() => openEditForm(row)}
                      style={{ background: '#2d3748', border: '1px solid #4a5568', color: '#e2e8f0', borderRadius: 3, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}
                    >Edit</button>
                    <button
                      onClick={() => void deleteRco(row.id)}
                      disabled={rcoBusy}
                      style={{ background: '#742a2a', border: 'none', color: '#feb2b2', borderRadius: 3, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}
                    >Delete</button>
                  </div>
                </div>
                <div style={{ color: '#a0aec0' }}>
                  <span style={{ fontFamily: 'monospace' }}>{row.host}:{row.port}</span>
                  <span style={{ marginLeft: 8 }}>db {row.dbIndex}</span>
                  {row.keyPrefix && <span style={{ marginLeft: 8 }}>prefix: <code style={{ color: '#90cdf4' }}>{row.keyPrefix}</code></span>}
                  <span style={{ marginLeft: 8 }}>TTL {Math.round(row.ttlSeconds / 86400)}d</span>
                  {row.maxEntries !== null && <span style={{ marginLeft: 8 }}>max {row.maxEntries}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add / Edit form */}
        {rcoFormVisible && (
          <div style={{ marginTop: 16, padding: 14, background: '#0f1117', borderRadius: 6, border: '1px solid #4a5568' }}>
            <div style={{ fontSize: 12, color: '#a0aec0', marginBottom: 12, fontWeight: 600 }}>
              {rcoEditId ? 'Edit Configuration' : 'New Configuration'}
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: '#a0aec0', display: 'block', marginBottom: 4 }}>Name <span style={{ color: '#fc8181' }}>*</span></label>
              <input
                type="text"
                value={rcoForm.name}
                onChange={e => setRcoForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. production, staging"
                style={{ width: '100%', boxSizing: 'border-box', background: '#2d3748', border: '1px solid #4a5568', borderRadius: 4, color: '#e2e8f0', fontSize: 12, padding: '6px 10px' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 60px', gap: 8, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: '#a0aec0', display: 'block', marginBottom: 4 }}>Host</label>
                <input
                  type="text"
                  value={rcoForm.host}
                  onChange={e => setRcoForm(f => ({ ...f, host: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box', background: '#2d3748', border: '1px solid #4a5568', borderRadius: 4, color: '#e2e8f0', fontSize: 12, padding: '6px 8px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#a0aec0', display: 'block', marginBottom: 4 }}>Port</label>
                <input
                  type="number" min={1} max={65535}
                  value={rcoForm.port}
                  onChange={e => setRcoForm(f => ({ ...f, port: parseInt(e.target.value, 10) || 6379 }))}
                  style={{ width: '100%', boxSizing: 'border-box', background: '#2d3748', border: '1px solid #4a5568', borderRadius: 4, color: '#e2e8f0', fontSize: 12, padding: '6px 8px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#a0aec0', display: 'block', marginBottom: 4 }}>DB</label>
                <input
                  type="number" min={0} max={15}
                  value={rcoForm.dbIndex}
                  onChange={e => setRcoForm(f => ({ ...f, dbIndex: parseInt(e.target.value, 10) || 0 }))}
                  style={{ width: '100%', boxSizing: 'border-box', background: '#2d3748', border: '1px solid #4a5568', borderRadius: 4, color: '#e2e8f0', fontSize: 12, padding: '6px 8px' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: '#a0aec0', display: 'block', marginBottom: 4 }}>Password (optional)</label>
              <input
                type="password"
                value={rcoForm.password}
                onChange={e => setRcoForm(f => ({ ...f, password: e.target.value }))}
                placeholder="leave blank to keep existing"
                style={{ width: '100%', boxSizing: 'border-box', background: '#2d3748', border: '1px solid #4a5568', borderRadius: 4, color: '#e2e8f0', fontSize: 12, padding: '6px 10px' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: '#a0aec0', display: 'block', marginBottom: 4 }}>Key prefix</label>
                <input
                  type="text"
                  value={rcoForm.keyPrefix}
                  onChange={e => setRcoForm(f => ({ ...f, keyPrefix: e.target.value }))}
                  placeholder="caia"
                  style={{ width: '100%', boxSizing: 'border-box', background: '#2d3748', border: '1px solid #4a5568', borderRadius: 4, color: '#e2e8f0', fontSize: 12, padding: '6px 8px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#a0aec0', display: 'block', marginBottom: 4 }}>Max entries</label>
                <input
                  type="number" min={1}
                  value={rcoForm.maxEntries}
                  onChange={e => setRcoForm(f => ({ ...f, maxEntries: e.target.value }))}
                  placeholder="unlimited"
                  style={{ width: '100%', boxSizing: 'border-box', background: '#2d3748', border: '1px solid #4a5568', borderRadius: 4, color: '#e2e8f0', fontSize: 12, padding: '6px 8px' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: '#a0aec0', display: 'block', marginBottom: 4 }}>
                TTL: <strong style={{ color: '#e2e8f0' }}>{rcoForm.ttlDays} day{rcoForm.ttlDays !== 1 ? 's' : ''}</strong>
              </label>
              <input
                type="range" min={1} max={90} step={1}
                value={rcoForm.ttlDays}
                onChange={e => setRcoForm(f => ({ ...f, ttlDays: parseInt(e.target.value, 10) }))}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: 12, color: '#a0aec0', marginRight: 8 }}>Scope</span>
                <button
                  onClick={() => setRcoForm(f => ({ ...f, scope: 'global' }))}
                  style={{ background: rcoForm.scope === 'global' ? '#2b6cb0' : '#2d3748', border: 'none', color: '#e2e8f0', borderRadius: '4px 0 0 4px', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
                >Global</button>
                <button
                  onClick={() => setRcoForm(f => ({ ...f, scope: 'project-specific' }))}
                  style={{ background: rcoForm.scope === 'project-specific' ? '#2b6cb0' : '#2d3748', border: 'none', color: '#e2e8f0', borderRadius: '0 4px 4px 0', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
                >Project</button>
              </div>
              <div>
                <span style={{ fontSize: 12, color: '#a0aec0', marginRight: 8 }}>Enabled</span>
                <button
                  onClick={() => setRcoForm(f => ({ ...f, enabled: !f.enabled }))}
                  style={{ background: rcoForm.enabled ? '#22543d' : '#742a2a', border: 'none', color: rcoForm.enabled ? '#9ae6b4' : '#feb2b2', borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                >{rcoForm.enabled ? 'ON' : 'OFF'}</button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => void saveRco()}
                disabled={rcoBusy}
                style={{ background: '#2b6cb0', border: 'none', color: '#e2e8f0', borderRadius: 4, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: rcoBusy ? 'not-allowed' : 'pointer', opacity: rcoBusy ? 0.5 : 1 }}
              >{rcoEditId ? 'Update' : 'Create'}</button>
              <button
                onClick={cancelRcoForm}
                style={{ background: '#2d3748', border: '1px solid #4a5568', color: '#e2e8f0', borderRadius: 4, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >Cancel</button>
              {rcoMsg && (
                <span style={{ fontSize: 11, color: rcoMsgOk ? '#68d391' : '#fc8181' }}>{rcoMsg}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Node Cache statistics */}
      <div data-test-region="node-cache-stats" style={{ marginTop: 20, background: '#1a1f2e', borderRadius: 8, padding: 16, border: '1px solid #2d3748', maxWidth: 600 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Node Cache (in-memory)</span>
          <button
            onClick={() => void loadNodeCacheStats()}
            style={{ marginLeft: 'auto', background: '#2d3748', border: '1px solid #4a5568', color: '#e2e8f0', borderRadius: 4, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}
          >Refresh</button>
        </div>

        {ncStats ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, color: '#a0aec0', marginBottom: 2 }}>Hits</div>
                <div style={{ fontSize: 20, color: '#68d391', fontWeight: 700 }}>{ncStats.hits}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#a0aec0', marginBottom: 2 }}>Misses</div>
                <div style={{ fontSize: 20, color: '#fc8181', fontWeight: 700 }}>{ncStats.misses}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#a0aec0', marginBottom: 2 }}>Sets</div>
                <div style={{ fontSize: 20, color: '#63b3ed', fontWeight: 700 }}>{ncStats.sets}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#a0aec0', marginBottom: 2 }}>Deletes</div>
                <div style={{ fontSize: 20, color: '#f6ad55', fontWeight: 700 }}>{ncStats.deletes}</div>
              </div>
            </div>

            {ncStats.hitRatioPct !== null && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#a0aec0', marginBottom: 4 }}>
                  <span>Hit ratio</span>
                  <span style={{ color: ncStats.hitRatioPct >= 80 ? '#68d391' : ncStats.hitRatioPct >= 50 ? '#f6ad55' : '#fc8181', fontWeight: 700 }}>
                    {ncStats.hitRatioPct}%
                  </span>
                </div>
                <div style={{ background: '#2d3748', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{ background: ncStats.hitRatioPct >= 80 ? '#68d391' : ncStats.hitRatioPct >= 50 ? '#f6ad55' : '#fc8181', height: '100%', width: `${ncStats.hitRatioPct}%`, transition: 'width 0.3s' }} />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => void resetNodeCache()}
                disabled={ncBusy}
                style={{ background: '#742a2a', border: 'none', color: '#feb2b2', borderRadius: 4, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: ncBusy ? 'not-allowed' : 'pointer', opacity: ncBusy ? 0.5 : 1 }}
              >Reset stats</button>
              {ncMsg && <span style={{ fontSize: 11, color: '#68d391' }}>{ncMsg}</span>}
            </div>
          </>
        ) : (
          <p style={{ fontSize: 13, color: '#718096', margin: 0 }}>Stats unavailable — orchestrator may be offline.</p>
        )}
      </div>
    </div>
  );
}
