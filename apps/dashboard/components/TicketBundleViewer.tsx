'use client';
/**
 * Ticket bundle viewer (GATE-4-03).
 *
 * Renders the self-contained payload returned by the orchestrator's
 * GET /stories/:id/bundle (PR #75 / PHASE1-04). Surfaces every section
 * of TicketTemplateV1 (scope, context, acceptanceCriteria,
 * verificationPlan, dependencies, agentSections, baEnrichment) plus
 * the linked prompt + requirement + bucket + entity-label set + the
 * upstream/downstream dependency lists.
 *
 * If the ticket failed Zod validation, the parseError is surfaced
 * verbatim so the user can see exactly which BA enrichment field
 * tripped the validator. The story.templateValidationErrors column
 * (the BA's own `validateTicket()` output) is also shown for
 * completeness.
 */
import Link from 'next/link';

export interface TicketBundle {
  story: {
    id: string;
    title: string;
    description: string;
    status: string;
    rootPromptId: string | null;
    parentEntityId: string | null;
    parentEntityType: string | null;
    bucketId: string | null;
    templateVersion: string;
    templateValidationStatus: string;
    templateValidationErrors: unknown[] | null;
    enrichedAt: number | null;
    updatedAt: number | null;
  };
  ticket: TicketTemplateV1Like | null;
  ticketParseError: string | null;
  prompt: { id: string; body: string; receivedAt: string; correlationId: string; status: string } | null;
  requirement: { id: string; title: string; description: string; state: string } | null;
  bucket: { id: string; kind: 'sequential' | 'parallel'; domainSlug: string | null; sequenceIndex: number | null; status: string } | null;
  labels: Array<{ labelSlug: string; labelType: string; confidence: number; source: string }>;
  dependencies: { upstream: string[]; downstream: string[] };
}

interface AgentSectionLike {
  contributedBy: string;
  contributedAt: number;
  [k: string]: unknown;
}

export interface TicketTemplateV1Like {
  scope: { summary: string; inScope: string[]; outOfScope: string[] };
  context: {
    rootPromptId: string;
    requirementId: string;
    parentEpic?: string;
    domainPrimary: string;
    domainAll: string[];
    nature: string;
    complexity: string;
  };
  acceptanceCriteria: string[];
  verificationPlan: string[];
  dependencies: { upstream: string[]; downstream: string[]; files: string[] };
  agentSections: Record<string, AgentSectionLike | undefined>;
  baEnrichment?: {
    enrichedBy: string;
    enrichedAt: number;
    inputsRequested?: Array<{ agent: string; correlationId: string; status: string; expectedReplyBy?: number; repliedAt?: number }>;
  };
  // TEST-006 — story-driven testing framework
  testCases?: TestCaseLike[];
  testDesign?: {
    designedBy: string;
    designedAt: number;
    totalCases: number;
    categoryCounts: Record<TestCaseCategoryLike, number>;
    notes?: string;
  };
}

export type TestCaseCategoryLike =
  | 'happy'
  | 'edge'
  | 'error'
  | 'accessibility'
  | 'security'
  | 'performance'
  | 'visual';

export type TestCaseStatusLike =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'flaky';

export interface TestCaseLike {
  id: string;
  title: string;
  category: TestCaseCategoryLike;
  layer: 'unit' | 'integration' | 'e2e' | 'visual' | 'accessibility';
  given: string;
  when: string;
  then: string;
  linkedAcceptanceCriterionIndex?: number;
  selectorHints?: string[];
  mocks?: Array<{ method: string; url: string; status: number; body: string }>;
  required?: boolean;
  status: TestCaseStatusLike;
  designedBy: string;
  designedAt: number;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    valid: '#2f855a',
    invalid: '#c53030',
    pending: '#dd6b20',
  };
  return <span style={{ background: map[status] ?? '#4a5568', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>{status}</span>;
}

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} style={{ marginTop: 16 }}>
      <h4 style={{ margin: '0 0 6px', color: '#e2e8f0', fontSize: 13 }}>{title}</h4>
      <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 6, padding: '10px 12px', color: '#cbd5e0', fontSize: 12 }}>
        {children}
      </div>
    </div>
  );
}

function StringList({ items, empty }: { items: string[] | undefined; empty?: string }) {
  if (!items || items.length === 0) return <span style={{ color: '#4a5568', fontStyle: 'italic' }}>{empty ?? '—'}</span>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((s, i) => <li key={i}>{s}</li>)}
    </ul>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
      <span style={{ color: '#a0aec0', minWidth: 110, flexShrink: 0 }}>{k}</span>
      <span style={{ color: '#e2e8f0', flex: 1, wordBreak: 'break-word' }}>{v}</span>
    </div>
  );
}

export function TicketBundleViewer({ bundle }: { bundle: TicketBundle }) {
  const { story, ticket, ticketParseError, prompt, requirement, bucket, labels, dependencies } = bundle;

  return (
    <div data-testid="ticket-bundle-viewer">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <h2 style={{ margin: 0, color: '#e2e8f0', fontSize: 20 }}>{story.title}</h2>
        <StatusPill status={story.templateValidationStatus} />
        <span style={{ color: '#a0aec0', fontSize: 11 }}>template {story.templateVersion}</span>
        {bucket && (
          <Link href={`/buckets`} style={{ color: '#90cdf4', fontSize: 12 }}>
            {bucket.kind === 'sequential' ? `📤 ${bucket.domainSlug ?? 'seq'}#${bucket.sequenceIndex ?? 0}` : '🟦 parallel pool'}
          </Link>
        )}
      </div>

      {/* Linked entities */}
      <Section title="Linked entities" testId="bundle-linked">
        <KV k="story" v={<code>{story.id}</code>} />
        {prompt && (
          <KV
            k="prompt"
            v={<Link href={`/prompts/${prompt.id}/journey`} style={{ color: '#90cdf4' }}>
              {prompt.id} — {prompt.body.slice(0, 80)}{prompt.body.length > 80 ? '…' : ''}
            </Link>}
          />
        )}
        {requirement && (
          <KV
            k="requirement"
            v={<Link href={`/requirements/${requirement.id}`} style={{ color: '#90cdf4' }}>
              {requirement.title}
            </Link>}
          />
        )}
        {bucket && <KV k="bucket" v={<code>{bucket.id}</code>} />}
        <KV k="status" v={story.status} />
      </Section>

      {/* Validation status */}
      {(ticketParseError || (story.templateValidationErrors && story.templateValidationErrors.length > 0)) && (
        <Section title="Validation issues" testId="bundle-validation-errors">
          {ticketParseError && (
            <div style={{ color: '#fc8181', fontSize: 12, marginBottom: 6 }}>
              <strong>Parse error:</strong> {ticketParseError}
            </div>
          )}
          {story.templateValidationErrors && story.templateValidationErrors.length > 0 && (
            <pre style={{ margin: 0, color: '#fc8181', fontSize: 11, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(story.templateValidationErrors, null, 2)}
            </pre>
          )}
        </Section>
      )}

      {/* If we have a parsed ticket, render every TicketTemplateV1 section */}
      {ticket && (
        <>
          <Section title="Scope" testId="bundle-scope">
            <KV k="summary" v={ticket.scope.summary} />
            <KV k="inScope" v={<StringList items={ticket.scope.inScope} />} />
            <KV k="outOfScope" v={<StringList items={ticket.scope.outOfScope} />} />
          </Section>

          <Section title="Context" testId="bundle-context">
            <KV k="rootPromptId" v={<code>{ticket.context.rootPromptId}</code>} />
            <KV k="requirementId" v={<code>{ticket.context.requirementId}</code>} />
            {ticket.context.parentEpic && <KV k="parentEpic" v={<code>{ticket.context.parentEpic}</code>} />}
            <KV k="domainPrimary" v={ticket.context.domainPrimary} />
            <KV k="domainAll" v={(ticket.context.domainAll ?? []).join(', ')} />
            <KV k="nature" v={ticket.context.nature} />
            <KV k="complexity" v={ticket.context.complexity} />
          </Section>

          <Section title={`Acceptance criteria (${ticket.acceptanceCriteria.length})`} testId="bundle-ac">
            <StringList items={ticket.acceptanceCriteria} />
          </Section>

          <Section title="Verification plan" testId="bundle-verification">
            <StringList items={ticket.verificationPlan} />
          </Section>

          <Section title="Ticket dependencies" testId="bundle-dependencies">
            <KV k="upstream" v={<StringList items={ticket.dependencies.upstream} empty="none" />} />
            <KV k="downstream" v={<StringList items={ticket.dependencies.downstream} empty="none" />} />
            <KV k="files" v={<StringList items={ticket.dependencies.files} empty="none" />} />
          </Section>

          {/* Agent contribution sections — show only the populated ones */}
          {Object.entries(ticket.agentSections ?? {}).map(([key, sec]) => sec ? (
            <Section key={key} title={`Agent section · ${key}`} testId={`bundle-agent-${key}`}>
              <KV k="contributedBy" v={sec.contributedBy} />
              <KV k="contributedAt" v={sec.contributedAt ? new Date(sec.contributedAt).toLocaleString() : '—'} />
              {Object.entries(sec)
                .filter(([k]) => k !== 'contributedBy' && k !== 'contributedAt')
                .map(([k, v]) => (
                  <KV
                    key={k}
                    k={k}
                    v={Array.isArray(v) ? <StringList items={v as string[]} empty="—" />
                      : typeof v === 'object' ? <code>{JSON.stringify(v)}</code>
                      : String(v ?? '—')}
                  />
                ))}
            </Section>
          ) : null)}

          {ticket.testCases && ticket.testCases.length > 0 && (
            <TestCasesSection
              cases={ticket.testCases}
              design={ticket.testDesign}
            />
          )}

          {ticket.baEnrichment && (
            <Section title="BA enrichment" testId="bundle-ba-enrichment">
              <KV k="enrichedBy" v={ticket.baEnrichment.enrichedBy} />
              <KV k="enrichedAt" v={new Date(ticket.baEnrichment.enrichedAt).toLocaleString()} />
              <KV
                k="inputsRequested"
                v={(ticket.baEnrichment.inputsRequested ?? []).length === 0
                  ? '—'
                  : <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {(ticket.baEnrichment.inputsRequested ?? []).map((req, i) => (
                        <li key={i}>
                          {req.agent} → <code>{req.status}</code>
                          {req.repliedAt && ` (${new Date(req.repliedAt).toLocaleTimeString()})`}
                        </li>
                      ))}
                    </ul>}
              />
            </Section>
          )}
        </>
      )}

      {/* Bundle-level dependency mirrors (independent of parsed ticket) */}
      <Section title="Bundle dependencies" testId="bundle-bundle-deps">
        <KV k="upstream stories" v={<StringList items={dependencies.upstream} empty="none" />} />
        <KV k="downstream stories" v={<StringList items={dependencies.downstream} empty="none" />} />
      </Section>

      {/* Test cases (TEST-006) — also rendered when ticket parses, but
          re-surfaced here as a fallback when only the story.testCasesJson
          column is populated. The detailed in-line render is preferred. */}

      {/* Labels */}
      <Section title="Entity labels" testId="bundle-labels">
        {labels.length === 0 ? (
          <span style={{ color: '#4a5568', fontStyle: 'italic' }}>none</span>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {labels.map((l, i) => (
              <span
                key={`${l.labelSlug}-${i}`}
                style={{
                  background: '#2d3748', color: '#e2e8f0',
                  padding: '2px 8px', borderRadius: 12, fontSize: 11,
                }}
                title={`${l.labelType} (${(l.confidence * 100).toFixed(0)}% from ${l.source})`}
              >
                {l.labelType}: {l.labelSlug}
              </span>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ─── TEST-006 — Test cases section ───────────────────────────────────────────

const CATEGORY_COLOURS: Record<TestCaseCategoryLike, string> = {
  happy: '#38a169',
  edge: '#dd6b20',
  error: '#e53e3e',
  accessibility: '#3182ce',
  security: '#805ad5',
  performance: '#d69e2e',
  visual: '#319795',
};

const STATUS_COLOURS: Record<TestCaseStatusLike, string> = {
  pending: '#4a5568',
  running: '#3182ce',
  passed: '#38a169',
  failed: '#e53e3e',
  skipped: '#a0aec0',
  flaky: '#dd6b20',
};

function CategoryPill({ category }: { category: TestCaseCategoryLike }) {
  return (
    <span
      data-testid={`tc-category-${category}`}
      style={{
        background: CATEGORY_COLOURS[category],
        color: '#fff',
        padding: '2px 6px',
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
      }}
    >
      {category}
    </span>
  );
}

function StatusPillTC({ status }: { status: TestCaseStatusLike }) {
  return (
    <span
      data-testid={`tc-status-${status}`}
      style={{
        background: STATUS_COLOURS[status],
        color: '#fff',
        padding: '2px 6px',
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  );
}

const ALL_CATEGORIES: TestCaseCategoryLike[] = [
  'happy', 'edge', 'error', 'accessibility', 'security', 'performance', 'visual',
];

function TestCasesSection({
  cases,
  design,
}: {
  cases: TestCaseLike[];
  design: TicketTemplateV1Like['testDesign'];
}) {
  // Compute per-category counts straight from the array so we never get
  // out-of-sync with what we actually render.
  const counts: Record<TestCaseCategoryLike, number> = {
    happy: 0, edge: 0, error: 0,
    accessibility: 0, security: 0, performance: 0, visual: 0,
  };
  for (const c of cases) counts[c.category] += 1;

  const statusCounts: Record<TestCaseStatusLike, number> = {
    pending: 0, running: 0, passed: 0, failed: 0, skipped: 0, flaky: 0,
  };
  for (const c of cases) statusCounts[c.status] += 1;

  return (
    <Section
      title={`Test cases (${cases.length})`}
      testId="bundle-test-cases"
    >
      {/* Category breakdown pills */}
      <div
        data-testid="bundle-test-cases-summary"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}
      >
        {ALL_CATEGORIES.filter((cat) => counts[cat] > 0).map((cat) => (
          <span
            key={cat}
            data-testid={`tc-summary-${cat}`}
            style={{
              background: CATEGORY_COLOURS[cat],
              color: '#fff',
              padding: '2px 8px',
              borderRadius: 12,
              fontSize: 11,
            }}
          >
            {cat} {counts[cat]}
          </span>
        ))}
      </div>

      {/* Status breakdown */}
      <div
        data-testid="bundle-test-cases-status"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}
      >
        {(['pending', 'running', 'passed', 'failed', 'skipped', 'flaky'] as TestCaseStatusLike[])
          .filter((s) => statusCounts[s] > 0)
          .map((s) => (
            <span
              key={s}
              style={{
                background: '#2d3748',
                color: STATUS_COLOURS[s],
                padding: '2px 8px',
                borderRadius: 12,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {s} {statusCounts[s]}
            </span>
          ))}
      </div>

      {/* Designer attribution */}
      {design && (
        <div style={{ color: '#a0aec0', fontSize: 11, marginBottom: 10 }}>
          designed by <code>{design.designedBy}</code> at{' '}
          {new Date(design.designedAt).toLocaleString()} ·{' '}
          {design.notes}
        </div>
      )}

      {/* Per-case list */}
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
        {cases.map((tc) => (
          <li
            key={tc.id}
            data-testid={`tc-row-${tc.id}`}
            style={{
              padding: '8px 10px',
              borderTop: '1px solid #2d3748',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <CategoryPill category={tc.category} />
              <span style={{ background: '#2d3748', color: '#cbd5e0', padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600 }}>
                {tc.layer}
              </span>
              <StatusPillTC status={tc.status} />
              <span style={{ color: '#e2e8f0', fontSize: 12, flex: 1 }}>
                {tc.title}
              </span>
              {tc.required === false && (
                <span style={{ color: '#a0aec0', fontSize: 10, fontStyle: 'italic' }}>
                  optional
                </span>
              )}
            </div>
            <div style={{ color: '#a0aec0', fontSize: 11, paddingLeft: 4 }}>
              <div><strong style={{ color: '#cbd5e0' }}>Given</strong> {tc.given}</div>
              <div><strong style={{ color: '#cbd5e0' }}>When</strong> {tc.when}</div>
              <div><strong style={{ color: '#cbd5e0' }}>Then</strong> {tc.then}</div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
