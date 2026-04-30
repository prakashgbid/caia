import { describe, it, expect } from 'vitest';
import {
  ArchitecturalInstructionSchema,
  ArchitecturalInstructionV2Schema,
  type ArchitecturalInstruction,
  type ArchitecturalInstructionV2,
} from '../schema';

describe('ArchitecturalInstructionV2Schema', () => {
  describe('backward compatibility with V1', () => {
    it('parses a V1 instruction without new fields', () => {
      const v1Data = {
        id: 'inst_001',
        techSubDomain: 'backend',
        action: 'enhance',
        summary: 'Update API endpoint',
        details: 'Add new query parameter to /api/users endpoint',
        referencedArtifactIds: ['arch_apis/users'],
        confidence: 0.9,
      };

      const v1Result = ArchitecturalInstructionSchema.safeParse(v1Data);
      expect(v1Result.success).toBe(true);

      const v2Result = ArchitecturalInstructionV2Schema.safeParse(v1Data);
      expect(v2Result.success).toBe(true);
      if (v2Result.success) {
        expect(v2Result.data.existingArtifactReferences).toEqual([]);
        expect(v2Result.data.newArtifactSpecs).toEqual([]);
        expect(v2Result.data.integrationPoints).toEqual([]);
        expect(v2Result.data.risks).toEqual([]);
        expect(v2Result.data.testHooks).toEqual([]);
        expect(v2Result.data.crossCuttingConcerns).toEqual([]);
        expect(v2Result.data.candidateAdr).toBeUndefined();
      }
    });

    it('parses a full V2 instruction with all new fields', () => {
      const v2Data = {
        id: 'inst_002',
        techSubDomain: 'backend',
        action: 'create',
        summary: 'Billing webhook handler',
        details: 'Receive and process Stripe webhook events',
        referencedArtifactIds: [],
        existingArtifactReferences: [
          {
            artifactId: 'arch_integrations/stripe',
            role: 'use_as_is' as const,
            note: 'Use existing Stripe API integration',
          },
        ],
        newArtifactSpecs: [
          {
            proposedKind: 'api' as const,
            proposedName: 'POST /webhooks/stripe',
            proposedPath: 'apps/orchestrator/src/routes/webhooks/stripe.ts',
            toolingChoice: 'stripe',
            radarRing: 'adopt' as const,
          },
        ],
        integrationPoints: [
          {
            direction: 'inbound' as const,
            protocol: 'http' as const,
            targetArtifactId: 'arch_integrations/stripe',
            contract: 'POST /webhooks/stripe { type, data }',
          },
        ],
        risks: [
          {
            severity: 'high' as const,
            summary: 'Webhook signature validation failure',
            mitigation: 'Verify X-Stripe-Signature header before processing',
          },
        ],
        testHooks: [
          {
            kind: 'integration' as const,
            target: 'webhook handler receives and processes charge.succeeded event',
            rationale: 'Critical path for payment confirmation',
          },
        ],
        crossCuttingConcerns: ['retry' as const, 'error_handling' as const, 'audit_log' as const],
        candidateAdr: {
          title: 'Stripe webhook integration pattern',
          context: 'Webhooks are async, out-of-order, and may retry',
          decision: 'Store webhook in pending queue, process idempotently',
          consequences: ['Adds latency', 'Guarantees exactly-once delivery'],
        },
      };

      const result = ArchitecturalInstructionV2Schema.safeParse(v2Data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('inst_002');
        expect(result.data.existingArtifactReferences).toHaveLength(1);
        expect(result.data.newArtifactSpecs).toHaveLength(1);
        expect(result.data.integrationPoints).toHaveLength(1);
        expect(result.data.risks).toHaveLength(1);
        expect(result.data.testHooks).toHaveLength(1);
        expect(result.data.crossCuttingConcerns).toHaveLength(3);
        expect(result.data.candidateAdr?.title).toBe('Stripe webhook integration pattern');
      }
    });
  });

  describe('field validation', () => {
    it('rejects existingArtifactReferences with invalid role', () => {
      const bad = {
        id: 'inst_003',
        techSubDomain: 'backend',
        action: 'enhance',
        summary: 'test',
        details: 'test',
        existingArtifactReferences: [
          {
            artifactId: 'arch_test',
            role: 'invalid_role',
          },
        ],
      };
      const result = ArchitecturalInstructionV2Schema.safeParse(bad);
      expect(result.success).toBe(false);
    });

    it('rejects integrationPoints with invalid protocol', () => {
      const bad = {
        id: 'inst_004',
        techSubDomain: 'backend',
        action: 'create',
        summary: 'test',
        details: 'test',
        integrationPoints: [
          {
            direction: 'inbound' as const,
            protocol: 'invalid_proto',
            contract: 'test',
          },
        ],
      };
      const result = ArchitecturalInstructionV2Schema.safeParse(bad);
      expect(result.success).toBe(false);
    });

    it('rejects risks with invalid severity', () => {
      const bad = {
        id: 'inst_005',
        techSubDomain: 'backend',
        action: 'create',
        summary: 'test',
        details: 'test',
        risks: [
          {
            severity: 'catastrophic',
            summary: 'test risk',
            mitigation: 'test mitigation',
          },
        ],
      };
      const result = ArchitecturalInstructionV2Schema.safeParse(bad);
      expect(result.success).toBe(false);
    });

    it('rejects testHooks with invalid kind', () => {
      const bad = {
        id: 'inst_006',
        techSubDomain: 'backend',
        action: 'create',
        summary: 'test',
        details: 'test',
        testHooks: [
          {
            kind: 'manual',
            target: 'test',
            rationale: 'test',
          },
        ],
      };
      const result = ArchitecturalInstructionV2Schema.safeParse(bad);
      expect(result.success).toBe(false);
    });

    it('rejects crossCuttingConcerns with invalid enum values', () => {
      const bad = {
        id: 'inst_007',
        techSubDomain: 'backend',
        action: 'create',
        summary: 'test',
        details: 'test',
        crossCuttingConcerns: ['auth', 'unknown_concern'],
      };
      const result = ArchitecturalInstructionV2Schema.safeParse(bad);
      expect(result.success).toBe(false);
    });
  });

  describe('default empty arrays', () => {
    const minimalV2 = {
      id: 'inst_008',
      techSubDomain: 'database',
      action: 'create',
      summary: 'New schema',
      details: 'Add users table',
    };

    it('defaults existingArtifactReferences to []', () => {
      const result = ArchitecturalInstructionV2Schema.safeParse(minimalV2);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.existingArtifactReferences).toEqual([]);
      }
    });

    it('defaults newArtifactSpecs to []', () => {
      const result = ArchitecturalInstructionV2Schema.safeParse(minimalV2);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.newArtifactSpecs).toEqual([]);
      }
    });

    it('defaults integrationPoints to []', () => {
      const result = ArchitecturalInstructionV2Schema.safeParse(minimalV2);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.integrationPoints).toEqual([]);
      }
    });

    it('defaults risks to []', () => {
      const result = ArchitecturalInstructionV2Schema.safeParse(minimalV2);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.risks).toEqual([]);
      }
    });

    it('defaults testHooks to []', () => {
      const result = ArchitecturalInstructionV2Schema.safeParse(minimalV2);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.testHooks).toEqual([]);
      }
    });

    it('defaults crossCuttingConcerns to []', () => {
      const result = ArchitecturalInstructionV2Schema.safeParse(minimalV2);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.crossCuttingConcerns).toEqual([]);
      }
    });

    it('defaults candidateAdr to undefined', () => {
      const result = ArchitecturalInstructionV2Schema.safeParse(minimalV2);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.candidateAdr).toBeUndefined();
      }
    });
  });
});
