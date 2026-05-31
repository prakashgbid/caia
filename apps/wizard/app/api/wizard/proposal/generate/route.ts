/**
 * `POST /api/wizard/proposal/generate` — Step 5 proposal generator.
 *
 * Server-side handler that imports `runStep5` from
 * `@caia/business-proposal-generator` and runs the V1 wizard flow.
 *
 * Phase B B4 (2026-05-31): the live path wraps `runStep5` with
 * `withTenantSearchPath` so every Postgres call the generator makes
 * resolves against the tenant's schema. The default V1 stub path is
 * 100% in-memory and never touches pg, so we deliberately skip the
 * `resolveTenantSchema` lookup there — it would needlessly call the
 * global `tenants` table on every request that's just rendering canned
 * markdown.
 *
 * Phase B B3 (2026-05-31): `runStep5` (which in live mode fans out to
 * multiple claude-spawner prompts via the injected `LlmCaller`) is
 * wrapped in `withClaudeSpawnerSpan` so Tempo records the wizard
 * step semantics around the entire proposal-generation run. The OTel
 * context manager threads the wizard span as parent of the
 * `claude.spawn` spans the spawner emits.
 *
 * Reuse-first compliance:
 *   - Uses `@caia/business-proposal-generator`'s `runStep5`,
 *     `MemoryBlobStorage`, `MemoryProposalPersistence`,
 *     `ScriptedLlmCaller`.
 *   - Uses `withTenantSearchPath` from `lib/tenants/search-path.ts`.
 *   - Uses `createTracer` + `withClaudeSpawnerSpan` from `@chiefaia/tracing`.
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
import { createTracer, withClaudeSpawnerSpan } from '@chiefaia/tracing';
import { resolveTenantSchema } from '../../../../../lib/wizard/store-wire';
import { getPool } from '../../../../../lib/tenants/wire';
import { withTenantSearchPath } from '../../../../../lib/tenants/search-path';

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

const tracer = createTracer('chiefaia.dashboard.wizard.proposal');

/** Claude model the proposal-generator path uses end-to-end. */
const PROPOSAL_LIVE_MODEL = 'claude-opus-4-6';

/**
 * Top-level prompt template identifier for the wizard's proposal
 * step. The runStep5 engine fans out to several sub-prompts
 * (`proposal:exec-summary`, `proposal:full`, `proposal:one-pager`,
 * `proposal:design-app-prompt`, `proposal:reviewer`); we surface
 * the top-level handle on the wizard span and rely on the inner
 * `claude.spawn` spans (one per sub-prompt) to carry the per-prompt
 * detail.
 */
const PROPOSAL_PROMPT_TEMPLATE = 'proposal:runStep5.v1';

function buildScriptedLlm(): LlmCaller {
  return new ScriptedLlmCaller([
    {
      kind: 'ok',
      text: JSON.stringify({
        markdown:
          '# Executive Summary\n\nA concise overview of the product and the target customer.',
      }),
    },
    {
      kind: 'ok',
      text: JSON.stringify({
        markdown:
          '# Technical Scope\n\n## Architecture\nThe system splits into a Next.js dashboard, a `@caia/*` workspace of agents, and a per-tenant Postgres schema.',
      }),
    },
    {
      kind: 'ok',
      text: JSON.stringify({
        markdown:
          '# Go-to-Market Plan\n\n- ICP: solo founders + small product teams.',
      }),
    },
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
        { id: 'home', title: 'Home', slug: '/', description: 'Landing page' },
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
    components: { schema_version: '1.0', components: [] },
  };
}

function emptyPlan(): GenerateProposalInput['plan'] {
  return {
    schemaVersion: '2.0',
    sections: { executive_summary: 'A short, structured pitch.' },
    rubricScores: { aggregateScore: 82 },
  };
}

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

  const useLive = process.env['WIZARD_PROPOSAL_LIVE'] === '1';
  const tenantProjectId = body.tenantProjectId;

  return await tracer.withSpan('wizard.proposal.generate', async (span) => {
    span.setAttribute('wizard.tenant_id', tenantId);
    span.setAttribute('wizard.project_id', tenantProjectId);
    span.setAttribute('wizard.proposal.source', useLive ? 'live' : 'memory');

    try {
      if (useLive) {
        // Phase B B4: resolve + pin the tenant search_path only on the
        // live path (the stub path is pure in-memory and never touches
        // pg). Wrap the whole generator call so any persistence write
        // inside `runStep5` lands in the right schema.
        const tenantSchema = await resolveTenantSchema(tenantId);
        span.setAttribute('wizard.tenant_schema', tenantSchema);
        const response: RouteResponse = await withTenantSearchPath(
          getPool(),
          tenantSchema,
          async () =>
            // Phase B B3: wrap the whole runStep5 fan-out so Tempo
            // records the wizard step semantics around every
            // claude-spawner prompt the engine fires (exec-summary,
            // full proposal, one-pager, design-app prompt, reviewer).
            withClaudeSpawnerSpan(
              {
                step: 'proposal.generate',
                projectId: tenantProjectId,
                tenantId,
                promptTemplate: PROPOSAL_PROMPT_TEMPLATE,
                model: PROPOSAL_LIVE_MODEL,
                extra: { 'caia.claude.live': true },
              },
              async () => {
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
                    tenantProjectId,
                    plan: body.plan ?? emptyPlan(),
                    ia: body.ia ?? emptyIa(),
                    ...(body.designAppTarget ? { designAppTarget: body.designAppTarget } : {}),
                    ...(body.revisionReason ? { revisionReason: body.revisionReason } : {}),
                  },
                );
                return {
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
              },
            ),
        );
        return NextResponse.json(response);
      }

      // Phase B B3: wrap the stub render so the wizard step span shows
      // up in Tempo with `caia.claude.live=false` — useful for tracking
      // V1 vs live rollout without a separate wizard.proposal.stub
      // span name.
      const stub = await withClaudeSpawnerSpan(
        {
          step: 'proposal.generate',
          projectId: tenantProjectId,
          tenantId,
          promptTemplate: PROPOSAL_PROMPT_TEMPLATE,
          model: PROPOSAL_LIVE_MODEL,
          extra: { 'caia.claude.live': false },
        },
        async () => stubResponse(),
      );
      return NextResponse.json(stub);
    } catch (err) {
      return NextResponse.json(
        {
          error: 'proposal-generation-failed',
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }
  });
}
