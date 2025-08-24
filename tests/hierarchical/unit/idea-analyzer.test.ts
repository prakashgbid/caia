import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { IdeaAnalyzer } from '../../../src/hierarchical/stream1/idea-analyzer';
import { Idea, AnalysisResult, ComplexityLevel } from '../../../src/hierarchical/types';

describe('IdeaAnalyzer', () => {
  let analyzer: IdeaAnalyzer;
  let mockIdea: Idea;

  beforeEach(() => {
    analyzer = new IdeaAnalyzer();
    mockIdea = {
      id: 'test-idea-1',
      title: 'Test Idea',
      description: 'A test idea for validation',
      complexity: 'medium',
      priority: 'high',
      tags: ['test', 'validation'],
      metadata: {
        source: 'unit-test',
        timestamp: Date.now()
      }
    };
  });

  describe('validateIdea', () => {
    it('should validate a properly formatted idea', async () => {
      const result = await analyzer.validateIdea(mockIdea);
      
      expect(result).toHaveProperty('isValid', true);
      expect(result).toHaveProperty('errors', []);
      expect(result).toHaveProperty('warnings');
    });

    it('should reject idea without title', async () => {
      delete mockIdea.title;
      
      const result = await analyzer.validateIdea(mockIdea);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Title is required');
    });

    it('should reject idea without description', async () => {
      delete mockIdea.description;
      
      const result = await analyzer.validateIdea(mockIdea);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Description is required');
    });

    it('should warn about short descriptions', async () => {
      mockIdea.description = 'Short';
      
      const result = await analyzer.validateIdea(mockIdea);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Description is too short for comprehensive analysis');
    });
  });

  describe('analyzeComplexity', () => {
    it('should analyze simple ideas correctly', async () => {
      mockIdea.description = 'Create a simple button component';
      
      const complexity = await analyzer.analyzeComplexity(mockIdea);
      
      expect(complexity).toBe('simple');
    });

    it('should analyze medium complexity ideas', async () => {
      mockIdea.description = 'Implement user authentication with JWT tokens, password validation, and role-based access control';
      
      const complexity = await analyzer.analyzeComplexity(mockIdea);
      
      expect(complexity).toBe('medium');
    });

    it('should analyze complex ideas correctly', async () => {
      mockIdea.description = 'Build a comprehensive microservices architecture with API gateway, service mesh, distributed logging, monitoring, auto-scaling, and multi-region deployment';
      
      const complexity = await analyzer.analyzeComplexity(mockIdea);
      
      expect(complexity).toBe('complex');
    });

    it('should handle edge cases gracefully', async () => {
      mockIdea.description = '';
      
      const complexity = await analyzer.analyzeComplexity(mockIdea);
      
      expect(complexity).toBe('unknown');
    });
  });

  describe('extractKeywords', () => {
    it('should extract relevant technical keywords', async () => {
      mockIdea.description = 'Create a React component with TypeScript, Jest testing, and Docker deployment';
      
      const keywords = await analyzer.extractKeywords(mockIdea);
      
      expect(keywords).toContain('react');
      expect(keywords).toContain('typescript');
      expect(keywords).toContain('jest');
      expect(keywords).toContain('docker');
    });

    it('should normalize keywords to lowercase', async () => {
      mockIdea.description = 'Use React and TypeScript for FRONTEND development';
      
      const keywords = await analyzer.extractKeywords(mockIdea);
      
      expect(keywords).toContain('react');
      expect(keywords).toContain('typescript');
      expect(keywords).toContain('frontend');
    });

    it('should remove duplicate keywords', async () => {
      mockIdea.description = 'React component using React hooks and React context';
      
      const keywords = await analyzer.extractKeywords(mockIdea);
      
      const reactCount = keywords.filter(k => k === 'react').length;
      expect(reactCount).toBe(1);
    });
  });

  describe('estimateEffort', () => {
    it('should estimate effort for simple tasks', async () => {
      mockIdea.complexity = 'simple';
      mockIdea.description = 'Create a button component';
      
      const effort = await analyzer.estimateEffort(mockIdea);
      
      expect(effort).toHaveProperty('hours');
      expect(effort.hours).toBeGreaterThan(0);
      expect(effort.hours).toBeLessThan(8);
    });

    it('should estimate effort for complex tasks', async () => {
      mockIdea.complexity = 'complex';
      mockIdea.description = 'Build microservices architecture';
      
      const effort = await analyzer.estimateEffort(mockIdea);
      
      expect(effort.hours).toBeGreaterThan(40);
    });

    it('should include confidence level in estimates', async () => {
      const effort = await analyzer.estimateEffort(mockIdea);
      
      expect(effort).toHaveProperty('confidence');
      expect(effort.confidence).toBeGreaterThanOrEqual(0);
      expect(effort.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('generateAnalysisReport', () => {
    it('should generate comprehensive analysis report', async () => {
      const report = await analyzer.generateAnalysisReport(mockIdea);
      
      expect(report).toHaveProperty('idea');
      expect(report).toHaveProperty('validation');
      expect(report).toHaveProperty('complexity');
      expect(report).toHaveProperty('keywords');
      expect(report).toHaveProperty('effort');
      expect(report).toHaveProperty('recommendations');
      expect(report).toHaveProperty('timestamp');
    });

    it('should include recommendations for improvement', async () => {
      mockIdea.description = 'Build app';
      
      const report = await analyzer.generateAnalysisReport(mockIdea);
      
      expect(report.recommendations).toBeArrayOfSize(expect.any(Number));
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should handle null idea gracefully', async () => {
      await expect(analyzer.validateIdea(null as any))
        .rejects.toThrow('Invalid idea: null or undefined');
    });

    it('should handle malformed idea objects', async () => {
      const malformedIdea = { random: 'data' } as any;
      
      const result = await analyzer.validateIdea(malformedIdea);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should timeout on extremely long descriptions', async () => {
      const longDescription = 'A'.repeat(100000);
      mockIdea.description = longDescription;
      
      const startTime = Date.now();
      await analyzer.analyzeComplexity(mockIdea);
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });

  describe('performance', () => {
    it('should analyze multiple ideas in parallel', async () => {
      const ideas = Array(10).fill(null).map((_, i) => ({
        ...mockIdea,
        id: `idea-${i}`,
        title: `Test Idea ${i}`
      }));
      
      const startTime = Date.now();
      const results = await Promise.all(
        ideas.map(idea => analyzer.generateAnalysisReport(idea))
      );
      const endTime = Date.now();
      
      expect(results).toBeArrayOfSize(10);
      expect(endTime - startTime).toBeLessThan(10000); // Should complete within 10 seconds
    });

    it('should maintain accuracy under load', async () => {
      const ideas = Array(50).fill(null).map((_, i) => ({
        ...mockIdea,
        id: `load-test-${i}`,
        description: `Complex task ${i} with multiple requirements and dependencies`
      }));
      
      const results = await Promise.all(
        ideas.map(idea => analyzer.validateIdea(idea))
      );
      
      const validResults = results.filter(r => r.isValid);
      expect(validResults.length).toBe(50);
    });
  });
});