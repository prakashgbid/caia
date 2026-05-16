import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseScaffolderSpec, validateScaffolderSpec, extractYamlBlock, specToYaml, SchemaError } from '../src/schema.js';

const FIXTURE_DIR = resolve(__dirname, '../tests/fixtures');

describe('schema.extractYamlBlock', () => {
  it('strips ```yaml fences', () => {
    const text = 'Here is the result:\n```yaml\nphases:\n  - id: 1\n```\nDone.';
    expect(extractYamlBlock(text)).toBe('phases:\n  - id: 1');
  });

  it('returns input unchanged when no fence', () => {
    const text = 'phases:\n  - id: 1\n';
    expect(extractYamlBlock(text)).toBe(text);
  });
});

describe('schema.validateScaffolderSpec', () => {
  it('accepts a well-formed minimal spec', () => {
    const ok = validateScaffolderSpec({
      phases: [
        {
          id: 1,
          name: 'p1',
          prompt_template: 'Phase 1 — concrete enough prompt template to exceed forty characters.',
          success_criteria: { output_file: '~/Documents/projects/reports/x.md' },
        },
      ],
    });
    expect(ok.phases).toHaveLength(1);
    expect(ok.phases[0].name).toBe('p1');
  });

  it('rejects missing prompt_template', () => {
    expect(() =>
      validateScaffolderSpec({
        phases: [
          {
            id: 1,
            name: 'p1',
            success_criteria: { output_file: '~/x.md' },
          },
        ],
      }),
    ).toThrowError(SchemaError);
  });

  it('rejects non-sequential phase ids', () => {
    let caught: SchemaError | null = null;
    try {
      validateScaffolderSpec({
        phases: [
          {
            id: 1,
            name: 'p1',
            prompt_template: 'x'.repeat(50),
            success_criteria: { output_file: '~/x.md' },
          },
          {
            id: 3,
            name: 'p3',
            prompt_template: 'x'.repeat(50),
            success_criteria: { output_file: '~/x.md' },
          },
        ],
      });
    } catch (e) {
      caught = e as SchemaError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.errors.join('|')).toMatch(/sequential/);
  });

  it('rejects deps referencing later phases', () => {
    let caught: SchemaError | null = null;
    try {
      validateScaffolderSpec({
        phases: [
          {
            id: 1,
            name: 'p1',
            deps: [2],
            prompt_template: 'x'.repeat(50),
            success_criteria: { output_file: '~/x.md' },
          },
          {
            id: 2,
            name: 'p2',
            prompt_template: 'x'.repeat(50),
            success_criteria: { output_file: '~/x.md' },
          },
        ],
      });
    } catch (e) {
      caught = e as SchemaError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.errors.join('|')).toMatch(/strictly-earlier/);
  });

  it('round-trips: specToYaml → parseScaffolderSpec', () => {
    const original = validateScaffolderSpec({
      defaults: { max_retries: 2 },
      chain_config: { alert_channels: ['handoff'], max_concurrent: 1, machine: 'm3' },
      phases: [
        {
          id: 1,
          name: 'p1',
          description: 'A description.',
          deps: [],
          max_minutes: 90,
          prompt_template:
            'Phase 1 — long enough prompt template to satisfy the schema validator minimum of forty characters.',
          success_criteria: { output_file: '~/r/p1.md', min_bytes: 800, requires_merged_pr: true },
        },
      ],
    });
    const yamlText = specToYaml(original);
    const reparsed = parseScaffolderSpec(yamlText);
    expect(reparsed.phases).toHaveLength(1);
    expect(reparsed.phases[0].success_criteria.min_bytes).toBe(800);
    expect(reparsed.chain_config?.machine).toBe('m3');
  });
});

describe('schema fixture', () => {
  it('accepts the bundled few-shot example', () => {
    const text = readFileSync(resolve(FIXTURE_DIR, 'example_chain.yaml'), 'utf8');
    const spec = parseScaffolderSpec(text);
    expect(spec.phases.length).toBeGreaterThanOrEqual(1);
    expect(spec.chain_config?.machine).toBe('m3');
  });

  it('round-trips the fenced loose_item_response fixture', () => {
    const text = readFileSync(resolve(FIXTURE_DIR, 'loose_item_response.yaml'), 'utf8');
    const spec = parseScaffolderSpec(text);
    expect(spec.phases).toHaveLength(1);
    expect(spec.phases[0].name).toBe('implement_widget_cache');
  });
});
