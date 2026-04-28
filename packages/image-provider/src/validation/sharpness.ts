import sharp from 'sharp';

const MIN_LONG_EDGE = 1600;
const MIN_SHARPNESS = 80;

export interface SharpnessResult {
  passed: boolean;
  score: number;
  width: number;
  height: number;
  reason?: string;
}

export async function checkSharpness(buffer: Buffer): Promise<SharpnessResult> {
  const image = sharp(buffer);
  const { width = 0, height = 0 } = await image.metadata();
  const longEdge = Math.max(width, height);

  if (longEdge < MIN_LONG_EDGE) {
    return {
      passed: false,
      score: 0,
      width,
      height,
      reason: `Too small: ${longEdge}px longest edge (min ${MIN_LONG_EDGE}px)`,
    };
  }

  // Compute pixel variance of grayscale image as a sharpness proxy.
  // High variance = more edge detail = sharper image.
  const gray = await sharp(buffer).grayscale().raw().toBuffer();
  const pixels = new Uint8Array(gray);
  let sum = 0;
  for (let i = 0; i < pixels.length; i++) sum += pixels[i]!;
  const mean = sum / pixels.length;
  let variance = 0;
  for (let i = 0; i < pixels.length; i++) variance += (pixels[i]! - mean) ** 2;
  variance /= pixels.length;

  // Normalize: variance of ~800+ is a sharp photo; map to 0-100 scale
  const score = Math.min((variance / 800) * 100, 200);

  return {
    passed: score >= MIN_SHARPNESS,
    score,
    width,
    height,
    reason: score < MIN_SHARPNESS ? `Low sharpness: ${score.toFixed(1)} (min ${MIN_SHARPNESS})` : undefined,
  };
}
