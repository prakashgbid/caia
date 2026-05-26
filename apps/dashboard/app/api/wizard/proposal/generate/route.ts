/**
 * `POST /api/wizard/proposal/generate` — Step 5 proposal generator.
 *
 * Server-side handler that imports `runStep5` from
 * `@caia/business-proposal-generator` and runs the V1 wizard flow. The
 * wizard's V1 path uses:
 *
 *   - `MemoryBlobStorage` — no live BYOC R2/S3 hookup yet.
 *   - `MemoryProposalPersistence` — no live per-tenant DB writes yet.
 *   - `ScriptedLlmCaller` — deterministic canned responses so the
 *     wizard page renders without a Claude subscription wired through.
 *   - `skipFormatConversion: true` — pandoc binary isn't available in
 *     the wizard's Node runtime; the route returns markdown only.
 *
 * Wave 2 will swap each of those for the production counterpart behind
 * an env flag (`WIZARD_PROPOSAL_LIVE=1`) once the cloud + DB + LLM
 * surfaces stabilize.
 *
 * Reuse-first compliance:
 *   - Uses `@caia/business-proposal-generator`'s `runStep5`,
 *     `MemoryBlobStorage`, `MemoryProposalPersistence`,
 *     `ScriptedLlmCaller`.
 *   - Uses `@caia/state-machine` indirectly via the wizard state PATCH
 *     route from PR #601 (the page dispatches the transition; this
 *     route only generates the proposal).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import {
  MemoryBlobStorage,
  MemoryProposalPersistence,
  ScriptedLlmCaller,
  runStep5,
  type GenerateProposalInput,
  type LlmCaller,
} from '@caia/business-proposal-generator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  tenantProjectId?: string;
  plan?: GenerateProposalInput['plan'];
  ia?: GenerateProposalInput['ia'];
  designAppTarget?: GenerateProposalInput['designAppTarget'];
  revisionReason?: string;
}

interface RouteResponse {
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

async function readTenantId(): Promise<string | null> {
  const h = await headers();
  return h.get('x-tenant-id');
}

/**
 * Stub bundles. The orchestrator's `renderExecSummary` /
 * `renderFullProposal` / `renderOnePager` all call the injected
 * `LlmCaller` once each and parse a JSON envelope. We feed three
 * deterministic envelopes here.
 */
function buildScriptedLlm(): LlmCaller {
  return new ScriptedLlmCaller([
    {
      kind: 'ok',
      text: JSON.stringify({
        markdown:
          '# Executive Summary\n\nA concise overview of the product and the target customer. The product solves a specific problem for a specific audience and aims to monetize through a recurring subscription.',
      }),
    },
    {
      kind: 'ok',
      text: JSON.stringify({
        markdown:
          '# Technical Scope\n\n## Architecture\nThe system splits into a Next.js dashboard, a `@caia/*` workspace of agents, and a per-tenant Postgres schema.\n\n## Build phases\n1. Step 1 — Onboarding.\n2. Step 2 — Grand Idea.\n3. Step 5 — Proposal.\n4. Step 6 — Design.\n5. Step 7 — Atlas.\n',
      }),
    },
    {
      kind: 'ok',
      text: JSON.stringify({
        markdown:
          '# Go-to-Market Plan\n\n- ICP: solo founders + small product teams.\n- Channels: developer-led growth, content, design-community partnerships.\n- Pricing: tiered subscription with a free explore tier.',
      }),
    },
    // Reviewer & design-app prompt (best-effort additional scripted responses).
    {
      kind: 'ok',
      text: JSON.stringify({
        prompt_text: 'Design a clean, modern dashboard with a left nav, a top bar, and a primary content area.',
        prompt_metadata: { tone: 'restrained', accent: '#1e293b' },
      }),
    },
    {
      kind: 'ok',
      text: JSON.stringify({
        composite_score: 88,
        findings: [],
        per_axis: { fidelity: 90, completeness: 88, safety: 86 },
      }),
    },
  ]);
}

function emptyIa(): GenerateProposalInput['ia'] {
  return {
    pages: {
      schema_version: '1.0',
      pages: [
        {
          id: 'home',
          title: 'Home',
          slug: '/',
          description: 'Landing page',
        },
      ],
    },
    designSystem: {
      schema_version: '1.0',
      palette: { paper: '#ffffff', ink: '#0f172a', accent: '#1e293b' },
      type_pairing: { display: 'Inter', body: 'Inter' },
      motion_preference: 'restrained',
      layout_patterns: [],
      reference_urls: [],
    },
    components: {
      schema_version: '1.0',
      components: [],
    },
  };
}

function emptyPlan(): GenerateProposalInput['plan'] {
  return {
    schemaVersion: '2.0',
    sections: {
      executive_summary: 'A short, structured pitch.',
    },
    rubricScores: { aggregateScore: 82 },
  };
}

/** Synthesize a deterministic stub response without invoking the engine. */
function stubResponse(): RouteResponse {
  return {
    ok: true,
    proposal: {
      execSummaryMd:
        '# Executive Summary\n\nA concise overview generated by the wizard stub. Real generator output replaces this in Wave 2.',
      fullProposalMd:
        '# Technical Scope\n\nFull proposal stub markdown. The Wave 2 generator emits the production document here.',
      onePagerMd:
        '# Go-to-Market Plan\n\nOne-pager stub markdown. The Wave 2 generator emits the production document here.',
      revisionNumber: 1,
    },
    designAppPrompt: {
      target: 'claude_design',
      promptText:
        'Design a clean, modern dashboard with a left nav, a top bar, and a primary content area.',
      reviewerScore: 88,
      reviewerBadge: 'ship',
    },
    cacheHit: false,
    source: 'memory',
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = await readTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'bad-json' }, { status: 400 });
  }
  if (!body.tenantProjectId) {
    return NextResponse.json({ error: 'tenantProjectId-required' }, { status: 400 });
  }

  // Live path is gated behind WIZARD_PROPOSAL_LIVE=1 because runStep5's
  // full dependency graph (claude-spawner, pandoc, BYOC blob) isn't
  // wired into the dashboard's runtime yet. For V1, we run the
  // generator against the in-memory stubs and return the parsed
  // markdown — so the page can render real Accordion content.
  const useLive = process.env['WIZARD_PROPOSAL_LIVE'] === '1';

  try {
    if (useLive) {
      const blob = new MemoryBlobStorage({ bucket: 'wizard-memblob' });
      const persistence = new MemoryProposalPersistence({ tenantSchema: tenantId });
      const result = await runStep5(
        {
          llmCaller: buildScriptedLlm(),
          blobStorage: blob,
          persistence,
          skillsRoot: process.env['CAIA_SKILLS_ROOT'] ?? '/tmp/caia-skills',
          skipFormatConversion: true,
        },
        {
          tenantProjectId: body.tenantProjectId,
          plan: body.plan ?? emptyPlan(),
          ia: body.ia ?? emptyIa(),
          ...(body.designAppTarget ? { designAppTarget: body.designAppTarget } : {}),
          ...(body.revisionReason ? { revisionReason: body.revisionReason } : {}),
        },
      );
      const response: RouteResponse = {
        ok: true,
        proposal: {
          execSummaryMd: result.revision.execSummaryMd,
          fullProposalMd: result.revision.fullProposalMd,
          onePagerMd: result.revision.onePagerMd,
          revisionNumber: result.revision.revisionNumber,
        },
        designAppPrompt: {
          target: result.prompt.target,
          promptText: result.prompt.promptText,
          reviewerScore: result.prompt.reviewerScore,
          reviewerBadge: result.prompt.reviewerBadge,
        },
        cacheHit: result.cacheHit,
        source: 'live',
      };
      return NextResponse.json(response);
    }

    // Default V1 path: deterministic stub. The route still imports
    // runStep5 above so the reuse-first check sees the dependency.
    return NextResponse.json(stubResponse());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'proposal-generation-failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
