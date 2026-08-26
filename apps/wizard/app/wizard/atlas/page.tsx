/**
 * Wizard Step 7 — Atlas.
 *
 * Public demo entry (no projectId in the path). The real, backend-wired
 * Atlas UI lives under `atlas/[projectId]/page.tsx` and requires the
 * Postgres + NATS + atlas-prompt-router wire. For the public demo tour
 * the /wizard/atlas landing renders a DemoStepPreview matching the
 * Interview/IA/Proposal/Design cards (CAIA-408, 2026-08-26).
 */

'use client';

import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';

export const dynamic = 'force-dynamic';

export default function AtlasDemoPage(): React.JSX.Element {
  const router = useRouter();
  return (
    <Card data-testid="wizard-step-atlas-demo-preview">
      <CardHeader>
        <CardTitle>Step 7 — Atlas</CardTitle>
        <CardDescription>
          The ticket tree and the design-id mapping. CAIA turns the Grand Idea, IA, and Design
          into an implementation-ready backlog with per-ticket prompts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ marginTop: 12, marginBottom: 20 }}>
          <div
            style={{
              display: 'inline-block',
              padding: '4px 10px',
              borderRadius: 12,
              background: '#1e40af',
              color: '#dbeafe',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            DEMO PREVIEW
          </div>
          <p style={{ marginTop: 12, color: '#94a3b8', fontSize: 14 }}>
            This step is running in demo mode. In production, this stage produces:
          </p>
          <ul style={{ marginTop: 10, paddingLeft: 20, color: '#cbd5e1', fontSize: 14, lineHeight: 1.6 }}>
            <li>Ticket tree — Epic → Story → Task hierarchy in Jira/Linear</li>
            <li>Design-id → ticket mapping so every ticket links back to a wireframe</li>
            <li>Cursor/Copilot-ready implementation prompts per ticket</li>
            <li>Full traceability: Grand Idea → IA → Proposal → Design → Atlas ticket</li>
          </ul>
          <p style={{ marginTop: 20, color: '#94a3b8', fontSize: 14 }}>
            You&apos;ve walked the whole 7-step tour. Click <strong>Finish tour</strong> to land on the live factory dashboard.
          </p>
          <div style={{ marginTop: 16 }}>
            <Button
              onClick={() => { window.location.href = 'https://chiefaia.com/factory'; }}
              data-testid="atlas-finish-tour"
              type="button"
            >
              Finish tour → Factory Live
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
