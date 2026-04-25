import { requireKey } from '../../config/index.js';
import { checkBudget, recordSpend } from './budget-ledger.js';

const PHOTOREALISM_SUFFIX =
  ', professional studio photograph, shallow depth of field, 50mm lens, ' +
  'natural window light, cinematic color grading, 8K detail, no text, no watermark, ' +
  'no logos, sharp focus, real-world physics, DSLR photography, photorealistic';

const NEGATIVE_PROMPT =
  'cartoon, illustration, render, CGI, plastic, fake, lowres, blurry, extra fingers, ' +
  'bad anatomy, distorted, warped, low quality, jpeg artifacts, oversaturated, deep-fried';

export const MODEL_COSTS = {
  'fal-ai/flux-pro': 0.05,
  'fal-ai/flux/schnell': 0.003,
} as const;

export type FalModel = keyof typeof MODEL_COSTS;

export interface GeneratedImage {
  url: string;
  model: FalModel;
  cost: number;
  prompt: string;
}

interface FalResult {
  images?: Array<{ url: string }>;
}

export async function generateImages(
  query: string,
  model: FalModel,
  count = 4,
): Promise<GeneratedImage[]> {
  const falKey = requireKey('FAL_KEY');
  const costPerImage = MODEL_COSTS[model];
  checkBudget(costPerImage * count);

  const prompt = query + PHOTOREALISM_SUFFIX;

  const { fal } = await import('@fal-ai/client');
  fal.config({ credentials: falKey });

  const results: GeneratedImage[] = [];

  for (let i = 0; i < count; i++) {
    checkBudget(costPerImage);
    const result = (await fal.subscribe(model, {
      input: {
        prompt,
        negative_prompt: NEGATIVE_PROMPT,
        num_images: 1,
        image_size: 'landscape_16_9',
        num_inference_steps: model === 'fal-ai/flux-pro' ? 28 : 4,
        guidance_scale: model === 'fal-ai/flux-pro' ? 7.5 : 0,
        output_format: 'jpeg',
      },
    })) as FalResult;

    const imageUrl = result.images?.[0]?.url;
    if (!imageUrl) continue;

    const imageId = `fal-${Date.now()}-${i}`;
    recordSpend({ model, cost: costPerImage, query, imageId });
    results.push({ url: imageUrl, model, cost: costPerImage, prompt });
  }

  return results;
}
