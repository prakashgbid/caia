'use client';
import { useState, useEffect, useCallback } from 'react';
import type { ProjectionData } from '../api/projections/route';

function fmt2(n: number): string {
  return `$${n.toFixed(2)}`;
}

function relDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysFromNow(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: '#1a202c',
        border: '1px solid #2d3748',
        borderRadius: 8,
        padding: '16px 20px',
        flex: '1 1 160px',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: '#718096',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function GaugeBar({
  label,
  value,
  max,
  color,
  unit = '',
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  unit?: string;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 13,
          color: '#a0aec0',
          marginBottom: 4,
        }}
      >
        <span>{label}</span>
        <span style={{ fontWeight: 600, color: '#f0f4f8' }}>
          {value.toLocaleString()}
          {unit} <span style={{ color: '#718096', fontWeight: 400 }}>/ {max.toLocaleString()}{unit}</span>
        </span>
      </div>
      <div style={{ height: 10, background: '#2d3748', borderRadius: 5, overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            borderRadius: 5,
            transition: 'width 0.5s',
          }}
        />
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#1a202c',
        border: '1px solid #2d3748',
        borderRadius: 8,
        padding: '18px 20px',
        marginBottom: 20,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: '#a0aec0',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 16,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

export default function ProjectionsPage() {
  const [data, setData] = useState<ProjectionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(() => {
    fetch('/api/projections')
      .then((r) => r.json() as Promise<ProjectionData | null>)
      .then((d) => {
        setData(d);
        setLoading(false);
        setLastRefresh(new Date());
      })
      .catch(() => {
        setLoading(false);
        setError('Failed to load projections data.');
      });
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return <div style={{ padding: 24, color: '#718096' }}>Computing projections…</div>;
  }

  if (error || !data) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ margin: '0 0 8px', color: '#f0f4f8' }}>Projections</h2>
        <div
          style={{
            background: '#2d2020',
            border: '1px solid #744949',
            borderRadius: 8,
            padding: '12px 16px',
            color: '#fc8181',
            fontSize: 13,
          }}
        >
          {error ?? 'Projections data unavailable.'}
        </div>
      </div>
    );
  }

  const { velocity, stories, cost } = data;
  const storyTotal = stories.total || 1;
  const donePct = Math.round((stories.done / storyTotal) * 100);

  const completionDaysAway =
    stories.estimatedCompletionDate ? daysFromNow(stories.estimatedCompletionDate) : null;

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 14,
            flexWrap: 'wrap',
            marginBottom: 4,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
            📈 Projections
          </h2>
          {lastRefresh && (
            <span style={{ fontSize: 12, color: '#718096' }}>
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={load}
            style={{
              background: '#2d3748',
              border: 'none',
              borderRadius: 4,
              color: '#a0aec0',
              cursor: 'pointer',
              fontSize: 12,
              padding: '3px 10px',
            }}
          >
            Refresh
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#718096' }}>
          Velocity, story throughput, and cost forecasts. Refreshes every 60 s.
        </p>
      </div>

      {/* Summary KPIs */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatCard
          label="Tasks remaining"
          value={velocity.tasksRemaining.toString()}
          sub={`${velocity.tasksCompletedLast7d} done last 7 d`}
          color={velocity.tasksRemaining === 0 ? '#68d391' : '#f0f4f8'}
        />
        <StatCard
          label="Daily velocity"
          value={velocity.tasksPerDay.toFixed(1)}
          sub="tasks / day (7-day avg)"
          color={velocity.tasksPerDay >= 2 ? '#68d391' : velocity.tasksPerDay >= 1 ? '#f6ad55' : '#fc8181'}
        />
        <StatCard
          label="Stories done"
          value={`${donePct}%`}
          sub={`${stories.done} / ${stories.total} stories`}
          color={donePct >= 80 ? '#68d391' : donePct >= 40 ? '#f6ad55' : '#63b3ed'}
        />
        <StatCard
          label="Projected monthly cost"
          value={fmt2(cost.projectedMonthlyUsd)}
          sub={`${fmt2(cost.dailyAvgUsd)} / day avg`}
          color={cost.projectedMonthlyUsd > 200 ? '#fc8181' : cost.projectedMonthlyUsd > 100 ? '#f6ad55' : '#68d391'}
        />
      </div>

      {/* Velocity Section */}
      <SectionCard title="⚡ Task Velocity">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <GaugeBar
            label="Tasks completed (last 7 d)"
            value={velocity.tasksCompletedLast7d}
            max={Math.max(velocity.tasksCompletedLast7d + velocity.tasksRemaining, 1)}
            color="#63b3ed"
          />
          {velocity.estimatedDaysToComplete !== null ? (
            <div
              style={{
                background: '#171d29',
                borderRadius: 6,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Estimated days to clear task backlog
                </div>
                <div style={{ fontSize: 32, fontWeight: 700, color: velocity.estimatedDaysToComplete <= 7 ? '#68d391' : velocity.estimatedDaysToComplete <= 30 ? '#f6ad55' : '#fc8181', marginTop: 2 }}>
                  {velocity.estimatedDaysToComplete} days
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#718096' }}>
                At {velocity.tasksPerDay.toFixed(1)} tasks/day,{' '}
                {velocity.tasksRemaining} remaining task{velocity.tasksRemaining !== 1 ? 's' : ''}{' '}
                clear by ~{relDate(new Date(Date.now() + velocity.estimatedDaysToComplete * 86_400_000).toISOString())}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#718096', fontStyle: 'italic' }}>
              No velocity data yet — tasks need completed timestamps to compute projections.
            </div>
          )}
        </div>
      </SectionCard>

      {/* Stories Section */}
      <SectionCard title="🌳 Story Throughput">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <GaugeBar
            label="Done"
            value={stories.done}
            max={stories.total || 1}
            color="#68d391"
          />
          <GaugeBar
            label="In progress"
            value={stories.inProgress}
            max={stories.total || 1}
            color="#63b3ed"
          />
          <GaugeBar
            label="Ready / Backlog"
            value={stories.ready}
            max={stories.total || 1}
            color="#f6ad55"
          />
          {stories.blocked > 0 && (
            <GaugeBar
              label="Blocked"
              value={stories.blocked}
              max={stories.total || 1}
              color="#fc8181"
            />
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 12,
              marginTop: 4,
            }}
          >
            {stories.avgCycleTimeDays !== null && (
              <div
                style={{
                  background: '#171d29',
                  borderRadius: 6,
                  padding: '10px 14px',
                }}
              >
                <div style={{ fontSize: 11, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  Avg cycle time
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
                  {stories.avgCycleTimeDays.toFixed(1)} d
                </div>
              </div>
            )}

            {stories.estimatedCompletionDate !== null && completionDaysAway !== null && (
              <div
                style={{
                  background: '#171d29',
                  borderRadius: 6,
                  padding: '10px 14px',
                }}
              >
                <div style={{ fontSize: 11, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  Est. completion
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color:
                      completionDaysAway <= 7
                        ? '#68d391'
                        : completionDaysAway <= 30
                        ? '#f6ad55'
                        : '#fc8181',
                  }}
                >
                  {relDate(stories.estimatedCompletionDate)}
                </div>
                <div style={{ fontSize: 12, color: '#718096', marginTop: 2 }}>
                  {completionDaysAway > 0 ? `${completionDaysAway} days away` : 'overdue'}
                </div>
              </div>
            )}

            {stories.avgCycleTimeDays === null && stories.estimatedCompletionDate === null && (
              <div style={{ fontSize: 13, color: '#718096', fontStyle: 'italic' }}>
                No cycle time data yet — stories need created + completed timestamps.
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Cost Forecast Section */}
      <SectionCard title="💰 Cost Forecast">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          {[
            { label: 'Daily avg (today)', value: fmt2(cost.dailyAvgUsd) },
            { label: 'Projected weekly', value: fmt2(cost.projectedWeeklyUsd) },
            { label: 'Projected monthly', value: fmt2(cost.projectedMonthlyUsd) },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                background: '#171d29',
                borderRadius: 6,
                padding: '10px 14px',
              }}
            >
              <div style={{ fontSize: 11, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                {label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#718096' }}>
          Projections are linear extrapolations from today&apos;s spend. Actual costs vary with pipeline activity.
        </div>
      </SectionCard>

      {/* Footer */}
      <div style={{ fontSize: 11, color: '#4a5568', textAlign: 'right' }}>
        Generated {relDate(data.generatedAt)}
      </div>
    </div>
  );
}
