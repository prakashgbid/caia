import { z } from 'zod';

export const StolutionDispatchInputSchema = z.object({
  task_brief: z.string().describe('The prompt to give the remote claude worker'),
  expected_output_shape: z
    .enum(['text', 'json', 'transcript'])
    .default('text')
    .describe('How to format the output'),
  timeout_seconds: z
    .number()
    .int()
    .min(1)
    .max(7200)
    .default(600)
    .describe('Timeout in seconds (default 600s, max 2h)'),
  working_directory: z
    .string()
    .default('/home/s903/stolution')
    .describe('Remote working directory for the task'),
  cleanup_on_completion: z
    .boolean()
    .default(true)
    .describe('Tear down session temp directories on completion'),
});

export type StolutionDispatchInput = z.infer<typeof StolutionDispatchInputSchema>;

export const StolutionDispatchOutputSchema = z.object({
  ok: z.boolean().describe('Whether the dispatch succeeded'),
  output: z.string().describe('The worker final message, stripped of system noise'),
  transcript_path: z
    .string()
    .optional()
    .describe('Path on stolution to full transcript JSONL if expected_output_shape==="transcript"'),
  duration_ms: z.number().describe('Total duration in milliseconds'),
  remote_session_id: z
    .string()
    .optional()
    .describe('Session ID on stolution for resume/inspection'),
  error: z.string().optional().describe('Error message if ok === false'),
});

export type StolutionDispatchOutput = z.infer<typeof StolutionDispatchOutputSchema>;

export interface DispatchError {
  type:
    | 'ssh_connection_failed'
    | 'claude_not_found'
    | 'claude_errored'
    | 'timeout'
    | 'cleanup_failed'
    | 'unknown';
  message: string;
  duration_ms: number;
  remote_session_id?: string;
}
