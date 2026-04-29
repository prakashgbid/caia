/**
 * @chiefaia/agent-contract-registry — registry.ts (ACR-002)
 *
 * The contract registry is a process-local, in-memory store of
 * `SectionContract` objects keyed by `contractId`. It's deliberately
 * mutable at startup (so each agent's `*-agent.contract.ts` can register
 * its contract on import) but immutable in steady-state runtime — the
 * Validator's per-scope composed template is cached against the registry's
 * `signature` and invalidated only on registry mutation.
 *
 * Why a class — testability. Tests can construct a fresh `ContractRegistry`
 * to avoid cross-test bleed via the shared global. Production code uses
 * `getDefaultRegistry()` which returns a singleton.
 *
 * Why no I/O — the registry holds in-memory contracts only. Persistence
 * is unnecessary: contracts are code, versioned in git, and registered on
 * import. There is no "user-uploaded contract" pattern in Phase 1.
 */

import type { AgentRole, SectionContract } from '@chiefaia/ticket-template';

export interface RegistryEntry {
  contract: SectionContract;
  /** Order of registration — used for deterministic ordering when contracts share an agent role. */
  registrationIndex: number;
}

export class ContractRegistry {
  private entries: Map<string, RegistryEntry> = new Map();
  private nextIndex = 0;

  /**
   * Register a contract. Throws if a contract with the same `contractId`
   * is already registered — this catches accidental double-import bugs.
   * Use `replace()` if intentional override is needed (e.g. test setup).
   */
  register(contract: SectionContract): void {
    if (this.entries.has(contract.contractId)) {
      throw new Error(
        `[agent-contract-registry] contract '${contract.contractId}' is already registered. Use replace() for overrides.`,
      );
    }
    this.entries.set(contract.contractId, {
      contract,
      registrationIndex: this.nextIndex++,
    });
  }

  /**
   * Replace a contract — overwrites if present, registers if absent.
   * Useful for test setup and hot-reload in dev. Production code should
   * prefer `register()`.
   */
  replace(contract: SectionContract): void {
    const existing = this.entries.get(contract.contractId);
    const registrationIndex = existing?.registrationIndex ?? this.nextIndex++;
    this.entries.set(contract.contractId, { contract, registrationIndex });
  }

  /** Remove a contract. Returns true if removed, false if absent. */
  unregister(contractId: string): boolean {
    return this.entries.delete(contractId);
  }

  /** All registered contracts in registration order. */
  list(): readonly SectionContract[] {
    return [...this.entries.values()]
      .sort((a, b) => a.registrationIndex - b.registrationIndex)
      .map((e) => e.contract);
  }

  /** All contracts owned by a given agent role. */
  listByAgent(ownerAgent: AgentRole): readonly SectionContract[] {
    return this.list().filter((c) => c.ownerAgent === ownerAgent);
  }

  /** Lookup a contract by ID. */
  get(contractId: string): SectionContract | undefined {
    return this.entries.get(contractId)?.contract;
  }

  /** Number of registered contracts. */
  size(): number {
    return this.entries.size;
  }

  /** Empty the registry. Test-only — production code should never clear. */
  clear(): void {
    this.entries.clear();
    this.nextIndex = 0;
  }
}

// ─── Default singleton ──────────────────────────────────────────────────────

let defaultRegistry: ContractRegistry | null = null;

/** Process-singleton registry. Production code should use this. */
export function getDefaultRegistry(): ContractRegistry {
  if (!defaultRegistry) defaultRegistry = new ContractRegistry();
  return defaultRegistry;
}

/** Reset the default singleton. Test-only. */
export function resetDefaultRegistry(): void {
  defaultRegistry = null;
}
