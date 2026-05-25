import { describe, expect, it } from 'vitest';

import {
  PandocError,
  PandocNotFoundError,
} from '../src/errors.js';
import { runPandoc, type PandocRunner, type PandocRunResult } from '../src/conversion/pandoc.js';
import { convertMarkdownToPdf } from '../src/conversion/markdown-to-pdf.js';
import { convertMarkdownToDocx } from '../src/conversion/markdown-to-docx.js';

function fakeRunner(result: PandocRunResult): PandocRunner {
  return { run: async () => result };
}
function throwingRunner(err: unknown): PandocRunner {
  return {
    run: async () => {
      throw err;
    },
  };
}

describe('runPandoc', () => {
  it('returns the runner result on exit code 0', async () => {
    const r = await runPandoc(fakeRunner({ stdout: 'OUT', stderr: '', exitCode: 0 }), {
      binary: 'pandoc',
      args: [],
    });
    expect(r.stdout).toBe('OUT');
  });

  it('throws PandocError on non-zero exit', async () => {
    await expect(
      runPandoc(fakeRunner({ stdout: '', stderr: 'broken', exitCode: 1 }), {
        binary: 'pandoc',
        args: [],
      }),
    ).rejects.toBeInstanceOf(PandocError);
  });
});

describe('convertMarkdownToPdf', () => {
  it('produces a Buffer from the runner output', async () => {
    const buf = await convertMarkdownToPdf('# hi', {
      runner: fakeRunner({ stdout: 'PDF-BYTES', stderr: '', exitCode: 0 }),
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('utf8')).toBe('PDF-BYTES');
  });

  it('bubbles PandocNotFoundError when the runner reports binary missing', async () => {
    await expect(
      convertMarkdownToPdf('# hi', {
        runner: throwingRunner(new PandocNotFoundError('pandoc')),
      }),
    ).rejects.toBeInstanceOf(PandocNotFoundError);
  });
});

describe('convertMarkdownToDocx', () => {
  it('produces a Buffer from the runner output', async () => {
    const buf = await convertMarkdownToDocx('# hi', {
      runner: fakeRunner({ stdout: 'DOCX-BYTES', stderr: '', exitCode: 0 }),
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('utf8')).toBe('DOCX-BYTES');
  });

  it('bubbles PandocError on non-zero exit', async () => {
    await expect(
      convertMarkdownToDocx('# hi', {
        runner: fakeRunner({ stdout: '', stderr: 'no template', exitCode: 99 }),
      }),
    ).rejects.toBeInstanceOf(PandocError);
  });
});
