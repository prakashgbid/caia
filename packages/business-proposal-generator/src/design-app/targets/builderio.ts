import { join } from 'node:path';
import { StubGenerator } from './stub-base.js';
import type { TargetName } from '../../types/proposal.js';

export interface BuilderioOpts { skillsRoot: string }
export class BuilderioGenerator extends StubGenerator {
  public readonly target: TargetName = 'builderio';
  public readonly skillPath: string;
  public constructor(opts: BuilderioOpts) { super(); this.skillPath = join(opts.skillsRoot, 'builderio'); }
}
