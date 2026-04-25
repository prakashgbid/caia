'use client';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface DbBackup {
  id: number;
  takenAt: string;
  path: string;
  sizeBytes: number;
  rowCountsJson: string;
  checksum: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

function parseRowCounts(json: string): Record<string, number> {
  try { return JSON.parse(json); } catch { return {}; }
}

export default function BackupsPage() {
  const { data: backups, isLoading } = useSWR<DbBackup[]>('/api/db-backups-proxy', fetcher, { refreshInterval: 120000 });

  const all = backups ?? [];
  const latest = all[0];
  const latestAge = latest ? Math.round((Date.now() - new Date(latest.takenAt).getTime()) / 1000 / 60 / 60) : null;
  const latestOk = latestAge !== null && latestAge < 26;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, color: '#90cdf4' }}>💾 Backups</h1>
        <span style={{ color: '#718096', fontSize: 14 }}>{all.length} recorded backups</span>
      </div>

      {/* Status card */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <div style={{ background: '#1a1f2e', border: `1px solid ${latestOk ? '#68d391' : '#fc8181'}`, borderRadius: 8, padding: 20 }}>
          <div style={{ fontSize: 13, color: '#718096', marginBottom: 4 }}>Latest backup</div>
          {latest ? (
            <>
              <div style={{ fontSize: 16, fontWeight: 700, color: latestOk ? '#68d391' : '#fc8181' }}>
                {latestAge !== null && latestAge < 1 ? '< 1h ago' : `${latestAge}h ago`}
              </div>
              <div style={{ fontSize: 11, color: '#718096', marginTop: 4, fontFamily: 'monospace' }}>
                {latest.path.split('/').pop()}
              </div>
            </>
          ) : (
            <div style={{ color: '#fc8181', fontSize: 14 }}>No backups recorded</div>
          )}
        </div>
        <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: 20 }}>
          <div style={{ fontSize: 13, color: '#718096', marginBottom: 4 }}>Total backups</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#e2e8f0' }}>{all.length}</div>
        </div>
        <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: 20 }}>
          <div style={{ fontSize: 13, color: '#718096', marginBottom: 4 }}>Latest size</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#e2e8f0' }}>
            {latest ? formatBytes(latest.sizeBytes) : '—'}
          </div>
        </div>
      </div>

      {/* Recovery link */}
      <div style={{ background: '#1a1f2e', border: '1px solid #4a5568', borderRadius: 8, padding: 16, marginBottom: 24, fontSize: 13, color: '#a0aec0' }}>
        <strong style={{ color: '#e2e8f0' }}>Restore procedure:</strong>{' '}
        Run <code style={{ color: '#90cdf4', background: '#2d3748', padding: '1px 4px', borderRadius: 3 }}>
          conductor db:import &lt;path&gt;
        </code>{' '}
        with the backup path below. See{' '}
        <code style={{ color: '#68d391' }}>framework/disaster-recovery.md</code> for full runbook.
        Restores require explicit user approval — never automatic.
      </div>

      {isLoading && <div style={{ color: '#a0aec0' }}>Loading...</div>}

      {all.length === 0 && !isLoading ? (
        <div data-empty-state style={{ color: '#718096', padding: 32, textAlign: 'center', border: '1px dashed #4a5568', borderRadius: 8 }}>
          No backups recorded yet. The daily cron at 3am will create the first backup.
          Run <code>conductor db:export ~/Documents/conductor-backups/manual.sqlite</code> for a manual backup.
        </div>
      ) : (
        <div data-test-region="backups-list" style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2d3748' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', color: '#718096', fontWeight: 600 }}>Taken at</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', color: '#718096', fontWeight: 600 }}>Path</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', color: '#718096', fontWeight: 600 }}>Size</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', color: '#718096', fontWeight: 600 }}>Row counts</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', color: '#718096', fontWeight: 600 }}>Checksum</th>
              </tr>
            </thead>
            <tbody>
              {all.map(b => {
                const counts = parseRowCounts(b.rowCountsJson);
                const totalRows = Object.values(counts).reduce((s, n) => s + n, 0);
                const age = Math.round((Date.now() - new Date(b.takenAt).getTime()) / 1000 / 60 / 60);
                return (
                  <tr key={b.id} style={{ borderBottom: '1px solid #141820' }}>
                    <td style={{ padding: '8px 14px', color: age < 26 ? '#68d391' : '#e2e8f0' }}>
                      {new Date(b.takenAt).toLocaleString()}
                      <div style={{ fontSize: 10, color: '#718096' }}>{age < 1 ? '< 1h ago' : `${age}h ago`}</div>
                    </td>
                    <td style={{ padding: '8px 14px', fontFamily: 'monospace', fontSize: 11, color: '#a0aec0', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {b.path}
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', color: '#e2e8f0' }}>{formatBytes(b.sizeBytes)}</td>
                    <td style={{ padding: '8px 14px', fontSize: 11, color: '#718096' }}>{totalRows.toLocaleString()} rows</td>
                    <td style={{ padding: '8px 14px', fontFamily: 'monospace', fontSize: 10, color: '#4a5568' }}>
                      {b.checksum.slice(0, 12)}…
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
