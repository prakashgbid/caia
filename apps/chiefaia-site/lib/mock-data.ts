/**
 * Mock data for the project-onboarding flow (STOL-5003).
 *
 * Everything here is static placeholder content — clearly labelled sample
 * projects plus the CAIA factory catalog derived from the STOL-1034 master
 * blueprint. No backend, no APIs, no persistence.
 */

import catalogJson from '../data/caia-factory-catalog.json';

export interface FactoryItem {
  id: string;
  name: string;
  kind: 'sf' | 'cp';
  scope: string;
  features: string[];
  workItems: string[];
}

export interface FactoryStage {
  id: string;
  code: string;
  name: string;
  epic: string;
  items: FactoryItem[];
}

export interface FactoryCatalog {
  source: string;
  stages: FactoryStage[];
}

export const factoryCatalog = catalogJson as FactoryCatalog;

export const factoryStages: FactoryStage[] = factoryCatalog.stages;

export const allFactoryItems: FactoryItem[] = factoryStages.flatMap(
  (stage) => stage.items
);

export function findFactoryItem(
  id: string
): { item: FactoryItem; stage: FactoryStage } | undefined {
  for (const stage of factoryStages) {
    const item = stage.items.find((candidate) => candidate.id === id);
    if (item) return { item, stage };
  }
  return undefined;
}

export interface MockProject {
  id: string;
  name: string;
  status: 'Draft' | 'In pipeline' | 'Awaiting ratification' | 'Live';
  stageLabel: string;
  lastUpdated: string; // ISO date — static so SSR + client render identically
}

/**
 * Sample projects — visual placeholders only (clicking does nothing yet,
 * future scope per STOL-5003). Names are explicitly "Sample" so nothing on
 * the marketing surface reads as a real customer or real usage claim.
 */
export const mockProjects: MockProject[] = [
  {
    id: 'sample-storefront',
    name: 'Sample: Neighborhood Storefront',
    status: 'In pipeline',
    stageLabel: 'Stage C — Product Engineering',
    lastUpdated: '2026-08-19',
  },
  {
    id: 'sample-booking',
    name: 'Sample: Service Booking App',
    status: 'Awaiting ratification',
    stageLabel: 'Stage D — Architecture gate',
    lastUpdated: '2026-08-17',
  },
  {
    id: 'sample-analytics',
    name: 'Sample: Analytics Dashboard',
    status: 'Live',
    stageLabel: 'Stage I — Production intelligence',
    lastUpdated: '2026-08-12',
  },
  {
    id: 'sample-brief',
    name: 'Sample: Untitled Brief',
    status: 'Draft',
    stageLabel: 'Stage A — Vision intake',
    lastUpdated: '2026-08-21',
  },
];

export function formatProjectDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
