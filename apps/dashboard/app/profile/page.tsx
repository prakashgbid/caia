'use client';
import { useEffect, useRef, useState } from 'react';

interface UserProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users/profile');
      if (res.ok) setProfile(await res.json() as UserProfile);
    } catch { /* silent */ }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const openEdit = () => {
    setDraftName(profile?.displayName ?? '');
    setEditing(true);
    setStatusMsg(null);
  };

  const cancelEdit = () => {
    setEditing(false);
    setStatusMsg(null);
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/users/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: draftName }),
      });
      if (res.ok) {
        setProfile(await res.json() as UserProfile);
        setEditing(false);
        setStatusMsg('Saved');
      } else {
        setStatusMsg('Save failed — please try again');
      }
    } catch {
      setStatusMsg('Save failed — please try again');
    }
    setBusy(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); void saveEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatusMsg(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch('/api/users/avatar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatarUrl: reader.result }),
        });
        if (res.ok) {
          setProfile(await res.json() as UserProfile);
          setStatusMsg('Avatar updated');
        } else {
          setStatusMsg('Avatar upload failed');
        }
      } catch {
        setStatusMsg('Avatar upload failed');
      }
      setBusy(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const removeAvatar = async () => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/users/avatar', { method: 'DELETE' });
      if (res.ok) {
        setProfile(await res.json() as UserProfile);
        setStatusMsg('Avatar removed');
      }
    } catch { /* silent */ }
    setBusy(false);
  };

  const card: React.CSSProperties = {
    background: '#1a1f2e',
    border: '1px solid #2d3748',
    borderRadius: 8,
    padding: '20px 24px',
    marginBottom: 16,
  };

  const labelStyle: React.CSSProperties = { color: '#718096', fontSize: 12, marginBottom: 4 };
  const valueStyle: React.CSSProperties = { color: '#f0f4f8', fontSize: 14 };

  const avatarCircle: React.CSSProperties = {
    width: 64,
    height: 64,
    borderRadius: '50%',
    flexShrink: 0,
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
        Profile
      </h1>

      {loading ? (
        <p style={{ color: '#718096' }}>Loading…</p>
      ) : (
        <>
          {/* Avatar upload section */}
          <section aria-label="Avatar upload" style={card}>
            <p style={{ ...labelStyle, marginBottom: 12 }}>Avatar</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {profile?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatarUrl}
                  alt="User avatar"
                  style={{ ...avatarCircle, objectFit: 'cover' }}
                />
              ) : (
                <div
                  role="img"
                  aria-label="Avatar placeholder"
                  style={{
                    ...avatarCircle,
                    background: '#2d3748',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    fontWeight: 700,
                    color: '#90cdf4',
                  }}
                >
                  {initials(profile?.displayName ?? '')}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
                <button
                  aria-label="Upload new avatar"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                  style={{
                    padding: '6px 14px',
                    background: '#2d3748',
                    border: '1px solid #4a5568',
                    borderRadius: 6,
                    color: '#f0f4f8',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Upload new avatar
                </button>
                {profile?.avatarUrl && (
                  <button
                    aria-label="Remove avatar"
                    disabled={busy}
                    onClick={removeAvatar}
                    style={{
                      padding: '6px 14px',
                      background: 'transparent',
                      border: '1px solid #fc8181',
                      borderRadius: 6,
                      color: '#fc8181',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    Remove avatar
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Display name section */}
          <div style={card}>
            <p style={labelStyle}>Display name</p>
            {editing ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  ref={inputRef}
                  aria-label="Display name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={busy}
                  style={{
                    flex: 1,
                    minWidth: 160,
                    padding: '6px 10px',
                    background: '#0f1117',
                    border: '1px solid #4a5568',
                    borderRadius: 6,
                    color: '#f0f4f8',
                    fontSize: 14,
                  }}
                />
                <button
                  aria-label="Save"
                  disabled={busy}
                  onClick={saveEdit}
                  style={{
                    padding: '6px 14px',
                    background: '#3182ce',
                    border: 'none',
                    borderRadius: 6,
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  Save
                </button>
                <button
                  aria-label="Cancel"
                  disabled={busy}
                  onClick={cancelEdit}
                  style={{
                    padding: '6px 14px',
                    background: 'transparent',
                    border: '1px solid #4a5568',
                    borderRadius: 6,
                    color: '#718096',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={valueStyle}>
                  {profile?.displayName || <em style={{ color: '#718096' }}>Not set</em>}
                </span>
                <button
                  aria-label="Edit display name"
                  onClick={openEdit}
                  style={{
                    padding: '4px 10px',
                    background: 'transparent',
                    border: '1px solid #4a5568',
                    borderRadius: 6,
                    color: '#90cdf4',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Edit
                </button>
              </div>
            )}
          </div>

          {/* Account info section */}
          <div style={card}>
            <p style={{ ...labelStyle, marginBottom: 12 }}>Account info</p>
            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px 12px' }}>
              <span style={labelStyle}>User ID</span>
              <span style={{ ...valueStyle, fontFamily: 'monospace', fontSize: 12 }}>{profile?.id}</span>
              <span style={labelStyle}>Created</span>
              <span style={valueStyle}>{profile ? new Date(profile.createdAt).toLocaleString() : '—'}</span>
              <span style={labelStyle}>Updated</span>
              <span style={valueStyle}>{profile ? new Date(profile.updatedAt).toLocaleString() : '—'}</span>
            </div>
          </div>

          {/* Status announcer */}
          <div
            role="status"
            aria-live="polite"
            style={{
              minHeight: 24,
              fontSize: 13,
              color: statusMsg?.toLowerCase().includes('fail') ? '#fc8181' : '#68d391',
              visibility: statusMsg ? 'visible' : 'hidden',
            }}
          >
            {statusMsg ?? ''}
          </div>
        </>
      )}
    </div>
  );
}
