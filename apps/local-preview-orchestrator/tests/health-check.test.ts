import { describe, it, expect, afterEach, vi } from 'vitest';
import { healthCheck, pollHealthCheck } from '../src/health-check';

describe('health-check', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should pass health check with 200 and matching content', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '<html><title>Dashboard</title></html>'
    });

    global.fetch = mockFetch as unknown;

    const result = await healthCheck('http://localhost:5173/', '<title', 5000);

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.responseTime).toBeDefined();
  });

  it('should fail health check with non-200 status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 503,
      text: async () => 'Service Unavailable'
    });

    global.fetch = mockFetch as unknown;

    const result = await healthCheck('http://localhost:5173/', '<title', 5000);

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(503);
  });

  it('should fail health check if content not found', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '<html>No title here</html>'
    });

    global.fetch = mockFetch as unknown;

    const result = await healthCheck('http://localhost:5173/', '<title', 5000);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('does not contain expected content');
  });

  it('should fail health check on fetch error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    global.fetch = mockFetch as unknown;

    const result = await healthCheck('http://localhost:5173/', '<title', 5000);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Connection refused');
  });

  it('should retry on poll health check', async () => {
    const mockFetch = vi.fn();

    // First two calls fail, third succeeds
    mockFetch
      .mockResolvedValueOnce({ status: 503, text: async () => 'unavailable' })
      .mockResolvedValueOnce({ status: 503, text: async () => 'unavailable' })
      .mockResolvedValueOnce({
        status: 200,
        text: async () => '<html><title>Ready</title></html>'
      });

    global.fetch = mockFetch as unknown;

    const result = await pollHealthCheck('http://localhost:5173/', '<title', 10, 10);

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should fail after max attempts exceeded', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 503,
      text: async () => 'unavailable'
    });

    global.fetch = mockFetch as unknown;

    const result = await pollHealthCheck('http://localhost:5173/', '<title', 3, 10);

    expect(result.ok).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
