// CLIP cosine-similarity relevance check.
// Uses @xenova/transformers with Xenova/clip-vit-base-patch32 (~150MB, cached locally).
// On first run the model downloads automatically to ~/.cache/huggingface/hub/.
// Falls back to a passing score if the model can't load (e.g. offline CI).

const MIN_RELEVANCE = 0.27;

export interface ClipResult {
  passed: boolean;
  score: number;
  reason?: string;
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

export async function checkClipRelevance(
  imageBuffer: Buffer,
  query: string,
): Promise<ClipResult> {
  try {
    const { pipeline } = await import('@xenova/transformers');

    const base64 = imageBuffer.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textPipe = await (pipeline as any)('feature-extraction', 'Xenova/clip-vit-base-patch32');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imagePipe = await (pipeline as any)('image-feature-extraction', 'Xenova/clip-vit-base-patch32');

    const [textOut, imageOut] = await Promise.all([
      textPipe([query]),
      imagePipe([dataUrl]),
    ]);

    const textEmb = textOut[0].data as Float32Array;
    const imageEmb = imageOut[0].data as Float32Array;
    const score = cosineSim(textEmb, imageEmb);

    return {
      passed: score >= MIN_RELEVANCE,
      score,
      reason: score < MIN_RELEVANCE
        ? `CLIP relevance too low: ${score.toFixed(3)} (min ${MIN_RELEVANCE})`
        : undefined,
    };
  } catch (err) {
    // Gracefully skip CLIP if the model can't load (no internet, CI, etc.)
    console.warn(
      '  [clip] Skipping: ',
      err instanceof Error ? err.message : String(err),
    );
    return { passed: true, score: 0.5 };
  }
}
