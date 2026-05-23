/**
 * Server-side engine singleton.
 *
 * Production wires a Postgres-backed store + the Infisical secrets
 * adapter; dev / e2e wires the in-memory store + a no-op secrets
 * adapter that returns a synthetic secretRef.
 *
 * The singleton is stashed on `globalThis` so Next's dev-mode HMR
 * (which sometimes re-instantiates module-level state) doesn't wipe
 * onboarding progress across requests.
 */

import {
  InMemoryOnboardingStore,
  OnboardingEngine,
  type SecretsPutter,
} from '@caia/onboarding';

class StubSecretsPutter implements SecretsPutter {
  async put(
    tenantId: string,
    category: string,
    key: string,
  ): Promise<{ secretRef: string; version: number }> {
    return {
      secretRef: `infisical://tenants/${tenantId}/${category}/${key}@v1`,
      version: 1,
    };
  }
}

interface EngineGlobals {
  __caiaOnboardingStore?: InMemoryOnboardingStore;
  __caiaOnboardingEngine?: OnboardingEngine;
}

function globalState(): EngineGlobals {
  return globalThis as unknown as EngineGlobals;
}

export function getEngine(): { engine: OnboardingEngine; store: InMemoryOnboardingStore } {
  const g = globalState();
  if (!g.__caiaOnboardingEngine || !g.__caiaOnboardingStore) {
    g.__caiaOnboardingStore = new InMemoryOnboardingStore();
    g.__caiaOnboardingEngine = new OnboardingEngine({
      store: g.__caiaOnboardingStore,
      secrets: new StubSecretsPutter(),
      infisicalBaseUrl:
        process.env['INFISICAL_BASE_URL'] ?? 'https://infisical.chiefaia.com',
    });
  }
  return {
    engine: g.__caiaOnboardingEngine,
    store: g.__caiaOnboardingStore,
  };
}

export function _resetEngineForTest(): void {
  const g = globalState();
  delete g.__caiaOnboardingEngine;
  delete g.__caiaOnboardingStore;
}
