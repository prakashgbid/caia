/**
 * Work — section landing.
 *
 * DASH-002 stub: a simple TOC card grid linking to the Work-section
 * children. Replaced with real KPIs + recent activity in PR8
 * (feat/dash-008-task-tracking-core).
 */
'use client';
import Link from 'next/link';

const SECTIONS = [
  { href: '/work/prompts', label: 'Prompts', icon: '💬', desc: 'List, drill into a prompt, see its journey + lineage.' },
  { href: '/work/submit', label: 'Submit a prompt', icon: '➕', desc: 'Send a new prompt to the pipeline.' },
  { href: '/work/queue', label: 'Queue', icon: '🎯', desc: 'What is up next, prioritised.' },
  { href: '/work/buckets', label: 'Buckets', icon: '🗂️', desc: 'Ticket bundles grouped by bucket.' },
  { href: '/work/stories', label: 'Stories', icon: '🌳', desc: 'All stories across every prompt.' },
  { href: '/work/tasks', label: 'Tasks', icon: '📋', desc: 'Atomic tasks across all stories.' },
  { href: '/work/requirements', label: 'Requirements', icon: '📝', desc: 'BA-emitted requirements.' },
  { href: '/work/blockers', label: 'Blockers', icon: '🚨', desc: 'Active and recently resolved blockers.' },
  { href: '/work/questions', label: 'Questions', icon: '❓', desc: 'Open agent ↔ human clarifications.' },
  { href: '/work/suggestions', label: 'Suggestions', icon: '💡', desc: 'Agent-emitted follow-up ideas.' },
];

export default function WorkLanding() {
  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#f0f4f8' }}>📋 Work</h1>
      <p style={{ marginTop: 8, color: '#a0aec0', fontSize: 14 }}>
        The Jira-like task board — prompts, stories, tasks, queue, blockers.
      </p>
      <div
        style={{
          marginTop: 24,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 12,
        }}
      >
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            style={{
              display: 'block',
              padding: 16,
              background: '#1a1f2e',
              border: '1px solid #2d3748',
              borderRadius: 12,
              textDecoration: 'none',
              color: '#f0f4f8',
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              <span aria-hidden="true">{s.icon}</span> {s.label}
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: '#a0aec0' }}>{s.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
