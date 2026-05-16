import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { LlmProvider, RawLlmScaffold } from './types.js';

const pExecFile = promisify(execFile);

export interface ProviderResolveOpts {
  provider?: 'claude' | 'local' | 'auto' | 'fixture';
  /** Override claude CLI binary (defaults to 'claude' on PATH). */
  claudeBin?: string;
  /** Override local-llm-router base URL. */
  routerBaseUrl?: string;
  /** Force the model id passed to the claude CLI. */
  claudeModel?: string;
  /** Force the task-type passed to local-llm-router. Defaults to 'reason'. */
  localTaskType?: string;
  /** Optional fixture provider for tests. */
  fixtureResponse?: string;
}

/**
 * Resolve the configured provider. The default `auto` strategy prefers `local`
 * when the router answers /healthz, else falls through to `claude` if the CLI
 * is on PATH, else throws. Callers can pin with `provider: 'claude' | 'local'`.
 */
export async function resolveProvider(opts: ProviderResolveOpts = {}): Promise<LlmProvider> {
  if (opts.provider === 'fixture') {
    return makeFixtureProvider(opts.fixtureResponse ?? '');
  }
  if (opts.provider === 'claude') return makeClaudeProvider(opts);
  if (opts.provider === 'local') return makeLocalProvider(opts);

  // auto
  const routerUp = await probeRouter(opts.routerBaseUrl);
  if (routerUp) return makeLocalProvider(opts);
  const claudeOk = await probeClaude(opts.claudeBin);
  if (claudeOk) return makeClaudeProvider(opts);
  throw new Error(
    'No LLM provider available: local-llm-router unreachable and claude CLI not on PATH. ' +
      'Set --provider claude (with a working claude binary) or start the router daemon.',
  );
}

async function probeRouter(routerBaseUrl?: string): Promise<boolean> {
  const url = `${(routerBaseUrl ?? 'http://127.0.0.1:7411').replace(/\/$/, '')}/healthz`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return false;
    const j = (await res.json()) as { ok?: boolean };
    return j.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function probeClaude(claudeBin?: string): Promise<boolean> {
  const bin = claudeBin ?? 'claude';
  try {
    await pExecFile(bin, ['--version'], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

export function makeFixtureProvider(response: string): LlmProvider {
  return {
    name: 'fixture',
    async complete() {
      return { raw: response, provider: 'fixture' } as RawLlmScaffold;
    },
  };
}

export function makeLocalProvider(opts: ProviderResolveOpts): LlmProvider {
  const baseUrl = (opts.routerBaseUrl ?? 'http://127.0.0.1:7411').replace(/\/$/, '');
  const taskType = opts.localTaskType ?? 'reason';
  return {
    name: 'local',
    async complete(system, user, callOpts) {
      const body = {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        caia_task_type: taskType,
        max_tokens: callOpts?.maxTokens ?? 4000,
        temperature: callOpts?.temperature ?? 0.1,
      };
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 120_000);
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '<unreadable>');
        throw new Error(`local-llm-router returned ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        throw new Error('local-llm-router returned no content');
      }
      const usage: RawLlmScaffold['usage'] = {};
      if (typeof data.usage?.prompt_tokens === 'number') usage.input_tokens = data.usage.prompt_tokens;
      if (typeof data.usage?.completion_tokens === 'number') usage.output_tokens = data.usage.completion_tokens;
      const out: RawLlmScaffold = { raw: content, provider: 'local' };
      if (Object.keys(usage).length > 0) out.usage = usage;
      return out;
    },
  };
}

export function makeClaudeProvider(opts: ProviderResolveOpts): LlmProvider {
  const bin = opts.claudeBin ?? 'claude';
  const model = opts.claudeModel ?? process.env.CAIA_SCAFFOLDER_MODEL ?? 'claude-sonnet-4-6';
  return {
    name: 'claude',
    async complete(system, user, _callOpts) {
      // Use the claude CLI in non-interactive print mode. The CLI prints the
      // assistant message to stdout. We pipe the prompt via stdin to avoid
      // command-line length limits; execFile's API doesn't expose stdin, so
      // we drop to `spawn` for this provider.
      const args = ['-p', '--model', model, '--max-turns', '1', '--output-format', 'text'];
      const combined = `<system>\n${system}\n</system>\n\n${user}`;
      const stdout: string = await new Promise<string>((resolveP, rejectP) => {
        const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        const chunks: Buffer[] = [];
        const errChunks: Buffer[] = [];
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          rejectP(new Error('claude CLI timed out after 180s'));
        }, 180_000);
        child.stdout.on('data', (c) => chunks.push(Buffer.from(c)));
        child.stderr.on('data', (c) => errChunks.push(Buffer.from(c)));
        child.on('error', (e) => {
          clearTimeout(timer);
          rejectP(e);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code !== 0) {
            rejectP(new Error(`claude CLI exited ${code}: ${Buffer.concat(errChunks).toString('utf8').slice(0, 200)}`));
            return;
          }
          resolveP(Buffer.concat(chunks).toString('utf8'));
        });
        child.stdin.write(combined);
        child.stdin.end();
      });
      const trimmed = stdout.trim();
      if (trimmed.length === 0) throw new Error('claude CLI returned empty stdout');
      return { raw: trimmed, provider: 'claude' };
    },
  };
}
