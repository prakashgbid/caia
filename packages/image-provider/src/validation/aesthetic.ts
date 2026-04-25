// Heuristic aesthetic scorer.
// Combines saturation, color diversity, and brightness balance into a 0-1 score.
// A proper LAION-aesthetic ONNX model can replace this when available via @xenova/transformers.

import sharp from 'sharp';

export interface AestheticResult {
  score: number;
  passed: boolean;
}

const PASS_THRESHOLD = 0.25;
const SAMPLE_SIZE = 256; // resize to this before analysis for speed

export async function checkAesthetic(buffer: Buffer): Promise<AestheticResult> {
  const { data, info } = await sharp(buffer)
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'cover' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  const channels = info.channels;
  const n = pixels.length / channels;

  let rSum = 0, gSum = 0, bSum = 0;
  const colorSet = new Set<number>();

  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    rSum += r;
    gSum += g;
    bSum += b;
    // Quantize to 4-bit per channel for diversity counting
    colorSet.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
  }

  const rMean = rSum / n;
  const gMean = gSum / n;
  const bMean = bSum / n;

  // Saturation proxy: distance from neutral gray
  const saturation = Math.sqrt((rMean - 128) ** 2 + (gMean - 128) ** 2 + (bMean - 128) ** 2) / 110;

  // Color diversity: how many distinct quantized colors (capped at 1)
  const diversity = Math.min(colorSet.size / 2048, 1);

  // Brightness balance: prefer mid-range, penalize pure black or white
  const brightness = (rMean + gMean + bMean) / 3 / 255;
  const brightnessScore = 1 - Math.abs(brightness - 0.5) * 2;

  const score = Math.min(saturation * 0.35 + diversity * 0.45 + brightnessScore * 0.2, 1);
  return { score, passed: score >= PASS_THRESHOLD };
}
