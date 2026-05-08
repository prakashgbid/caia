#!/usr/bin/env node
/**
 * caia-aiml-architect CLI.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { AIMLArchitect } from './architect.js';
import type { QualityBar, Hardware } from './types.js';

interface Argv {
  readonly subcommand: string;
  readonly flags: Readonly<Record<string, string | boolean>>;
}

function parseArgv(argv: ReadonlyArray<string>): Argv {
  const [, , subcommand = 'help', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === undefined) continue;
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { subcommand, flags };
}

function printHelp(): void {
  console.log(
    [
      'caia-aiml-architect — AI/ML Architect Agent CLI',
      '',
      'Subcommands:',
      '  select       Select a model for a task category.',
      '               --task <category> --context <tokens> --quality <best-effort|standard|high> [--hardware <h>]',
      '',
      '  review       Review a prompt template.',
      '               --template-id <id> --template-file <path> --task <category> [--shape plain|json|markdown|code]',
      '',
      '  eval-audit   Audit the canonical 100-prompt eval suite.',
      '',
      '  coordinate   Apprentice-loop coordination verdict.',
      '',
      '  convention   Regenerate caia/docs/ai-ml-architecture-conventions.md.',
      '               [--output <path>]',
      '',
      '  help         Show this help.',
      ''
    ].join('\n')
  );
}

function asString(v: string | boolean | undefined, name: string): string {
  if (typeof v !== 'string') {
    throw new Error(`Missing required flag --${name}`);
  }
  return v;
}

async function main(argv: ReadonlyArray<string>): Promise<number> {
  const { subcommand, flags } = parseArgv(argv);
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return 0;
  }

  const architect = new AIMLArchitect();

  switch (subcommand) {
    case 'select': {
      const task = asString(flags['task'], 'task');
      const contextRaw = asString(flags['context'], 'context');
      const quality = asString(flags['quality'], 'quality') as QualityBar;
      const hardware = (flags['hardware'] as string | undefined) as
        | Hardware
        | undefined;
      const context = parseInt(contextRaw, 10);
      const choice = architect.selectModel(
        hardware === undefined
          ? {
              taskCategory: task,
              contextSizeTokens: context,
              qualityBar: quality
            }
          : {
              taskCategory: task,
              contextSizeTokens: context,
              qualityBar: quality,
              hardware
            }
      );
      console.log(JSON.stringify(choice, null, 2));
      return 0;
    }
    case 'review': {
      const templateId = asString(flags['template-id'], 'template-id');
      const templateFile = asString(flags['template-file'], 'template-file');
      const task = asString(flags['task'], 'task');
      const shape = (flags['shape'] as string | undefined) ?? 'plain';
      const template = readFileSync(templateFile, 'utf-8');
      const result = architect.reviewPromptPattern({
        templateId,
        template,
        intendedTaskCategory: task,
        expectedOutputShape: shape as 'plain' | 'json' | 'markdown' | 'code'
      });
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    case 'eval-audit': {
      const suite = architect.ownEvalSuite();
      console.log(JSON.stringify(suite, null, 2));
      return suite.integrityIssues.length === 0 ? 0 : 1;
    }
    case 'coordinate': {
      const plan = architect.coordinateApprenticeLoop();
      console.log(JSON.stringify(plan, null, 2));
      return 0;
    }
    case 'convention': {
      const out =
        (flags['output'] as string | undefined) ??
        architect.config().conventionsDocPath;
      const body = architect.generateConventionsDoc();
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, body, 'utf-8');
      console.log(`Wrote ${out} (${body.length} chars).`);
      return 0;
    }
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printHelp();
      return 2;
  }
}

main(process.argv).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`[caia-aiml-architect] fatal: ${String(e)}`);
    process.exit(1);
  }
);
