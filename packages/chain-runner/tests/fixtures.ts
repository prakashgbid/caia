import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FixtureBundle {
  chainHome: string;
  chainId: string;
  specPath: string;
  cleanup: () => void;
}

const FIXTURE_SPEC = `defaults:
  max_retries: 2
  max_minutes: 45
  heartbeat_interval_sec: 120

phases:
  - id: 1
    name: phase_one
    deps: []
    prompt_template: |
      first phase task
  - id: 2
    name: phase_two
    deps: [1]
    prompt_template: |
      second phase task
  - id: 3
    name: phase_three
    deps: [2]
    prompt_template: |
      third phase task
  - id: 4
    name: phase_four
    deps: [3]
    prompt_template: |
      fourth phase task
  - id: 5
    name: phase_five
    deps: [4]
    prompt_template: |
      fifth phase task
  - id: 6
    name: phase_six
    deps: [5]
    prompt_template: |
      sixth phase task
  - id: 7
    name: phase_seven
    deps: [6]
    prompt_template: |
      seventh phase task
  - id: 8
    name: phase_eight
    deps: [7]
    prompt_template: |
      eighth phase task
  - id: 9
    name: phase_nine
    deps: [8]
    prompt_template: |
      ninth phase task
  - id: 10
    name: phase_ten
    deps: [9]
    prompt_template: |
      tenth phase task
  - id: 11
    name: phase_eleven
    deps: [10]
    prompt_template: |
      eleventh phase task
  - id: 12
    name: phase_twelve
    deps: [11]
    prompt_template: |
      twelfth phase task
  - id: 13
    name: phase_thirteen
    deps: [12]
    prompt_template: |
      thirteenth phase task
`;

export function makeFixture(label = 'cr-test'): FixtureBundle {
  const root = mkdtempSync(join(tmpdir(), `caia-cr-${label}-`));
  const chainHome = join(root, 'chain');
  mkdirSync(chainHome, { recursive: true });
  const specPath = join(root, 'phases.yaml');
  writeFileSync(specPath, FIXTURE_SPEC);
  process.env['CAIA_CHAIN_HOME'] = chainHome;
  return {
    chainHome,
    chainId: `cr-${label}-${process.pid}`,
    specPath,
    cleanup: () => {
      delete process.env['CAIA_CHAIN_HOME'];
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}
