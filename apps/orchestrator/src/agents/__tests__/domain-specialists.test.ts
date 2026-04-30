import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSpecialists, uiSpecialist, backendSpecialist, type SpecialistOptions } from '../domain-specialists';
import * as router from '@chiefaia/local-llm-router';
import * as registry from '@chiefaia/architecture-registry';
import type { TicketBundle } from '@chiefaia/ticket-template';

vi.mock('@chiefaia/local-llm-router');
vi.mock('@chiefaia/architecture-registry');

const mockTicket: TicketBundle = {
  story: {
    id: 'test-story-1',
    title: 'Add user profile page',
    description: 'Create a React component with avatar upload',
    primaryDomain: 'ui-frontend',
    status: 'open',
    rootPromptId: 'prompt-1',
  },
} as any;

describe('Domain Specialists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uiSpecialist should query findUIArtifacts and call LLM', async () => {
    vi.mocked(registry.findUIArtifacts).mockResolvedValue([
      { title: 'Button', description: 'Reusable button component', id: 'comp-1' },
    ] as any);
    vi.mocked(router.route).mockResolvedValue({
      text: '{"title":"Add profile page","description":"Create profile React page"}',
    } as any);

    const result = await uiSpecialist(mockTicket);

    expect(registry.findUIArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
    );
    expect(router.route).toHaveBeenCalledWith('ui-specialist', expect.any(String), {
      forceLocal: undefined,
    });
    expect(result).toBeTruthy();
  });

  it('backendSpecialist should query findBackendArtifacts and call LLM', async () => {
    vi.mocked(registry.findBackendArtifacts).mockResolvedValue([
      { title: 'UserService', description: 'User business logic', id: 'svc-1' },
    ] as any);
    vi.mocked(router.route).mockResolvedValue({
      text: '{"title":"User API route","description":"POST /api/users"}',
    } as any);

    const result = await backendSpecialist(mockTicket);

    expect(registry.findBackendArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
    );
    expect(result).toBeTruthy();
  });

  it('runSpecialists should call all applicable specialists in parallel', async () => {
    vi.mocked(registry.findUIArtifacts).mockResolvedValue([]);
    vi.mocked(registry.findBackendArtifacts).mockResolvedValue([]);
    vi.mocked(router.route).mockResolvedValue({
      text: '{"title":"test","description":"test"}',
    } as any);

    const results = await runSpecialists(mockTicket, ['ui', 'backend']);

    expect(results).toHaveLength(2);
    expect(router.route).toHaveBeenCalledTimes(2);
  });

  it('runSpecialists should handle specialist failures gracefully', async () => {
    vi.mocked(registry.findUIArtifacts).mockResolvedValue([]);
    vi.mocked(registry.findBackendArtifacts).mockRejectedValue(new Error('AKG unavailable'));
    vi.mocked(router.route).mockResolvedValue({
      text: '{"title":"test","description":"test"}',
    } as any);

    const results = await runSpecialists(mockTicket, ['ui', 'backend']);

    // UI specialist succeeds, backend fails and returns null
    expect(results).toHaveLength(1);
  });

  it('should respect topK option', async () => {
    vi.mocked(registry.findUIArtifacts).mockResolvedValue([]);
    vi.mocked(router.route).mockResolvedValue({
      text: '{"title":"test","description":"test"}',
    } as any);

    const options: SpecialistOptions = { topK: 10 };
    await uiSpecialist(mockTicket, options);

    expect(registry.findUIArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
  });

  it('should respect forceLocal option', async () => {
    vi.mocked(registry.findUIArtifacts).mockResolvedValue([]);
    vi.mocked(router.route).mockResolvedValue({
      text: '{"title":"test","description":"test"}',
    } as any);

    const options: SpecialistOptions = { forceLocal: true };
    await uiSpecialist(mockTicket, options);

    expect(router.route).toHaveBeenCalledWith('ui-specialist', expect.any(String), {
      forceLocal: true,
    });
  });
});
