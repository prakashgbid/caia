import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { checkSharpness } from '../../src/validation/sharpness.js';
import { checkAesthetic } from '../../src/validation/aesthetic.js';
import { checkAiDetection } from '../../src/validation/ai-detector.js';

// Generate synthetic test images in-process — no network required
async function makeImage(width: number, height: number, variant: 'noise' | 'flat' | 'gradient' = 'noise'): Promise<Buffer> {
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let i = 0; i < data.length; i += channels) {
    if (variant === 'noise') {
      data[i] = Math.floor(Math.random() * 255);
      data[i + 1] = Math.floor(Math.random() * 255);
      data[i + 2] = Math.floor(Math.random() * 255);
    } else if (variant === 'flat') {
      data[i] = 128; data[i + 1] = 128; data[i + 2] = 128;
    } else {
      const x = (i / channels) % width;
      data[i] = Math.floor((x / width) * 255);
      data[i + 1] = 100;
      data[i + 2] = 200;
    }
  }
  return sharp(data, { raw: { width, height, channels } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe('Sharpness validator', () => {
  it('rejects images below 1600px on the longest edge', async () => {
    const buf = await makeImage(800, 600);
    const result = await checkSharpness(buf);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/Too small/);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it('accepts a large noisy image (high variance = sharp)', async () => {
    const buf = await makeImage(1920, 1080, 'noise');
    const result = await checkSharpness(buf);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.score).toBeGreaterThan(0);
    // Noisy image should have reasonably high variance
    expect(result.score).toBeGreaterThan(50);
  });

  it('rejects a flat grey image (no variance = blurry)', async () => {
    const buf = await makeImage(2000, 1500, 'flat');
    const result = await checkSharpness(buf);
    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(80);
  });

  it('reports correct dimensions', async () => {
    const buf = await makeImage(3000, 2000, 'noise');
    const result = await checkSharpness(buf);
    expect(result.width).toBe(3000);
    expect(result.height).toBe(2000);
  });
});

describe('Aesthetic validator', () => {
  it('returns a score between 0 and 1', async () => {
    const buf = await makeImage(512, 512, 'noise');
    const result = await checkAesthetic(buf);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('gives a low score to flat grey image (no saturation/diversity)', async () => {
    const buf = await makeImage(512, 512, 'flat');
    const result = await checkAesthetic(buf);
    expect(result.score).toBeLessThan(0.5);
  });

  it('gives a higher score to colorful noisy image', async () => {
    const buf = await makeImage(512, 512, 'noise');
    const result = await checkAesthetic(buf);
    expect(result.score).toBeGreaterThan(0.2);
  });
});

describe('AI detector stub', () => {
  it('always returns passed:true and score:0 (stub)', async () => {
    const buf = await makeImage(256, 256, 'noise');
    const result = await checkAiDetection(buf);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0);
  });
});
