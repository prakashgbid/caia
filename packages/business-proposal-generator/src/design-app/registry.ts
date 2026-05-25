/** TargetRegistry — maps target name → generator instance. */

import { ProposalGeneratorError } from '../errors.js';
import { isTargetName, type TargetName } from '../types/proposal.js';
import type { IDesignAppPromptGenerator } from './generator-interface.js';

export class TargetRegistry {
  private readonly map = new Map<TargetName, IDesignAppPromptGenerator>();

  public register(generator: IDesignAppPromptGenerator): void {
    if (this.map.has(generator.target)) {
      throw new ProposalGeneratorError(
        'validation_failed',
        `target '${generator.target}' already registered`,
      );
    }
    this.map.set(generator.target, generator);
  }

  public get(target: TargetName): IDesignAppPromptGenerator {
    const g = this.map.get(target);
    if (!g) {
      throw new ProposalGeneratorError(
        'not_implemented',
        `no generator registered for target '${target}'`,
        undefined,
        { target },
      );
    }
    return g;
  }

  public lookup(target: string): IDesignAppPromptGenerator | undefined {
    if (!isTargetName(target)) return undefined;
    return this.map.get(target);
  }

  public listTargets(): readonly TargetName[] {
    return [...this.map.keys()];
  }

  public has(target: TargetName): boolean {
    return this.map.has(target);
  }
}
