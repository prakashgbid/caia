/**
 * Re-exports for the `@chiefaia/librarian` backend abstraction.
 *
 * Two backends today:
 *   - `'sqlite-vec'` (Phase-1 default) lives in the existing
 *     `index-builder.ts` + `retrieve.ts` modules.
 *   - `'mem0'` is the new Mem0-backed alternative shipped per
 *     validation decision #4.
 *
 * The dispatcher functions (`buildIndexWithBackend`,
 * `retrieveWithBackend`, `prependWithBackend`) accept an optional
 * `backend?: LibrarianBackendName` parameter and pick the right
 * implementation. The Phase-1 public functions (`buildIndex`,
 * `retrievePrecedent`, `prependPrecedent`) remain untouched.
 *
 * For library callers that want to talk to a backend directly, both
 * the dispatcher and the Mem0 surface are exported from this module.
 */

export {
  DEFAULT_BACKEND,
  isLibrarianBackendName,
  type LibrarianBackendName
} from './types.js';

export {
  Mem0Backend,
  buildMem0Index,
  retrieveMem0Precedent,
  buildMem0Config,
  defaultMemoryFactory,
  MEM0_INDEX_DB_FILENAME,
  MEM0_HISTORY_DB_FILENAME,
  DEFAULT_MEM0_USER_ID,
  DEFAULT_OLLAMA_URL as MEM0_DEFAULT_OLLAMA_URL,
  DEFAULT_EMBED_MODEL as MEM0_DEFAULT_EMBED_MODEL,
  DEFAULT_EMBED_DIM as MEM0_DEFAULT_EMBED_DIM,
  DEFAULT_EXTRACTION_MODEL as MEM0_DEFAULT_EXTRACTION_MODEL,
  DEFAULT_MEM0_MIN_SIMILARITY,
  DEFAULT_MEM0_TOP_N,
  type BuildMem0IndexOptions,
  type RetrieveMem0PrecedentOptions,
  type Mem0BackendOptions,
  type Mem0MemoryFactory,
  type Mem0MemoryLike
} from './mem0-backend.js';

export {
  buildIndexWithBackend,
  retrieveWithBackend,
  prependWithBackend,
  type BuildIndexWithBackendOptions,
  type RetrieveWithBackendOptions,
  type PrependWithBackendOptions
} from './dispatcher.js';
