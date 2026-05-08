import type {
  StolutionDispatchInput,
  StolutionDispatchOutput} from './types.js';
import {
  StolutionDispatchInputSchema
} from './types.js';
import { dispatchToStolution } from './dispatch.js';

/**
 * Main entry point for the stolution-dispatch module.
 * Provides type-safe access to the dispatch functionality.
 */

export async function dispatch(input: StolutionDispatchInput): Promise<StolutionDispatchOutput> {
  // Validate input
  const validatedInput = StolutionDispatchInputSchema.parse(input);
  return dispatchToStolution(validatedInput);
}

export type { StolutionDispatchInput, StolutionDispatchOutput };
export { StolutionDispatchInputSchema };

/**
 * Tool definition for MCP server integration
 */
export const stolutionDispatchToolDefinition = {
  name: 'stolution_claude_dispatch',
  description:
    'Dispatch a task to a remote Claude Code worker on stolution via SSH. The worker runs in a temporary session and returns the result.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      task_brief: {
        type: 'string',
        description: 'The prompt to give the remote claude worker',
      },
      expected_output_shape: {
        type: 'string',
        enum: ['text', 'json', 'transcript'],
        default: 'text',
        description: 'How to format the output: text (final message), json (JSON object), or transcript (full JSONL)',
      },
      timeout_seconds: {
        type: 'number',
        default: 600,
        description: 'Timeout in seconds (default 600s, max 7200s)',
      },
      working_directory: {
        type: 'string',
        default: '/home/s903/stolution',
        description: 'Remote working directory for the task',
      },
      cleanup_on_completion: {
        type: 'boolean',
        default: true,
        description: 'Tear down session temp directories on completion',
      },
    },
    required: ['task_brief'],
  },
};

export default dispatch;
