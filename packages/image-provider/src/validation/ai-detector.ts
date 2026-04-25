// AI-image detection stub.
// TODO: Wire up umm-maybe/AI-image-detector (or similar ONNX model) via @xenova/transformers
// when a Node-compatible build is available.
//
// For AI-generated images (FLUX outputs), a score > 0.85 should trigger rejection
// if they look obviously synthetic (which would undermine trust in the imagery).

export interface AiDetectorResult {
  score: number; // 0 = looks real, 1 = looks AI-generated
  passed: boolean;
}

export async function checkAiDetection(_buffer: Buffer): Promise<AiDetectorResult> {
  // Stub: always passes. Web images are real; AI images from FLUX are expected to look real.
  return { score: 0, passed: true };
}
