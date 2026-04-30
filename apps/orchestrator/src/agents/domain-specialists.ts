/**
 * Domain Specialists — Stage 2 of the EA Multi-Domain Decomposition mesh.
 *
 * Six specialist agents run in parallel, each consulting the AKG for their domain.
 * Each produces an ArchitecturalInstructionV2 with concrete artifacts, integration points,
 * risks, and test hooks specific to their domain.
 */

import { z } from 'zod';
import {
  ArchitecturalInstructionV2Schema,
  type ArchitecturalInstructionV2,
  type TicketBundle,
} from '@chiefaia/ticket-template';
import {
  findUIArtifacts,
  findBackendArtifacts,
  findDBArtifacts,
  findIntegrationArtifacts,
  findAcrossDomains,
} from '@chiefaia/architecture-registry';
import { route } from '@chiefaia/local-llm-router';
import type { MacroDomain } from './domain-triage';

// ─── Specialist implementations ────────────────────────────────────────────────

export interface SpecialistOptions {
  topK?: number;
  forceLocal?: boolean;
}

export async function uiSpecialist(
  ticketData: TicketBundle,
  options: SpecialistOptions = {},
): Promise<ArchitecturalInstructionV2 | null> {
  const topK = options.topK ?? 5;
  const query = `${ticketData.story.title}\n${ticketData.story.description || ''}`;

  try {
    const uiHits = await findUIArtifacts({
      query,
      limit: topK,
      embedModel: 'all-MiniLM-L6-v2',
    });

    const prompt = `You are a UI/Frontend specialist architect. Query the AKG and propose UI artifacts (components, pages, design specs). Story: ${query}\n\nExisting UI artifacts: ${uiHits.map((h) => h.title).join(', ') || 'none'}`;

    const response = await route('ui-specialist', prompt, { forceLocal: options.forceLocal });
    const parsed = JSON.parse(response.text);
    return ArchitecturalInstructionV2Schema.parse(parsed);
  } catch (err) {
    console.warn('[ui-specialist] failed:', err);
    return null;
  }
}

export async function backendSpecialist(
  ticketData: TicketBundle,
  options: SpecialistOptions = {},
): Promise<ArchitecturalInstructionV2 | null> {
  const topK = options.topK ?? 5;
  const query = `${ticketData.story.title}\n${ticketData.story.description || ''}`;

  try {
    const backendHits = await findBackendArtifacts({
      query,
      limit: topK,
      embedModel: 'all-MiniLM-L6-v2',
    });

    const prompt = `You are a Backend/Services specialist architect. Query the AKG and propose services, routes, middleware. Story: ${query}\n\nExisting artifacts: ${backendHits.map((h) => h.title).join(', ') || 'none'}`;

    const response = await route('backend-specialist', prompt, { forceLocal: options.forceLocal });
    const parsed = JSON.parse(response.text);
    return ArchitecturalInstructionV2Schema.parse(parsed);
  } catch (err) {
    console.warn('[backend-specialist] failed:', err);
    return null;
  }
}

export async function dataSpecialist(
  ticketData: TicketBundle,
  options: SpecialistOptions = {},
): Promise<ArchitecturalInstructionV2 | null> {
  const topK = options.topK ?? 5;
  const query = `${ticketData.story.title}\n${ticketData.story.description || ''}`;

  try {
    const dbHits = await findDBArtifacts({
      query,
      limit: topK,
      embedModel: 'all-MiniLM-L6-v2',
    });

    const prompt = `You are a Data/Database specialist architect. Query the AKG and propose schemas, migrations. Story: ${query}\n\nExisting artifacts: ${dbHits.map((h) => h.title).join(', ') || 'none'}`;

    const response = await route('data-specialist', prompt, { forceLocal: options.forceLocal });
    const parsed = JSON.parse(response.text);
    return ArchitecturalInstructionV2Schema.parse(parsed);
  } catch (err) {
    console.warn('[data-specialist] failed:', err);
    return null;
  }
}

export async function platformSpecialist(
  ticketData: TicketBundle,
  options: SpecialistOptions = {},
): Promise<ArchitecturalInstructionV2 | null> {
  const topK = options.topK ?? 5;
  const query = `${ticketData.story.title}\n${ticketData.story.description || ''}`;

  try {
    const infraHits = await findAcrossDomains({
      query,
      limit: topK,
      embedModel: 'all-MiniLM-L6-v2',
    });

    const prompt = `You are a Platform/Infrastructure specialist architect. Query the AKG and propose observability, deployment, CI/CD. Story: ${query}\n\nExisting artifacts: ${infraHits.map((h) => h.title).join(', ') || 'none'}`;

    const response = await route('platform-specialist', prompt, { forceLocal: options.forceLocal });
    const parsed = JSON.parse(response.text);
    return ArchitecturalInstructionV2Schema.parse(parsed);
  } catch (err) {
    console.warn('[platform-specialist] failed:', err);
    return null;
  }
}

export async function qualitySecuritySpecialist(
  ticketData: TicketBundle,
  options: SpecialistOptions = {},
): Promise<ArchitecturalInstructionV2 | null> {
  const query = `${ticketData.story.title}\n${ticketData.story.description || ''}`;

  try {
    const prompt = `You are a QA/Security specialist architect. Propose test cases, security controls, compliance. Story: ${query}`;

    const response = await route('quality-security-specialist', prompt, {
      forceLocal: options.forceLocal,
    });
    const parsed = JSON.parse(response.text);
    return ArchitecturalInstructionV2Schema.parse(parsed);
  } catch (err) {
    console.warn('[quality-security-specialist] failed:', err);
    return null;
  }
}

export async function integrationsSpecialist(
  ticketData: TicketBundle,
  options: SpecialistOptions = {},
): Promise<ArchitecturalInstructionV2 | null> {
  const topK = options.topK ?? 5;
  const query = `${ticketData.story.title}\n${ticketData.story.description || ''}`;

  try {
    const integrationHits = await findIntegrationArtifacts({
      query,
      limit: topK,
      embedModel: 'all-MiniLM-L6-v2',
    });

    const prompt = `You are an Integrations specialist architect. Query the AKG and propose SDKs, webhooks, external integrations. Story: ${query}\n\nExisting artifacts: ${integrationHits.map((h) => h.title).join(', ') || 'none'}`;

    const response = await route('integrations-specialist', prompt, { forceLocal: options.forceLocal });
    const parsed = JSON.parse(response.text);
    return ArchitecturalInstructionV2Schema.parse(parsed);
  } catch (err) {
    console.warn('[integrations-specialist] failed:', err);
    return null;
  }
}

// ─── Orchestration: run all specialists in parallel ──────────────────────────

export async function runSpecialists(
  ticketData: TicketBundle,
  inScopeDomains: MacroDomain[],
  options: SpecialistOptions = {},
): Promise<ArchitecturalInstructionV2[]> {
  const promises: Promise<ArchitecturalInstructionV2 | null>[] = [];

  for (const domain of inScopeDomains) {
    switch (domain) {
      case 'ui':
        promises.push(uiSpecialist(ticketData, options));
        break;
      case 'backend':
        promises.push(backendSpecialist(ticketData, options));
        break;
      case 'data':
        promises.push(dataSpecialist(ticketData, options));
        break;
      case 'platform':
        promises.push(platformSpecialist(ticketData, options));
        break;
      case 'quality-security':
        promises.push(qualitySecuritySpecialist(ticketData, options));
        break;
      case 'integrations':
        promises.push(integrationsSpecialist(ticketData, options));
        break;
    }
  }

  const results = await Promise.all(promises);
  return results.filter((r) => r !== null) as ArchitecturalInstructionV2[];
}
