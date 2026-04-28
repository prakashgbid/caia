'use client';
import { useEffect, useState } from 'react';

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

export default function SettingsPage() {
  const [status, setStatus] = useState<ExecutorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState<number>(3);
  const [breakerThreshold, setBreakerThreshold] = useState<number>(3);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

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

  useEffect(() => { void load(); }, []);

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
    </div>
  );
}
