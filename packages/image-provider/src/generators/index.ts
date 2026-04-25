import { type FalModel, generateImages, MODEL_COSTS } from './fal.js';
import { checkBudget } from './budget-ledger.js';

export { getTotalSpend, getRemainingBudget, getLedger } from './budget-ledger.js';
export { MODEL_COSTS } from './fal.js';
export type { FalModel, GeneratedImage } from './fal.js';

export interface GeneratorOptions {
  query: string;
  isHero: boolean;
  count?: number;
}

export async function generate(opts: GeneratorOptions) {
  const model: FalModel = opts.isHero ? 'fal-ai/flux-pro' : 'fal-ai/flux/schnell';
  const count = opts.count ?? 4;
  checkBudget(MODEL_COSTS[model] * count);
  return generateImages(opts.query, model, count);
}
