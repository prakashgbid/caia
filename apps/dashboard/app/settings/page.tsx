export default function SettingsPage() {
  return (
    <div>
      <h1 style={{ margin: '0 0 16px', fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>⚙️ Settings</h1>
      <p style={{ color: '#718096', fontSize: 14 }}>Configuration options coming soon.</p>
      <div style={{ marginTop: 24, background: '#1a1f2e', borderRadius: 8, padding: 16, border: '1px solid #2d3748', maxWidth: 480 }}>
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
    </div>
  );
}
