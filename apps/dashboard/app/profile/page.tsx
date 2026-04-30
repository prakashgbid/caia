'use client';
import useSWR from 'swr';
import { useState, useRef, useCallback } from 'react';

interface Profile {
  username: string;
  displayName: string;
  bio: string;
  city: string;
  state: string;
  avatarUrl: string | null;
  updatedAt: string;
}

const fetcher = (url: string) =>
  fetch(url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<Profile>;
  });

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const cardStyle: React.CSSProperties = {
  background: '#1a1f2e',
  border: '1px solid #2d3748',
  borderRadius: 8,
  padding: 20,
  marginBottom: 16,
  maxWidth: 600,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#718096',
  marginBottom: 4,
  display: 'block',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0f1117',
  border: '1px solid #2d3748',
  borderRadius: 4,
  padding: '8px 10px',
  color: '#e2e8f0',
  fontSize: 14,
  outline: 'none',
};

const btnStyle = (variant: 'save' | 'cancel' | 'edit', disabled = false): React.CSSProperties => ({
  background: variant === 'save' ? '#22543d' : variant === 'cancel' ? '#742a2a' : '#2b6cb0',
  border: 'none',
  color: '#e2e8f0',
  borderRadius: 4,
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.6 : 1,
});

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <dt style={{ fontSize: 12, color: '#718096', minWidth: 110 }}>{label}</dt>
      <dd style={{ fontSize: 14, color: '#e2e8f0', margin: 0 }}>{value}</dd>
    </div>
  );
}

export default function ProfilePage() {
  const { data: profile, error, mutate, isLoading } = useSWR<Profile>(
    '/api/profile',
    fetcher,
    { revalidateOnFocus: false },
  );

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Profile>>({});
  const [saving, setSaving] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startEdit = useCallback(() => {
    if (!profile) return;
    setForm({
      displayName: profile.displayName,
      bio: profile.bio,
      city: profile.city,
      state: profile.state,
    });
    setAvatarPreview(null);
    setAvatarFile(null);
    setFileError(null);
    setStatusMsg(null);
    setEditing(true);
  }, [profile]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setAvatarPreview(null);
    setAvatarFile(null);
    setFileError(null);
    setStatusMsg(null);
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setFileError('Only JPEG, PNG, WebP, and GIF files are allowed.');
      setAvatarFile(null);
      setAvatarPreview(null);
      return;
    }
    setFileError(null);
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setStatusMsg(null);
    try {
      let avatarUrl: string | undefined;
      if (avatarFile) {
        const fd = new FormData();
        fd.append('avatar', avatarFile);
        const avatarRes = await fetch('/api/profile/avatar', { method: 'POST', body: fd });
        if (avatarRes.ok) {
          const { url } = await avatarRes.json() as { url: string };
          avatarUrl = url;
        }
      }
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, ...(avatarUrl !== undefined && { avatarUrl }) }),
      });
      if (!res.ok) throw new Error(`Save failed (HTTP ${res.status})`);
      await mutate();
      setEditing(false);
      setAvatarPreview(null);
      setAvatarFile(null);
      setStatusMsg({ text: 'Profile saved.', ok: true });
    } catch (err) {
      setStatusMsg({
        text: err instanceof Error ? err.message : 'Unknown error saving profile.',
        ok: false,
      });
    } finally {
      setSaving(false);
    }
  }, [form, avatarFile, mutate]);

  const displayInitial = ((profile?.displayName || profile?.username) ?? 'O')[0]?.toUpperCase() ?? 'O';
  const avatarSrc = avatarPreview ?? profile?.avatarUrl ?? null;

  return (
    <main>
      <h1 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
        👤 Profile
      </h1>

      {isLoading && (
        <p aria-live="polite" aria-busy="true" style={{ color: '#718096' }}>
          Loading profile…
        </p>
      )}

      {error && !isLoading && (
        <div
          role="alert"
          style={{
            color: '#fc8181',
            background: '#1a1f2e',
            border: '1px solid #742a2a',
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
            maxWidth: 600,
          }}
        >
          Could not load profile.{' '}
          <button
            onClick={() => void mutate()}
            style={{ background: 'none', border: 'none', color: '#63b3ed', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}
          >
            Retry
          </button>
        </div>
      )}

      {profile && (
        <>
          {/* Avatar + name header */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              {/* Avatar */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                {avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt={`${profile.displayName || profile.username} avatar`}
                    style={{
                      width: 72, height: 72, borderRadius: '50%',
                      objectFit: 'cover', border: '2px solid #2d3748',
                    }}
                  />
                ) : (
                  <div
                    aria-label={`Avatar for ${profile.displayName || profile.username}`}
                    style={{
                      width: 72, height: 72, borderRadius: '50%', background: '#2b6cb0',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 28, fontWeight: 700, color: '#e2e8f0',
                      border: '2px solid #2d3748', userSelect: 'none',
                    }}
                  >
                    {displayInitial}
                  </div>
                )}
                {editing && (
                  <button
                    aria-label="Upload new avatar"
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      position: 'absolute', bottom: 0, right: 0,
                      background: '#2b6cb0', border: '2px solid #0f1117',
                      borderRadius: '50%', width: 24, height: 24,
                      cursor: 'pointer', color: '#e2e8f0', fontSize: 11,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    ✏
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES.join(',')}
                  aria-label="Choose avatar file"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
              </div>

              {/* Name + username */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#f0f4f8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {profile.displayName || profile.username}
                </div>
                <div style={{ fontSize: 13, color: '#718096', marginTop: 2 }}>
                  @{profile.username}
                </div>
                {!editing && (
                  <button
                    onClick={startEdit}
                    aria-label="Edit profile"
                    style={{ ...btnStyle('edit'), marginTop: 10 }}
                  >
                    Edit profile
                  </button>
                )}
              </div>
            </div>

            {fileError && (
              <p role="alert" style={{ color: '#fc8181', fontSize: 12, marginTop: 10 }}>
                {fileError}
              </p>
            )}
          </div>

          {/* Details card */}
          <div style={cardStyle}>
            {editing ? (
              <form
                onSubmit={e => { e.preventDefault(); void handleSave(); }}
                aria-label="Edit profile form"
              >
                <div style={{ marginBottom: 14 }}>
                  <label htmlFor="profile-display-name" style={labelStyle}>
                    Display name
                  </label>
                  <input
                    id="profile-display-name"
                    type="text"
                    style={inputStyle}
                    value={form.displayName ?? ''}
                    onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                    maxLength={80}
                  />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label htmlFor="profile-bio" style={labelStyle}>Bio</label>
                  <textarea
                    id="profile-bio"
                    style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }}
                    value={form.bio ?? ''}
                    onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
                    maxLength={280}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                  <div>
                    <label htmlFor="profile-city" style={labelStyle}>City</label>
                    <input
                      id="profile-city"
                      type="text"
                      style={inputStyle}
                      value={form.city ?? ''}
                      onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                      maxLength={60}
                    />
                  </div>
                  <div>
                    <label htmlFor="profile-state" style={labelStyle}>State / Region</label>
                    <input
                      id="profile-state"
                      type="text"
                      style={inputStyle}
                      value={form.state ?? ''}
                      onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
                      maxLength={60}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="submit" disabled={saving} style={btnStyle('save', saving)}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={cancelEdit} disabled={saving} style={btnStyle('cancel', saving)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <dl style={{ display: 'grid', gap: 12 }}>
                <FieldRow label="Display name" value={profile.displayName || '—'} />
                <FieldRow label="Bio" value={profile.bio || '—'} />
                <FieldRow label="City" value={profile.city || '—'} />
                <FieldRow label="State / Region" value={profile.state || '—'} />
                <FieldRow
                  label="Last updated"
                  value={new Date(profile.updatedAt).toLocaleString()}
                />
              </dl>
            )}
          </div>

          {statusMsg && (
            <p
              aria-live="polite"
              style={{
                color: statusMsg.ok ? '#68d391' : '#fc8181',
                fontSize: 13,
                marginTop: 4,
              }}
            >
              {statusMsg.text}
            </p>
          )}
        </>
      )}
    </main>
  );
}
