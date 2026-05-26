'use client';
/**
 * Wizard Step 5 — Proposal.
 *
 * Client component. The "Generate" CTA calls
 * `POST /api/wizard/proposal/generate` (the route handler imports
 * `runStep5` from `@caia/business-proposal-generator` server-side).
 * Once the response lands, the three Markdown renderers (executive
 * summary, technical scope / full proposal, GTM / one-pager) are
 * rendered as `@caia/ui` Accordion items.
 *
 * "Approve & continue" PATCHes the wizard state from the current
 * state to `proposal-generated` (the canonical FSM target). The brief
 * mentioned `proposal-in-progress → proposal-generated`, but the
 * canonical FSM doesn't have a literal `proposal-in-progress` state —
 * the API route's `canTransition` check handles the actual edge
 * (`information-architecture-complete → proposal-generated` or
 * `interview-complete → proposal-generated` depending on the project's
 * current state).
 *
 * Reuse-first compliance:
 *   - UI: `@caia/ui` primitives only (Card, Button, Accordion,
 *     AccordionItem, AccordionTrigger, AccordionContent, Badge).
 *   - The route handler uses
 *     `@caia/business-proposal-generator.runStep5`.
 *   - FSM dispatch uses the existing
 *     `/api/wizard/[projectId]/state` route from PR #601 (which
 *     wraps `@caia/state-machine`).
 */

import { useCallback, useState } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@caia/ui';

interface ProposalResponse {
  ok: boolean;
  proposal: {
    execSummaryMd: string;
    fullProposalMd: string;
    onePagerMd: string;
    revisionNumber: number;
  };
  designAppPrompt: {
    target: string;
    promptText: string;
    reviewerScore: number | null;
    reviewerBadge: 'ship' | 'caution' | null;
  };
  cacheHit: boolean;
  source: 'memory' | 'live';
}

interface ProposalPageProps {
  /** Override the global fetch (tests). */
  fetchImpl?: typeof fetch;
}

export default function ProposalPage(props: ProposalPageProps = {}): React.JSX.Element {
  const fetchFn = props.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const [projectId, setProjectId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [proposal, setProposal] = useState<ProposalResponse | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveMessage, setApproveMessage] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    const effectiveProjectId = projectId || 'p-stub';
    setGenerating(true);
    setGenerateError(null);
    setProposal(null);
    try {
      const res = await fetchFn('/api/wizard/proposal/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantProjectId: effectiveProjectId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ProposalResponse;
      setProposal(data);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }, [fetchFn, projectId]);

  const handleApprove = useCallback(async () => {
    const effectiveProjectId = projectId || 'p-stub';
    setApproving(true);
    setApproveError(null);
    setApproveMessage(null);
    try {
      const res = await fetchFn(`/api/wizard/${effectiveProjectId}/state`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetState: 'proposal-generated',
          reason: 'wizard-step-5-approved',
        }),
      });
      if (res.status === 409) {
        setApproveMessage('Already at proposal-generated — design step is reachable.');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setApproveMessage('Proposal approved — advancing to design step.');
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : String(err));
    } finally {
      setApproving(false);
    }
  }, [fetchFn, projectId]);

  return (
    <Card data-testid="wizard-step-proposal">
      <CardHeader>
        <CardTitle>Step 5 — Proposal</CardTitle>
        <CardDescription>
          Generate the business proposal + design-app prompt from your interview
          + Information-Architecture artifacts. Approve to advance to the design
          step.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <label htmlFor="proposal-project-id" style={{ fontSize: 13, fontWeight: 600 }}>
            Project ID
          </label>
          <input
            id="proposal-project-id"
            data-testid="proposal-project-id"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="p-stub"
            style={{
              flex: 1,
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              fontSize: 13,
              background: 'transparent',
              color: 'inherit',
            }}
          />
          <Button
            variant="default"
            onClick={handleGenerate}
            disabled={generating}
            data-testid="generate-proposal"
            type="button"
          >
            {generating ? 'Generating…' : 'Generate'}
          </Button>
        </div>
        {generateError && (
          <div data-testid="generate-error" style={{ color: '#b91c1c', fontSize: 13, marginBottom: 12 }}>
            {generateError}
          </div>
        )}

        {proposal && (
          <div data-testid="proposal-output">
            <div
              style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}
            >
              <Badge data-testid="proposal-source">{proposal.source}</Badge>
              {proposal.cacheHit && (
                <Badge variant="secondary" data-testid="proposal-cache-hit">
                  cache hit
                </Badge>
              )}
              <Badge
                variant={proposal.designAppPrompt.reviewerBadge === 'ship' ? 'default' : 'destructive'}
                data-testid="proposal-reviewer-badge"
              >
                reviewer:{' '}
                {proposal.designAppPrompt.reviewerBadge ?? 'n/a'}
                {proposal.designAppPrompt.reviewerScore !== null
                  ? ` (${proposal.designAppPrompt.reviewerScore})`
                  : ''}
              </Badge>
            </div>

            <Accordion type="single" defaultValue="exec">
              <AccordionItem value="exec">
                <AccordionTrigger data-testid="renderer-exec">
                  Executive Summary
                </AccordionTrigger>
                <AccordionContent>
                  <pre
                    data-testid="renderer-exec-content"
                    style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}
                  >
                    {proposal.proposal.execSummaryMd}
                  </pre>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="full">
                <AccordionTrigger data-testid="renderer-full">
                  Technical Scope (Full Proposal)
                </AccordionTrigger>
                <AccordionContent>
                  <pre
                    data-testid="renderer-full-content"
                    style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}
                  >
                    {proposal.proposal.fullProposalMd}
                  </pre>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="onepager">
                <AccordionTrigger data-testid="renderer-onepager">
                  GTM Plan (One-Pager)
                </AccordionTrigger>
                <AccordionContent>
                  <pre
                    data-testid="renderer-onepager-content"
                    style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}
                  >
                    {proposal.proposal.onePagerMd}
                  </pre>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="design-app-prompt">
                <AccordionTrigger data-testid="renderer-design-prompt">
                  Design-App Prompt
                </AccordionTrigger>
                <AccordionContent>
                  <div style={{ marginBottom: 6, fontSize: 12, opacity: 0.7 }}>
                    Target: {proposal.designAppPrompt.target}
                  </div>
                  <pre
                    data-testid="renderer-design-prompt-content"
                    style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}
                  >
                    {proposal.designAppPrompt.promptText}
                  </pre>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
              <Button
                variant="default"
                onClick={handleApprove}
                disabled={approving}
                data-testid="approve-proposal"
                type="button"
              >
                {approving ? 'Approving…' : 'Approve & continue'}
              </Button>
              {approveError && (
                <span data-testid="approve-error" style={{ color: '#b91c1c', fontSize: 13 }}>
                  {approveError}
                </span>
              )}
              {approveMessage && (
                <span data-testid="approve-message" style={{ color: '#065f46', fontSize: 13 }}>
                  {approveMessage}
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
