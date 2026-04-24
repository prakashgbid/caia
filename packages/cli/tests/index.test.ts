import { describe, it, expect } from 'vitest';
import { program } from '../src/index.js';

describe('caia CLI', () => {
  it('registers new and doctor commands', () => {
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('new');
    expect(names).toContain('doctor');
  });

  it('new command has utility, site, agent subcommands', () => {
    const newCmd = program.commands.find((c) => c.name() === 'new');
    expect(newCmd).toBeDefined();
    const subs = newCmd!.commands.map((c) => c.name());
    expect(subs).toContain('utility');
    expect(subs).toContain('site');
    expect(subs).toContain('agent');
  });
});
