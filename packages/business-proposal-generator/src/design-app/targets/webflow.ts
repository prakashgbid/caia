import { join } from 'node:path';
import { StubGenerator } from './stub-base.js';
import type { TargetName } from '../../types/proposal.js';

export interface WebflowOpts { skillsRoot: string }
export class WebflowGenerator extends StubGenerator {
  public readonly target: TargetName = 'webflow';
  public readonly skillPath: string;
  public constructor(opts: WebflowOpts) { super(); this.skillPath = join(opts.skillsRoot, 'webflow'); }
}
