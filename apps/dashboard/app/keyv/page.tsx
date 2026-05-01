'use client';
// KEYV-001 — Key-value store browser.
//
// Lets operators inspect and manage in-process (node-cache) entries:
//   - List all keys with TTL countdown
//   - Filter by substring pattern
//   - Delete individual keys
//   - Flush the entire cache
//
// Polls /api/node-cache/keys automatically when the user opens the page.

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';

interface KeyEntry {
  key: string;
  expiresAt: number | null;
  ttlMs: number | null;
}

interface KeysResponse {
  count: number;
  keys: KeyEntry[];
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

function formatTtl(ttlMs: number | null): string {
  if (ttlMs === null) return 'no TTL';
  if (ttlMs < 0) return 'expired';
  const s = Math.floor(ttlMs / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}

function ttlColor(ttlMs: number | null): string {
  if (ttlMs === null) return '#718096';
  if (ttlMs < 0) return '#fc8181';
  if (ttlMs < 60_000) return '#f6e05e';
  if (ttlMs < 600_000) return '#90cdf4';
  return '#68d391';
}

export default function KeyvPage() {
  const [data, setData] = useState<KeysResponse | null>(null);
  const [pattern, setPattern] = useState('');
  const [loading, setLoading] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchKeys = useCallback((p: string) => {
    setLoading(true);
    const url = p.trim()
      ? `/api/node-cache/keys?pattern=${encodeURIComponent(p.trim())}`
      : '/api/node-cache/keys';
    fetch(url)
      .then((r) => r.json())
      .then((d: unknown) => {
        setData(d as KeysResponse);
        setLastUpdated(new Date());
      })
      .catch(() => setData({ count: 0, keys: [], error: 'orchestrator unreachable' }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchKeys(pattern);
  }, [pattern]); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePatternChange(value: string) {
    setPattern(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchKeys(value), 300);
  }

  const deleteKey = useCallback(async (key: string) => {
    setDeletingKey(key);
    try {
      await fetch(`/api/node-cache/key/${encodeURIComponent(key)}`, { method: 'DELETE' });
      setMsg({ text: `Deleted: ${key}`, ok: true });
      fetchKeys(pattern);
    } catch {
      setMsg({ text: 'Delete failed', ok: false });
    } finally {
      setDeletingKey(null);
    }
  }, [fetchKeys, pattern]);

  const flushAll = useCallback(async () => {
    if (!confirm('Flush all cache entries? This cannot be undone.')) return;
    setFlushing(true);
    try {
      await fetch('/api/node-cache/flush', { method: 'POST' });
      setMsg({ text: 'Cache flushed', ok: true });
      fetchKeys(pattern);
    } catch {
      setMsg({ text: 'Flush failed', ok: false });
    } finally {
      setFlushing(false);
    }
  }, [fetchKeys, pattern]);

  const keys = data?.keys ?? [];
  const hasError = !!data?.error;

  return (
    <div style={{ padding: 24, maxWidth: 1000, color: '#e2e8f0', fontFamily: 'monospace' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
            🗂️ Key-Value Browser
          </h1>
          <div style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>
            {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString()} · node-cache (in-process)`
              : 'loading…'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/cache"
            style={{ fontSize: 12, color: '#718096', textDecoration: 'none' }}
          >
            ← Cache stats
          </Link>
          <button
            type="button"
            onClick={() => fetchKeys(pattern)}
            disabled={loading}
            style={{
              background: '#2d3748',
              border: '1px solid #4a5568',
              color: loading ? '#718096' : '#e2e8f0',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 12,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '…' : '↻ Refresh'}
          </button>
          <button
            type="button"
            onClick={() => void flushAll()}
            disabled={flushing || keys.length === 0}
            style={{
              background: '#2d0a0a',
              border: '1px solid #742a2a',
              color: flushing || keys.length === 0 ? '#718096' : '#fc8181',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 12,
              cursor: flushing || keys.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {flushing ? 'Flushing…' : 'Flush all'}
          </button>
        </div>
      </div>

      {msg && (
        <div
          style={{
            ...card,
            marginBottom: 16,
            color: msg.ok ? '#68d391' : '#fc8181',
            border: `1px solid ${msg.ok ? '#276749' : '#742a2a'}`,
            background: msg.ok ? '#0d1f12' : '#2d0a0a',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{msg.text}</span>
          <button
            type="button"
            onClick={() => setMsg(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#718096', fontSize: 14 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <div style={card}>
          <div style={labelStyle}>Total keys</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#90cdf4', marginTop: 4 }}>
            {data?.count ?? '—'}
          </div>
        </div>
        <div style={card}>
          <div style={labelStyle}>Filtered</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#90cdf4', marginTop: 4 }}>
            {keys.length}
          </div>
          {pattern && (
            <div style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>
              matching "{pattern}"
            </div>
          )}
        </div>
        <div style={card}>
          <div style={labelStyle}>Expiring soon</div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: '#f6e05e',
              marginTop: 4,
            }}
          >
            {keys.filter((k) => k.ttlMs !== null && k.ttlMs >= 0 && k.ttlMs < 60_000).length}
          </div>
          <div style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>in under 1 minute</div>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Filter keys by substring…"
          value={pattern}
          onChange={(e) => handlePatternChange(e.target.value)}
          style={{
            background: '#0f1117',
            border: '1px solid #2d3748',
            borderRadius: 6,
            color: '#e2e8f0',
            padding: '8px 12px',
            fontSize: 13,
            width: '100%',
            boxSizing: 'border-box',
            fontFamily: 'monospace',
          }}
        />
      </div>

      {/* Keys table */}
      {hasError && (
        <div style={{ ...card, color: '#fc8181', marginBottom: 16 }}>
          {data?.error} — is the orchestrator running?
        </div>
      )}

      {!hasError && keys.length === 0 && !loading && (
        <div
          style={{
            ...card,
            color: '#718096',
            textAlign: 'center',
            padding: 40,
          }}
        >
          {pattern ? `No keys matching "${pattern}"` : 'Cache is empty — no keys stored.'}
        </div>
      )}

      {keys.length > 0 && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2d3748', background: '#131720' }}>
                <th
                  style={{
                    padding: '10px 16px',
                    textAlign: 'left',
                    color: '#718096',
                    fontWeight: 600,
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Key
                </th>
                <th
                  style={{
                    padding: '10px 16px',
                    textAlign: 'right',
                    color: '#718096',
                    fontWeight: 600,
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    width: 140,
                  }}
                >
                  TTL
                </th>
                <th
                  style={{
                    padding: '10px 16px',
                    textAlign: 'right',
                    color: '#718096',
                    fontWeight: 600,
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    width: 80,
                  }}
                >
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((entry, i) => (
                <tr
                  key={entry.key}
                  style={{
                    borderBottom: i < keys.length - 1 ? '1px solid #1e2535' : 'none',
                    background: deletingKey === entry.key ? '#1a0a0a' : 'transparent',
                  }}
                >
                  <td
                    style={{
                      padding: '9px 16px',
                      fontFamily: 'monospace',
                      color: '#e2e8f0',
                      wordBreak: 'break-all',
                    }}
                  >
                    {entry.key}
                  </td>
                  <td
                    style={{
                      padding: '9px 16px',
                      textAlign: 'right',
                      color: ttlColor(entry.ttlMs),
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatTtl(entry.ttlMs)}
                  </td>
                  <td style={{ padding: '9px 16px', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => void deleteKey(entry.key)}
                      disabled={deletingKey === entry.key}
                      style={{
                        background: 'none',
                        border: '1px solid #742a2a',
                        color: deletingKey === entry.key ? '#718096' : '#fc8181',
                        borderRadius: 4,
                        padding: '3px 8px',
                        fontSize: 11,
                        cursor: deletingKey === entry.key ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {deletingKey === entry.key ? '…' : 'Del'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {keys.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11, color: '#4a5568', textAlign: 'right' }}>
          {keys.length} {keys.length === 1 ? 'entry' : 'entries'}
          {pattern ? ` matching "${pattern}"` : ''}
        </div>
      )}
    </div>
  );
}
