// Lazy OCR check using tesseract.js (loaded on demand to keep startup fast).
// Flags images with garbled text artifacts (watermarks, random glyphs).
// Loaded only when needed; skips gracefully on failure.

export interface OcrResult {
  hasGarbledText: boolean;
  passed: boolean;
  text?: string;
}

export async function checkOcr(buffer: Buffer): Promise<OcrResult> {
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    const { data } = await worker.recognize(buffer);
    await worker.terminate();

    const text = data.text.trim();
    if (!text) return { hasGarbledText: false, passed: true, text: '' };

    const alphaRatio = (text.match(/[a-zA-Z]/g)?.length ?? 0) / text.length;
    // Flag as garbled if text is present but mostly non-alphabetic (random glyphs / watermark noise)
    const hasGarbledText = text.length > 5 && alphaRatio < 0.5;

    return { hasGarbledText, passed: !hasGarbledText, text };
  } catch {
    return { hasGarbledText: false, passed: true };
  }
}
