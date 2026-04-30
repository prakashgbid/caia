'use client';
import { useEffect, useRef, useState } from 'react';

interface UserProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  tier: string;
  lifetime_points: number;
  location_state: string | null;
  location_city: string | null;
  created_at: string;
  updated_at: string;
}

const TIER_COLORS: Record<string, string> = {
  admin: '#fc8181',
  moderator: '#f6ad55',
  trusted: '#68d391',
  contributor: '#63b3ed',
  member: '#a0aec0',
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [editBtnHovered, setEditBtnHovered] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [locationState, setLocationState] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/profile');
      if (!res.ok) {
        setError(`Failed to load profile (${res.status})`);
        return;
      }
      const data = await res.json() as UserProfile;
      setProfile(data);
      setDisplayName(data.display_name ?? '');
      setBio(data.bio ?? '');
      setLocationCity(data.location_city ?? '');
      setLocationState(data.location_state ?? '');
    } catch {
      setError('Could not reach orchestrator. Is the API up?');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleEdit = () => {
    setEditing(true);
    setSuccessMsg(null);
    setError(null);
  };

  const handleCancel = () => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? '');
    setBio(profile.bio ?? '');
    setLocationCity(profile.location_city ?? '');
    setLocationState(profile.location_state ?? '');
    setAvatarPreview(null);
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName || null,
          bio: bio || null,
          location_city: locationCity || null,
          location_state: locationState || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        setError(body.error ?? `Save failed (${res.status})`);
        return;
      }
      await load();
      setEditing(false);
      setSuccessMsg('Profile updated successfully');
    } catch {
      setError('Failed to save profile changes');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      setAvatarPreview(evt.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleAvatarUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setUploadingAvatar(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('avatar', file);

      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        setError(body.error ?? `Avatar upload failed (${res.status})`);
        return;
      }
      await load();
      setAvatarPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setSuccessMsg('Avatar updated');
    } catch {
      setError('Failed to upload avatar');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: '#0f1117',
    border: '1px solid #2d3748',
    borderRadius: 6,
    color: '#f0f4f8',
    padding: '8px 12px',
    fontSize: 14,
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    color: '#a0aec0',
    fontSize: 12,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  const cardStyle: React.CSSProperties = {
    background: '#1a1f2e',
    border: '1px solid #2d3748',
    borderRadius: 8,
    padding: 20,
    marginBottom: 16,
  };

  if (loading) {
    return (
      <div>
        <h1 style={{ margin: '0 0 16px', fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
          👤 Profile
        </h1>
        <p style={{ color: '#718096' }}>Loading profile…</p>
      </div>
    );
  }

  if (!profile && error) {
    return (
      <div>
        <h1 style={{ margin: '0 0 16px', fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
          👤 Profile
        </h1>
        <p style={{ color: '#fc8181' }}>{error}</p>
      </div>
    );
  }

  const avatarSrc = avatarPreview ?? profile?.avatar_url;
  const tierColor = profile ? (TIER_COLORS[profile.tier] ?? '#a0aec0') : '#a0aec0';

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>👤 Profile</h1>
        {!editing && (
          <button
            onClick={handleEdit}
            aria-label="Edit profile"
            onMouseEnter={() => setEditBtnHovered(true)}
            onMouseLeave={() => setEditBtnHovered(false)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: editBtnHovered ? '#2c5282' : '#2b6cb0',
              color: '#fff',
              border: '1px solid ' + (editBtnHovered ? '#90cdf4' : 'transparent'),
              borderRadius: 6,
              padding: '7px 14px',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              outline: 'none',
              transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
              boxShadow: editBtnHovered ? '0 0 0 2px #2b6cb044' : 'none',
            }}
            onFocus={(e) => { e.currentTarget.style.boxShadow = '0 0 0 3px #63b3ed88'; }}
            onBlur={(e) => { e.currentTarget.style.boxShadow = editBtnHovered ? '0 0 0 2px #2b6cb044' : 'none'; }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit
          </button>
        )}
      </div>

      {successMsg && (
        <div
          role="status"
          style={{ background: '#1c4532', border: '1px solid #38a169', borderRadius: 6, padding: '10px 14px', marginBottom: 16, color: '#68d391', fontSize: 14 }}
        >
          {successMsg}
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{ background: '#3b1111', border: '1px solid #fc8181', borderRadius: 6, padding: '10px 14px', marginBottom: 16, color: '#fc8181', fontSize: 14 }}
        >
          {error}
        </div>
      )}

      {/* Avatar section */}
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarSrc}
              alt={`${profile?.display_name ?? profile?.username ?? 'User'} avatar`}
              width={80}
              height={80}
              style={{ borderRadius: '50%', objectFit: 'cover', border: '2px solid #2d3748' }}
            />
          ) : (
            <div
              aria-label="No avatar"
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: '#2d3748',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 32,
                border: '2px solid #4a5568',
              }}
            >
              👤
            </div>
          )}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#f0f4f8', marginBottom: 4 }}>
            {profile?.display_name ?? profile?.username ?? '—'}
          </div>
          <div style={{ color: '#a0aec0', fontSize: 13, marginBottom: 6 }}>
            @{profile?.username}
          </div>
          <span
            style={{
              background: '#2d3748',
              color: tierColor,
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 12,
              fontWeight: 600,
              textTransform: 'capitalize',
            }}
          >
            {profile?.tier}
          </span>
        </div>

        {editing && (
          <div style={{ flexShrink: 0, textAlign: 'center' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              aria-label="Upload avatar image"
              onChange={handleAvatarFileChange}
              style={{ display: 'none' }}
              id="avatar-upload"
            />
            <label
              htmlFor="avatar-upload"
              style={{
                display: 'block',
                background: '#2d3748',
                color: '#f0f4f8',
                borderRadius: 6,
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: 12,
                marginBottom: 8,
                textAlign: 'center',
              }}
            >
              📷 Choose photo
            </label>
            {avatarPreview && (
              <button
                onClick={() => void handleAvatarUpload()}
                disabled={uploadingAvatar}
                style={{
                  background: uploadingAvatar ? '#2d3748' : '#276749',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '6px 12px',
                  cursor: uploadingAvatar ? 'not-allowed' : 'pointer',
                  fontSize: 12,
                  width: '100%',
                }}
              >
                {uploadingAvatar ? 'Uploading…' : '⬆️ Upload'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Profile fields */}
      <div style={cardStyle}>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle} htmlFor="display-name">Display Name</label>
          {editing ? (
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your display name"
              maxLength={80}
              style={inputStyle}
            />
          ) : (
            <div style={{ color: '#f0f4f8', fontSize: 14, padding: '8px 0' }}>
              {profile?.display_name ?? <span style={{ color: '#4a5568' }}>Not set</span>}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle} htmlFor="bio">Bio</label>
          {editing ? (
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell us about yourself"
              maxLength={300}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          ) : (
            <div style={{ color: '#f0f4f8', fontSize: 14, padding: '8px 0', whiteSpace: 'pre-wrap' }}>
              {profile?.bio ?? <span style={{ color: '#4a5568' }}>Not set</span>}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={labelStyle} htmlFor="location-city">City</label>
            {editing ? (
              <input
                id="location-city"
                type="text"
                value={locationCity}
                onChange={(e) => setLocationCity(e.target.value)}
                placeholder="City"
                maxLength={100}
                style={inputStyle}
              />
            ) : (
              <div style={{ color: '#f0f4f8', fontSize: 14, padding: '8px 0' }}>
                {profile?.location_city ?? <span style={{ color: '#4a5568' }}>—</span>}
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle} htmlFor="location-state">State / Region</label>
            {editing ? (
              <input
                id="location-state"
                type="text"
                value={locationState}
                onChange={(e) => setLocationState(e.target.value)}
                placeholder="State or region"
                maxLength={100}
                style={inputStyle}
              />
            ) : (
              <div style={{ color: '#f0f4f8', fontSize: 14, padding: '8px 0' }}>
                {profile?.location_state ?? <span style={{ color: '#4a5568' }}>—</span>}
              </div>
            )}
          </div>
        </div>

        {editing && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={handleCancel}
              disabled={saving}
              style={{
                background: 'transparent',
                color: '#a0aec0',
                border: '1px solid #4a5568',
                borderRadius: 6,
                padding: '8px 16px',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              style={{
                background: saving ? '#2d3748' : '#2b6cb0',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>

      {/* Read-only stats */}
      <div style={{ ...cardStyle, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#63b3ed', fontSize: 20, fontWeight: 700 }}>
            {profile?.lifetime_points?.toLocaleString() ?? '0'}
          </div>
          <div style={{ color: '#718096', fontSize: 12 }}>Points</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#68d391', fontSize: 14, fontWeight: 600, textTransform: 'capitalize' }}>
            {profile?.tier ?? '—'}
          </div>
          <div style={{ color: '#718096', fontSize: 12 }}>Tier</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#a0aec0', fontSize: 12 }}>
            {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}
          </div>
          <div style={{ color: '#718096', fontSize: 12 }}>Joined</div>
        </div>
      </div>
    </div>
  );
}
