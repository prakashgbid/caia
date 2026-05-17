/**
 * Shared types for the A2A adapter. Intentionally minimal so consumers don't
 * leak transitive @a2a-js/sdk types into their public surface.
 */

export type A2AAgentId = string;

/** An A2A Task envelope — sent to an agent's `tasks/send` JSON-RPC method. */
export interface A2ATaskRequest {
  taskId: string;
  contextId: string;
  /** Free-form input — for SQL it's `{ task: 'NL query', schema: '...' }` */
  input: Record<string, unknown>;
}

/** The A2A response carries an Artifact + status. */
export interface A2ATaskResponse {
  taskId: string;
  contextId: string;
  status: 'done' | 'streaming' | 'error';
  artifact?: A2AArtifact;
  error?: { code: number; message: string };
}

/** A2A Artifact extended with CAIA provenance fields per §4.3. */
export interface A2AArtifact {
  artifactId: string;
  kind: 'sql' | 'code' | 'mockup' | 'review' | 'plan' | 'text';
  body: Record<string, unknown>;
  producerModel: string;
  producerVersion?: string;
  reviewerModel?: string;
  evidenceGateRun?: string;
  caiaChainRunId?: string;
  caiaPhaseStepId?: string;
  parentArtifactId?: string;
  createdAt: string; // ISO-8601
}
