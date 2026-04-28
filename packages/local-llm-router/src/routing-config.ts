// Routing rules for @chiefaia/local-llm-router
// Determines which tasks go local vs Claude API

export interface RoutingRule {
  taskType: string;
  description: string;
  localModel: string;
  claudeModel?: string; // fallback if local fails
  useLocal: boolean;
  maxTokens: number;
  estimatedCostLocal: string; // per 1000 calls
  estimatedCostClaude: string; // per 1000 calls
}

export const ROUTING_RULES: RoutingRule[] = [
  // ALWAYS LOCAL - Simple pattern matching
  {
    taskType: 'domain-classification',
    description: 'Classify text into functional domains (auth, ui, api, etc.)',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 500,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.05',
  },
  {
    taskType: 'nature-classification',
    description: 'Classify task nature (feature/bug/refactor/chore)',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 300,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.03',
  },
  {
    taskType: 'embedding-generation',
    description: 'Generate text embeddings for similarity search',
    localModel: 'nomic-embed-text',
    useLocal: true,
    maxTokens: 2000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.20',
  },
  {
    taskType: 'dedup-check',
    description: 'Check if a requirement is similar to existing ones',
    localModel: 'qwen2.5-coder:7b',
    useLocal: true,
    maxTokens: 800,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.08',
  },

  // LOCAL PREFERRED - Story/requirement work
  {
    taskType: 'story-enrichment',
    description: 'Add acceptance criteria and implementation notes to a story',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 2000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.50',
  },
  {
    taskType: 'test-generation-simple',
    description: 'Generate unit tests for a simple function',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 3000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.75',
  },
  {
    taskType: 'code-implementation-simple',
    description: 'Implement a well-defined, scoped coding task (< 100 lines)',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 4000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$1.00',
  },
  {
    taskType: 'changelog-generation',
    description: 'Generate changelogs from git commits or task descriptions',
    localModel: 'llama3.1:8b',
    useLocal: true,
    maxTokens: 2000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.40',
  },
  {
    taskType: 'status-summarization',
    description: 'Summarize project status, task lists, progress reports',
    localModel: 'llama3.1:8b',
    useLocal: true,
    maxTokens: 2000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.40',
  },

  // CLAUDE ONLY - Complex tasks requiring deep reasoning
  {
    taskType: 'hierarchy-decomposition',
    description: 'Break a prompt into Initiative→Epic→Story→Task hierarchy',
    localModel: 'qwen2.5-coder:7b', // rule-based fallback only
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false,
    maxTokens: 8000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$2.00',
  },
  {
    taskType: 'architecture-decision',
    description: 'Make architectural decisions, produce ADRs',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-opus-4-6',
    useLocal: false,
    maxTokens: 6000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$3.00',
  },
  {
    taskType: 'code-implementation-complex',
    description:
      'Complex multi-file implementation, novel algorithms, system design',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false, // local quality not reliable enough for complex
    maxTokens: 16000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$4.00',
  },
  {
    taskType: 'security-review',
    description: 'Security audit, vulnerability analysis',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false,
    maxTokens: 8000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$2.00',
  },
];

export function getRoute(taskType: string): RoutingRule {
  const rule = ROUTING_RULES.find((r) => r.taskType === taskType);
  if (!rule) {
    // Default: use Claude Sonnet for unknown task types
    return {
      taskType,
      description: 'Unknown task type',
      localModel: 'qwen2.5-coder:7b',
      claudeModel: 'claude-sonnet-4-6',
      useLocal: false,
      maxTokens: 4000,
      estimatedCostLocal: '$0.00',
      estimatedCostClaude: '$1.00',
    };
  }
  return rule;
}

// Estimated monthly savings at 1000 agent invocations/day
export const COST_ANALYSIS = {
  withoutLocalLLM: '$600–$1,200/month (all Claude)',
  withLocalLLM: '$180–$360/month (30% Claude)',
  estimatedSavings: '$420–$840/month (65–70% reduction)',
  breakEven: 'Immediate (Ollama is free)',
};
