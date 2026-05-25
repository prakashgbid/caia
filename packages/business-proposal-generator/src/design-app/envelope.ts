/** Envelope parse helper used by generators and tests. */

import { z } from 'zod';

import { ProposalGeneratorError } from '../errors.js';
import { designAppPromptOutputSchema, type DesignAppPromptOutput } from '../types/design-app.js';

export function parseDesignAppPromptOutput(value: unknown): DesignAppPromptOutput {
  try {
    return designAppPromptOutputSchema.parse(value);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ProposalGeneratorError(
        'envelope_invalid',
        'DesignAppPromptOutput failed schema validation',
        err,
        { issues: err.issues },
      );
    }
    throw err;
  }
}

export { designAppPromptOutputSchema };
