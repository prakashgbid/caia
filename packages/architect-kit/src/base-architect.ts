/**
 * @caia/architect-kit — BaseArchitect abstract class.
 *
 * Reduces per-architect boilerplate. Concrete architects extend this and
 * implement only `run()`, optionally overriding `systemPrompt()` and `tools`.
 *
 * Goals:
 *  - Centralise the spend-accounting + output-validation discipline so every
 *    architect treats failures the same way.
 *  - Make tests cheap to write — test a concrete architect by constructing
 *    it with a mock input and asserting on the output shape.
 *  - Stay free of runtime deps — this class doesn't import claude-spawner;
 *    sub-classes wire their own spawner via constructor injection. Keeps
 *    architect-kit a pure-types package and decouples LLM-call mechanics
 *    from the interface contract.
 */

import type { SpecialistArchitect } from './specialist-architect.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSpend,
  ArchitectToolCall,
  ToolDefinition,
} from './types.js';
import type { ArchitectSectionContract } from './architect-section-contract.js';
import { contractPaths } from './architect-section-contract.js';

export abstract class BaseArchitect implements SpecialistArchitect {
  abstract readonly name: string;
  abstract readonly sectionContract: ArchitectSectionContract;

  /** Default: empty tool list. Override per-architect when needed. */
  readonly tools: readonly ToolDefinition[] = [];

  /**
   * Default system prompt — a sensible boilerplate that incorporates the
   * architect's name + owned paths. Override for production architects.
   * Keeping this in BaseArchitect lets the dispatcher's smoke tests spawn
   * a "stub" architect without writing a prompt.
   */
  systemPrompt(): string {
    const paths = contractPaths(this.sectionContract).join(', ');
    return [
      `You are the ${this.name} specialist architect for the CAIA EA fan-out phase.`,
      `Your job is to populate the following JSON paths under tickets.architecture:`,
      `  ${paths}`,
      ``,
      `Return ONLY valid JSON conforming to the section contract. Do not add`,
      `keys outside the contract. Do not omit required keys. If you can't`,
      `complete a section, set its value to null and mention the gap in`,
      `your `,
      `\`notes\` field.`,
    ].join('\n');
  }

  abstract run(input: ArchitectInput): Promise<ArchitectOutput>;

  // ─── Helpers — sub-classes may use these to avoid boilerplate ────────────

  /**
   * Empty-but-valid spend record. Useful for stub/test architects that
   * don't actually invoke an LLM.
   */
  protected zeroSpend(model = 'none'): ArchitectSpend {
    return {
      inputTokens: 0,
      outputTokens: 0,
      usdCost: 0,
      wallClockMs: 0,
      model,
    };
  }

  /**
   * Construct a `failed` output with the supplied reason. Used by retry
   * paths and exception handlers to avoid throwing across the dispatcher
   * boundary.
   */
  protected failedOutput(
    reason: string,
    opts?: { confidence?: number; risks?: readonly string[] },
  ): ArchitectOutput {
    return {
      architectName: this.name,
      architectureFields: {},
      confidence: opts?.confidence ?? 0,
      notes: '',
      dependencies: [],
      risks: opts?.risks ?? [],
      toolCalls: [],
      spend: this.zeroSpend(),
      status: 'failed',
      failureReason: reason,
    };
  }

  /**
   * Construct a `partial` output — used when some declared sections could
   * not be populated but the architect still has useful content.
   */
  protected partialOutput(
    architectureFields: Record<string, unknown>,
    opts: {
      confidence: number;
      notes?: string;
      risks?: readonly string[];
      spend?: ArchitectSpend;
      toolCalls?: readonly ArchitectToolCall[];
    },
  ): ArchitectOutput {
    return {
      architectName: this.name,
      architectureFields,
      confidence: opts.confidence,
      notes: opts.notes ?? '',
      dependencies: [],
      risks: opts.risks ?? [],
      toolCalls: opts.toolCalls ?? [],
      spend: opts.spend ?? this.zeroSpend(),
      status: 'partial',
    };
  }

  /**
   * Construct an `ok` output. Validates that the supplied
   * architectureFields covers every required path in the contract; if not,
   * downgrades to `partial`.
   */
  protected okOutput(
    architectureFields: Record<string, unknown>,
    opts: {
      confidence: number;
      notes?: string;
      risks?: readonly string[];
      spend?: ArchitectSpend;
      toolCalls?: readonly ArchitectToolCall[];
      dependencies?: readonly string[];
    },
  ): ArchitectOutput {
    const missingRequired = this.sectionContract.sections
      .filter((s) => s.required)
      .map((s) => s.path)
      .filter((p) => !(p in architectureFields) || architectureFields[p] == null);

    const status: 'ok' | 'partial' = missingRequired.length === 0 ? 'ok' : 'partial';

    return {
      architectName: this.name,
      architectureFields,
      confidence: opts.confidence,
      notes: opts.notes ?? '',
      dependencies: opts.dependencies ?? [],
      risks: opts.risks ?? [],
      toolCalls: opts.toolCalls ?? [],
      spend: opts.spend ?? this.zeroSpend(),
      status,
      ...(status === 'partial'
        ? { failureReason: `missing required paths: ${missingRequired.join(', ')}` }
        : {}),
    };
  }

  /**
   * Returns the set of paths from the contract NOT present in the supplied
   * architectureFields. Used by the dispatcher's retry-with-corrected-prompt
   * fragment ("your last output was missing key X").
   */
  static missingPaths(
    contract: ArchitectSectionContract,
    architectureFields: Record<string, unknown>,
  ): readonly string[] {
    return contractPaths(contract).filter((p) => !(p in architectureFields));
  }

  /**
   * Returns the set of paths in architectureFields that are NOT declared
   * by the contract (extras the architect shouldn't have written).
   */
  static extraPaths(
    contract: ArchitectSectionContract,
    architectureFields: Record<string, unknown>,
  ): readonly string[] {
    const declared = new Set(contractPaths(contract));
    return Object.keys(architectureFields).filter((p) => !declared.has(p));
  }
}
