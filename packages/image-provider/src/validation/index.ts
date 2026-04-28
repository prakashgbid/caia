import { checkSharpness } from './sharpness.js';
import { checkClipRelevance } from './clip.js';
import { checkAesthetic } from './aesthetic.js';
import { checkAiDetection } from './ai-detector.js';

export { checkSharpness } from './sharpness.js';
export { checkClipRelevance } from './clip.js';
export { checkAesthetic } from './aesthetic.js';
export { checkAiDetection } from './ai-detector.js';
export { checkOcr } from './ocr.js';

export interface ValidationResult {
  passed: boolean;
  relevance: number;
  sharpness: number;
  aesthetic: number;
  aiDetection: number;
  width: number;
  height: number;
  reasons: string[];
}

export async function validateImage(
  buffer: Buffer,
  query: string,
): Promise<ValidationResult> {
  const [sharpness, clip, aesthetic, aiDetect] = await Promise.all([
    checkSharpness(buffer),
    checkClipRelevance(buffer, query),
    checkAesthetic(buffer),
    checkAiDetection(buffer),
  ]);

  const reasons: string[] = [];
  if (!sharpness.passed && sharpness.reason) reasons.push(sharpness.reason);
  if (!clip.passed && clip.reason) reasons.push(clip.reason);
  if (!aesthetic.passed) reasons.push(`Low aesthetic score: ${aesthetic.score.toFixed(3)}`);
  if (!aiDetect.passed) reasons.push('Appears AI-generated (low quality)');

  // Core pass/fail: must pass both dimension/sharpness AND relevance checks
  const passed = sharpness.passed && clip.passed;

  return {
    passed,
    relevance: clip.score,
    sharpness: sharpness.score,
    aesthetic: aesthetic.score,
    aiDetection: aiDetect.score,
    width: sharpness.width,
    height: sharpness.height,
    reasons,
  };
}
