'use client';
import { useState, useRef, useCallback } from 'react';
import useSWR, { mutate } from 'swr';

interface UserProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

const CARD: React.CSSProperties = {
  background: '#1a1f2e',
  border: '1px solid #2d3748',
  borderRadius: 8,
  padding: 24,
  maxWidth: 480,
};

const LABEL: React.CSSProperties = {
  fontSize: 12,
  color: '#718096',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 6,
  display: 'block',
};

const INPUT: React.CSSProperties = {
  background: '#0f1117',
  border: '1px solid #4a5568',
  borderRadius: 4,
  color: '#f0f4f8',
  fontSize: 14,
  padding: '8px 12px',
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
};

const BTN_PRIMARY: React.CSSProperties = {
  background: '#2b6cb0',
  border: 'none',
  borderRadius: 4,
  color: '#e2e8f0',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  padding: '8px 18px',
};

const BTN_SECONDARY: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #4a5568',
  borderRadius: 4,
  color: '#a0aec0',
  cursor: 'pointer',
  fontSize: 13,
  padding: '8px 18px',
};

const BTN_DANGER: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #742a2a',
  borderRadius: 4,
  color: '#fc8181',
  cursor: 'pointer',
  fontSize: 12,
  padding: '6px 12px',
};

export default function ProfilePage() {
  const { data: profile, isLoading } = useSWR<UserProfile>('/api/users/profile', fetcher);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDisplayName(profile?.displayName ?? '');
    setStatusMsg(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setStatusMsg(null);
  };

  const saveProfile = async () => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/users/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      if (!res.ok) throw new Error('Save failed');
      await mutate('/api/users/profile');
      setEditing(false);
      setStatusMsg('Profile saved');
    } catch {
      setStatusMsg('Save failed — please try again');
    } finally {
      setBusy(false);
    }
  };

  const handleAvatarFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setStatusMsg('Please select an image file');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setStatusMsg('Image must be under 2 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setBusy(true);
      setStatusMsg(null);
      try {
        const res = await fetch('/api/users/avatar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl }),
        });
        if (!res.ok) throw new Error('Upload failed');
        await mutate('/api/users/profile');
        setStatusMsg('Avatar updated');
      } catch {
        setStatusMsg('Upload failed — please try again');
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // only clear when leaving the drop zone itself, not its children
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragging(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleAvatarFile(file);
  }, [handleAvatarFile]);

  const removeAvatar = async () => {
    setBusy(true);
    setStatusMsg(null);
    try {
      await fetch('/api/users/avatar', { method: 'DELETE' });
      await mutate('/api/users/profile');
      setStatusMsg('Avatar removed');
    } catch {
      setStatusMsg('Remove failed');
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div>
        <h1 style={{ margin: '0 0 16px', fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>👤 Profile</h1>
        <p style={{ color: '#718096' }}>Loading…</p>
      </div>
    );
  }

  const initials = (profile?.displayName ?? '').slice(0, 2).toUpperCase() || '??';

  return (
    <div>
      <h1 style={{ margin: '0 0 24px', fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>👤 Profile</h1>

      {/* Avatar section — also a drag-and-drop target */}
      <div
        role="region"
        aria-label="Avatar upload"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          ...CARD,
          marginBottom: 16,
          border: dragging ? '1px dashed #63b3ed' : '1px solid #2d3748',
          background: dragging ? '#1a2744' : '#1a1f2e',
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        <span style={LABEL}>Avatar</span>

        {dragging && (
          <div
            aria-hidden="true"
            style={{
              textAlign: 'center',
              padding: '12px 0',
              color: '#63b3ed',
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            Drop image here
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          {/* Avatar preview */}
          <div
            role="img"
            aria-label={profile?.avatarUrl ? 'User avatar' : `User avatar placeholder: ${initials}`}
            style={{
              width: 80, height: 80, borderRadius: '50%',
              background: profile?.avatarUrl ? 'transparent' : '#2d3748',
              border: dragging ? '2px dashed #63b3ed' : '2px solid #4a5568',
              overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'border-color 0.15s',
            }}
          >
            {profile?.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt="User avatar"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: 24, color: '#a0aec0', fontWeight: 700 }} aria-hidden="true">
                {initials}
              </span>
            )}
          </div>

          {/* Upload controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              aria-label="Upload avatar image"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleAvatarFile(f); e.target.value = ''; }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              style={{ ...BTN_PRIMARY, opacity: busy ? 0.5 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}
              aria-label="Upload new avatar"
            >
              {busy ? 'Uploading…' : 'Upload image'}
            </button>
            {profile?.avatarUrl && (
              <button
                onClick={removeAvatar}
                disabled={busy}
                style={{ ...BTN_DANGER, opacity: busy ? 0.5 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}
                aria-label="Remove avatar"
              >
                Remove
              </button>
            )}
            <span style={{ fontSize: 11, color: '#718096' }}>PNG, JPG, GIF · max 2 MB · or drag &amp; drop</span>
          </div>
        </div>
      </div>

      {/* Display name section */}
      <div style={{ ...CARD, marginBottom: 16 }}>
        <span style={LABEL}>Display name</span>
        {editing ? (
          <div>
            <input
              id="display-name-input"
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void saveProfile(); if (e.key === 'Escape') cancelEdit(); }}
              maxLength={64}
              placeholder="Your display name"
              aria-label="Display name"
              autoFocus
              style={INPUT}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
              <button
                onClick={saveProfile}
                disabled={busy}
                style={{ ...BTN_PRIMARY, opacity: busy ? 0.5 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button onClick={cancelEdit} disabled={busy} style={BTN_SECONDARY}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, color: profile?.displayName ? '#f0f4f8' : '#4a5568' }}>
              {profile?.displayName || 'No display name set'}
            </span>
            <button
              onClick={startEdit}
              style={BTN_SECONDARY}
              aria-label="Edit display name"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Status message */}
      {statusMsg && (
        <div
          role="status"
          aria-live="polite"
          style={{
            fontSize: 13,
            color: statusMsg.includes('fail') || statusMsg.includes('Failed') ? '#fc8181' : '#68d391',
            marginBottom: 16,
          }}
        >
          {statusMsg}
        </div>
      )}

      {/* Meta info */}
      {profile && (
        <div style={{ ...CARD }}>
          <span style={LABEL}>Account info</span>
          <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ color: '#718096', minWidth: 90 }}>User ID</span>
              <span style={{ fontFamily: 'monospace', color: '#63b3ed', wordBreak: 'break-all' }}>{profile.id}</span>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <span style={{ color: '#718096', minWidth: 90 }}>Created</span>
              <span style={{ color: '#a0aec0' }}>{new Date(profile.createdAt).toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <span style={{ color: '#718096', minWidth: 90 }}>Updated</span>
              <span style={{ color: '#a0aec0' }}>{new Date(profile.updatedAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
