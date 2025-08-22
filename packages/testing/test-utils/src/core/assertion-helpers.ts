/**
 * @fileoverview Advanced assertion helpers for CAIA testing
 * Provides enhanced assertion capabilities beyond Jest defaults
 */

import { diff } from 'jest-diff';

export interface AssertionOptions {
  timeout?: number;
  interval?: number;
  message?: string;
}

/**
 * Enhanced assertion utilities for CAIA testing
 */
export class CAIAAssertions {
  /**
   * Assert that a condition becomes true within a timeout
   */
  static async eventually(
    condition: () => boolean | Promise<boolean>,
    options: AssertionOptions = {}
  ): Promise<void> {
    const { timeout = 5000, interval = 100, message = 'Condition was not met' } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const result = await condition();
        if (result) {
          return;
        }
      } catch (error) {
        // Continue trying until timeout
      }
      
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error(`${message} within ${timeout}ms`);
  }

  /**
   * Assert that an agent has the expected structure
   */
  static assertValidAgent(agent: any): void {
    expect(agent).toBeDefined();
    expect(agent).toHaveProperty('id');
    expect(agent).toHaveProperty('name');
    expect(agent).toHaveProperty('execute');
    expect(typeof agent.execute).toBe('function');
    expect(agent.id).toBeTruthy();
    expect(agent.name).toBeTruthy();
  }

  /**
   * Assert that a workflow result is valid
   */
  static assertValidWorkflowResult(result: any): void {
    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');
    expect(typeof result.success).toBe('boolean');
    
    if (result.success) {
      expect(result).toHaveProperty('results');
      expect(Array.isArray(result.results)).toBe(true);
    } else {
      expect(result).toHaveProperty('error');
    }
  }

  /**
   * Assert performance metrics are within acceptable ranges
   */
  static assertPerformanceMetrics(
    metrics: any,
    thresholds: { maxExecutionTime?: number; maxMemoryUsage?: number; minThroughput?: number }
  ): void {
    expect(metrics).toBeDefined();
    
    if (thresholds.maxExecutionTime) {
      expect(metrics.executionTime).toBeLessThanOrEqual(thresholds.maxExecutionTime);
    }
    
    if (thresholds.maxMemoryUsage) {
      expect(metrics.memoryUsage).toBeLessThanOrEqual(thresholds.maxMemoryUsage);
    }
    
    if (thresholds.minThroughput) {
      expect(metrics.throughput).toBeGreaterThanOrEqual(thresholds.minThroughput);
    }
  }

  /**
   * Assert that an error has the expected properties
   */
  static assertErrorStructure(
    error: any,
    expectedProperties: { code?: string; message?: string; type?: string }
  ): void {
    expect(error).toBeDefined();
    expect(error).toBeInstanceOf(Error);
    
    if (expectedProperties.code) {
      expect(error.code).toBe(expectedProperties.code);
    }
    
    if (expectedProperties.message) {
      expect(error.message).toContain(expectedProperties.message);
    }
    
    if (expectedProperties.type) {
      expect(error.constructor.name).toBe(expectedProperties.type);
    }
  }

  /**
   * Assert that two objects are deeply equal with better diff output
   */
  static assertDeepEqual(actual: any, expected: any, message?: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      const diffString = diff(expected, actual);
      const errorMessage = message 
        ? `${message}\n\nDiff:\n${diffString}`
        : `Objects are not deeply equal:\n\nDiff:\n${diffString}`;
      
      throw new Error(errorMessage);
    }
  }

  /**
   * Assert that an array contains items matching a predicate
   */
  static assertArrayContains<T>(
    array: T[],
    predicate: (item: T) => boolean,
    message?: string
  ): void {
    expect(Array.isArray(array)).toBe(true);
    
    const matchingItems = array.filter(predicate);
    if (matchingItems.length === 0) {
      throw new Error(message || 'Array does not contain any items matching the predicate');
    }
  }

  /**
   * Assert that all items in an array match a predicate
   */
  static assertArrayAll<T>(
    array: T[],
    predicate: (item: T) => boolean,
    message?: string
  ): void {
    expect(Array.isArray(array)).toBe(true);
    
    const failingItems = array.filter(item => !predicate(item));
    if (failingItems.length > 0) {
      throw new Error(
        message || `${failingItems.length} items in array do not match the predicate`
      );
    }
  }

  /**
   * Assert that a promise resolves within a timeout
   */
  static async assertResolvesWithin<T>(
    promise: Promise<T>,
    timeout: number,
    message?: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(message || `Promise did not resolve within ${timeout}ms`));
      }, timeout);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Assert that a promise rejects within a timeout
   */
  static async assertRejectsWithin(
    promise: Promise<any>,
    timeout: number,
    message?: string
  ): Promise<Error> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(message || `Promise did not reject within ${timeout}ms`));
      }, timeout);
    });

    try {
      await Promise.race([promise, timeoutPromise]);
      throw new Error('Promise resolved when it should have rejected');
    } catch (error) {
      if (error.message.includes('did not reject within')) {
        throw error;
      }
      return error as Error;
    }
  }

  /**
   * Assert HTTP response structure
   */
  static assertHttpResponse(
    response: any,
    expectedStatus: number,
    expectedProperties?: string[]
  ): void {
    expect(response).toBeDefined();
    expect(response.status).toBe(expectedStatus);
    
    if (expectedProperties) {
      for (const property of expectedProperties) {
        expect(response.data).toHaveProperty(property);
      }
    }
  }

  /**
   * Assert that a value is within a numeric range
   */
  static assertWithinRange(
    value: number,
    min: number,
    max: number,
    message?: string
  ): void {
    if (value < min || value > max) {
      throw new Error(
        message || `Value ${value} is not within range [${min}, ${max}]`
      );
    }
  }

  /**
   * Assert that a string matches a pattern
   */
  static assertMatches(
    actual: string,
    pattern: RegExp,
    message?: string
  ): void {
    if (!pattern.test(actual)) {
      throw new Error(
        message || `String "${actual}" does not match pattern ${pattern}`
      );
    }
  }

  /**
   * Assert that an object has nested property
   */
  static assertNestedProperty(
    object: any,
    path: string,
    expectedValue?: any,
    message?: string
  ): void {
    const keys = path.split('.');
    let current = object;

    for (const key of keys) {
      if (current === null || current === undefined) {
        throw new Error(
          message || `Property path "${path}" does not exist on object`
        );
      }
      current = current[key];
    }

    if (expectedValue !== undefined) {
      expect(current).toEqual(expectedValue);
    } else {
      expect(current).toBeDefined();
    }
  }

  /**
   * Assert file system state
   */
  static async assertFileExists(filePath: string, message?: string): Promise<void> {
    const fs = await import('fs/promises');
    
    try {
      await fs.access(filePath);
    } catch (error) {
      throw new Error(message || `File does not exist: ${filePath}`);
    }
  }

  /**
   * Assert directory structure
   */
  static async assertDirectoryStructure(
    basePath: string,
    expectedStructure: string[],
    message?: string
  ): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');

    for (const expectedPath of expectedStructure) {
      const fullPath = path.join(basePath, expectedPath);
      try {
        await fs.access(fullPath);
      } catch (error) {
        throw new Error(
          message || `Expected path does not exist: ${fullPath}`
        );
      }
    }
  }
}

/**
 * Fluent assertion builder for complex scenarios
 */
export class FluentAssertion<T> {
  constructor(private value: T) {}

  static that<T>(value: T): FluentAssertion<T> {
    return new FluentAssertion(value);
  }

  isDefined(): FluentAssertion<T> {
    expect(this.value).toBeDefined();
    return this;
  }

  isNotNull(): FluentAssertion<T> {
    expect(this.value).not.toBeNull();
    return this;
  }

  equals(expected: T): FluentAssertion<T> {
    expect(this.value).toEqual(expected);
    return this;
  }

  hasProperty(property: string): FluentAssertion<T> {
    expect(this.value).toHaveProperty(property);
    return this;
  }

  hasLength(length: number): FluentAssertion<T> {
    expect(this.value).toHaveLength(length);
    return this;
  }

  matches(pattern: RegExp): FluentAssertion<T> {
    expect(this.value).toMatch(pattern);
    return this;
  }

  isGreaterThan(value: number): FluentAssertion<T> {
    expect(this.value).toBeGreaterThan(value);
    return this;
  }

  isLessThan(value: number): FluentAssertion<T> {
    expect(this.value).toBeLessThan(value);
    return this;
  }

  contains(item: any): FluentAssertion<T> {
    expect(this.value).toContain(item);
    return this;
  }

  satisfies(predicate: (value: T) => boolean): FluentAssertion<T> {
    expect(predicate(this.value)).toBe(true);
    return this;
  }

  getValue(): T {
    return this.value;
  }
}

// Export convenience functions
export const assert = CAIAAssertions;
export const that = FluentAssertion.that;