/**
 * Read + validate <adapterPath>/training-metadata.json (mandatory) and
 * <adapterPath>/eval-report.json (optional). Compute the metadata sha256
 * for cross-run identity.
 */

import { createHash } from 'node:crypto';
import * as path from 'node:path';
import {
  AdapterNotFoundError,
  MetadataMalformedError
} from './types.js';
import type {
  EvalReportRead,
  EvalSummary,
  FsAccess,
  TrainingMetadataRead
} from './types.js';

export interface AdapterArtifacts {
  adapterPath: string;
  /** Absolute path to <adapterPath>/Modelfile. */
  modelfilePath: string;
  /** Absolute path to <adapterPath>/adapters.safetensors. */
  adapterFile: string;
  /** Absolute path to <adapterPath>/adapter_config.json. */
  adapterConfigFile: string;
  /** Absolute path to <adapterPath>/training-metadata.json. */
  metadataPath: string;
  metadata: TrainingMetadataRead;
  metadataSha256: string;
  evalReport?: EvalSummary;
}

/** Mandatory artifacts that must exist in the adapter dir. */
const MANDATORY_FILES = ['Modelfile', 'adapters.safetensors', 'adapter_config.json', 'training-metadata.json'] as const;

export function readAdapterArtifacts(fs: FsAccess, adapterPath: string): AdapterArtifacts {
  if (!fs.exists(adapterPath)) {
    throw new AdapterNotFoundError(`adapterPath not found: ${adapterPath}`, { adapterPath });
  }
  for (const f of MANDATORY_FILES) {
    const p = path.join(adapterPath, f);
    if (!fs.exists(p)) {
      throw new AdapterNotFoundError(
        `adapter dir is missing mandatory file ${f}: ${p}`,
        { adapterPath, missing: f }
      );
    }
  }

  const metadataPath = path.join(adapterPath, 'training-metadata.json');
  const metadataRaw = fs.readFile(metadataPath);
  const metadataSha256 = createHash('sha256').update(metadataRaw).digest('hex');

  let metadata: TrainingMetadataRead;
  try {
    metadata = JSON.parse(metadataRaw) as TrainingMetadataRead;
  } catch (e) {
    throw new MetadataMalformedError(
      `training-metadata.json is not valid JSON: ${(e as Error).message}`,
      { metadataPath }
    );
  }

  validateMetadata(metadata, metadataPath);

  const result: AdapterArtifacts = {
    adapterPath,
    modelfilePath: path.join(adapterPath, 'Modelfile'),
    adapterFile: path.join(adapterPath, 'adapters.safetensors'),
    adapterConfigFile: path.join(adapterPath, 'adapter_config.json'),
    metadataPath,
    metadata,
    metadataSha256
  };

  // eval-report.json is optional.
  const evalPath = path.join(adapterPath, 'eval-report.json');
  if (fs.exists(evalPath)) {
    try {
      const raw = fs.readFile(evalPath);
      const parsed = JSON.parse(raw) as EvalReportRead;
      const summary = extractEvalSummary(parsed);
      if (summary !== undefined) result.evalReport = summary;
    } catch {
      // Treat malformed eval-report as absent; the eval gate is Phase 4's
      // concern, and we don't want a malformed sidecar to block registration.
    }
  }

  return result;
}

function validateMetadata(m: TrainingMetadataRead, metadataPath: string): void {
  const required = ['version', 'baseModel', 'baseModelOllamaTag', 'configSha256'] as const;
  const missing = required.filter((k) => m[k] === undefined || m[k] === null);
  if (missing.length > 0) {
    throw new MetadataMalformedError(
      `training-metadata.json is missing required fields: ${missing.join(', ')}`,
      { metadataPath, missing }
    );
  }
  if (typeof m.baseModel !== 'string' || m.baseModel.length === 0) {
    throw new MetadataMalformedError('baseModel must be a non-empty string', { metadataPath });
  }
  if (typeof m.baseModelOllamaTag !== 'string' || m.baseModelOllamaTag.length === 0) {
    throw new MetadataMalformedError('baseModelOllamaTag must be a non-empty string', { metadataPath });
  }
  if (typeof m.configSha256 !== 'string' || m.configSha256.length === 0) {
    throw new MetadataMalformedError('configSha256 must be a non-empty string', { metadataPath });
  }
}

export function extractEvalSummary(report: EvalReportRead): EvalSummary | undefined {
  const entry = report.adapters?.[0];
  if (!entry) return undefined;
  const winRate = typeof entry.winRate === 'number' ? entry.winRate : NaN;
  const decision = typeof entry.decision === 'string' ? entry.decision : 'unknown';
  const regressionFlags = Array.isArray(entry.regressionFlags)
    ? entry.regressionFlags.filter((s): s is string => typeof s === 'string')
    : [];
  if (Number.isNaN(winRate)) return undefined;
  return { winRate, decision, regressionFlags };
}
