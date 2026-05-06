import { describe, expect, it } from 'vitest';
import {
  DefaultSubprocessExecutor,
  parseListOutput,
  SubprocessOllamaClient
} from '../src/ollama-client.js';
import {
  OllamaCreateError,
  OllamaInspectError,
  OllamaNotInstalledError,
  OllamaRemoveError
} from '../src/types.js';
import type { SubprocessExecutor, SubprocessExecutorArgs, SubprocessExecutorResult } from '../src/ollama-client.js';

type ScriptedReply = SubprocessExecutorResult;

class ScriptedExecutor implements SubprocessExecutor {
  public calls: SubprocessExecutorArgs[] = [];
  constructor(private readonly replies: ScriptedReply[]) {}
  async run(args: SubprocessExecutorArgs): Promise<SubprocessExecutorResult> {
    this.calls.push(args);
    const next = this.replies.shift();
    if (next === undefined) {
      throw new Error('ScriptedExecutor: replies exhausted');
    }
    return next;
  }
}

function ok(stdout = ''): ScriptedReply {
  return { exitCode: 0, signal: null, stdout, stderr: '', timedOut: false, elapsedMs: 1 };
}
function fail(stderr: string, exitCode = 1): ScriptedReply {
  return { exitCode, signal: null, stdout: '', stderr, timedOut: false, elapsedMs: 1 };
}

describe('SubprocessOllamaClient — version', () => {
  it('returns trimmed stdout on success', async () => {
    const exec = new ScriptedExecutor([ok('ollama version is 0.23.1\n')]);
    const c = new SubprocessOllamaClient({
      ollamaBinaryPath: 'ollama',
      timeoutMs: 1000,
      executor: exec
    });
    expect(await c.version()).toBe('ollama version is 0.23.1');
  });

  it('throws OllamaNotInstalledError on non-zero exit', async () => {
    const exec = new ScriptedExecutor([fail('command not found', 127)]);
    const c = new SubprocessOllamaClient({
      ollamaBinaryPath: 'ollama',
      timeoutMs: 1000,
      executor: exec
    });
    await expect(c.version()).rejects.toThrow(OllamaNotInstalledError);
  });
});

describe('SubprocessOllamaClient — list', () => {
  it('parses model list output', async () => {
    const stdout =
      'NAME                       ID              SIZE      MODIFIED\n' +
      'qwen2.5-coder:7b           dae161e27b0e    4.7 GB    8 days ago\n' +
      'phi4:latest                ac896e5b8b34    9.1 GB    7 days ago\n';
    const exec = new ScriptedExecutor([ok(stdout)]);
    const c = new SubprocessOllamaClient({
      ollamaBinaryPath: 'ollama',
      timeoutMs: 1000,
      executor: exec
    });
    const out = await c.list();
    expect(out).toEqual(['qwen2.5-coder:7b', 'phi4:latest']);
  });

  it('throws OllamaInspectError on non-zero exit', async () => {
    const exec = new ScriptedExecutor([fail('daemon not running')]);
    const c = new SubprocessOllamaClient({
      ollamaBinaryPath: 'ollama',
      timeoutMs: 1000,
      executor: exec
    });
    await expect(c.list()).rejects.toThrow(OllamaInspectError);
  });
});

describe('SubprocessOllamaClient — create', () => {
  it('passes correct argv + cwd', async () => {
    const exec = new ScriptedExecutor([ok()]);
    const c = new SubprocessOllamaClient({
      ollamaBinaryPath: '/usr/local/bin/ollama',
      timeoutMs: 1000,
      executor: exec
    });
    await c.create({
      modelName: 'qwen-canary-abc',
      modelfilePath: '/path/to/Modelfile',
      cwd: '/path/to/adapter'
    });
    expect(exec.calls[0]!.command).toBe('/usr/local/bin/ollama');
    expect(exec.calls[0]!.args).toEqual(['create', 'qwen-canary-abc', '-f', '/path/to/Modelfile']);
    expect(exec.calls[0]!.cwd).toBe('/path/to/adapter');
  });

  it('throws OllamaCreateError on non-zero exit', async () => {
    const exec = new ScriptedExecutor([fail('invalid Modelfile')]);
    const c = new SubprocessOllamaClient({
      ollamaBinaryPath: 'ollama',
      timeoutMs: 1000,
      executor: exec
    });
    await expect(
      c.create({ modelName: 'x', modelfilePath: '/x', cwd: '/' })
    ).rejects.toThrow(OllamaCreateError);
  });
});

describe('SubprocessOllamaClient — remove', () => {
  it('treats success as success', async () => {
    const exec = new ScriptedExecutor([ok()]);
    const c = new SubprocessOllamaClient({
      ollamaBinaryPath: 'ollama',
      timeoutMs: 1000,
      executor: exec
    });
    await expect(c.remove('foo')).resolves.toBeUndefined();
  });

  it('treats "not found" stderr as success', async () => {
    const exec = new ScriptedExecutor([fail('Error: model "foo" not found')]);
    const c = new SubprocessOllamaClient({
      ollamaBinaryPath: 'ollama',
      timeoutMs: 1000,
      executor: exec
    });
    await expect(c.remove('foo')).resolves.toBeUndefined();
  });

  it('throws OllamaRemoveError on other non-zero exit', async () => {
    const exec = new ScriptedExecutor([fail('disk full')]);
    const c = new SubprocessOllamaClient({
      ollamaBinaryPath: 'ollama',
      timeoutMs: 1000,
      executor: exec
    });
    await expect(c.remove('foo')).rejects.toThrow(OllamaRemoveError);
  });
});

describe('SubprocessOllamaClient — show', () => {
  it('returns stdout', async () => {
    const exec = new ScriptedExecutor([ok('FROM qwen2.5-coder:7b\nADAPTER ./adapters.safetensors\n')]);
    const c = new SubprocessOllamaClient({
      ollamaBinaryPath: 'ollama',
      timeoutMs: 1000,
      executor: exec
    });
    const out = await c.show('foo');
    expect(out).toContain('FROM qwen2.5-coder:7b');
  });

  it('throws OllamaInspectError on failure', async () => {
    const exec = new ScriptedExecutor([fail('not found')]);
    const c = new SubprocessOllamaClient({
      ollamaBinaryPath: 'ollama',
      timeoutMs: 1000,
      executor: exec
    });
    await expect(c.show('foo')).rejects.toThrow(OllamaInspectError);
  });
});

describe('SubprocessOllamaClient — env', () => {
  it('clears ANTHROPIC_API_KEY from subprocess env', async () => {
    const exec = new ScriptedExecutor([ok('ollama version is 0.23.1\n')]);
    const c = new SubprocessOllamaClient({
      ollamaBinaryPath: 'ollama',
      timeoutMs: 1000,
      executor: exec
    });
    const before = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-fake';
    try {
      await c.version();
      expect(exec.calls[0]!.env['ANTHROPIC_API_KEY']).toBeUndefined();
    } finally {
      if (before === undefined) delete process.env['ANTHROPIC_API_KEY'];
      else process.env['ANTHROPIC_API_KEY'] = before;
    }
  });

  it('honours ollamaHost when provided', async () => {
    const exec = new ScriptedExecutor([ok('ollama version is 0.23.1\n')]);
    const c = new SubprocessOllamaClient({
      ollamaBinaryPath: 'ollama',
      ollamaHost: 'http://localhost:9999',
      timeoutMs: 1000,
      executor: exec
    });
    await c.version();
    expect(exec.calls[0]!.env['OLLAMA_HOST']).toBe('http://localhost:9999');
  });
});

describe('parseListOutput', () => {
  it('skips header row', () => {
    const stdout =
      'NAME    ID    SIZE\n' +
      'qwen-7b    abc    4GB\n' +
      'phi4    def    9GB\n';
    expect(parseListOutput(stdout)).toEqual(['qwen-7b', 'phi4']);
  });

  it('handles empty output', () => {
    expect(parseListOutput('')).toEqual([]);
    expect(parseListOutput('NAME ID SIZE\n')).toEqual([]);
  });
});

describe('DefaultSubprocessExecutor sanity', () => {
  it('exists and is constructible', () => {
    expect(new DefaultSubprocessExecutor()).toBeInstanceOf(DefaultSubprocessExecutor);
  });
});
