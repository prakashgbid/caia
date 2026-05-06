/**
 * Resolve config defaults. CAIA-default paths are anchored to
 * ~/Documents/projects/apprentice/ — same root the trainer writes
 * adapters under, so registry + canary-routing live alongside.
 */

import { homedir } from 'node:os';
import * as path from 'node:path';
import type {
  ApprenticeServingConfig,
  AdapterRegistryConfig,
  CanaryRouterConfig,
  ResolvedServingConfig,
  ResolvedAdapterRegistryConfig,
  ResolvedCanaryRouterConfig
} from './types.js';
import { DefaultFsAccess } from './fs-access.js';

export function expandHome(p: string): string {
  if (p.startsWith('~/')) return path.join(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

const DEFAULT_REGISTRY_PATH = '~/Documents/projects/apprentice/registry.json';
const DEFAULT_CANARY_ROUTING_PATH = '~/Documents/projects/apprentice/canary-routing.json';

export function resolveServingConfig(cfg: ApprenticeServingConfig = {}): ResolvedServingConfig {
  const fs = cfg.fs ?? new DefaultFsAccess();
  const clock = cfg.clock ?? (() => new Date());
  const resolved: ResolvedServingConfig = {
    registryPath: expandHome(cfg.registryPath ?? DEFAULT_REGISTRY_PATH),
    canaryRoutingConfigPath: expandHome(cfg.canaryRoutingConfigPath ?? DEFAULT_CANARY_ROUTING_PATH),
    ollamaBinaryPath: cfg.ollamaBinaryPath ?? 'ollama',
    productionModelName: cfg.productionModelName ?? ((b: string) => `${b}-production`),
    canaryModelName: cfg.canaryModelName ?? ((b: string, s: string) => `${b}-canary-${s}`),
    shadowModelName: cfg.shadowModelName ?? ((b: string, s: string) => `${b}-shadow-${s}`),
    maxArchivedToKeep: cfg.maxArchivedToKeep ?? 10,
    fs,
    clock,
    ollamaTimeoutMs: cfg.ollamaTimeoutMs ?? 5 * 60 * 1000
  };
  if (cfg.ollamaClient !== undefined) resolved.ollamaClient = cfg.ollamaClient;
  if (cfg.ollamaHost !== undefined) resolved.ollamaHost = cfg.ollamaHost;
  return resolved;
}

export function resolveAdapterRegistryConfig(
  cfg: AdapterRegistryConfig = {}
): ResolvedAdapterRegistryConfig {
  return {
    registryPath: expandHome(cfg.registryPath ?? DEFAULT_REGISTRY_PATH),
    fs: cfg.fs ?? new DefaultFsAccess(),
    clock: cfg.clock ?? (() => new Date())
  };
}

export function resolveCanaryRouterConfig(
  cfg: CanaryRouterConfig = {}
): ResolvedCanaryRouterConfig {
  return {
    canaryRoutingConfigPath: expandHome(
      cfg.canaryRoutingConfigPath ?? DEFAULT_CANARY_ROUTING_PATH
    ),
    fs: cfg.fs ?? new DefaultFsAccess(),
    clock: cfg.clock ?? (() => new Date())
  };
}

/** baseModel "qwen2.5-coder:7b" → "qwen2.5-coder-7b". */
export function baseShortName(baseModelOllamaTag: string): string {
  return baseModelOllamaTag
    .toLowerCase()
    .replace(/:/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
