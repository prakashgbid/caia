/**
 * Default FsAccess wrapping node:fs. Tests inject createInMemoryFs()
 * from tests/helpers/fakes.ts.
 */

import * as nodeFs from 'node:fs';
import type { FsAccess } from './types.js';

export class DefaultFsAccess implements FsAccess {
  exists(p: string): boolean {
    return nodeFs.existsSync(p);
  }
  readFile(p: string): string {
    return nodeFs.readFileSync(p, 'utf8');
  }
  writeFile(p: string, content: string): void {
    nodeFs.writeFileSync(p, content);
  }
  mkdir(p: string): void {
    nodeFs.mkdirSync(p, { recursive: true });
  }
  rename(oldP: string, newP: string): void {
    nodeFs.renameSync(oldP, newP);
  }
  unlink(p: string): void {
    nodeFs.unlinkSync(p);
  }
  readDir(p: string): string[] {
    return nodeFs.readdirSync(p);
  }
  stat(p: string): { mtimeMs: number; size: number; isFile: boolean; isDirectory: boolean } {
    const s = nodeFs.statSync(p);
    return {
      mtimeMs: s.mtimeMs,
      size: s.size,
      isFile: s.isFile(),
      isDirectory: s.isDirectory()
    };
  }
}
