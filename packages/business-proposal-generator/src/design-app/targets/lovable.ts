import { join } from 'node:path';
import { StubGenerator } from './stub-base.js';
import type { TargetName } from '../../types/proposal.js';

export interface LovableOpts { skillsRoot: string }
export class LovableGenerator extends StubGenerator {
  public readonly target: TargetName = 'lovable';
  public readonly skillPath: string;
  public constructor(opts: LovableOpts) { super(); this.skillPath = join(opts.skillsRoot, 'lovable'); }
}
