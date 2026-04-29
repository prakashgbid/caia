'use client';
/**
 * Phase 1 timeline component (GATE-4-01).
 *
 * Renders a vertical timeline of the canonical Phase-1 stages
 * (ingested → scaffolded → po_decomposed → ba_enriched →
 *  bucket_placed → ready_for_pickup) with per-stage status pulled
 * from `prompt_pipeline_stages` rows on the prompt's `/phase1` payload.
 *
 * Each stage carries its own evidence summary (story count, ticket
 * count, bucket counts, BA collab counts) so the user can see at a
 * glance which stage produced what. Live updates land via the
 * journey page's WS subscription — when a Phase-1 event arrives the
 * page refetches and feeds the new payload here.
 */
import Link from 'next/link';

export const PHASE1_STAGES = [
  { key: 'ingested', label: 'Ingested', icon: '📥', actor: 'api' },
  { key: 'scaffolded', label: 'Scaffolded', icon: '🏗️', actor: 'scaffolder' },
  { key: 'po_decomposed', label: 'PO Decomposed', icon: '📐', actor: 'po-agent' },
  { key: 'ba_enriched', label: 'BA Enriched', icon: '🤝', actor: 'ba-agent' },
  // ARCH-006 (2026-04-28): EA now runs after BA, producing per-domain
  // architecturalInstructions[] grounded in the AKG.
  { key: 'ea_decomposed', label: 'EA Decomposed', icon: '🏛️', actor: 'ea-agent' },
  { key: 'validated', label: 'Validated', icon: '🛡️', actor: 'validator' },
  { key: 'test_designed', label: 'Test Designed', icon: '🧪', actor: 'test-design-agent' },
  { key: 'bucket_placed', label: 'Bucket Placed', icon: '🗂️', actor: 'task-scheduler' },
  { key: 'ready_for_pickup', label: 'Ready for Pickup', icon: '🟢', actor: 'task-scheduler' },
] as const;

type StageKey = typeof PHASE1_STAGES[number]['key'];

export interface Phase1Story {
  id: string;
  title: string;
  kind: string;
  status: string;
  bucketId: string | null;
  templateVersion: string;
  templateValidationStatus: string;
  acceptanceCriteriaCount: number;
  enrichedAt: number | null;
  updatedAt: number | null;
}

export interface Phase1Bucket {
  id: string;
  kind: string;
  domainSlug: string | null;
  sequenceIndex: number | null;
  status: string;
  createdAt: number;
  storyIds: string[];
}

export interface Phase1AgentMessage {
  id: string;
  fromAgent: string;
  toAgent: string;
  messageType: string;
  correlationId: string;
  status: string;
  createdAt: number;
  processedAt: number | null;
  expectedReplyBy: number | null;
  repliedAt: number | null;
  parentMessageId: string | null;
  payload: unknown;
}

export interface Phase1Stage {
  id: string;
  stage: string;
  entityKind: string | null;
  entityId: string | null;
  enteredAt: number;
  durationMs: number | null;
  metadata: string | null;
}

export interface Phase1Event {
  id: string;
  type: string;
  actor: string;
  occurredAt: string;
  correlationId: string;
  entityType: string | null;
  entityId: string | null;
  payload: unknown;
  severity: string;
}

export interface Phase1Payload {
  prompt: { id: string; body: string; receivedAt: string; correlationId: string; status: string };
  pipelineStages: Phase1Stage[];
  stories: Phase1Story[];
  buckets: Phase1Bucket[];
  agentMessages: Phase1AgentMessage[];
  phase1Events: Phase1Event[];
}

function fmtMs(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v < 1000) return `${v}ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(1)}s`;
  return `${(v / 60_000).toFixed(1)}m`;
}

function fmtTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString();
}

function stageEvidence(key: StageKey, p: Phase1Payload): string {
  switch (key) {
    case 'ingested':
      return p.prompt.body ? `${p.prompt.body.slice(0, 80)}${p.prompt.body.length > 80 ? '…' : ''}` : '';
    case 'scaffolded':
      return 'context broadcast to activated agents';
    case 'po_decomposed':
      return `${p.stories.length} stor${p.stories.length === 1 ? 'y' : 'ies'} produced`;
    case 'ba_enriched': {
      const valid = p.stories.filter((s) => s.templateValidationStatus === 'valid').length;
      const reqs = p.agentMessages.filter((m) => m.messageType === 'input-requested').length;
      const reps = p.agentMessages.filter((m) => m.messageType === 'input-received').length;
      return `${valid}/${p.stories.length} valid · ${reps}/${reqs} consultant replies`;
    }
    case 'bucket_placed': {
      const seq = p.buckets.filter((b) => b.kind === 'sequential').length;
      const par = p.buckets.filter((b) => b.kind === 'parallel').length;
      return `${seq} sequential · ${par} parallel`;
    }
    case 'ready_for_pickup': {
      const placed = p.stories.filter((s) => s.bucketId).length;
      return `${placed} ticket${placed === 1 ? '' : 's'} ready for executor`;
    }
  }
}

export function Phase1Timeline({ data }: { data: Phase1Payload }) {
  const stagesByKey = new Map<string, Phase1Stage>();
  for (const s of data.pipelineStages) stagesByKey.set(s.stage, s);

  return (
    <div data-testid="phase1-timeline">
      <h3 style={{ margin: '0 0 12px', color: '#e2e8f0', fontSize: 16 }}>Phase 1 pipeline</h3>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {PHASE1_STAGES.map((stage, idx) => {
          const row = stagesByKey.get(stage.key);
          const reached = !!row;
          const last = idx === PHASE1_STAGES.length - 1;
          const dot = reached ? '#68d391' : '#4a5568';
          const text = reached ? '#e2e8f0' : '#718096';
          return (
            <li
              key={stage.key}
              data-testid={`phase1-stage-${stage.key}`}
              data-stage-reached={reached ? 'true' : 'false'}
              style={{ position: 'relative', paddingLeft: 32, paddingBottom: last ? 0 : 18 }}
            >
              {!last && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute', left: 11, top: 24, bottom: -6, width: 2,
                    background: reached ? '#2f855a' : '#2d3748',
                  }}
                />
              )}
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute', left: 4, top: 4, width: 16, height: 16,
                  borderRadius: '50%', background: dot, border: '2px solid #1a1f2e',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: text }}>
                  {stage.icon} {stage.label}
                </span>
                <span style={{ fontSize: 11, color: '#718096' }}>{stage.actor}</span>
                {row && (
                  <>
                    <span style={{ fontSize: 11, color: '#a0aec0', fontFamily: 'monospace' }}>
                      {fmtTime(row.enteredAt)}
                    </span>
                    {row.durationMs != null && (
                      <span style={{ fontSize: 11, color: '#718096' }}>
                        +{fmtMs(row.durationMs)}
                      </span>
                    )}
                  </>
                )}
              </div>
              <div style={{ fontSize: 12, color: text, marginTop: 4 }}>
                {reached ? stageEvidence(stage.key, data) : 'pending'}
              </div>
            </li>
          );
        })}
      </ol>

      {data.stories.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h4 style={{ margin: '0 0 8px', color: '#e2e8f0', fontSize: 14 }}>
            Stories ({data.stories.length})
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {data.stories.map((s) => (
              <div
                key={s.id}
                data-testid={`phase1-story-${s.id}`}
                style={{
                  background: '#1a1f2e',
                  border: '1px solid #2d3748',
                  borderRadius: 6,
                  padding: '10px 12px',
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Link href={`/stories/${encodeURIComponent(s.id)}`} style={{ color: '#90cdf4', textDecoration: 'none', fontWeight: 600 }}>
                    {s.title}
                  </Link>
                  <span style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 3,
                    background: s.templateValidationStatus === 'valid' ? '#2f855a'
                              : s.templateValidationStatus === 'invalid' ? '#c53030' : '#4a5568',
                    color: '#fff',
                  }}>{s.templateValidationStatus}</span>
                </div>
                <div style={{ color: '#a0aec0', fontSize: 11 }}>
                  {s.kind} · {s.acceptanceCriteriaCount} AC{s.bucketId ? ` · bucket ${s.bucketId.slice(0, 14)}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.buckets.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h4 style={{ margin: '0 0 8px', color: '#e2e8f0', fontSize: 14 }}>
            Buckets ({data.buckets.length})
          </h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {data.buckets.map((b) => (
              <div
                key={b.id}
                data-testid={`phase1-bucket-${b.id}`}
                style={{
                  background: b.kind === 'sequential' ? '#2c2410' : '#10202c',
                  border: `1px solid ${b.kind === 'sequential' ? '#f6ad55' : '#63b3ed'}33`,
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 12,
                  minWidth: 180,
                }}
              >
                <div style={{ color: b.kind === 'sequential' ? '#f6ad55' : '#63b3ed', fontWeight: 600 }}>
                  {b.kind} {b.domainSlug ? `· ${b.domainSlug}` : '· pool'}
                </div>
                <div style={{ color: '#a0aec0', marginTop: 2 }}>
                  {b.storyIds.length} ticket{b.storyIds.length === 1 ? '' : 's'} · {b.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.agentMessages.length > 0 && (
        <div style={{ marginTop: 20 }} data-testid="phase1-collab-teaser">
          <h4 style={{ margin: '0 0 8px', color: '#e2e8f0', fontSize: 14 }}>
            BA collaboration ({data.agentMessages.length} message{data.agentMessages.length === 1 ? '' : 's'})
          </h4>
          <div style={{ color: '#a0aec0', fontSize: 12 }}>
            {data.agentMessages.filter((m) => m.messageType === 'input-requested').length} inputRequest
            {' · '}
            {data.agentMessages.filter((m) => m.messageType === 'input-received').length} inputReceived
          </div>
        </div>
      )}
    </div>
  );
}
