import { describe, expect, it } from 'vitest';

import { NotImplementedError } from '../src/errors.js';
import { BoltGenerator } from '../src/design-app/targets/bolt.js';
import { BuilderioGenerator } from '../src/design-app/targets/builderio.js';
import { FigmaGenerator } from '../src/design-app/targets/figma.js';
import { LovableGenerator } from '../src/design-app/targets/lovable.js';
import { V0Generator } from '../src/design-app/targets/v0.js';
import { WebflowGenerator } from '../src/design-app/targets/webflow.js';
import { sampleIa, samplePlan } from './fixtures/sample-plan.js';

const cases: Array<[string, () => { render: (input: never) => Promise<unknown>; target: string }]> = [
  ['figma', () => new FigmaGenerator({ skillsRoot: '/tmp/skills' })],
  ['v0', () => new V0Generator({ skillsRoot: '/tmp/skills' })],
  ['lovable', () => new LovableGenerator({ skillsRoot: '/tmp/skills' })],
  ['bolt', () => new BoltGenerator({ skillsRoot: '/tmp/skills' })],
  ['builderio', () => new BuilderioGenerator({ skillsRoot: '/tmp/skills' })],
  ['webflow', () => new WebflowGenerator({ skillsRoot: '/tmp/skills' })],
];

describe('stub generators', () => {
  for (const [name, factory] of cases) {
    it(`${name} stub throws NotImplementedError on render`, async () => {
      const g = factory();
      expect(g.target).toBe(name);
      await expect(
        g.render({ plan: samplePlan(), ia: sampleIa() } as never),
      ).rejects.toBeInstanceOf(NotImplementedError);
    });
  }
});
