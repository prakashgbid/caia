/**
 * `ClaudeDesignAdapter` — implements `DesignAdapter` for the
 * "let CAIA call Claude (subscription) to generate a design from the
 * Step-5 design-app prompt" source.
 *
 * Phase B Task B2. Server-side only.
 *
 * Why this exists
 * ---------------
 * Step 5 already produces a polished design-app prompt
 * (`packages/business-proposal-generator/src/types/design-app.ts`).
 * Before B2, the only way to get from that prompt to a parsed
 * `RenderableDesign` was for the customer to paste it into an external
 * tool (Claude Design / Figma / v0 / Lovable / Bolt / Builder.io /
 * Webflow / Framer / Anima), export the result, and upload it as a CD
 * ZIP. That round-trip is the "stub Claude calls" the B2 brief refers
 * to — a placeholder in the Step 6 UI tagged `Wave 2 wires the actual
 * @caia/design-ingest Ingestor here`.
 *
 * This adapter closes the loop: given the prompt, it spawns the
 * canonical `claude` binary via `@chiefaia/claude-spawner`
 * (subscription-only, no API key) and parses the JSON envelope into a
 * `RenderableDesign`. The `Ingestor` then runs DOM-ID finalisation +
 * snapshot capture exactly as it would for any other source.
 *
 * Constraints (from `feedback_no_api_key_billing.md`):
 *   - SUBSCRIPTION-ONLY. `@chiefaia/claude-spawner` scrubs
 *     ANTHROPIC_API_KEY + sibling vars unconditionally. We do NOT set
 *     them; we do NOT fall back to API-key billing.
 *   - SERVER-SIDE ONLY. This module never runs in the browser.
 *   - REUSE-FIRST. We use `spawnClaude` (D1 canonical extraction) and
 *     `parseClaudeJsonEnvelope` (same package) — never raw
 *     `child_process.spawn` and never bespoke envelope parsing.
 *
 * Input shape
 * -----------
 * The framework passes `AdapterInput` of kind `'remote'`. The
 * `sourceConfig` carries the prompt + optional model + timeout:
 *
 *   {
 *     kind: 'remote',
 *     tenantId,
 *     sourceConfig: {
 *       promptText: string,              // the Step 5 design-app prompt
 *       designVersionId: string,         // assigned by the framework
 *       model?: string,                  // default: undefined (claude default)
 *       timeoutMs?: number,              // default: 120_000
 *     }
 *   }
 *
 * Output shape
 * ------------
 * Claude is asked to respond with a single JSON object matching the
 * `RenderableDesign` shape from `@caia/design-ingest`. The envelope
 * `result` field is parsed and validated via `assertRenderableDesign`
 * (Zod). Validation failures are surfaced as `IngestionError` with
 * code `claude_envelope_invalid` so the route can return a clean 422.
 *
 * Tests reach the adapter through three injectable seams
 * (`spawnImpl`, `parseEnvelopeImpl`, `now`) so the suite never spawns
 * a real subprocess.
 */

import type {
  AdapterCapabilities,
  AdapterDeps,
  AdapterInput,
  DesignAdapter,
  ValidationResult,
} from './types.js';
import type { RenderableDesign, SourceName } from './schema.js';
import { assertRenderableDesign } from './schema.js';
import {
  RefreshNotSupported,
  DesignIngestError,
} from './errors.js';
import {
  spawnClaude,
  parseClaudeJsonEnvelope,
  type SpawnClaudeInput,
  type SpawnClaudeResult,
  type ParsedClaudeEnvelope,
} from '@chiefaia/claude-spawner';

const CAPABILITIES: AdapterCapabilities = Object.freeze({
  supportsRefresh: false,
  supportsLiveWebhook: false,
  // subscription-only — the credential is the keychain OAuth session,
  // never an API token the customer has to provide.
  requiresCredential: false,
});

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Wraps `Claude` so it emits a single JSON object matching
 * `RenderableDesign`. Identical to the system-prompt frame used by
 * `@chiefaia/critic` / `@caia/ea-architect` — small frame, no
 * persona, just a hard JSON-only contract.
 */
export function buildClaudeDesignPrompt(promptText: string, designVersionId: string): string {
  return [
    `You are CAIA's design-generation step. Read the design-app prompt below`,
    `and emit ONE JSON object that conforms to the CAIA RenderableDesign`,
    `schema. Required top-level fields: designVersionId (string), routes`,
    `(array), componentTrees (object). Use designVersionId="${designVersionId}".`,
    ``,
    `Respond with the JSON object ONLY. No markdown fences, no prose.`,
    ``,
    `Design-app prompt:`,
    `---`,
    promptText,
    `---`,
  ].join('\n');
}

export interface ClaudeDesignAdapterDeps extends AdapterDeps {
  /** Test seam — replaces `@chiefaia/claude-spawner.spawnClaude`. */
  spawnImpl?: (input: SpawnClaudeInput) => Promise<SpawnClaudeResult>;
  /** Test seam — replaces `parseClaudeJsonEnvelope`. */
  parseEnvelopeImpl?: (stdout: string) => ParsedClaudeEnvelope;
  /** Test seam — clock for diagnostics + timing. */
  now?: () => number;
}

interface ClaudeDesignSourceConfig {
  promptText: string;
  designVersionId: string;
  model?: string;
  timeoutMs?: number;
}

function readSourceConfig(input: AdapterInput): ClaudeDesignSourceConfig {
  if (input.kind !== 'remote') {
    throw new DesignIngestError(
      'claude_design_requires_remote_input',
      'ClaudeDesignAdapter only accepts remote AdapterInput; got kind=' + input.kind,
      { kind: input.kind },
    );
  }
  const cfg = input.sourceConfig as Record<string, unknown>;
  const promptText = cfg['promptText'];
  const designVersionId = cfg['designVersionId'];
  if (typeof promptText !== 'string' || promptText.trim().length === 0) {
    throw new DesignIngestError(
      'claude_design_prompt_required',
      'sourceConfig.promptText must be a non-empty string',
    );
  }
  if (typeof designVersionId !== 'string' || designVersionId.trim().length === 0) {
    throw new DesignIngestError(
      'claude_design_version_id_required',
      'sourceConfig.designVersionId must be a non-empty string',
    );
  }
  const out: ClaudeDesignSourceConfig = { promptText, designVersionId };
  if (typeof cfg['model'] === 'string') out.model = cfg['model'] as string;
  if (typeof cfg['timeoutMs'] === 'number') out.timeoutMs = cfg['timeoutMs'] as number;
  return out;
}

export class ClaudeDesignAdapter implements DesignAdapter {
  public readonly sourceName: SourceName = 'claude-design';
  public readonly capabilities: AdapterCapabilities = CAPABILITIES;

  private readonly spawnImpl: (input: SpawnClaudeInput) => Promise<SpawnClaudeResult>;
  private readonly parseEnvelopeImpl: (stdout: string) => ParsedClaudeEnvelope;

  constructor(deps: ClaudeDesignAdapterDeps) {
    this.spawnImpl = deps.spawnImpl ?? spawnClaude;
    this.parseEnvelopeImpl = deps.parseEnvelopeImpl ?? parseClaudeJsonEnvelope;
  }

  /**
   * Lightweight prompt presence check. The expensive Claude call
   * happens in `parse`. We keep `validate` cheap so the framework's
   * fast-path can reject malformed input before paying the LLM tax.
   */
  async validate(input: AdapterInput): Promise<ValidationResult> {
    try {
      readSourceConfig(input);
      return { ok: true, warnings: [], errors: [] };
    } catch (err) {
      const e = err as DesignIngestError;
      return {
        ok: false,
        warnings: [],
        errors: [{ code: e.code ?? 'validate-failed', message: e.message }],
      };
    }
  }

  async parse(input: AdapterInput): Promise<RenderableDesign> {
    const cfg = readSourceConfig(input);
    const spawnInput: SpawnClaudeInput = {
      prompt: buildClaudeDesignPrompt(cfg.promptText, cfg.designVersionId),
      options: {
        outputFormat: 'json',
        timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(cfg.model !== undefined ? { model: cfg.model } : {}),
      },
    };
    const result = await this.spawnImpl(spawnInput);
    if (!result.ok) {
      throw new DesignIngestError(
        'claude_spawn_failed',
        'spawnClaude returned ok=false during ClaudeDesignAdapter.parse',
        {
          diagnostic: result.diagnostic ?? 'spawn returned ok=false',
          rc: result.rc,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
        },
      );
    }
    const parsed = this.parseEnvelopeImpl(result.stdout);
    if (!parsed.ok) {
      throw new DesignIngestError(
        'claude_envelope_invalid',
        'Claude JSON envelope was not parseable: ' + parsed.diagnostic,
        { diagnostic: parsed.diagnostic },
      );
    }
    let designObj: unknown;
    try {
      designObj = JSON.parse(parsed.text);
    } catch (e) {
      throw new DesignIngestError(
        'claude_design_json_parse_failed',
        'Claude envelope.result was not parseable JSON: ' + (e as Error).message,
        { diagnostic: (e as Error).message },
      );
    }
    try {
      // assertRenderableDesign throws ZodError; wrap so the framework
      // surfaces a consistent IngestionError envelope.
      // Cast through unknown — the Zod inferred type has slightly looser
      // optional handling than the atlas-mapper RenderableDesign interface
      // under exactOptionalPropertyTypes; the schema already validated
      // every required field.
      return assertRenderableDesign(designObj) as unknown as RenderableDesign;
    } catch (e) {
      throw new DesignIngestError(
        'claude_design_schema_invalid',
        'Claude generation did not satisfy RenderableDesignSchema: ' + (e as Error).message,
        { diagnostic: (e as Error).message },
      );
    }
  }

  /**
   * Claude-design is one-shot; the user can re-run Step 6 to get a
   * new generation, but we don't repull an existing one (the prompt
   * is the source of truth, the generation is opaque).
   */
  async refresh(_designVersionId: string): Promise<RenderableDesign> {
    throw new RefreshNotSupported('claude-design');
  }
}
