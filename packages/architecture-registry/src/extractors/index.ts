/**
 * @chiefaia/architecture-registry — extractors (ARCH-002 + ARCH-003)
 *
 * Re-exports per-kind extractors. Composing them into one full backfill:
 *
 *   const repo = '/Users/MAC/Documents/projects/caia';
 *   const opts: ExtractorOptions = { repoRoot: repo, defaultProject: 'caia', now: Date.now() };
 *   const services = extractServicesFromAppsRoot(opts);
 *   const apis = extractApisFromFiles(globRouteFiles(repo), opts);
 *   const components = extractComponentsFromFiles(globComponentFiles(repo), opts);
 *   // ... persist to DB via storage layer (ARCH-004 wires up the persistence)
 */

export {
  extractComponentsFromFiles,
  extractComponentsFromInMemorySources,
  extractComponentsFromProject,
} from './component-extractor';

export {
  extractApisFromFiles,
  extractApisFromInMemorySources,
  extractApisFromProject,
} from './api-extractor';

export { extractServicesFromAppsRoot } from './service-extractor';

export type { ExtractionResult, ExtractorOptions } from './ts-morph-types';
export { sha256 } from './utils';
