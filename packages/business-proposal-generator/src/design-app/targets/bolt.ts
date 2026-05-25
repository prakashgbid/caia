import { join } from 'node:path';
import { StubGenerator } from './stub-base.js';
import type { TargetName } from '../../types/proposal.js';

export interface BoltOpts { skillsRoot: string }
export class BoltGenerator extends StubGenerator {
  public readonly target: TargetName = 'bolt';
  public readonly skillPath: string;
  public constructor(opts: BoltOpts) { super(); this.skillPath = join(opts.skillsRoot, 'bolt'); }
}
