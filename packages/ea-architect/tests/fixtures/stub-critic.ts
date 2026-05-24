import type { CriticAdapter, CriticInput, CriticOutput, ReviewStatus } from '../../src/types.js';

/** A pre-canned critic output for tests. */
export function makeOutput(partial: Partial<CriticOutput> & { status: ReviewStatus }): CriticOutput {
  return {
    status: partial.status,
    reasoning: partial.reasoning ?? 'test',
    cited_adrs: partial.cited_adrs ?? [],
    cited_principles: partial.cited_principles ?? [],
    cited_lessons: partial.cited_lessons ?? [],
    requested_modifications: partial.requested_modifications ?? [],
    new_adrs_to_file: partial.new_adrs_to_file ?? [],
    affected_existing_adrs: partial.affected_existing_adrs ?? [],
    ...(partial.escalation_to_operator !== undefined
      ? { escalation_to_operator: partial.escalation_to_operator }
      : {}),
    ok: partial.ok ?? true,
    ...(partial.diagnostic !== undefined ? { diagnostic: partial.diagnostic } : {})
  };
}

/** A critic adapter that returns a fixed sequence of outputs (per iteration). */
export class StubCritic implements CriticAdapter {
  public calls: CriticInput[] = [];

  constructor(private readonly outputs: CriticOutput[]) {}

  async review(input: CriticInput): Promise<CriticOutput> {
    this.calls.push(input);
    const idx = Math.min(this.calls.length - 1, this.outputs.length - 1);
    const out = this.outputs[idx];
    if (out === undefined) throw new Error('StubCritic exhausted');
    return out;
  }
}

/** A critic that always returns the same output regardless of iteration. */
export class FixedCritic implements CriticAdapter {
  public calls: CriticInput[] = [];

  constructor(private readonly output: CriticOutput) {}

  async review(input: CriticInput): Promise<CriticOutput> {
    this.calls.push(input);
    return this.output;
  }
}
