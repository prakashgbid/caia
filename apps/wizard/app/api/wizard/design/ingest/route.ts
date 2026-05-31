/**
 * `POST /api/wizard/design/ingest` — Step 6 server-side ingest entry.
 *
 * Phase B B2 (2026-05-31). Replaces the prior client-side stub flow
 * (DesignPanel.tsx's "Wave 2 wires the actual @caia/design-ingest
 * Ingestor here" placeholder) with the real adapter path:
 *
 *   1. Compose the canonical wrapper chain the backend B-wave codified:
 *        withTenantSearchPath  → ensures any future Postgres writes
 *        wizardWithRetry       → B7 retry/backoff + progress events
 *        withClaudeSpawnerSpan → B3 Tempo semantic-attribute envelope
 *   2. Instantiate `ClaudeDesignAdapter` from `@caia/design-ingest`
 *      (subscription-only via `@chiefaia/claude-spawner`).
 *   3. Call `adapter.validate(input)` then `adapter.parse(input)` —
 *      both run under the wrappers so failures surface as 503 (retry
 *      exhausted) or 422 (validation/schema failure) with structured
 *      bodies the client error.tsx (B1) can render.
 *
 * Persistence note: the full Ingestor.ingest() persistence cycle
 * (ux_uploads insert → snapshot capture) is deliberately deferred
 * because the tenant schema scaffolding for `ux_uploads` does not yet
 * exist on every tenant. The V1 wizard surface returns the parsed
 * RenderableDesign so the client can advance to Step 7; Wave 2 wires
 * the Ingestor cycle once the per-tenant migration plumbing lands.
 *
 * Reuse-first:
 *   - `@caia/design-ingest.ClaudeDesignAdapter` — canonical adapter,
 *     no parallel Claude call here.
 *   - `wizardWithRetry` — B7's retry envelope, no inline backoff.
 *   - `withClaudeSpawnerSpan` — B3's OTel envelope, no parallel
 *     tracer.
 *   - `withTenantSearchPath` — B4's schema-pin wrapper.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { randomUUID } from 'node:crypto';
import {
  ClaudeDesignAdapter,
  type ClaudeDesignAdapterDeps,
  type AdapterInput,
  DesignIngestError,
} from '@caia/design-ingest';
import { createTracer, withClaudeSpawnerSpan } from '@chiefaia/tracing';
import { wizardWithRetry } from '../../../../../lib/wizard/retry-spawner';
import { resolveTenantSchema } from '../../../../../lib/wizard/store-wire';
import { getPool } from '../../../../../lib/tenants/wire';
import { withTenantSearchPath } from '../../../../../lib/tenants/search-path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  tenantProjectId?: string;
  promptText?: string;
  designVersionId?: string;
  model?: string;
  timeoutMs?: number;
}

const tracer = createTracer('chiefaia.dashboard.wizard.design');

const DESIGN_PROMPT_TEMPLATE = 'design:claude-adapter.v1';
const DESIGN_LIVE_MODEL_DEFAULT = 'claude-opus-4-6';

/**
 * Minimal AdapterDeps stub for the live path. The ClaudeDesignAdapter
 * itself only needs `spawnImpl` / `parseEnvelopeImpl` (it defaults
 * those to the canonical `@chiefaia/claude-spawner` helpers). The
 * other fields (secrets / storage / pg / snapshotter / accessContext)
 * satisfy the structural `AdapterDeps` contract but are unused by
 * this adapter — the Ingestor path that needs them is deferred to
 * Wave 2 as documented in the file-level comment.
 */
function buildAdapterDeps(): ClaudeDesignAdapterDeps {
  return {
    // The five fields below satisfy AdapterDeps structurally. The
    // Claude adapter doesn't read them, so the no-op shells are safe.
    secrets: {} as ClaudeDesignAdapterDeps['secrets'],
    storage: {} as ClaudeDesignAdapterDeps['storage'],
    pg: getPool(),
    snapshotter: {} as ClaudeDesignAdapterDeps['snapshotter'],
    accessContext: {
      callerType: 'system',
      callerId: 'wizard.design.ingest',
      reason: 'wizard step 6 design generation',
    } as unknown as ClaudeDesignAdapterDeps['accessContext'],
  };
}

async function readTenantId(): Promise<string | null> {
  const h = await headers();
  return h.get('x-tenant-id');
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
    return NextResponse.json(
      { error: 'tenantProjectId-required' },
      { status: 400 },
    );
  }
  if (!body.promptText || body.promptText.trim().length === 0) {
    return NextResponse.json(
      { error: 'promptText-required' },
      { status: 400 },
    );
  }
  const tenantProjectId = body.tenantProjectId;
  const designVersionId = body.designVersionId ?? `dv-${randomUUID()}`;
  const useLive = process.env['WIZARD_DESIGN_LIVE'] === '1';

  return await tracer.withSpan('wizard.design.ingest', async (span) => {
    span.setAttribute('wizard.tenant_id', tenantId);
    span.setAttribute('wizard.project_id', tenantProjectId);
    span.setAttribute('wizard.design.source', useLive ? 'live' : 'memory');
    span.setAttribute('wizard.design.version_id', designVersionId);

    // Stub path: skip the LLM call entirely. Useful for offline dev +
    // for the existing wizard E2E suite that asserts the route exists
    // without burning Claude tokens.
    if (!useLive) {
      return NextResponse.json({
        ok: true,
        source: 'memory',
        designVersionId,
        attemptsRun: 1,
        renderableDesign: null,
        note:
          'Stub path — set WIZARD_DESIGN_LIVE=1 to call Claude via @chiefaia/claude-spawner.',
      });
    }

    const retryResult = await wizardWithRetry(
      {
        key: { tenantId, projectId: tenantProjectId },
        // The wizardWithRetry binding step union does not yet include
        // 'design.ingest' — we tag the proposal.generate bucket so the
        // progress channel still surfaces this route's retries to the
        // UI. A follow-up minor PR will widen the union.
        step: 'proposal.generate',
      },
      async () => {
        try {
          const tenantSchema = await resolveTenantSchema(tenantId);
          span.setAttribute('wizard.tenant_schema', tenantSchema);
          const response = await withTenantSearchPath(
            getPool(),
            tenantSchema,
            async () =>
              withClaudeSpawnerSpan(
                {
                  step: 'design.ingest',
                  projectId: tenantProjectId,
                  tenantId,
                  promptTemplate: DESIGN_PROMPT_TEMPLATE,
                  model: body.model ?? DESIGN_LIVE_MODEL_DEFAULT,
                  extra: { 'caia.claude.live': true },
                },
                async () => {
                  const adapter = new ClaudeDesignAdapter(buildAdapterDeps());
                  const input: AdapterInput = {
                    kind: 'remote',
                    tenantId,
                    sourceConfig: {
                      promptText: body.promptText as string,
                      designVersionId,
                      ...(body.model ? { model: body.model } : {}),
                      ...(body.timeoutMs ? { timeoutMs: body.timeoutMs } : {}),
                    },
                  };
                  const v = await adapter.validate(input);
                  if (!v.ok) {
                    const first = v.errors[0];
                    const err = new DesignIngestError(
                      // The validate path returns DesignIngestErrorCode values
                      // in errors[].code already — cast through unknown.
                      (first?.code ?? 'invalid_renderable_design') as never,
                      first?.message ?? 'validate failed',
                    );
                    throw err;
                  }
                  const design = await adapter.parse(input);
                  return {
                    ok: true,
                    source: 'live' as const,
                    designVersionId,
                    renderableDesign: design,
                  };
                },
              ),
          );
          return { ok: true, value: response };
        } catch (err) {
          // Surface DesignIngestError codes verbatim so the client can
          // branch on them. Any other error class becomes a generic
          // failure (retry envelope will classify it).
          if (err instanceof DesignIngestError) {
            return {
              ok: false,
              error: err,
              classification: 'permanent' as const,
            };
          }
          return { ok: false, error: err as Error };
        }
      },
    );

    if (!retryResult.ok) {
      const lastErr = retryResult.lastError;
      const errCode =
        lastErr && typeof lastErr === 'object' && 'code' in lastErr
          ? (lastErr as { code: string }).code
          : 'design_ingest_failed';
      span.setAttribute('wizard.design.error_code', errCode);
      // 422 for validation/schema, 503 for spawn failure (retry exhausted).
      const status = errCode === 'claude_spawn_failed' ? 503 : 422;
      return NextResponse.json(
        {
          ok: false,
          error: errCode,
          attemptsRun: retryResult.attemptsRun,
        },
        { status },
      );
    }
    return NextResponse.json({
      ...retryResult.value,
      attemptsRun: retryResult.attemptsRun,
    });
  });
}
