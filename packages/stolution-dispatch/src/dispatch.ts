import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { StolutionDispatchInput, StolutionDispatchOutput, DispatchError } from './types.js';

const execPromise = promisify(exec);

const STOLUTION_HOST = 'stolution';
const STOLUTION_USER = 's903';
const CLAUDE_BINARY = '/home/s903/.local/bin/claude';

interface SSHExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Execute a command on stolution via SSH
 */
async function sshExec(command: string, timeout_ms: number): Promise<SSHExecResult> {
  const sshCommand = `ssh -o BatchMode=yes -o ConnectTimeout=10 ${STOLUTION_USER}@${STOLUTION_HOST} "${command.replace(/"/g, '\\"')}"`;

  try {
    const result = await execPromise(sshCommand, {
      timeout: timeout_ms,
      maxBuffer: 50 * 1024 * 1024, // 50 MB for large outputs
    });
    return result;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (error.code === 'ETIMEDOUT') {
      throw {
        type: 'timeout' as const,
        message: 'SSH command timed out',
      };
    }
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
    };
  }
}

/**
 * Extract final assistant message from claude output
 */
function extractFinalMessage(fullOutput: string): string {
  // Claude --print outputs just the response text with minimal formatting
  // Simply return the trimmed output as the message
  return fullOutput.trim();
}

/**
 * Main dispatch function
 */
export async function dispatchToStolution(
  input: StolutionDispatchInput,
): Promise<StolutionDispatchOutput> {
  const startTime = Date.now();
  const sessionId = randomUUID();
  const sessionDir = `/tmp/cowork-dispatch/${sessionId}`;

  try {
    // Step 1: Create session directory on remote
    const createDirCmd = `mkdir -p "${sessionDir}" && echo "OK"`;
    let result = await sshExec(createDirCmd, Math.min(input.timeout_seconds * 1000, 10000));

    if (!result.stdout.includes('OK')) {
      const duration_ms = Date.now() - startTime;
      return {
        ok: false,
        output: '',
        duration_ms,
        error: `Failed to create session directory on stolution: ${result.stderr}`,
      };
    }

    // Step 2: Verify claude binary exists
    const claudeCheckCmd = `test -x ${CLAUDE_BINARY} && echo "FOUND" || echo "NOT_FOUND"`;
    result = await sshExec(claudeCheckCmd, 10000);

    if (!result.stdout.includes('FOUND')) {
      const duration_ms = Date.now() - startTime;
      return {
        ok: false,
        output: '',
        duration_ms,
        error: `Claude binary not found at ${CLAUDE_BINARY} on stolution`,
      };
    }

    // Step 3: Write task brief to temp file for stdin
    const taskFile = `${sessionDir}/task.txt`;
    const escapedTask = input.task_brief.replace(/"/g, '\\"').replace(/\$/g, '\\$');
    const writeTaskCmd = `cat > "${taskFile}" << 'TASK_EOF'\n${input.task_brief}\nTASK_EOF\necho "WRITTEN"`;

    result = await sshExec(writeTaskCmd, 10000);
    if (!result.stdout.includes('WRITTEN')) {
      const duration_ms = Date.now() - startTime;
      return {
        ok: false,
        output: '',
        duration_ms,
        error: `Failed to write task file on stolution: ${result.stderr}`,
      };
    }

    // Step 4: Run claude with the task
    const claudeCmd =
      `cd "${input.working_directory}" && ` +
      `timeout ${input.timeout_seconds} ${CLAUDE_BINARY} --print < "${taskFile}" 2>&1`;

    result = await sshExec(claudeCmd, (input.timeout_seconds + 5) * 1000);

    // Check for timeout or other errors
    if (result.stderr.includes('timed out') || result.stderr.includes('Terminated')) {
      const duration_ms = Date.now() - startTime;
      return {
        ok: false,
        output: '',
        duration_ms,
        remote_session_id: sessionId,
        error: `Remote claude execution timed out after ${input.timeout_seconds}s`,
      };
    }

    // Step 5: Process output based on expected shape
    let finalOutput = result.stdout;

    if (input.expected_output_shape === 'text') {
      finalOutput = extractFinalMessage(result.stdout);
    } else if (input.expected_output_shape === 'json') {
      // Try to extract JSON from the output
      const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        finalOutput = jsonMatch[0];
      }
    } else if (input.expected_output_shape === 'transcript') {
      // Save full transcript
      const transcriptPath = `${sessionDir}/transcript.jsonl`;
      const saveTranscriptCmd = `echo '${result.stdout.replace(/'/g, "'")}' > "${transcriptPath}" && echo "SAVED"`;
      const transcriptResult = await sshExec(saveTranscriptCmd, 10000);

      if (transcriptResult.stdout.includes('SAVED')) {
        return {
          ok: true,
          output: finalOutput,
          transcript_path: transcriptPath,
          duration_ms: Date.now() - startTime,
          remote_session_id: sessionId,
        };
      }
    }

    // Step 6: Cleanup (if enabled)
    if (input.cleanup_on_completion) {
      const cleanupCmd = `rm -rf "${sessionDir}"`;
      // Don't wait for cleanup, fire and forget with short timeout
      sshExec(cleanupCmd, 10000).catch(() => {
        // Silently ignore cleanup errors
      });
    }

    const duration_ms = Date.now() - startTime;

    return {
      ok: true,
      output: finalOutput,
      duration_ms,
      remote_session_id: input.cleanup_on_completion ? undefined : sessionId,
    };
  } catch (err: unknown) {
    const error = err as DispatchError;
    const duration_ms = Date.now() - startTime;

    // Attempt cleanup on error
    if (input.cleanup_on_completion) {
      const cleanupCmd = `rm -rf "/tmp/cowork-dispatch/${sessionId}"`;
      sshExec(cleanupCmd, 5000).catch(() => {
        // Silently ignore
      });
    }

    return {
      ok: false,
      output: '',
      duration_ms,
      remote_session_id: sessionId,
      error: error.message || 'Unknown error during dispatch',
    };
  }
}
