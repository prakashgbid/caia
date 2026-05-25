/** Shared stub-generator base. Throws NotImplementedError on render(). */
import { NotImplementedError } from '../../errors.js';
import type { IDesignAppPromptGenerator, GeneratorRenderInput } from '../generator-interface.js';
import type { DesignAppPromptOutput } from '../../types/design-app.js';
import type { TargetName } from '../../types/proposal.js';

export abstract class StubGenerator implements IDesignAppPromptGenerator {
  public abstract readonly target: TargetName;
  public abstract readonly skillPath: string;
  public async render(_input: GeneratorRenderInput): Promise<DesignAppPromptOutput> {
    throw new NotImplementedError(this.target);
  }
}
