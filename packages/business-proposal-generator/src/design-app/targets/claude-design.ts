/** Claude Design (CD ZIP) target generator — locked V1 path. */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ProposalGeneratorError } from '../../errors.js';
import { extractJsonObject, type LlmCaller } from '../../llm.js';
import type { IaArtifactSet } from '../../types/ia.js';
import type { BusinessPlanV2, TargetName } from '../../types/proposal.js';
import type { DesignAppPromptOutput } from '../../types/design-app.js';
import { buildDeepLink } from '../deep-links.js';
import { parseDesignAppPromptOutput } from '../envelope.js';
import type { GeneratorRenderInput, IDesignAppPromptGenerator } from '../generator-interface.js';

export interface ClaudeDesignGeneratorOptions {
  llmCaller: LlmCaller;
  skillsRoot: string;
}

export class ClaudeDesignGenerator implements IDesignAppPromptGenerator {
  public readonly target: TargetName = 'claude_design';
  public readonly skillPath: string;
  private readonly llmCaller: LlmCaller;
  private skillBodyCache: string | null = null;

  public constructor(opts: ClaudeDesignGeneratorOptions) {
    this.llmCaller = opts.llmCaller;
    this.skillPath = join(opts.skillsRoot, 'claude-design');
  }

  public async render(input: GeneratorRenderInput): Promise<DesignAppPromptOutput> {
    const skillBody = await this.loadSkill();
    const userPrompt = buildUserPrompt(input);
    const result = await this.llmCaller.call(userPrompt, {
      systemPrompt: skillBody,
      modelHint: 'sonnet',
      maxBudgetMs: 180_000,
    });
    if (!result.ok) {
      throw new ProposalGeneratorError(
        'llm_call_failed',
        'claude-design generator failed',
        undefined,
        { target: 'claude_design', diagnostic: result.diagnostic },
      );
    }
    const json = extractJsonObject(result.text);
    const envelope = parseDesignAppPromptOutput(json);
    if (envelope.target !== 'claude_design') {
      throw new ProposalGeneratorError(
        'envelope_invalid',
        `expected target=claude_design; got '${envelope.target}'`,
      );
    }
    // Force a stable deep-link (even if the model emitted one, we own the URL pattern).
    return { ...envelope, deep_link_url: buildDeepLink('claude_design', envelope.prompt_text) };
  }

  private async loadSkill(): Promise<string> {
    if (this.skillBodyCache !== null) return this.skillBodyCache;
    const skillMdPath = join(this.skillPath, 'SKILL.md');
    const templatePath = join(this.skillPath, 'template.md');
    const [skillMd, template] = await Promise.all([
      readFile(skillMdPath, 'utf8').catch(
        (err: NodeJS.ErrnoException) => {
          throw new ProposalGeneratorError(
            'validation_failed',
            `claude-design SKILL.md not found at ${skillMdPath}`,
            err,
          );
        },
      ),
      readFile(templatePath, 'utf8').catch(() => ''),
    ]);
    const body = template.length > 0
      ? `${skillMd}\n\n# Canonical template (fill placeholders with plan values)\n\n${template}`
      : skillMd;
    this.skillBodyCache = body;
    return body;
  }
}

function buildUserPrompt(input: GeneratorRenderInput): string {
  const pieces: string[] = [
    'Render a CD-target design prompt that captures every committed decision in the BusinessPlanV2 and IA artifacts.',
    'Return ONLY a JSON object that validates against DesignAppPromptOutput. No code fences, no preface.',
    'Set target="claude_design" and prompt_text to the full structured brief.',
    'Set prompt_metadata.palette, type_pairing, motion_preference, platform_strategy from the IA design-system artifact.',
    'Set instructions_for_customer to a 1-2 sentence "paste this into claude.ai" hint.',
  ];
  if (input.previousFindings) {
    pieces.push('\nReviewer findings from the previous pass — address each:');
    pieces.push(JSON.stringify(input.previousFindings).slice(0, 4000));
  }
  pieces.push('\n## Business plan (full JSON)');
  pieces.push(JSON.stringify(input.plan).slice(0, 30000));
  pieces.push('\n## IA artifacts (full JSON)');
  pieces.push(JSON.stringify(input.ia).slice(0, 30000));
  if (input.tenantContext) {
    pieces.push('\n## Tenant context');
    pieces.push(JSON.stringify(input.tenantContext).slice(0, 5000));
  }
  return pieces.join('\n');
}

export function buildClaudeDesignUserPromptForTests(
  plan: BusinessPlanV2,
  ia: IaArtifactSet,
): string {
  return buildUserPrompt({ plan, ia });
}
