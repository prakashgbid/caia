/**
 * Markdown → PDF via pandoc + locked LaTeX template.
 *
 * Per the `pdf` skill, this is the canonical "create a new PDF" path:
 * shell out to pandoc with a curated reference template that pins the
 * cover page, type pairing, accent color, and TOC.
 */

import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPandoc, type PandocRunner } from './pandoc.js';

export interface ConvertMarkdownToPdfOptions {
  runner: PandocRunner;
  binary?: string;
  templatePath?: string;
  /** Map of pandoc -V key=value overrides (title, accent, etc.). */
  variables?: Readonly<Record<string, string>>;
}

/**
 * Convert markdown → PDF, returning the PDF bytes (Buffer).
 *
 * The function writes the markdown to a tempfile and passes the path
 * to pandoc, which writes to stdout (--to=pdf --output=-) so the
 * caller never needs filesystem write permission for the output.
 */
export async function convertMarkdownToPdf(
  markdown: string,
  opts: ConvertMarkdownToPdfOptions,
): Promise<Buffer> {
  const binary = opts.binary ?? 'pandoc';
  const dir = await mkdtemp(join(tmpdir(), 'caia-bpg-pdf-'));
  const inputPath = join(dir, 'in.md');
  await writeFile(inputPath, markdown, 'utf8');

  const args = ['--from=gfm', '--to=pdf', '-o', '-'];
  if (opts.templatePath !== undefined) args.push('--template', opts.templatePath);
  if (opts.variables) {
    for (const [k, v] of Object.entries(opts.variables)) args.push('-V', `${k}=${v}`);
  }
  args.push(inputPath);

  try {
    const result = await runPandoc(opts.runner, { binary, args });
    return Buffer.from(result.stdout, 'binary');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
