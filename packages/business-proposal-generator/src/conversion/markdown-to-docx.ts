import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPandoc, type PandocRunner } from './pandoc.js';

export interface DocxOptions {
  runner: PandocRunner;
  binary?: string;
  referenceDocxPath?: string;
}

export async function convertMarkdownToDocx(md: string, opts: DocxOptions): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'caia-bpg-docx-'));
  const ip = join(dir, 'in.md');
  await writeFile(ip, md, 'utf8');
  const args = ['--from=gfm', '--to=docx', '-o', '-'];
  if (opts.referenceDocxPath) args.push('--reference-doc', opts.referenceDocxPath);
  args.push(ip);
  try {
    const r = await runPandoc(opts.runner, { binary: opts.binary ?? 'pandoc', args });
    return Buffer.from(r.stdout, 'binary');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
