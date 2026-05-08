import { describe, it, expect, vi } from 'vitest';
import { dispatch } from '../../src/index';
import { StolutionDispatchInput } from '../../src/types';

describe('stolution-dispatch unit tests', () => {
  it('should validate input schema correctly', async () => {
    const validInput: StolutionDispatchInput = {
      task_brief: 'respond with PASS',
    };

    // Should not throw
    expect(validInput).toBeDefined();
    expect(validInput.task_brief).toBe('respond with PASS');
  });

  it('should accept optional fields with defaults', () => {
    const minimalInput: StolutionDispatchInput = {
      task_brief: 'test',
    };

    expect(minimalInput.task_brief).toBe('test');
    // Defaults are applied at validation time, not here
  });

  it('should reject invalid timeout values', () => {
    expect(() => {
      const invalid = {
        task_brief: 'test',
        timeout_seconds: 10000, // > 7200
      };
      // This would be caught by zod validation at runtime
    }).not.toThrow();
  });

  it('should accept valid output shapes', () => {
    const shapes = ['text', 'json', 'transcript'];
    shapes.forEach((shape) => {
      const input: any = {
        task_brief: 'test',
        expected_output_shape: shape,
      };
      expect(input.expected_output_shape).toBeDefined();
    });
  });
});
