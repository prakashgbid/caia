import { join } from 'node:path';
import { StubGenerator } from './stub-base.js';
import type { TargetName } from '../../types/proposal.js';

export interface FigmaOpts { skillsRoot: string }
export class FigmaGenerator extends StubGenerator {
  public readonly target: TargetName = 'figma';
  public readonly skillPath: string;
  public constructor(opts: FigmaOpts) { super(); this.skillPath = join(opts.skillsRoot, 'figma'); }
}
