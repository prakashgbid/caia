/**
 * Subprocess-backed implementation of OllamaClient. Spawns the `ollama`
 * CLI and parses its output. Treats "model not found" on rm as success
 * (idempotent removal). Throws typed errors on every other non-zero exit.
 *
 * Tests inject createFakeOllamaClient() from tests/helpers/fakes.ts.
 */

import { spawn } from 'node:child_process';
import {
  OllamaCreateError,
  OllamaInspectError,
  OllamaNotInstalledError,
  OllamaRemoveError
} from './types.js';
import type { OllamaClient, OllamaCreateArgs } from './types.js';

export interface SubprocessExecutorArgs {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  timeoutMs: number;
  /** Combined stdin string. Default empty. */
  stdin?: string;
}

export interface SubprocessExecutorResult {
  exitCode: number;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  elapsedMs: number;
}

export interface SubprocessExecutor {
  run(args: SubprocessExecutorArgs): Promise<SubprocessExecutorResult>;
}

export class DefaultSubprocessExecutor implements SubprocessExecutor {
  async run(args: SubprocessExecutorArgs): Promise<SubprocessExecutorResult> {
    return new Promise<SubprocessExecutorResult>((resolve) => {
      const start = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const child = spawn(args.command, args.args, {
        cwd: args.cwd,
        env: args.env as NodeJS.ProcessEnv,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 30_000);
      }, args.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: -1,
          signal: null,
          stdout,
          stderr: stderr + '\n' + (err.message ?? String(err)),
          timedOut,
          elapsedMs: Date.now() - start
        });
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? -1,
          signal: signal ?? null,
          stdout,
          stderr,
          timedOut,
          elapsedMs: Date.now() - start
        });
      });

      if (args.stdin) {
        child.stdin?.write(args.stdin);
        child.stdin?.end();
      } else {
        child.stdin?.end();
      }
    });
  }
}

export interface OllamaClientConfig {
  ollamaBinaryPath: string;
  /** Default OLLAMA_HOST when set. */
  ollamaHost?: string;
  timeoutMs: number;
  executor?: SubprocessExecutor;
}

export class SubprocessOllamaClient implements OllamaClient {
  private readonly binary: string;
  private readonly host?: string;
  private readonly timeoutMs: number;
  private readonly executor: SubprocessExecutor;

  constructor(cfg: OllamaClientConfig) {
    this.binary = cfg.ollamaBinaryPath;
    if (cfg.ollamaHost !== undefined) this.host = cfg.ollamaHost;
    this.timeoutMs = cfg.timeoutMs;
    this.executor = cfg.executor ?? new DefaultSubprocessExecutor();
  }

  private env(): Record<string, string | undefined> {
    const base = { ...process.env };
    if (this.host !== undefined) base.OLLAMA_HOST = this.host;
    // Defence in depth: clear any LLM-API-key env vars from subprocess.
    delete base.ANTHROPIC_API_KEY;
    return base;
  }

  async version(): Promise<string> {
    const r = await this.executor.run({
      command: this.binary,
      args: ['--version'],
      env: this.env(),
      timeoutMs: this.timeoutMs
    });
    if (r.exitCode !== 0) {
      throw new OllamaNotInstalledError(
        `ollama --version failed (exit ${r.exitCode}). Install Ollama: https://ollama.com/download`,
        { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
      );
    }
    return r.stdout.trim();
  }

  async list(): Promise<string[]> {
    const r = await this.executor.run({
      command: this.binary,
      args: ['list'],
      env: this.env(),
      timeoutMs: this.timeoutMs
    });
    if (r.exitCode !== 0) {
      throw new OllamaInspectError(`ollama list failed (exit ${r.exitCode})`, {
        stderr: r.stderr,
        exitCode: r.exitCode
      });
    }
    return parseListOutput(r.stdout);
  }

  async create(args: OllamaCreateArgs): Promise<void> {
    const r = await this.executor.run({
      command: this.binary,
      args: ['create', args.modelName, '-f', args.modelfilePath],
      cwd: args.cwd,
      env: this.env(),
      timeoutMs: this.timeoutMs
    });
    if (r.exitCode !== 0) {
      throw new OllamaCreateError(
        `ollama create ${args.modelName} failed (exit ${r.exitCode})`,
        {
          stdout: r.stdout,
          stderr: r.stderr,
          modelName: args.modelName,
          modelfilePath: args.modelfilePath,
          cwd: args.cwd,
          exitCode: r.exitCode,
          timedOut: r.timedOut
        }
      );
    }
  }

  async remove(modelName: string): Promise<void> {
    const r = await this.executor.run({
      command: this.binary,
      args: ['rm', modelName],
      env: this.env(),
      timeoutMs: this.timeoutMs
    });
    if (r.exitCode === 0) return;
    if (isNotFound(r.stdout + r.stderr)) return;
    throw new OllamaRemoveError(`ollama rm ${modelName} failed (exit ${r.exitCode})`, {
      stdout: r.stdout,
      stderr: r.stderr,
      modelName,
      exitCode: r.exitCode
    });
  }

  async show(modelName: string): Promise<string> {
    const r = await this.executor.run({
      command: this.binary,
      args: ['show', modelName, '--modelfile'],
      env: this.env(),
      timeoutMs: this.timeoutMs
    });
    if (r.exitCode !== 0) {
      throw new OllamaInspectError(
        `ollama show ${modelName} --modelfile failed (exit ${r.exitCode})`,
        { stderr: r.stderr, modelName, exitCode: r.exitCode }
      );
    }
    return r.stdout;
  }
}

function isNotFound(text: string): boolean {
  return /not\s*found|no\s*such/i.test(text);
}

/** Parse `ollama list` table output: skip header row, column 1 = NAME. */
export function parseListOutput(stdout: string): string[] {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const names: string[] = [];
  let isFirst = true;
  for (const line of lines) {
    if (isFirst) {
      // The first non-empty line is the header (e.g., "NAME  ID  SIZE  MODIFIED")
      isFirst = false;
      if (/^name\b/i.test(line)) continue;
    }
    // Take the first whitespace-delimited token as the model name.
    const name = line.split(/\s+/)[0];
    if (name && !/^name$/i.test(name)) names.push(name);
  }
  return names;
}
