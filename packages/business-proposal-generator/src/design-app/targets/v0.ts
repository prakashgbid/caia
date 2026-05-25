import { join } from 'node:path';
import { StubGenerator } from './stub-base.js';
import type { TargetName } from '../../types/proposal.js';

export interface V0Opts { skillsRoot: string }
export class V0Generator extends StubGenerator {
  public readonly target: TargetName = 'v0';
  public readonly skillPath: string;
  public constructor(opts: V0Opts) { super(); this.skillPath = join(opts.skillsRoot, 'v0'); }
}
