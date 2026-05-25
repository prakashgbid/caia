/** Shared test fixtures: a minimum-viable plan + IA. */

import type { BusinessPlanV2 } from '../../src/types/proposal.js';
import type { IaArtifactSet } from '../../src/types/ia.js';

export function samplePlan(score = 88): BusinessPlanV2 {
  return {
    schemaVersion: '2.0',
    sections: {
      branding: { voice: 'editorial, restrained' },
      audience: { primary: 'indie founders' },
      problem: 'curating open-source releases is slow',
      proposed_product: 'a daily newsletter with 3 picks',
      success_metric: '500 subscribers in 90 days',
    },
    rubricScores: { aggregateScore: score },
  } as BusinessPlanV2;
}

export function sampleIa(): IaArtifactSet {
  return {
    pages: {
      schema_version: '1.0',
      pages: [
        { id: 'home', title: 'Home', slug: '/' },
        { id: 'archive', title: 'Archive', slug: '/archive' },
        { id: 'about', title: 'About', slug: '/about' },
      ],
    },
    designSystem: {
      schema_version: '1.0',
      palette: { paper: '#FFFFFF', ink: '#0F172A', accent: '#0E7490' },
      type_pairing: { display: 'Fraunces', body: 'Inter', mono: 'JetBrains Mono' },
      motion_preference: 'restrained',
      layout_patterns: ['editorial', 'long-scroll'],
      reference_urls: ['https://example.com/inspo'],
    },
    components: {
      schema_version: '1.0',
      components: [
        { id: 'card', name: 'Card', category: 'surface' },
        { id: 'pill', name: 'Pill', category: 'badge' },
      ],
    },
  };
}
