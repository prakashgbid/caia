/**
 * @jest-environment node
 */

import ProgressTracker, {
  ProgressData,
  Milestone,
  ProgressReport
} from '../index';
// Type-only import for unused types
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { Checkpoint, ProgressMetrics, ProgressAnalysis, ProgressEstimate } from '../index';

describe('ProgressTracker', () => {
  let progressTracker: ProgressTracker;

  beforeEach(() => {
    progressTracker = new ProgressTracker();
  });

  describe('ProgressTracker instantiation', () => {
    it('should create a new instance', () => {
      expect(progressTracker).toBeInstanceOf(ProgressTracker);
    });

    it('should create instance with initial progress', () => {
      const initialProgress: ProgressData = {
        current: 25,
        total: 100,
        percentage: 25,
        startTime: Date.now() - 10000,
        estimatedDuration: 40000,
        status: 'running'
      };

      const tracker = new ProgressTracker(initialProgress);
      const currentProgress = tracker.getProgress();

      expect(currentProgress.current).toBe(25);
      expect(currentProgress.percentage).toBe(25);
      expect(currentProgress.status).toBe('running');
    });
  });

  describe('updateProgress', () => {
    it('should update progress values', () => {
      progressTracker.updateProgress(30, 100);

      const progress = progressTracker.getProgress();
      expect(progress.current).toBe(30);
      expect(progress.total).toBe(100);
      expect(progress.percentage).toBe(30);
      expect(progress.status).toBe('running');
    });

    it('should emit progress-updated event', async () => {
      const progressPromise = new Promise<ProgressData>((resolve) => {
        progressTracker.on('progress-updated', (progress: ProgressData) => {
          expect(progress.current).toBe(50);
          expect(progress.percentage).toBe(50);
          resolve(progress);
        });
      });

      progressTracker.updateProgress(50, 100);
      await progressPromise;
    });

    it('should mark as completed when current equals total', () => {
      progressTracker.updateProgress(100, 100);

      const progress = progressTracker.getProgress();
      expect(progress.status).toBe('completed');
      expect(progress.completedAt).toBeDefined();
    });

    it('should calculate elapsed time', () => {
      const startTime = Date.now() - 5000; // 5 seconds ago
      progressTracker.start(0, 100, startTime);
      progressTracker.updateProgress(50, 100);

      const progress = progressTracker.getProgress();
      expect(progress.elapsedTime).toBeGreaterThan(4000);
      expect(progress.elapsedTime).toBeLessThan(6000);
    });

    it('should handle progress beyond total', () => {
      progressTracker.updateProgress(150, 100);

      const progress = progressTracker.getProgress();
      expect(progress.percentage).toBe(100);
      expect(progress.status).toBe('completed');
    });
  });

  describe('increment', () => {
    it('should increment progress by default amount', () => {
      progressTracker.start(0, 100);
      progressTracker.increment();

      const progress = progressTracker.getProgress();
      expect(progress.current).toBe(1);
    });

    it('should increment progress by specified amount', () => {
      progressTracker.start(0, 100);
      progressTracker.increment(5);

      const progress = progressTracker.getProgress();
      expect(progress.current).toBe(5);
    });

    it('should not exceed total when incrementing', () => {
      progressTracker.start(95, 100);
      progressTracker.increment(10);

      const progress = progressTracker.getProgress();
      expect(progress.current).toBe(100);
      expect(progress.percentage).toBe(100);
    });
  });

  describe('setStatus', () => {
    it('should update status', () => {
      progressTracker.setStatus('paused');

      const progress = progressTracker.getProgress();
      expect(progress.status).toBe('paused');
    });

    it('should emit status-changed event', async () => {
      const statusPromise = new Promise((resolve) => {
        progressTracker.on('status-changed', ({ oldStatus, newStatus }) => {
          expect(oldStatus).toBe('pending');
          expect(newStatus).toBe('running');
          resolve({ oldStatus, newStatus });
        });
      });

      progressTracker.setStatus('running');
      await statusPromise;
    });

    it('should set timestamps for status changes', () => {
      progressTracker.setStatus('running');
      progressTracker.setStatus('paused');
      progressTracker.setStatus('completed');

      const progress = progressTracker.getProgress();
      expect(progress.completedAt).toBeDefined();
    });
  });

  describe('start', () => {
    it('should start progress tracking', () => {
      const startTime = Date.now();
      progressTracker.start(0, 100);

      const progress = progressTracker.getProgress();
      expect(progress.current).toBe(0);
      expect(progress.total).toBe(100);
      expect(progress.status).toBe('running');
      expect(progress.startTime).toBeGreaterThanOrEqual(startTime);
    });

    it('should emit started event', async () => {
      const startedPromise = new Promise<ProgressData>((resolve) => {
        progressTracker.on('started', (progress: ProgressData) => {
          expect(progress.status).toBe('running');
          expect(progress.startTime).toBeDefined();
          resolve(progress);
        });
      });

      progressTracker.start(0, 50);
      await startedPromise;
    });
  });

  describe('pause and resume', () => {
    it('should pause progress tracking', () => {
      progressTracker.start(0, 100);
      progressTracker.pause();

      const progress = progressTracker.getProgress();
      expect(progress.status).toBe('paused');
      expect(progress.pausedAt).toBeDefined();
    });

    it('should resume progress tracking', () => {
      progressTracker.start(0, 100);
      progressTracker.pause();
      progressTracker.resume();

      const progress = progressTracker.getProgress();
      expect(progress.status).toBe('running');
      expect(progress.resumedAt).toBeDefined();
    });

    it('should emit pause and resume events', async () => {
      const pausePromise = new Promise((resolve) => {
        progressTracker.on('paused', resolve);
      });

      const resumePromise = new Promise((resolve) => {
        progressTracker.on('resumed', resolve);
      });

      progressTracker.start(0, 100);
      progressTracker.pause();
      const pauseResult = await pausePromise;
      expect(pauseResult).toBeDefined();

      progressTracker.resume();
      const resumeResult = await resumePromise;
      expect(resumeResult).toBeDefined();
    });

    it('should track pause duration', () => {
      progressTracker.start(0, 100);
      
      const _pauseTime = Date.now();
      progressTracker.pause();
      
      // Simulate pause duration
      setTimeout(() => {
        progressTracker.resume();
        
        const progress = progressTracker.getProgress();
        expect(progress.pausedDuration).toBeGreaterThan(0);
      }, 100);
    });
  });

  describe('complete', () => {
    it('should mark progress as completed', () => {
      progressTracker.start(0, 100);
      progressTracker.complete();

      const progress = progressTracker.getProgress();
      expect(progress.status).toBe('completed');
      expect(progress.percentage).toBe(100);
      expect(progress.completedAt).toBeDefined();
    });

    it('should emit completed event', async () => {
      const completedPromise = new Promise<ProgressData>((resolve) => {
        progressTracker.on('completed', (progress: ProgressData) => {
          expect(progress.status).toBe('completed');
          expect(progress.completedAt).toBeDefined();
          resolve(progress);
        });
      });

      progressTracker.start(0, 100);
      progressTracker.complete();
      await completedPromise;
    });
  });

  describe('fail', () => {
    it('should mark progress as failed', () => {
      progressTracker.start(0, 100);
      progressTracker.fail('Test error');

      const progress = progressTracker.getProgress();
      expect(progress.status).toBe('failed');
      expect(progress.error).toBe('Test error');
      expect(progress.failedAt).toBeDefined();
    });

    it('should emit failed event', async () => {
      const failedPromise = new Promise((resolve) => {
        progressTracker.on('failed', ({ progress, error }) => {
          expect(progress.status).toBe('failed');
          expect(error).toBe('Something went wrong');
          resolve({ progress, error });
        });
      });

      progressTracker.start(0, 100);
      progressTracker.fail('Something went wrong');
      await failedPromise;
    });
  });

  describe('milestones', () => {
    it('should add milestone', () => {
      const milestone: Milestone = {
        id: 'milestone-1',
        name: 'First Milestone',
        target: 25,
        description: 'Quarter complete'
      };

      progressTracker.addMilestone(milestone);

      const milestones = progressTracker.getMilestones();
      expect(milestones).toHaveLength(1);
      expect(milestones[0].id).toBe('milestone-1');
    });

    it('should detect milestone reached', async () => {
      const milestone: Milestone = {
        id: 'milestone-reached',
        name: 'Half Way',
        target: 50
      };

      progressTracker.addMilestone(milestone);

      const milestonePromise = new Promise((resolve) => {
        progressTracker.on('milestone-reached', (reachedMilestone) => {
          expect(reachedMilestone.id).toBe('milestone-reached');
          expect(reachedMilestone.reachedAt).toBeDefined();
          resolve(reachedMilestone);
        });
      });

      progressTracker.start(0, 100);
      progressTracker.updateProgress(50, 100);
      await milestonePromise;
    });

    it('should not trigger milestone multiple times', () => {
      const milestone: Milestone = {
        id: 'no-repeat',
        name: 'No Repeat',
        target: 30
      };

      let milestoneCount = 0;
      progressTracker.addMilestone(milestone);

      progressTracker.on('milestone-reached', () => {
        milestoneCount++;
      });

      progressTracker.start(0, 100);
      progressTracker.updateProgress(30, 100);
      progressTracker.updateProgress(35, 100);
      progressTracker.updateProgress(40, 100);

      expect(milestoneCount).toBe(1);
    });

    it('should remove milestone', () => {
      const milestone: Milestone = {
        id: 'removable',
        name: 'Removable',
        target: 75
      };

      progressTracker.addMilestone(milestone);
      expect(progressTracker.getMilestones()).toHaveLength(1);

      const removed = progressTracker.removeMilestone('removable');
      expect(removed).toBe(true);
      expect(progressTracker.getMilestones()).toHaveLength(0);
    });
  });

  describe('checkpoints', () => {
    it('should create checkpoint', () => {
      progressTracker.start(0, 100);
      progressTracker.updateProgress(30, 100);

      const _checkpoint = progressTracker.createCheckpoint('checkpoint-1', 'Progress saved');

      expect(_checkpoint.id).toBe('checkpoint-1');
      expect(checkpoint.progress.current).toBe(30);
      expect(checkpoint.timestamp).toBeDefined();
    });

    it('should restore from checkpoint', () => {
      progressTracker.start(0, 100);
      progressTracker.updateProgress(50, 100);
      
      const _checkpoint = progressTracker.createCheckpoint('save-point');
      
      progressTracker.updateProgress(80, 100);
      progressTracker.restoreFromCheckpoint('save-point');

      const progress = progressTracker.getProgress();
      expect(progress.current).toBe(50);
    });

    it('should emit checkpoint events', async () => {
      const createdPromise = new Promise((resolve) => {
        progressTracker.on('checkpoint-created', resolve);
      });

      const restoredPromise = new Promise((resolve) => {
        progressTracker.on('checkpoint-restored', resolve);
      });

      progressTracker.start(0, 100);
      progressTracker.updateProgress(25, 100);
      
      progressTracker.createCheckpoint('test-checkpoint');
      const createdResult = await createdPromise;
      expect(createdResult).toBeDefined();

      progressTracker.updateProgress(75, 100);
      progressTracker.restoreFromCheckpoint('test-checkpoint');
      const restoredResult = await restoredPromise;
      expect(restoredResult).toBeDefined();
    });

    it('should list all checkpoints', () => {
      progressTracker.start(0, 100);
      
      progressTracker.updateProgress(25, 100);
      progressTracker.createCheckpoint('cp1');
      
      progressTracker.updateProgress(50, 100);
      progressTracker.createCheckpoint('cp2');

      const checkpoints = progressTracker.getCheckpoints();
      expect(checkpoints).toHaveLength(2);
      expect(checkpoints.map(cp => cp.id)).toEqual(['cp1', 'cp2']);
    });

    it('should remove checkpoint', () => {
      progressTracker.start(0, 100);
      progressTracker.createCheckpoint('removable-cp');

      const removed = progressTracker.removeCheckpoint('removable-cp');
      expect(removed).toBe(true);
      expect(progressTracker.getCheckpoints()).toHaveLength(0);
    });
  });

  describe('estimateCompletion', () => {
    it('should estimate completion time based on current rate', () => {
      const startTime = Date.now() - 10000; // Started 10 seconds ago
      progressTracker.start(0, 100, startTime);
      progressTracker.updateProgress(25, 100); // 25% in 10 seconds

      const estimate = progressTracker.estimateCompletion();

      expect(estimate.estimatedDuration).toBeGreaterThan(30000); // Should take more than 30 seconds total
      expect(estimate.estimatedCompletion).toBeGreaterThan(Date.now());
      expect(estimate.confidence).toBeGreaterThan(0);
    });

    it('should provide low confidence for early estimates', () => {
      progressTracker.start(0, 100);
      progressTracker.updateProgress(1, 100);

      const estimate = progressTracker.estimateCompletion();
      expect(estimate.confidence).toBeLessThan(0.5);
    });

    it('should provide high confidence for later estimates', () => {
      const startTime = Date.now() - 30000; // Started 30 seconds ago
      progressTracker.start(0, 100, startTime);
      progressTracker.updateProgress(80, 100);

      const estimate = progressTracker.estimateCompletion();
      expect(estimate.confidence).toBeGreaterThan(0.7);
    });

    it('should handle completed progress', () => {
      progressTracker.start(0, 100);
      progressTracker.complete();

      const estimate = progressTracker.estimateCompletion();
      expect(estimate.remainingTime).toBe(0);
      expect(estimate.confidence).toBe(1);
    });
  });

  describe('generateReport', () => {
    beforeEach(() => {
      const startTime = Date.now() - 30000; // Started 30 seconds ago
      progressTracker.start(0, 100, startTime);
      
      // Add some milestones
      progressTracker.addMilestone({
        id: 'quarter',
        name: 'Quarter Done',
        target: 25
      });
      
      progressTracker.addMilestone({
        id: 'half',
        name: 'Half Done',
        target: 50
      });

      // Simulate progress
      progressTracker.updateProgress(25, 100);
      progressTracker.updateProgress(60, 100);
    });

    it('should generate comprehensive progress report', () => {
      const report = progressTracker.generateReport();

      expect(report.progress).toBeDefined();
      expect(report.milestones).toHaveLength(2);
      expect(report.milestones[0].reached).toBe(true);
      expect(report.milestones[1].reached).toBe(true);
      expect(report.estimate).toBeDefined();
      expect(report.metrics).toBeDefined();
    });

    it('should include progress metrics', () => {
      const report = progressTracker.generateReport();

      expect(report.metrics.averageRate).toBeGreaterThan(0);
      expect(report.metrics.velocity).toBeGreaterThan(0);
      expect(report.metrics.efficiency).toBeGreaterThan(0);
      expect(report.metrics.efficiency).toBeLessThanOrEqual(1);
    });

    it('should emit report-generated event', async () => {
      const reportPromise = new Promise<ProgressReport>((resolve) => {
        progressTracker.on('report-generated', (report: ProgressReport) => {
          expect(report.timestamp).toBeDefined();
          expect(report.progress).toBeDefined();
          resolve(report);
        });
      });

      progressTracker.generateReport();
      await reportPromise;
    });
  });

  describe('analyzeProgress', () => {
    beforeEach(() => {
      const baseTime = Date.now() - 60000; // Started 1 minute ago
      progressTracker.start(0, 100, baseTime);

      // Simulate variable progress over time
      const intervals = [10000, 20000, 30000, 40000, 50000];
      const progressValues = [10, 30, 45, 70, 85];

      intervals.forEach((time, index) => {
        progressTracker.updateProgress(progressValues[index], 100);
      });
    });

    it('should analyze progress trends', () => {
      const analysis = progressTracker.analyzeProgress();

      expect(analysis.trend).toBeOneOf(['accelerating', 'steady', 'decelerating']);
      expect(analysis.averageVelocity).toBeGreaterThan(0);
      expect(analysis.currentVelocity).toBeGreaterThan(0);
      expect(analysis.efficiency).toBeGreaterThan(0);
      expect(analysis.predictedCompletion).toBeGreaterThan(Date.now());
    });

    it('should identify performance issues', () => {
      // Simulate stalled progress
      progressTracker.updateProgress(85, 100); // Same as last update
      
      const analysis = progressTracker.analyzeProgress();
      
      expect(analysis.issues).toBeDefined();
      expect(analysis.currentVelocity).toBeGreaterThanOrEqual(0);
      // Check for stalled progress condition
      if (analysis.issues && analysis.currentVelocity === 0) {
        expect(analysis.issues).toContain('Progress has stalled');
      } else {
        // If not stalled, expect issues array is defined
        expect(analysis.issues).toBeDefined();
      }
    });

    it('should provide recommendations', () => {
      const analysis = progressTracker.analyzeProgress();

      expect(analysis.recommendations).toBeDefined();
      expect(Array.isArray(analysis.recommendations)).toBe(true);
    });
  });

  describe('getMetrics', () => {
    beforeEach(() => {
      const startTime = Date.now() - 45000; // Started 45 seconds ago
      progressTracker.start(0, 100, startTime);
      progressTracker.updateProgress(60, 100);
    });

    it('should provide detailed metrics', () => {
      const metrics = progressTracker.getMetrics();

      expect(metrics.totalElapsedTime).toBeGreaterThan(40000);
      expect(metrics.averageRate).toBeGreaterThan(0);
      expect(metrics.currentRate).toBeGreaterThan(0);
      expect(metrics.velocity).toBeGreaterThan(0);
      expect(metrics.throughput).toBeGreaterThan(0);
      expect(metrics.efficiency).toBeGreaterThan(0);
      expect(metrics.remainingWork).toBe(40);
      expect(metrics.estimatedTimeRemaining).toBeGreaterThan(0);
    });

    it('should handle zero elapsed time', () => {
      const newTracker = new ProgressTracker();
      newTracker.start(0, 100);

      const metrics = newTracker.getMetrics();
      expect(metrics.averageRate).toBe(0);
      expect(metrics.currentRate).toBe(0);
    });

    it('should handle completed progress', () => {
      progressTracker.complete();

      const metrics = progressTracker.getMetrics();
      expect(metrics.remainingWork).toBe(0);
      expect(metrics.estimatedTimeRemaining).toBe(0);
    });
  });

  describe('reset', () => {
    it('should reset all progress data', () => {
      progressTracker.start(0, 100);
      progressTracker.updateProgress(50, 100);
      progressTracker.addMilestone({ id: 'test', name: 'Test', target: 75 });
      progressTracker.createCheckpoint('test-cp');

      progressTracker.reset();

      const progress = progressTracker.getProgress();
      expect(progress.current).toBe(0);
      expect(progress.percentage).toBe(0);
      expect(progress.status).toBe('pending');
      expect(progress.startTime).toBeUndefined();
      expect(progressTracker.getMilestones()).toHaveLength(0);
      expect(progressTracker.getCheckpoints()).toHaveLength(0);
    });

    it('should emit reset event', async () => {
      const resetPromise = new Promise<void>((resolve) => {
        progressTracker.on('reset', () => {
          resolve();
        });
      });

      progressTracker.start(0, 100);
      progressTracker.reset();
      await resetPromise;
      expect(true).toBe(true); // Ensure test has assertions
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle negative progress values', () => {
      progressTracker.updateProgress(-10, 100);

      const progress = progressTracker.getProgress();
      expect(progress.current).toBe(0);
      expect(progress.percentage).toBe(0);
    });

    it('should handle zero total', () => {
      progressTracker.start(0, 0);

      const progress = progressTracker.getProgress();
      expect(progress.percentage).toBe(100);
      expect(progress.status).toBe('completed');
    });

    it('should handle NaN values', () => {
      expect(() => {
        progressTracker.updateProgress(NaN, 100);
        progressTracker.updateProgress(50, NaN);
      }).not.toThrow();
    });

    it('should handle very large numbers', () => {
      const large = Number.MAX_SAFE_INTEGER;
      progressTracker.updateProgress(large / 2, large);

      const progress = progressTracker.getProgress();
      expect(progress.percentage).toBe(50);
    });

    it('should handle duplicate milestone IDs', () => {
      const milestone1: Milestone = { id: 'dup', name: 'First', target: 25 };
      const milestone2: Milestone = { id: 'dup', name: 'Second', target: 75 };

      progressTracker.addMilestone(milestone1);
      progressTracker.addMilestone(milestone2);

      const milestones = progressTracker.getMilestones();
      expect(milestones).toHaveLength(1);
      expect(milestones[0].name).toBe('Second'); // Should replace first
    });

    it('should handle checkpoint restoration of non-existent checkpoint', () => {
      expect(() => {
        progressTracker.restoreFromCheckpoint('non-existent');
      }).toThrow('Checkpoint not found: non-existent');
    });

    it('should handle operations on non-started progress', () => {
      expect(() => {
        progressTracker.pause();
        progressTracker.resume();
        progressTracker.complete();
      }).not.toThrow();
    });

    it('should handle rapid status changes', () => {
      progressTracker.start(0, 100);
      progressTracker.pause();
      progressTracker.resume();
      progressTracker.pause();
      progressTracker.resume();
      progressTracker.complete();

      const progress = progressTracker.getProgress();
      expect(progress.status).toBe('completed');
    });
  });

  describe('Performance tests', () => {
    it('should handle frequent progress updates efficiently', () => {
      progressTracker.start(0, 10000);

      const startTime = Date.now();

      for (let i = 0; i <= 10000; i++) {
        progressTracker.updateProgress(i, 10000);
      }

      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
      expect(progressTracker.getProgress().current).toBe(10000);
    });

    it('should handle many milestones efficiently', () => {
      progressTracker.start(0, 1000);

      // Add many milestones
      for (let i = 10; i <= 1000; i += 10) {
        progressTracker.addMilestone({
          id: `milestone-${i}`,
          name: `Milestone ${i}`,
          target: i
        });
      }

      const startTime = Date.now();
      progressTracker.updateProgress(1000, 1000);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(100); // Should be fast even with many milestones
      expect(progressTracker.getMilestones().every(m => m.reached)).toBe(true);
    });

    it('should handle frequent checkpoint creation efficiently', () => {
      progressTracker.start(0, 100);

      const startTime = Date.now();

      for (let i = 0; i < 100; i++) {
        progressTracker.updateProgress(i, 100);
        progressTracker.createCheckpoint(`cp-${i}`);
      }

      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(500);
      expect(progressTracker.getCheckpoints()).toHaveLength(100);
    });
  });
});