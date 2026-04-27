import { classify, classifyKeyword } from './classifier';

describe('classifyKeyword', () => {
  it('classifies auth-related text to auth domain', () => {
    const result = classifyKeyword('Add Google OAuth login with JWT tokens');
    expect(result.primaryDomain).toBe('auth');
    expect(result.nature).toBe('feature');
  });

  it('classifies bug reports correctly', () => {
    const result = classifyKeyword('Fix broken login form that crashes on submit');
    expect(result.nature).toBe('bug');
  });

  it('classifies UI work to ui-frontend', () => {
    const result = classifyKeyword('Create a responsive dashboard component with React');
    expect(result.primaryDomain).toBe('ui-frontend');
  });

  it('classifies database work correctly', () => {
    const result = classifyKeyword('Add migration to create users table with index');
    expect(result.primaryDomain).toBe('data-storage');
  });

  it('returns allLabels as flat array', () => {
    const result = classifyKeyword('Add login with Google OAuth');
    expect(Array.isArray(result.allLabels)).toBe(true);
    expect(result.allLabels.length).toBeGreaterThan(0);
  });

  it('handles empty text gracefully', () => {
    const result = classifyKeyword('');
    expect(result.primaryDomain).toBeDefined();
    expect(result.allLabels).toBeDefined();
  });

  it('detects sub-domain for SSO', () => {
    const result = classifyKeyword('Implement SSO with OAuth2 and OpenID Connect');
    expect(result.primaryDomain).toBe('auth');
    expect(result.subDomain).toBe('auth.sso');
  });

  it('detects sub-domain for cache', () => {
    const result = classifyKeyword('Add Redis cache with TTL invalidation strategy');
    expect(result.primaryDomain).toBe('data-storage');
    expect(result.subDomain).toBe('data-storage.cache');
  });

  it('includes nature, complexity and layer in allLabels', () => {
    const result = classifyKeyword('Fix broken user authentication session token');
    expect(result.allLabels).toContain(result.nature);
    expect(result.allLabels).toContain(result.complexity);
    expect(result.allLabels).toContain(result.layer);
  });

  it('classifies devops/infrastructure work', () => {
    const result = classifyKeyword('Set up GitHub Actions CI pipeline with Docker and deploy to AWS');
    expect(result.primaryDomain).toBe('devops');
  });

  it('classifies AI/ML work', () => {
    const result = classifyKeyword('Integrate OpenAI embeddings for RAG vector search with LLM prompt engineering');
    expect(result.primaryDomain).toBe('ai-ml');
  });

  it('includes confidence score between 0 and 1', () => {
    const result = classifyKeyword('Add JWT token authentication with OAuth login');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('defaults to business-logic for unrecognised text', () => {
    const result = classifyKeyword('xyzzy frobnicate the quux widget');
    expect(result.primaryDomain).toBe('business-logic');
  });
});

describe('classify (async wrapper)', () => {
  it('returns same result as classifyKeyword synchronously', async () => {
    const sync = classifyKeyword('Create new user registration flow');
    const async_ = await classify('Create new user registration flow');
    expect(async_.primaryDomain).toBe(sync.primaryDomain);
    expect(async_.nature).toBe(sync.nature);
  });
});
