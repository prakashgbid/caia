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
  appendFile(p: string, content: string): void {
    nodeFs.appendFileSync(p, content);
  }
}
