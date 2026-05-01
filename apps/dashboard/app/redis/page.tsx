'use client';
import { useState, useEffect, useCallback } from 'react';

interface RedisConfig {
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
  status: string;
  scope: string;
  createdAt: string;
  updatedAt: string;
}

interface PingResult {
  ok: boolean;
  host?: string;
  port?: number;
  db?: number;
  latencyMs?: number;
  error?: string;
}

type ConnectionMode = 'host-port' | 'url';

const EMPTY_FORM = {
  name: '',
  connectionMode: 'host-port' as ConnectionMode,
  urlInput: '',
  host: 'localhost',
  port: 6379,
  dbIndex: 0,
  password: '',
  keyPrefix: '',
  ttlSeconds: 3600,
  maxEntries: '',
  enabled: true,
  scope: 'global',
  projectId: '',
};

type FormState = typeof EMPTY_FORM;

const TTL_PRESETS: Array<{ label: string; seconds: number }> = [
  { label: '1h', seconds: 3600 },
  { label: '12h', seconds: 43200 },
  { label: '1d', seconds: 86400 },
  { label: '7d', seconds: 604800 },
  { label: '30d', seconds: 2592000 },
  { label: '90d', seconds: 7776000 },
];

interface ConnectionTemplate {
  label: string;
  mode: ConnectionMode;
  host?: string;
  port?: number;
  dbIndex?: number;
  keyPrefix?: string;
  note?: string;
}

const CONNECTION_TEMPLATES: ConnectionTemplate[] = [
  { label: 'Local', mode: 'host-port', host: 'localhost', port: 6379, dbIndex: 0, keyPrefix: 'caia:' },
  { label: 'Heroku', mode: 'url', note: 'Paste REDIS_URL from Heroku config vars' },
  { label: 'Upstash', mode: 'url', port: 6380, keyPrefix: 'llm:', note: 'Use Upstash REST URL in Full URL mode' },
  { label: 'ElastiCache', mode: 'host-port', port: 6379, keyPrefix: 'caia:', note: 'Enter cluster endpoint as host' },
];

function formatTtl(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function buildRedisUrl(host: string, port: number, dbIndex: number, password?: string | null): string {
  const auth = password ? `:${password}@` : '';
  const db = dbIndex > 0 ? `/${dbIndex}` : '';
  return `redis://${auth}${host}:${port}${db}`;
}

function buildRedisUrlSafe(host: string, port: number, dbIndex: number): string {
  const db = dbIndex > 0 ? `/${dbIndex}` : '';
  return `redis://${host}:${port}${db}`;
}

function parseRedisUrl(urlStr: string): { host: string; port: number; dbIndex: number; password: string } {
  try {
    const u = new URL(urlStr.trim());
    return {
      host: u.hostname || 'localhost',
      port: u.port ? parseInt(u.port, 10) : 6379,
      dbIndex: u.pathname && u.pathname.length > 1 ? (parseInt(u.pathname.slice(1), 10) || 0) : 0,
      password: u.password || '',
    };
  } catch {
    return { host: 'localhost', port: 6379, dbIndex: 0, password: '' };
  }
}

function sectionLabel(text: string) {
  return (
    <div style={{
      fontSize: 13, fontWeight: 600, color: '#a0aec0',
      textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12,
    }}>
      {text}
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    background: '#0f1117', border: '1px solid #2d3748', borderRadius: 4,
    color: '#e2e8f0', padding: '6px 10px', fontSize: 13,
    width: '100%', boxSizing: 'border-box',
  };
}

function labelStyle(): React.CSSProperties {
  return { fontSize: 12, color: '#718096', marginBottom: 4, display: 'block' };
}

function fieldGroup(label: string, input: React.ReactNode) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle()}>{label}</label>
      {input}
    </div>
  );
}

function formatTs(ts: string) {
  return new Date(ts).toLocaleString();
}

function PingBadge({ result }: { result: PingResult }) {
  return (
    <div style={{
      marginTop: 6, padding: '5px 10px', borderRadius: 4,
      background: result.ok ? '#0d1f12' : '#2d0a0a',
      border: `1px solid ${result.ok ? '#276749' : '#742a2a'}`,
      fontSize: 11, color: result.ok ? '#68d391' : '#fc8181',
      fontFamily: 'monospace',
    }}>
      {result.ok
        ? `Connected — latency ${result.latencyMs}ms`
        : `Failed — ${result.error}`}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [text]);
  return (
    <button
      onClick={() => void copy()}
      title="Copy to clipboard"
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: copied ? '#68d391' : '#4a5568', fontSize: 11, padding: '0 4px',
        flexShrink: 0,
      }}
    >
      {copied ? '✓' : 'Copy'}
    </button>
  );
}

export default function RedisPage() {
  const [configs, setConfigs] = useState<RedisConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [ping, setPing] = useState<PingResult | null>(null);
  const [pinging, setPinging] = useState(false);
  const [configPings, setConfigPings] = useState<Record<string, PingResult>>({});
  const [pingingId, setPingingId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgOk, setMsgOk] = useState(true);

  // In-form test connection
  const [formPing, setFormPing] = useState<PingResult | null>(null);
  const [formPinging, setFormPinging] = useState(false);

  // Env-var export panel and duplicate
  const [envExportId, setEnvExportId] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/redis/config');
      const data = await r.json();
      setConfigs(Array.isArray(data) ? data : []);
    } catch {
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const doPing = useCallback(async () => {
    setPinging(true);
    setPing(null);
    try {
      const r = await fetch('/api/redis/ping');
      const data = await r.json() as PingResult;
      setPing(data);
    } catch {
      setPing({ ok: false, error: 'Network error' });
    } finally {
      setPinging(false);
    }
  }, []);

  const doPingById = useCallback(async (id: string) => {
    setPingingId(id);
    setConfigPings((prev) => { const next = { ...prev }; delete next[id]; return next; });
    try {
      const r = await fetch(`/api/redis/ping/${id}`);
      const data = await r.json() as PingResult;
      setConfigPings((prev) => ({ ...prev, [id]: data }));
    } catch {
      setConfigPings((prev) => ({ ...prev, [id]: { ok: false, error: 'Network error' } }));
    } finally {
      setPingingId(null);
    }
  }, []);

  // Test connection from the form using current form fields
  const doFormPing = useCallback(async () => {
    setFormPinging(true);
    setFormPing(null);

    let host = form.host.trim() || 'localhost';
    let port = Number(form.port) || 6379;
    let dbIndex = Number(form.dbIndex) || 0;

    if (form.connectionMode === 'url' && form.urlInput.trim()) {
      const parsed = parseRedisUrl(form.urlInput);
      host = parsed.host;
      port = parsed.port;
      dbIndex = parsed.dbIndex;
    }

    try {
      // Use global ping endpoint — best available without a saved config
      const r = await fetch('/api/redis/ping');
      const data = await r.json() as PingResult;
      // Show the actual connection being tested
      setFormPing({ ...data, host, port, db: dbIndex });
    } catch {
      setFormPing({ ok: false, error: 'Network error' });
    } finally {
      setFormPinging(false);
    }
  }, [form]);

  function openCreate() {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setMsg(null);
    setFormPing(null);
    setShowForm(true);
  }

  function openEdit(cfg: RedisConfig) {
    setEditId(cfg.id);
    setForm({
      name: cfg.name,
      connectionMode: 'host-port',
      urlInput: buildRedisUrlSafe(cfg.host, cfg.port, cfg.dbIndex),
      host: cfg.host,
      port: cfg.port,
      dbIndex: cfg.dbIndex,
      password: '',
      keyPrefix: cfg.keyPrefix,
      ttlSeconds: cfg.ttlSeconds,
      maxEntries: cfg.maxEntries != null ? String(cfg.maxEntries) : '',
      enabled: cfg.enabled,
      scope: cfg.scope,
      projectId: cfg.projectId ?? '',
    });
    setMsg(null);
    setFormPing(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditId(null);
    setMsg(null);
    setFormPing(null);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function switchConnectionMode(mode: ConnectionMode) {
    if (mode === 'url') {
      // Build URL preview from current host/port/db
      const url = buildRedisUrlSafe(
        form.host.trim() || 'localhost',
        Number(form.port) || 6379,
        Number(form.dbIndex) || 0,
      );
      setForm((f) => ({ ...f, connectionMode: mode, urlInput: url }));
    } else {
      // Parse URL back into host/port/db/password
      if (form.urlInput.trim()) {
        const parsed = parseRedisUrl(form.urlInput);
        setForm((f) => ({
          ...f,
          connectionMode: mode,
          host: parsed.host,
          port: parsed.port,
          dbIndex: parsed.dbIndex,
          password: parsed.password || f.password,
        }));
      } else {
        setForm((f) => ({ ...f, connectionMode: mode }));
      }
    }
    setFormPing(null);
  }

  // Resolve effective host/port/db from form (accounting for URL mode)
  function resolvedConnection() {
    if (form.connectionMode === 'url' && form.urlInput.trim()) {
      return parseRedisUrl(form.urlInput);
    }
    return {
      host: form.host.trim() || 'localhost',
      port: Number(form.port) || 6379,
      dbIndex: Number(form.dbIndex) || 0,
      password: form.password,
    };
  }

  async function saveForm() {
    if (!form.name.trim()) { setMsg('Name is required'); setMsgOk(false); return; }
    setBusy(true);
    setMsg(null);

    const conn = resolvedConnection();

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      host: conn.host,
      port: conn.port,
      db_index: conn.dbIndex,
      key_prefix: form.keyPrefix.trim(),
      ttl_seconds: Number(form.ttlSeconds),
      enabled: form.enabled,
      scope: form.scope,
    };

    // Only set password if explicitly provided in form
    const effectivePassword = form.connectionMode === 'url'
      ? conn.password
      : form.password.trim();
    if (effectivePassword) payload['password'] = effectivePassword;

    if (form.maxEntries.toString().trim()) payload['max_entries'] = Number(form.maxEntries);
    if (form.projectId.trim()) payload['project_id'] = form.projectId.trim();

    try {
      const url = editId ? `/api/redis/config/${editId}` : '/api/redis/config';
      const method = editId ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        setMsg(editId ? 'Configuration updated.' : 'Configuration created.');
        setMsgOk(true);
        await load();
        closeForm();
      } else {
        const body = await r.json() as { error?: string };
        setMsg(body.error ?? `Error ${r.status}`);
        setMsgOk(false);
      }
    } catch {
      setMsg('Network error');
      setMsgOk(false);
    } finally {
      setBusy(false);
    }
  }

  async function deleteConfig(id: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      const r = await fetch(`/api/redis/config/${id}`, { method: 'DELETE' });
      if (r.ok) await load();
    } catch { /* ignore */ }
  }

  async function toggleEnabled(cfg: RedisConfig) {
    try {
      await fetch(`/api/redis/config/${cfg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !cfg.enabled }),
      });
      await load();
    } catch { /* ignore */ }
  }

  async function duplicateConfig(cfg: RedisConfig) {
    setDuplicating(cfg.id);
    try {
      const payload: Record<string, unknown> = {
        name: `Copy of ${cfg.name}`,
        host: cfg.host,
        port: cfg.port,
        db_index: cfg.dbIndex,
        key_prefix: cfg.keyPrefix,
        ttl_seconds: cfg.ttlSeconds,
        enabled: cfg.enabled,
        scope: cfg.scope,
      };
      if (cfg.maxEntries != null) payload['max_entries'] = cfg.maxEntries;
      if (cfg.projectId) payload['project_id'] = cfg.projectId;
      const r = await fetch('/api/redis/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) await load();
    } catch { /* ignore */ }
    setDuplicating(null);
  }

  function buildEnvVars(cfg: RedisConfig): Array<[string, string]> {
    const vars: Array<[string, string]> = [
      ['REDIS_URL', buildRedisUrlSafe(cfg.host, cfg.port, cfg.dbIndex)],
      ['REDIS_HOST', cfg.host],
      ['REDIS_PORT', String(cfg.port)],
    ];
    if (cfg.dbIndex > 0) vars.push(['REDIS_DB', String(cfg.dbIndex)]);
    if (cfg.keyPrefix) vars.push(['LLM_CACHE_KEY_PREFIX', cfg.keyPrefix]);
    vars.push(['LLM_CACHE_TTL_MS', String(cfg.ttlSeconds * 1000)]);
    return vars;
  }

  function applyTemplate(tpl: ConnectionTemplate) {
    setForm((f) => ({
      ...f,
      connectionMode: tpl.mode,
      ...(tpl.host !== undefined ? { host: tpl.host } : {}),
      ...(tpl.port !== undefined ? { port: tpl.port } : {}),
      ...(tpl.dbIndex !== undefined ? { dbIndex: tpl.dbIndex } : {}),
      ...(tpl.keyPrefix !== undefined ? { keyPrefix: tpl.keyPrefix } : {}),
      urlInput: tpl.mode === 'url' ? '' : f.urlInput,
    }));
    setFormPing(null);
  }

  const globalConfig = configs.find((c) => c.scope === 'global');
  const namedConfigs = configs.filter((c) => c.scope !== 'global');

  const conn = resolvedConnection();
  const previewUrl = buildRedisUrlSafe(conn.host, Number(conn.port) || 6379, Number(conn.dbIndex) || 0);

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
          Redis Cache Options
        </h2>
        <button
          onClick={() => void load()}
          style={{
            marginLeft: 'auto', background: '#2d3748', border: '1px solid #4a5568',
            color: '#a0aec0', borderRadius: 4, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ color: '#718096' }}>Loading…</div>
      ) : (
        <>
          {/* Global config status */}
          <section style={{ marginBottom: 28 }}>
            {sectionLabel('Global configuration')}
            {globalConfig ? (
              <div style={{
                background: '#1a202c', border: '1px solid #2d3748',
                borderRadius: 8, padding: '16px 20px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <span style={{ color: '#63b3ed', fontWeight: 600 }}>{globalConfig.name}</span>
                    <span style={{ color: '#4a5568', margin: '0 6px' }}>·</span>
                    <span style={{ fontFamily: 'monospace', color: '#e2e8f0', fontSize: 13 }}>
                      {buildRedisUrlSafe(globalConfig.host, globalConfig.port, globalConfig.dbIndex)}
                    </span>
                    {globalConfig.keyPrefix && (
                      <span style={{ color: '#718096', fontSize: 12, marginLeft: 8 }}>
                        prefix: {globalConfig.keyPrefix}
                      </span>
                    )}
                    <span style={{ color: '#718096', fontSize: 12, marginLeft: 8 }}>
                      TTL: {formatTtl(globalConfig.ttlSeconds)}
                    </span>
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{
                      background: globalConfig.enabled ? '#276749' : '#742a2a',
                      color: globalConfig.enabled ? '#68d391' : '#fc8181',
                      borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600,
                    }}>
                      {globalConfig.enabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                    <button
                      onClick={() => void doPing()}
                      disabled={pinging}
                      style={{
                        background: '#2b4c7e', border: '1px solid #2b6cb0',
                        color: '#63b3ed', borderRadius: 4, padding: '5px 12px',
                        fontSize: 12, cursor: pinging ? 'default' : 'pointer',
                      }}
                    >
                      {pinging ? 'Pinging…' : 'Test Connection'}
                    </button>
                    <button
                      onClick={() => openEdit(globalConfig)}
                      style={{
                        background: '#2d3748', border: '1px solid #4a5568',
                        color: '#a0aec0', borderRadius: 4, padding: '5px 10px',
                        fontSize: 12, cursor: 'pointer',
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void duplicateConfig(globalConfig)}
                      disabled={duplicating === globalConfig.id}
                      title="Clone this configuration as a named config"
                      style={{
                        background: '#2d3748', border: '1px solid #4a5568',
                        color: '#a0aec0', borderRadius: 4, padding: '5px 10px',
                        fontSize: 12, cursor: duplicating === globalConfig.id ? 'default' : 'pointer',
                      }}
                    >
                      {duplicating === globalConfig.id ? '…' : 'Dup'}
                    </button>
                    <button
                      onClick={() => setEnvExportId(envExportId === globalConfig.id ? null : globalConfig.id)}
                      title="Export as environment variables"
                      style={{
                        background: envExportId === globalConfig.id ? '#2c5282' : '#2d3748',
                        border: `1px solid ${envExportId === globalConfig.id ? '#2b6cb0' : '#4a5568'}`,
                        color: envExportId === globalConfig.id ? '#90cdf4' : '#a0aec0',
                        borderRadius: 4, padding: '5px 10px',
                        fontSize: 12, cursor: 'pointer',
                      }}
                    >
                      Env
                    </button>
                  </div>
                </div>

                {ping && (
                  <div style={{
                    marginTop: 12, padding: '8px 12px', borderRadius: 4,
                    background: ping.ok ? '#0d1f12' : '#2d0a0a',
                    border: `1px solid ${ping.ok ? '#276749' : '#742a2a'}`,
                    fontSize: 12, color: ping.ok ? '#68d391' : '#fc8181',
                    fontFamily: 'monospace',
                  }}>
                    {ping.ok
                      ? `Connected — ${ping.host}:${ping.port} db=${ping.db} latency=${ping.latencyMs}ms`
                      : `Failed — ${ping.error}`}
                  </div>
                )}
                {envExportId === globalConfig.id && (
                  <div style={{
                    marginTop: 10, background: '#0f1117', border: '1px solid #2d3748',
                    borderRadius: 4, padding: '10px 12px',
                  }}>
                    <div style={{ fontSize: 11, color: '#718096', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Environment variables
                    </div>
                    {buildEnvVars(globalConfig).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#68d391', flexShrink: 0 }}>{k}</span>
                        <span style={{ color: '#4a5568', flexShrink: 0 }}>=</span>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#90cdf4', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
                        <CopyButton text={`${k}=${v}`} />
                      </div>
                    ))}
                    <div style={{ marginTop: 8 }}>
                      <CopyButton text={buildEnvVars(globalConfig).map(([k, v]) => `${k}=${v}`).join('\n')} />
                      <span style={{ fontSize: 10, color: '#4a5568', marginLeft: 4 }}>Copy all</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                background: '#1a202c', border: '1px dashed #4a5568',
                borderRadius: 8, padding: '20px', color: '#718096',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <span>No global configuration. Create one to enable Redis caching.</span>
                <button
                  onClick={() => { setForm({ ...EMPTY_FORM, scope: 'global', name: 'default' }); setShowForm(true); }}
                  style={{
                    background: '#276749', border: '1px solid #2f855a',
                    color: '#68d391', borderRadius: 4, padding: '5px 12px',
                    fontSize: 12, cursor: 'pointer', marginLeft: 'auto',
                  }}
                >
                  Create Global Config
                </button>
              </div>
            )}
          </section>

          {/* Named configs */}
          <section style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              {sectionLabel(`Named configurations (${namedConfigs.length})`)}
              <button
                onClick={openCreate}
                style={{
                  marginLeft: 'auto', background: '#276749', border: '1px solid #2f855a',
                  color: '#68d391', borderRadius: 4, padding: '5px 12px',
                  fontSize: 12, cursor: 'pointer',
                }}
              >
                + Add
              </button>
            </div>

            {namedConfigs.length === 0 ? (
              <div style={{
                background: '#1a202c', border: '1px dashed #4a5568',
                borderRadius: 8, padding: '20px', color: '#718096', textAlign: 'center',
              }}>
                No named configurations yet.
              </div>
            ) : (
              <div style={{ background: '#1a202c', border: '1px solid #2d3748', borderRadius: 8, overflow: 'hidden' }}>
                {namedConfigs.map((cfg, i) => (
                  <div
                    key={cfg.id}
                    style={{
                      padding: '12px 16px',
                      borderBottom: i < namedConfigs.length - 1 ? '1px solid #2d3748' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{cfg.name}</span>
                          <span style={{
                            background: cfg.enabled ? '#276749' : '#742a2a',
                            color: cfg.enabled ? '#68d391' : '#fc8181',
                            borderRadius: 3, padding: '1px 6px', fontSize: 10, fontWeight: 600,
                          }}>
                            {cfg.enabled ? 'ON' : 'OFF'}
                          </span>
                          {cfg.scope === 'project-specific' && (
                            <span style={{ color: '#805ad5', fontSize: 10, background: '#1a0a3a', padding: '1px 6px', borderRadius: 3 }}>
                              project
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: '#718096', marginTop: 3, fontFamily: 'monospace' }}>
                          {buildRedisUrlSafe(cfg.host, cfg.port, cfg.dbIndex)}
                          {cfg.keyPrefix ? ` · prefix: ${cfg.keyPrefix}` : ''}
                          {' · '}TTL: {formatTtl(cfg.ttlSeconds)}
                          {cfg.maxEntries != null ? ` · max: ${cfg.maxEntries}` : ''}
                        </div>
                        <div style={{ fontSize: 11, color: '#4a5568', marginTop: 2 }}>
                          {formatTs(cfg.updatedAt)}
                          {cfg.projectId && ` · project: ${cfg.projectId}`}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button
                          onClick={() => void doPingById(cfg.id)}
                          disabled={pingingId === cfg.id}
                          style={{
                            background: '#2b4c7e', border: '1px solid #2b6cb0',
                            color: '#63b3ed', borderRadius: 4, padding: '4px 8px',
                            fontSize: 11, cursor: pingingId === cfg.id ? 'default' : 'pointer',
                          }}
                        >
                          {pingingId === cfg.id ? '…' : 'Test'}
                        </button>
                        <button
                          onClick={() => void toggleEnabled(cfg)}
                          style={{
                            background: '#2d3748', border: '1px solid #4a5568',
                            color: '#a0aec0', borderRadius: 4, padding: '4px 8px',
                            fontSize: 11, cursor: 'pointer',
                          }}
                        >
                          {cfg.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => openEdit(cfg)}
                          style={{
                            background: '#2d3748', border: '1px solid #4a5568',
                            color: '#a0aec0', borderRadius: 4, padding: '4px 8px',
                            fontSize: 11, cursor: 'pointer',
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void duplicateConfig(cfg)}
                          disabled={duplicating === cfg.id}
                          title="Clone this configuration"
                          style={{
                            background: '#2d3748', border: '1px solid #4a5568',
                            color: '#a0aec0', borderRadius: 4, padding: '4px 8px',
                            fontSize: 11, cursor: duplicating === cfg.id ? 'default' : 'pointer',
                          }}
                        >
                          {duplicating === cfg.id ? '…' : 'Dup'}
                        </button>
                        <button
                          onClick={() => setEnvExportId(envExportId === cfg.id ? null : cfg.id)}
                          title="Export as environment variables"
                          style={{
                            background: envExportId === cfg.id ? '#2c5282' : '#2d3748',
                            border: `1px solid ${envExportId === cfg.id ? '#2b6cb0' : '#4a5568'}`,
                            color: envExportId === cfg.id ? '#90cdf4' : '#a0aec0',
                            borderRadius: 4, padding: '4px 8px',
                            fontSize: 11, cursor: 'pointer',
                          }}
                        >
                          Env
                        </button>
                        <button
                          onClick={() => void deleteConfig(cfg.id, cfg.name)}
                          style={{
                            background: '#2d0a0a', border: '1px solid #742a2a',
                            color: '#fc8181', borderRadius: 4, padding: '4px 8px',
                            fontSize: 11, cursor: 'pointer',
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {configPings[cfg.id] && <PingBadge result={configPings[cfg.id]} />}
                    {envExportId === cfg.id && (
                      <div style={{
                        marginTop: 10, background: '#0f1117', border: '1px solid #2d3748',
                        borderRadius: 4, padding: '10px 12px',
                      }}>
                        <div style={{ fontSize: 11, color: '#718096', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Environment variables
                        </div>
                        {buildEnvVars(cfg).map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#68d391', flexShrink: 0 }}>{k}</span>
                            <span style={{ color: '#4a5568', flexShrink: 0 }}>=</span>
                            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#90cdf4', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
                            <CopyButton text={`${k}=${v}`} />
                          </div>
                        ))}
                        <div style={{ marginTop: 8 }}>
                          <CopyButton text={buildEnvVars(cfg).map(([k, v]) => `${k}=${v}`).join('\n')} />
                          <span style={{ fontSize: 10, color: '#4a5568', marginLeft: 4 }}>Copy all</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* All configs table (compact) */}
          {configs.length > 0 && (
            <section>
              {sectionLabel(`All configurations (${configs.length})`)}
              <div style={{
                background: '#1a202c', border: '1px solid #2d3748', borderRadius: 8,
                overflow: 'auto',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #2d3748' }}>
                      {['ID', 'Name', 'Scope', 'URL', 'TTL', 'Enabled', 'Updated'].map((h) => (
                        <th key={h} style={{
                          padding: '8px 12px', textAlign: 'left',
                          color: '#718096', fontWeight: 600, fontSize: 11,
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {configs.map((cfg, i) => (
                      <tr
                        key={cfg.id}
                        style={{ borderBottom: i < configs.length - 1 ? '1px solid #2d3748' : 'none' }}
                      >
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#4a5568', fontSize: 11 }}>
                          {cfg.id}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', fontWeight: 500 }}>{cfg.name}</td>
                        <td style={{ padding: '8px 12px', color: '#a0aec0' }}>{cfg.scope}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#90cdf4' }}>
                          {buildRedisUrlSafe(cfg.host, cfg.port, cfg.dbIndex)}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#a0aec0' }}>{formatTtl(cfg.ttlSeconds)}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{
                            color: cfg.enabled ? '#68d391' : '#fc8181', fontWeight: 600,
                          }}>
                            {cfg.enabled ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', color: '#718096' }}>
                          {formatTs(cfg.updatedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {/* Create/Edit modal */}
      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#1a202c', border: '1px solid #2d3748', borderRadius: 8,
            padding: '24px', width: '100%', maxWidth: 540, maxHeight: '92vh',
            overflowY: 'auto',
          }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 700, color: '#f0f4f8' }}>
              {editId ? 'Edit Configuration' : 'New Redis Configuration'}
            </h3>

            {/* Quick-connect templates */}
            {!editId && (
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle()}>Quick connect</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {CONNECTION_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.label}
                      onClick={() => applyTemplate(tpl)}
                      title={tpl.note}
                      style={{
                        background: '#2d3748', border: '1px solid #4a5568',
                        color: '#a0aec0', borderRadius: 4, padding: '4px 10px',
                        fontSize: 11, cursor: 'pointer',
                      }}
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Name */}
            {fieldGroup('Name *', (
              <input
                style={inputStyle()}
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="e.g. default"
              />
            ))}

            {/* Connection mode toggle */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle()}>Connection mode</label>
              <div style={{ display: 'flex', gap: 0 }}>
                {(['host-port', 'url'] as const).map((mode, idx) => (
                  <button
                    key={mode}
                    onClick={() => switchConnectionMode(mode)}
                    style={{
                      flex: 1,
                      background: form.connectionMode === mode ? '#2b6cb0' : '#2d3748',
                      border: '1px solid #4a5568',
                      borderRadius: idx === 0 ? '4px 0 0 4px' : '0 4px 4px 0',
                      color: form.connectionMode === mode ? '#bee3f8' : '#718096',
                      padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    {mode === 'host-port' ? 'Host / Port' : 'Full URL'}
                  </button>
                ))}
              </div>
            </div>

            {form.connectionMode === 'url' ? (
              /* URL mode */
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle()}>
                  Redis URL{' '}
                  <span style={{ color: '#4a5568', fontWeight: 400 }}>
                    (redis://[:password@]host:port[/db])
                  </span>
                </label>
                <input
                  style={inputStyle()}
                  value={form.urlInput}
                  onChange={(e) => setField('urlInput', e.target.value)}
                  placeholder="redis://:password@host:6379/0"
                  spellCheck={false}
                />
                {form.urlInput.trim() && (() => {
                  const p = parseRedisUrl(form.urlInput);
                  return (
                    <div style={{ marginTop: 6, fontSize: 11, color: '#718096' }}>
                      Parsed → host: <span style={{ color: '#90cdf4' }}>{p.host}</span>
                      {' '}port: <span style={{ color: '#90cdf4' }}>{p.port}</span>
                      {' '}db: <span style={{ color: '#90cdf4' }}>{p.dbIndex}</span>
                      {p.password && <> password: <span style={{ color: '#90cdf4' }}>•••</span></>}
                    </div>
                  );
                })()}
              </div>
            ) : (
              /* Host / Port mode */
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                {fieldGroup('Host', (
                  <input
                    style={inputStyle()}
                    value={form.host}
                    onChange={(e) => setField('host', e.target.value)}
                    placeholder="localhost"
                  />
                ))}
                {fieldGroup('Port', (
                  <input
                    type="number" style={inputStyle()}
                    value={form.port}
                    onChange={(e) => setField('port', parseInt(e.target.value, 10) || 6379)}
                  />
                ))}

                {fieldGroup('DB Index (0–15)', (
                  <input
                    type="number" min={0} max={15} style={inputStyle()}
                    value={form.dbIndex}
                    onChange={(e) => setField('dbIndex', parseInt(e.target.value, 10) || 0)}
                  />
                ))}
                {fieldGroup('Password (leave blank to keep)', (
                  <input
                    type="password" style={inputStyle()}
                    value={form.password}
                    onChange={(e) => setField('password', e.target.value)}
                    placeholder="optional"
                  />
                ))}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              {fieldGroup('Key Prefix', (
                <input
                  style={inputStyle()}
                  value={form.keyPrefix}
                  onChange={(e) => setField('keyPrefix', e.target.value)}
                  placeholder="e.g. caia:"
                />
              ))}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle()}>{`TTL — ${formatTtl(Number(form.ttlSeconds) || 3600)}`}</label>
                <input
                  type="number" min={1} style={inputStyle()}
                  value={form.ttlSeconds}
                  onChange={(e) => setField('ttlSeconds', parseInt(e.target.value, 10) || 3600)}
                />
                <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                  {TTL_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => setField('ttlSeconds', p.seconds)}
                      style={{
                        background: form.ttlSeconds === p.seconds ? '#2b6cb0' : '#2d3748',
                        border: '1px solid #4a5568',
                        color: form.ttlSeconds === p.seconds ? '#bee3f8' : '#718096',
                        borderRadius: 3, padding: '2px 7px', fontSize: 10, cursor: 'pointer',
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {fieldGroup('Max Entries (optional)', (
                <input
                  type="number" min={0} style={inputStyle()}
                  value={form.maxEntries}
                  onChange={(e) => setField('maxEntries', e.target.value)}
                  placeholder="unlimited"
                />
              ))}
              {fieldGroup('Project ID (optional)', (
                <input
                  style={inputStyle()}
                  value={form.projectId}
                  onChange={(e) => setField('projectId', e.target.value)}
                  placeholder="proj_..."
                />
              ))}

              <div>
                {fieldGroup('Scope', (
                  <select
                    style={inputStyle()}
                    value={form.scope}
                    onChange={(e) => setField('scope', e.target.value)}
                  >
                    <option value="global">global</option>
                    <option value="project-specific">project-specific</option>
                  </select>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 18 }}>
                <input
                  type="checkbox" id="form-enabled"
                  checked={form.enabled}
                  onChange={(e) => setField('enabled', e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                <label htmlFor="form-enabled" style={{ color: '#a0aec0', fontSize: 13, cursor: 'pointer' }}>
                  Enabled
                </label>
              </div>
            </div>

            {/* Redis URL preview */}
            <div style={{
              marginTop: 14, padding: '8px 12px', borderRadius: 4,
              background: '#0f1117', border: '1px solid #2d3748',
              fontSize: 11, color: '#718096',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ color: '#4a5568', flexShrink: 0 }}>URL preview:</span>
              <span style={{ fontFamily: 'monospace', color: '#90cdf4', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {previewUrl}
              </span>
              <CopyButton text={previewUrl} />
            </div>

            {/* In-form test connection */}
            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => void doFormPing()}
                disabled={formPinging}
                style={{
                  background: 'none', border: '1px solid #2b6cb0',
                  color: '#63b3ed', borderRadius: 4, padding: '5px 12px',
                  fontSize: 12, cursor: formPinging ? 'default' : 'pointer', width: '100%',
                }}
              >
                {formPinging ? 'Testing connection…' : 'Test connection'}
              </button>
              {formPing && <PingBadge result={formPing} />}
            </div>

            {msg && (
              <div style={{
                marginTop: 12, padding: '8px 12px', borderRadius: 4, fontSize: 13,
                background: msgOk ? '#0d1f12' : '#2d0a0a',
                color: msgOk ? '#68d391' : '#fc8181',
                border: `1px solid ${msgOk ? '#276749' : '#742a2a'}`,
              }}>
                {msg}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button
                onClick={closeForm}
                style={{
                  background: '#2d3748', border: '1px solid #4a5568',
                  color: '#a0aec0', borderRadius: 4, padding: '7px 16px',
                  fontSize: 13, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void saveForm()}
                disabled={busy}
                style={{
                  background: busy ? '#1a4731' : '#276749',
                  border: '1px solid #2f855a', color: '#68d391',
                  borderRadius: 4, padding: '7px 16px', fontSize: 13,
                  cursor: busy ? 'default' : 'pointer', fontWeight: 600,
                }}
              >
                {busy ? 'Saving…' : (editId ? 'Update' : 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
