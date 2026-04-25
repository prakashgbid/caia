// @pokerzeno/image-provider — public library API

// Manifest
export {
  ImageRecordSchema,
  getAllImages,
  getImageById,
  addImage,
  appendUsage,
  getImagesBySite,
  findSimilarByQuery,
  generateId,
} from './manifest/index.js';
export type { ImageRecord, ImageUsage } from './manifest/index.js';

// Site helper
export {
  getImageForSlot,
  renderImgTag,
  getSiteCredits,
} from './lib/site-helper.js';
export type { ImgTagData, CreditEntry } from './lib/site-helper.js';

// Storage
export { getStorage } from './storage/index.js';
export type { Storage, StorageVariants, UploadMeta } from './storage/index.js';

// Validation
export {
  validateImage,
  checkSharpness,
  checkClipRelevance,
  checkAesthetic,
  checkAiDetection,
  checkOcr,
} from './validation/index.js';
export type { ValidationResult } from './validation/index.js';

// Generators
export {
  generate,
  getTotalSpend,
  getRemainingBudget,
  getLedger,
  MODEL_COSTS,
} from './generators/index.js';
export type { FalModel, GeneratedImage, GeneratorOptions } from './generators/index.js';

// Sources
export { searchAllSources } from './sources/index.js';
export type { SourceImage } from './sources/types.js';

// Orchestrator
export { acquire, acquireVideo, quickHash } from './orchestrator/index.js';
export type { AcquireOptions, AcquireResult, AcquireVideoOptions } from './orchestrator/index.js';
