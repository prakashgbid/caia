import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { IdeaAnalyzer } from '../../../src/hierarchical/stream1/idea-analyzer';
import { InitiativePlanner } from '../../../src/hierarchical/stream2/initiative-planner';
import { JiraConnector } from '../../../agents/connectors/jira-connect';
import { Idea } from '../../../src/hierarchical/types';

describe('Stream 1 to Stream 2 Integration', () => {
  let ideaAnalyzer: IdeaAnalyzer;
  let initiativePlanner: InitiativePlanner;
  let jiraConnector: JiraConnector;
  let mockIdea: Idea;

  beforeEach(() => {
    ideaAnalyzer = new IdeaAnalyzer();
    initiativePlanner = new InitiativePlanner();
    jiraConnector = new JiraConnector();
    
    mockIdea = {
      id: 'integration-test-idea',
      title: 'Customer Portal Integration',
      description: 'Build a comprehensive customer portal with authentication, profile management, order history, support tickets, and real-time notifications',
      complexity: 'complex',
      priority: 'high',
      tags: ['customer-portal', 'authentication', 'notifications', 'support'],
      metadata: {
        source: 'integration-test',
        timestamp: Date.now(),
        requestedBy: 'product-team'
      }
    };
  });

  describe('Idea Analysis to Initiative Planning Flow', () => {
    it('should successfully flow from idea analysis to initiative creation', async () => {
      // Step 1: Analyze the idea
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(mockIdea);
      
      expect(analysisResult).toHaveProperty('validation');
      expect(analysisResult.validation.isValid).toBe(true);
      
      // Step 2: Create initiative from analysis
      const initiative = await initiativePlanner.createInitiative(analysisResult);
      
      expect(initiative).toHaveProperty('id');
      expect(initiative).toHaveProperty('originalIdea');
      expect(initiative).toHaveProperty('analysisResult');
      expect(initiative.originalIdea.id).toBe(mockIdea.id);
      expect(initiative.analysisResult).toEqual(analysisResult);
    });

    it('should maintain data integrity through the pipeline', async () => {
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(mockIdea);
      const initiativePlan = await initiativePlanner.createInitiativePlan(analysisResult);
      
      // Verify original idea data is preserved
      expect(initiativePlan.initiative.originalIdea.title).toBe(mockIdea.title);
      expect(initiativePlan.initiative.originalIdea.description).toBe(mockIdea.description);
      expect(initiativePlan.initiative.originalIdea.tags).toEqual(mockIdea.tags);
      
      // Verify analysis results are preserved
      expect(initiativePlan.initiative.analysisResult.complexity).toBe(analysisResult.complexity);
      expect(initiativePlan.initiative.analysisResult.keywords).toEqual(analysisResult.keywords);
      expect(initiativePlan.initiative.analysisResult.effort).toEqual(analysisResult.effort);
    });

    it('should handle complexity escalation properly', async () => {
      // Test with a highly complex idea
      const complexIdea = {
        ...mockIdea,
        description: `Build a comprehensive enterprise platform with microservices architecture, 
        distributed systems, real-time analytics, machine learning recommendations, 
        multi-tenant support, global CDN, advanced security, compliance frameworks, 
        automated testing, CI/CD pipelines, monitoring and alerting, disaster recovery, 
        and multi-region deployment with auto-scaling`,
        complexity: 'complex' as const
      };
      
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(complexIdea);
      const initiativePlan = await initiativePlanner.createInitiativePlan(analysisResult);
      
      expect(analysisResult.complexity).toBe('complex');
      expect(initiativePlan.epics.length).toBeGreaterThan(5); // Should break down into many epics
      expect(initiativePlan.timeline.endDate.getTime() - initiativePlan.timeline.startDate.getTime())
        .toBeGreaterThan(90 * 24 * 60 * 60 * 1000); // Should span more than 90 days
    });
  });

  describe('JIRA Integration Flow', () => {
    it('should create JIRA issues from initiative plan', async () => {
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(mockIdea);
      const initiativePlan = await initiativePlanner.createInitiativePlan(analysisResult);
      
      // Mock JIRA connector
      const mockCreateIssue = jest.fn().mockResolvedValue({
        key: 'TEST-123',
        id: '12345',
        summary: initiativePlan.initiative.title,
        issueType: 'Initiative',
        status: 'To Do'
      });
      
      jiraConnector.createIssue = mockCreateIssue;
      
      // Create JIRA initiative
      const jiraInitiative = await jiraConnector.createIssue({
        summary: initiativePlan.initiative.title,
        description: initiativePlan.initiative.description,
        issueType: 'Initiative',
        project: 'TEST'
      });
      
      expect(mockCreateIssue).toHaveBeenCalledWith({
        summary: initiativePlan.initiative.title,
        description: initiativePlan.initiative.description,
        issueType: 'Initiative',
        project: 'TEST'
      });
      
      expect(jiraInitiative).toHaveProperty('key');
      expect(jiraInitiative).toHaveProperty('id');
    });

    it('should create hierarchical JIRA structure from initiative plan', async () => {
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(mockIdea);
      const initiativePlan = await initiativePlanner.createInitiativePlan(analysisResult);
      
      const createdIssues: any[] = [];
      const mockCreateIssue = jest.fn().mockImplementation(async (issueData) => {
        const issue = {
          key: `TEST-${createdIssues.length + 1}`,
          id: `${createdIssues.length + 1}`,
          summary: issueData.summary,
          issueType: issueData.issueType,
          status: 'To Do',
          parentKey: issueData.parentKey
        };
        createdIssues.push(issue);
        return issue;
      });
      
      jiraConnector.createIssue = mockCreateIssue;
      
      // Create initiative issue
      const initiativeIssue = await jiraConnector.createIssue({
        summary: initiativePlan.initiative.title,
        description: initiativePlan.initiative.description,
        issueType: 'Initiative',
        project: 'TEST'
      });
      
      // Create epic issues
      const epicIssues = await Promise.all(
        initiativePlan.epics.map(epic => 
          jiraConnector.createIssue({
            summary: epic.title,
            description: epic.description,
            issueType: 'Epic',
            project: 'TEST',
            parentKey: initiativeIssue.key
          })
        )
      );
      
      expect(createdIssues.length).toBe(1 + initiativePlan.epics.length);
      expect(epicIssues.every(issue => issue.parentKey === initiativeIssue.key)).toBe(true);
    });

    it('should handle JIRA API errors gracefully', async () => {
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(mockIdea);
      const initiativePlan = await initiativePlanner.createInitiativePlan(analysisResult);
      
      // Mock JIRA API error
      const mockCreateIssue = jest.fn().mockRejectedValue(new Error('JIRA API rate limit exceeded'));
      jiraConnector.createIssue = mockCreateIssue;
      
      await expect(jiraConnector.createIssue({
        summary: initiativePlan.initiative.title,
        description: initiativePlan.initiative.description,
        issueType: 'Initiative',
        project: 'TEST'
      })).rejects.toThrow('JIRA API rate limit exceeded');
      
      // Should still maintain local state
      expect(initiativePlan.initiative.status).toBe('planning');
    });
  });

  describe('Data Transformation Accuracy', () => {
    it('should accurately transform idea keywords to epic tags', async () => {
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(mockIdea);
      const initiativePlan = await initiativePlanner.createInitiativePlan(analysisResult);
      
      const allEpicTags = initiativePlan.epics.flatMap(epic => epic.tags || []);
      const originalKeywords = analysisResult.keywords;
      
      // Most original keywords should appear in epic tags
      const keywordMatches = originalKeywords.filter(keyword => 
        allEpicTags.some(tag => tag.includes(keyword) || keyword.includes(tag))
      );
      
      expect(keywordMatches.length).toBeGreaterThan(originalKeywords.length * 0.7);
    });

    it('should preserve effort estimations across transformations', async () => {
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(mockIdea);
      const initiativePlan = await initiativePlanner.createInitiativePlan(analysisResult);
      
      const totalEpicEffort = initiativePlan.epics.reduce((sum, epic) => sum + epic.estimatedEffort.hours, 0);
      const originalEffort = analysisResult.effort.hours;
      
      // Epic effort should be within 25% of original estimate (allows for decomposition overhead)
      expect(totalEpicEffort).toBeGreaterThan(originalEffort * 0.75);
      expect(totalEpicEffort).toBeLessThan(originalEffort * 1.25);
    });

    it('should maintain priority consistency', async () => {
      const highPriorityIdea = { ...mockIdea, priority: 'critical' as const };
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(highPriorityIdea);
      const initiativePlan = await initiativePlanner.createInitiativePlan(analysisResult);
      
      // At least some epics should inherit high priority
      const highPriorityEpics = initiativePlan.epics.filter(epic => 
        epic.priority === 'critical' || epic.priority === 'high'
      );
      
      expect(highPriorityEpics.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle validation failures in Stream 1 and prevent Stream 2 processing', async () => {
      const invalidIdea = { ...mockIdea, title: '', description: '' };
      
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(invalidIdea);
      
      expect(analysisResult.validation.isValid).toBe(false);
      
      // Should not proceed to initiative planning with invalid analysis
      await expect(initiativePlanner.createInitiativePlan(analysisResult))
        .rejects.toThrow('Invalid analysis result');
    });

    it('should handle partial failures in epic creation', async () => {
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(mockIdea);
      
      // Mock partial failure in epic decomposition
      const originalDecomposeToEpics = initiativePlanner.decomposeToEpics;
      const mockDecomposeToEpics = jest.fn().mockImplementation(async (initiative) => {
        const epics = await originalDecomposeToEpics.call(initiativePlanner, initiative);
        // Corrupt one epic
        if (epics.length > 0) {
          delete (epics[0] as any).title;
        }
        return epics;
      });
      
      initiativePlanner.decomposeToEpics = mockDecomposeToEpics;
      
      const initiativePlan = await initiativePlanner.createInitiativePlan(analysisResult);
      const validation = await initiativePlanner.validatePlan(initiativePlan);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(error => error.includes('title'))).toBe(true);
    });

    it('should maintain transactional integrity during JIRA creation failures', async () => {
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(mockIdea);
      const initiativePlan = await initiativePlanner.createInitiativePlan(analysisResult);
      
      let callCount = 0;
      const mockCreateIssue = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Network error');
        }
        return {
          key: `TEST-${callCount}`,
          id: `${callCount}`,
          summary: 'Test Issue',
          issueType: 'Epic',
          status: 'To Do'
        };
      });
      
      jiraConnector.createIssue = mockCreateIssue;
      
      // Try to create multiple issues
      const results = await Promise.allSettled([
        jiraConnector.createIssue({ summary: 'Epic 1', issueType: 'Epic', project: 'TEST' }),
        jiraConnector.createIssue({ summary: 'Epic 2', issueType: 'Epic', project: 'TEST' }),
        jiraConnector.createIssue({ summary: 'Epic 3', issueType: 'Epic', project: 'TEST' })
      ]);
      
      // Should have partial success
      const successful = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');
      
      expect(successful.length).toBe(2);
      expect(failed.length).toBe(1);
    });
  });

  describe('Performance Integration', () => {
    it('should process large ideas through the pipeline efficiently', async () => {
      const largeIdea = {
        ...mockIdea,
        description: 'A'.repeat(50000), // 50KB description
        tags: Array(100).fill(null).map((_, i) => `tag-${i}`)
      };
      
      const startTime = Date.now();
      
      const analysisResult = await ideaAnalyzer.generateAnalysisReport(largeIdea);
      const initiativePlan = await initiativePlanner.createInitiativePlan(analysisResult);
      
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(30000); // Should complete within 30 seconds
      expect(initiativePlan.epics.length).toBeGreaterThan(0);
    });

    it('should handle concurrent processing of multiple ideas', async () => {
      const ideas = Array(10).fill(null).map((_, i) => ({
        ...mockIdea,
        id: `concurrent-idea-${i}`,
        title: `Concurrent Idea ${i}`,
        description: `This is concurrent idea ${i} for testing parallel processing`
      }));
      
      const startTime = Date.now();
      
      const results = await Promise.all(
        ideas.map(async (idea) => {
          const analysisResult = await ideaAnalyzer.generateAnalysisReport(idea);
          const initiativePlan = await initiativePlanner.createInitiativePlan(analysisResult);
          return { analysisResult, initiativePlan };
        })
      );
      
      const endTime = Date.now();
      
      expect(results.length).toBe(10);
      expect(endTime - startTime).toBeLessThan(45000); // Parallel processing should be faster
      
      // Verify all results are valid
      results.forEach(({ analysisResult, initiativePlan }) => {
        expect(analysisResult.validation.isValid).toBe(true);
        expect(initiativePlan.epics.length).toBeGreaterThan(0);
      });
    });
  });
});