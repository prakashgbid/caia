import { z } from 'zod';

const trimmed = (label: string) =>
  z
    .string()
    .min(1, { message: `${label} must be a non-empty string` })
    .refine((s) => s.trim().length > 0, { message: `${label} must not be blank` });

const externalAgentEntrySchema = z.object({
  name: trimmed('name'),
  repo: trimmed('repo'),
  capabilities: z.array(trimmed('capability')).default([]),
  suggested_call_sites: z.array(trimmed('suggested_call_site')).default([]),
});

export const externalAgentsFileSchema = z
  .object({
    version: z.literal(1),
    mcp_servers: z.array(externalAgentEntrySchema).default([]),
    agent_manifests: z.array(externalAgentEntrySchema).default([]),
  })
  .strict();

export type ExternalAgentEntry = z.infer<typeof externalAgentEntrySchema>;
export type ExternalAgentsFile = z.infer<typeof externalAgentsFileSchema>;

export type ExternalAgentKind = 'mcp_server' | 'agent_manifest';
