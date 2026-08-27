/**
 * Wizard Step 3 — Interview (server component).
 *
 * Pattern matches the sibling step pages from PR #610:
 *   - `'use client'` lives in the `<InterviewerChat>` component, not here.
 *   - This page is async + reads `searchParams`.
 *   - Default projectId/tenantSlug fall back to `p-pending` / `tenant-pending`
 *     so the page renders before the wizard wires up a real project (same
 *     contract as `app/wizard/grand-idea/page.tsx`).
 *
 * If the project is already past `interview-complete`, the page renders
 * an accumulated Q&A summary card instead of mounting the live chat —
 * matching the brief's "If step is complete, shows the accumulated Q&A
 * summary." requirement. The summary is sourced from the dashboard's
 * in-memory thread store (V1) or from the per-tenant
 * `interview_threads` table (Wave 2, gated behind
 * `WIZARD_INTERVIEW_LIVE=1`).
 *
 * Reuse-first compliance:
 *   - UI primitives via `@caia/ui` only (Card / CardHeader / etc).
 *   - The actual chat surface delegates to `<InterviewerChat>` so this
 *     server file stays small.
 *   - Tenant-state lookup uses `getStateStoreForTenant` +
 *     `getWizardState`, the same factory used by the existing
 *     `[projectId]/state` route from PR #601.
 */

import { headers } from 'next/headers';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';
import { InterviewerChat } from '../../../components/wizard/InterviewerChat';
import { InterviewCriticBridge } from '../../../components/wizard/InterviewCriticBridge';
import { getInterviewThreadStore } from '../../../lib/wizard/interview-thread-store';
import { getStateStoreForTenant } from '../../../lib/wizard/store-wire';
import { getWizardState, ProjectNotFoundError } from '../../../lib/wizard/state.server';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    projectId?: string;
    tenantSlug?: string;
    criticKind?: 'approved-with-modifications' | 'coverage-insufficient';
  }>;
}

interface SummaryPair {
  turn: number;
  role: 'agent' | 'user';
  content: string;
}

async function readTenantId(): Promise<string | null> {
  const h = await headers();
  return h.get('x-tenant-id');
}

async function loadCompletedSummary(args: {
  tenantId: string;
  projectId: string;
}): Promise<{ pairs: SummaryPair[]; completedAtIso: string } | null> {
  const store = getInterviewThreadStore();
  const thread = await store.read(args);
  if (!thread || !thread.completedAt) return null;
  return {
    pairs: thread.qaPairs.map((p) => ({
      turn: p.turn,
      role: p.role,
      content: p.content,
    })),
    completedAtIso: thread.completedAt,
  };
}

async function safeWizardStateName(
  tenantId: string | null,
  projectId: string,
): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const store = await getStateStoreForTenant(tenantId);
    const snapshot = await getWizardState(projectId, { store });
    return snapshot.state;
  } catch (err) {
    if (err instanceof ProjectNotFoundError) return null;
    // Soft-fail — the page falls back to the live chat surface.
    return null;
  }
}

export default async function InterviewPage({
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  const sp = await Promise.resolve(searchParams);
  const projectId = sp.projectId ?? 'p-pending';
  const tenantSlug = sp.tenantSlug ?? 'tenant-pending';
  const criticKind = sp.criticKind ?? null;
  const tenantId = await readTenantId();

  // 1) If the FSM is past interview-complete, surface the summary view.
  const currentState = await safeWizardStateName(tenantId, projectId);
  const isPastInterview =
    currentState === 'interview-complete' ||
    currentState === 'information-architecture-in-progress' ||
    currentState === 'information-architecture-complete' ||
    currentState === 'proposal-generated';

  if (isPastInterview && tenantId) {
    const summary = await loadCompletedSummary({ tenantId, projectId });
    if (summary) {
      return (
        <Card data-testid="wizard-step-interview-summary">
          <CardHeader>
            <CardTitle>Step 3 — Interview (complete)</CardTitle>
            <CardDescription>
              Captured {summary.pairs.length} turns. Completed{' '}
              {new Date(summary.completedAtIso).toLocaleString()}. The
              Information Architect is the next step.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div data-testid="interview-summary-history">
              {summary.pairs.map((p, idx) => (
                <div
                  key={`${p.turn}-${p.role}-${idx}`}
                  data-testid={`summary-${p.role}-${p.turn}`}
                  style={{
                    marginBottom: 10,
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: p.role === 'agent' ? '#f1f5f9' : '#dbeafe',
                  }}
                >
                  <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>
                    {p.role === 'agent' ? 'Interviewer' : 'You'} · turn {p.turn}
                  </div>
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{p.content}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      );
    }
  }

  // 2) Otherwise mount the live chat surface.
  return (
    <Card data-testid="wizard-step-interview-shell">
      <CardHeader>
        <CardTitle>Step 3 — Interview</CardTitle>
        <CardDescription>
          The Interviewer walks the 16 pillars of a Series-Seed-grade
          BusinessPlanV2. Answer in your own words; when coverage is
          sufficient the system advances to the Information Architect.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div data-testid="interview-context" style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
          Project: {projectId} · Tenant: {tenantSlug}
        </div>
        <InterviewerChat projectId={projectId} />
        <div style={{ marginTop: 16 }}>
          <InterviewCriticBridge projectId={projectId} criticKind={criticKind} />
        </div>
      </CardContent>
    </Card>
  );
}
