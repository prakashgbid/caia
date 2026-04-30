'use client';

import { useEffect, useState, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  userId: string;
  totalPrompts: number;
  lastActiveAt: string;
  firstSeenAt: string;
  channels: string[];
  status: 'active' | 'idle';
  displayName?: string;
  handle?: string;
  email?: string;
  avatarUrl?: string;
}

interface UserFormData {
  userId: string;
  handle: string;
  displayName: string;
  email: string;
  avatarUrl: string;
}

type SortKey = 'userId' | 'displayName' | 'status' | 'totalPrompts' | 'lastActiveAt' | 'firstSeenAt';
type SortDir = 'asc' | 'desc';

const EMPTY_FORM: UserFormData = { userId: '', handle: '', displayName: '', email: '', avatarUrl: '' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts: string | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function fmtDate(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

function stripEmpty(obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v.trim() !== ''));
}

function sortUsers(users: User[], key: SortKey, dir: SortDir): User[] {
  return [...users].sort((a, b) => {
    let av: string | number = '';
    let bv: string | number = '';
    if (key === 'totalPrompts') {
      av = a.totalPrompts; bv = b.totalPrompts;
    } else if (key === 'lastActiveAt' || key === 'firstSeenAt') {
      av = a[key] ? new Date(a[key]).getTime() : 0;
      bv = b[key] ? new Date(b[key]).getTime() : 0;
    } else {
      av = (a[key] ?? '').toString().toLowerCase();
      bv = (b[key] ?? '').toString().toLowerCase();
    }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const INPUT_STYLE: React.CSSProperties = {
  borderRadius: 6,
  border: '1px solid #2d3748',
  background: '#0f1117',
  padding: '6px 10px',
  fontSize: 12,
  color: '#f0f4f8',
  outline: 'none',
};

const LABEL_STYLE: React.CSSProperties = { display: 'block', fontSize: 11, color: '#718096', marginBottom: 4 };
const FIELD_WRAP: React.CSSProperties = { marginBottom: 10 };

// ─── UserForm ─────────────────────────────────────────────────────────────────

function UserForm({
  mode,
  initial,
  onSave,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initial: UserFormData;
  onSave: (data: UserFormData) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<UserFormData>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const field = (key: keyof UserFormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (mode === 'create' && !form.userId.trim()) { setErr('User ID is required'); return; }
    setBusy(true);
    try { await onSave(form); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : 'Save failed'); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={handleSubmit}>
      {mode === 'create' && (
        <div style={FIELD_WRAP}>
          <label style={LABEL_STYLE} htmlFor="uf-userId">User ID <span style={{ color: '#fc8181' }}>*</span></label>
          <input id="uf-userId" type="text" required value={form.userId} onChange={field('userId')} placeholder="e.g. user_abc123" style={{ ...INPUT_STYLE, width: '100%', boxSizing: 'border-box' }} />
        </div>
      )}
      <div style={FIELD_WRAP}>
        <label style={LABEL_STYLE} htmlFor="uf-handle">Handle</label>
        <input id="uf-handle" type="text" value={form.handle} onChange={field('handle')} placeholder="@handle" style={{ ...INPUT_STYLE, width: '100%', boxSizing: 'border-box' }} />
      </div>
      <div style={FIELD_WRAP}>
        <label style={LABEL_STYLE} htmlFor="uf-displayName">Display name</label>
        <input id="uf-displayName" type="text" value={form.displayName} onChange={field('displayName')} placeholder="Full name" style={{ ...INPUT_STYLE, width: '100%', boxSizing: 'border-box' }} />
      </div>
      <div style={FIELD_WRAP}>
        <label style={LABEL_STYLE} htmlFor="uf-email">Email</label>
        <input id="uf-email" type="email" value={form.email} onChange={field('email')} placeholder="user@example.com" style={{ ...INPUT_STYLE, width: '100%', boxSizing: 'border-box' }} />
      </div>
      <div style={FIELD_WRAP}>
        <label style={LABEL_STYLE} htmlFor="uf-avatarUrl">Avatar URL</label>
        <input id="uf-avatarUrl" type="url" value={form.avatarUrl} onChange={field('avatarUrl')} placeholder="https://..." style={{ ...INPUT_STYLE, width: '100%', boxSizing: 'border-box' }} />
      </div>
      {err && <div style={{ fontSize: 11, color: '#fc8181', marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button type="submit" disabled={busy} style={{ flex: 1, borderRadius: 6, border: 'none', background: busy ? '#2b4c7e' : '#2b6cb0', color: '#e2e8f0', padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Saving…' : mode === 'create' ? 'Create user' : 'Save changes'}
        </button>
        <button type="button" onClick={onCancel} style={{ borderRadius: 6, border: '1px solid #2d3748', background: '#1a1f2e', color: '#a0aec0', padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── SortHeader ───────────────────────────────────────────────────────────────

function SortHeader({ label, sortKey, current, dir, onSort }: { label: string; sortKey: SortKey; current: SortKey; dir: SortDir; onSort: (k: SortKey) => void }) {
  const active = current === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: active ? '#90cdf4' : '#718096', fontWeight: 600, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', borderBottom: '1px solid #2d3748' }}
    >
      {label} {active ? (dir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

type Panel = 'detail' | 'create' | 'edit' | null;

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('lastActiveAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json() as { users?: User[]; error?: string };
      if (data.users) setUsers(data.users);
      if (data.error) setError(data.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers().catch(() => {});
    const poll = setInterval(() => { fetchUsers().catch(() => {}); }, 30_000);
    return () => clearInterval(poll);
  }, [fetchUsers]);

  const flash = (msg: string) => {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(null), 3000);
  };

  const handleCreate = async (data: UserFormData) => {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: data.userId.trim(), ...stripEmpty({ handle: data.handle, displayName: data.displayName, email: data.email, avatarUrl: data.avatarUrl }) }),
    });
    const json = await res.json() as { error?: string };
    if (!res.ok) throw new Error(json.error ?? `Server error ${res.status}`);
    flash('User created');
    setPanel(null);
    await fetchUsers();
  };

  const handleEdit = async (data: UserFormData) => {
    if (!selected) return;
    const res = await fetch(`/api/admin/users/${encodeURIComponent(selected.userId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stripEmpty({ handle: data.handle, displayName: data.displayName, email: data.email, avatarUrl: data.avatarUrl })),
    });
    const json = await res.json() as { error?: string };
    if (!res.ok) throw new Error(json.error ?? `Server error ${res.status}`);
    flash('User updated');
    setPanel('detail');
    await fetchUsers();
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const filtered = filter
    ? users.filter(u =>
        u.userId.toLowerCase().includes(filter.toLowerCase()) ||
        (u.displayName ?? '').toLowerCase().includes(filter.toLowerCase()) ||
        (u.handle ?? '').toLowerCase().includes(filter.toLowerCase()) ||
        (u.email ?? '').toLowerCase().includes(filter.toLowerCase()),
      )
    : users;

  const displayed = sortUsers(filtered, sortKey, sortDir);

  const activeCount = users.filter(u => u.status === 'active').length;
  const editInitial: UserFormData = selected
    ? { userId: selected.userId, handle: selected.handle ?? '', displayName: selected.displayName ?? '', email: selected.email ?? '', avatarUrl: selected.avatarUrl ?? '' }
    : EMPTY_FORM;

  const panelCard: React.CSSProperties = {
    width: 300,
    flexShrink: 0,
    borderRadius: 8,
    border: '1px solid #2d3748',
    background: '#1a1f2e',
    padding: 16,
    alignSelf: 'flex-start',
    position: 'sticky',
    top: 0,
  };

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f0f4f8', marginBottom: 6 }}>Users</h1>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#718096' }}>
            <span>{users.length} total</span>
            <span style={{ color: '#68d391' }}>● {activeCount} active</span>
            <span>refreshes every 30s</span>
            {saveMsg && <span style={{ color: '#68d391' }}>{saveMsg}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="search"
            placeholder="Search by ID, name, email…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ ...INPUT_STYLE, width: 240 }}
          />
          <button
            onClick={() => { setSelected(null); setPanel('create'); }}
            style={{ borderRadius: 6, border: 'none', background: '#2b6cb0', color: '#e2e8f0', padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            + New user
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 16, borderRadius: 6, border: '1px solid #fc8181', background: 'rgba(252,129,129,0.08)', padding: '10px 14px', fontSize: 13, color: '#fc8181' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* Table */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <div style={{ color: '#718096', padding: 32 }}>Loading users…</div>
          ) : displayed.length === 0 ? (
            <div style={{ color: '#718096', padding: 32, textAlign: 'center', borderRadius: 8, border: '1px solid #2d3748' }}>
              {filter ? 'No users match your search.' : 'No users yet.'}
            </div>
          ) : (
            <div style={{ borderRadius: 8, border: '1px solid #2d3748', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ background: '#1a1f2e' }}>
                  <tr>
                    <SortHeader label="User" sortKey="displayName" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Status" sortKey="status" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Prompts" sortKey="totalPrompts" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Last active" sortKey="lastActiveAt" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="First seen" sortKey="firstSeenAt" current={sortKey} dir={sortDir} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((user, i) => {
                    const isSelected = selected?.userId === user.userId;
                    const name = user.displayName ?? user.handle ?? user.userId;
                    return (
                      <tr
                        key={user.userId}
                        onClick={() => { const next = isSelected ? null : user; setSelected(next); setPanel(next ? 'detail' : null); }}
                        style={{
                          background: isSelected ? 'rgba(99,179,237,0.08)' : i % 2 === 0 ? '#0f1117' : 'rgba(255,255,255,0.015)',
                          borderLeft: isSelected ? '2px solid #63b3ed' : '2px solid transparent',
                          cursor: 'pointer',
                          transition: 'background 0.1s',
                        }}
                      >
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2535' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {user.avatarUrl
                              ? <img src={user.avatarUrl} alt="" width={24} height={24} style={{ borderRadius: '50%', objectFit: 'cover' }} />
                              : <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#2d3748', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#718096', flexShrink: 0 }}>{name[0]?.toUpperCase()}</div>
                            }
                            <div>
                              <div style={{ color: '#f0f4f8', fontWeight: 500 }}>{name}</div>
                              {user.email && <div style={{ fontSize: 11, color: '#718096' }}>{user.email}</div>}
                              {!user.email && user.handle && <div style={{ fontSize: 11, color: '#718096' }}>@{user.handle}</div>}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2535' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: user.status === 'active' ? 'rgba(104,211,145,0.12)' : '#1a1f2e', color: user.status === 'active' ? '#68d391' : '#718096', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: user.status === 'active' ? '#68d391' : '#718096' }} />
                            {user.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2535', color: '#a0aec0', fontVariantNumeric: 'tabular-nums' }}>
                          {user.totalPrompts.toLocaleString()}
                        </td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2535', color: '#a0aec0', whiteSpace: 'nowrap' }}>
                          {timeAgo(user.lastActiveAt)}
                        </td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2535', color: '#718096', whiteSpace: 'nowrap' }}>
                          {timeAgo(user.firstSeenAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ padding: '8px 12px', background: '#1a1f2e', borderTop: '1px solid #2d3748', fontSize: 11, color: '#718096' }}>
                {displayed.length} of {users.length} user{users.length !== 1 ? 's' : ''}
                {filter && ` matching "${filter}"`}
              </div>
            </div>
          )}
        </div>

        {/* Create panel */}
        {panel === 'create' && (
          <div style={panelCard}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#f0f4f8' }}>Create user</span>
              <button onClick={() => setPanel(null)} style={{ background: 'none', border: 'none', color: '#718096', cursor: 'pointer', fontSize: 18 }} aria-label="Close">×</button>
            </div>
            <UserForm mode="create" initial={EMPTY_FORM} onSave={handleCreate} onCancel={() => setPanel(null)} />
          </div>
        )}

        {/* Edit panel */}
        {panel === 'edit' && selected && (
          <div style={panelCard}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#f0f4f8' }}>Edit user</span>
              <button onClick={() => setPanel('detail')} style={{ background: 'none', border: 'none', color: '#718096', cursor: 'pointer', fontSize: 18 }} aria-label="Close">×</button>
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#718096', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.userId}</div>
            <UserForm mode="edit" initial={editInitial} onSave={handleEdit} onCancel={() => setPanel('detail')} />
          </div>
        )}

        {/* Detail panel */}
        {panel === 'detail' && selected && (
          <div style={panelCard}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {selected.avatarUrl
                  ? <img src={selected.avatarUrl} alt="" width={32} height={32} style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  : <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#2d3748', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#a0aec0', flexShrink: 0 }}>{(selected.displayName ?? selected.handle ?? selected.userId)[0]?.toUpperCase()}</div>
                }
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f4f8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selected.displayName ?? selected.handle ?? selected.userId}
                  </div>
                  {selected.handle && selected.displayName && (
                    <div style={{ fontSize: 11, color: '#718096' }}>@{selected.handle}</div>
                  )}
                </div>
              </div>
              <button onClick={() => { setSelected(null); setPanel(null); }} style={{ background: 'none', border: 'none', color: '#718096', cursor: 'pointer', fontSize: 18, flexShrink: 0, marginLeft: 8 }} aria-label="Close">×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#718096' }}>User ID</span>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#a0aec0', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.userId}</span>
              </div>
              {selected.email && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: '#718096', flexShrink: 0 }}>Email</span>
                  <span style={{ color: '#a0aec0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.email}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#718096' }}>Status</span>
                <span style={{ color: selected.status === 'active' ? '#68d391' : '#718096' }}>{selected.status}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#718096' }}>Prompts</span>
                <span style={{ color: '#a0aec0' }}>{selected.totalPrompts.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#718096' }}>Last active</span>
                <span style={{ color: '#a0aec0' }}>{fmtDate(selected.lastActiveAt)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#718096' }}>First seen</span>
                <span style={{ color: '#a0aec0' }}>{fmtDate(selected.firstSeenAt)}</span>
              </div>
            </div>

            {selected.channels.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: '#718096', marginBottom: 6 }}>Channels ({selected.channels.length})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {selected.channels.map(ch => (
                    <span key={ch} style={{ background: '#2d3748', color: '#a0aec0', padding: '2px 6px', borderRadius: 10, fontSize: 11 }}>{ch}</span>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setPanel('edit')}
              style={{ width: '100%', borderRadius: 6, border: '1px solid #2d3748', background: '#0f1117', color: '#90cdf4', padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              Edit profile
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
