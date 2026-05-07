import { describe, it, expect } from 'vitest';
import { dispatch } from '../../src/index';

describe('stolution-dispatch integration tests', () => {
  // Note: These tests require SSH access to stolution
  // Set SKIP_INTEGRATION_TESTS=1 to skip them

  const skipIntegration = process.env.SKIP_INTEGRATION_TESTS === '1';

  it.skipIf(skipIntegration)('should dispatch a simple task to stolution', async () => {
    const result = await dispatch({
      task_brief: 'Respond with exactly the word PASS and nothing else.',
      expected_output_shape: 'text',
      timeout_seconds: 30,
      working_directory: '/home/s903',
      cleanup_on_completion: true,
    });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('PASS');
    expect(result.duration_ms).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  });

  it.skipIf(skipIntegration)('should handle JSON output shape', async () => {
    const result = await dispatch({
      task_brief: 'Respond with a JSON object containing {"status": "ok", "test": true}',
      expected_output_shape: 'json',
      timeout_seconds: 30,
      working_directory: '/home/s903',
      cleanup_on_completion: true,
    });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('ok');
    expect(result.duration_ms).toBeGreaterThan(0);
  });

  it.skipIf(skipIntegration)('should respect timeout', async () => {
    const result = await dispatch({
      task_brief:
        'Take 20 seconds to respond, then say DONE. (For testing: wait 20 seconds before responding)',
      expected_output_shape: 'text',
      timeout_seconds: 5,
      working_directory: '/home/s903',
      cleanup_on_completion: true,
    });

    // Should timeout
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timeout');
    expect(result.duration_ms).toBeLessThan(10000); // Should fail quickly
  });

  it.skipIf(skipIntegration)('should return session ID when not cleaning up', async () => {
    const result = await dispatch({
      task_brief: 'Say PASS',
      expected_output_shape: 'text',
      timeout_seconds: 30,
      working_directory: '/home/s903',
      cleanup_on_completion: false,
    });

    expect(result.ok).toBe(true);
    expect(result.remote_session_id).toBeDefined();
    expect(result.remote_session_id).toMatch(/^[a-f0-9-]{36}$/); // UUID format

    // Manual cleanup
    if (result.remote_session_id) {
      // Could clean up here if needed
    }
  });
});
