/**
 * Parallelization Optimizer - Optimizes project structure for parallel execution
 */

import { logger } from '../utils/logger';
import type { SynthesizedPlan } from '../synthesis/SynthesisEngine';

export interface OptimizedPlan extends SynthesizedPlan {
  parallelization: {
    strategy: string;
    batchSize: number;
    dependencies: Dependency[];
    execution: ExecutionLevel[];
  };
}

export interface Dependency {
  dependent: string;
  dependsOn: string[];
  type: 'blocks' | 'precedes' | 'related';
}

export interface ExecutionLevel {
  level: number;
  items: ExecutionItem[];
  estimatedDuration: string;
  parallelizable: boolean;
}

export interface ExecutionItem {
  id: string;
  type: 'initiative' | 'feature' | 'story' | 'task';
  name: string;
  storyPoints?: number;
  estimate?: string;
  dependencies: string[];
}

export class ParallelizationOptimizer {
  async optimize(plan: SynthesizedPlan): Promise<OptimizedPlan> {
    logger.info('Starting parallelization optimization');

    // Analyze dependencies
    const dependencies = this.analyzeDependencies(plan);
    
    // Create execution levels
    const executionLevels = this.createExecutionLevels(plan, dependencies);
    
    // Determine optimal batch size
    const batchSize = this.calculateOptimalBatchSize(plan);

    const optimizedPlan: OptimizedPlan = {
      ...plan,
      parallelization: {
        strategy: 'level-based-parallel',
        batchSize,
        dependencies,
        execution: executionLevels
      }
    };

    logger.info('Parallelization optimization completed', {
      levels: executionLevels.length,
      batchSize,
      totalDependencies: dependencies.length
    });

    return optimizedPlan;
  }

  private analyzeDependencies(plan: SynthesizedPlan): Dependency[] {
    const dependencies: Dependency[] = [];

    plan.structure.initiatives.forEach((initiative, initIndex) => {
      // Initiative dependencies
      if (initIndex > 0) {
        dependencies.push({
          dependent: `initiative-${initIndex}`,
          dependsOn: [`initiative-${initIndex - 1}`],
          type: 'precedes'
        });
      }

      initiative.features.forEach((feature, featIndex) => {
        const featureId = `initiative-${initIndex}-feature-${featIndex}`;
        
        // Feature depends on initiative
        dependencies.push({
          dependent: featureId,
          dependsOn: [`initiative-${initIndex}`],
          type: 'blocks'
        });

        // Sequential feature dependencies within initiative
        if (featIndex > 0) {
          dependencies.push({
            dependent: featureId,
            dependsOn: [`initiative-${initIndex}-feature-${featIndex - 1}`],
            type: 'precedes'
          });
        }

        feature.stories.forEach((story, storyIndex) => {
          const storyId = `${featureId}-story-${storyIndex}`;
          
          // Story depends on feature
          dependencies.push({
            dependent: storyId,
            dependsOn: [featureId],
            type: 'blocks'
          });

          story.tasks.forEach((task, taskIndex) => {
            const taskId = `${storyId}-task-${taskIndex}`;
            
            // Task depends on story
            dependencies.push({
              dependent: taskId,
              dependsOn: [storyId],
              type: 'blocks'
            });
          });
        });
      });
    });

    return dependencies;
  }

  private createExecutionLevels(plan: SynthesizedPlan, dependencies: Dependency[]): ExecutionLevel[] {
    const levels: ExecutionLevel[] = [];
    const processed = new Set<string>();

    // Level 0: PROJECT (single item)
    levels.push({
      level: 0,
      items: [{
        id: 'project',
        type: 'initiative',
        name: plan.project.name,
        storyPoints: plan.structure.totalStoryPoints,
        dependencies: []
      }],
      estimatedDuration: '1 day',
      parallelizable: false
    });
    processed.add('project');

    // Level 1: INITIATIVES (parallel within level)
    const initiativeItems: ExecutionItem[] = plan.structure.initiatives.map((initiative, index) => ({
      id: `initiative-${index}`,
      type: 'initiative',
      name: initiative.name,
      storyPoints: initiative.features.reduce((sum, f) => sum + f.storyPoints, 0),
      dependencies: ['project']
    }));

    levels.push({
      level: 1,
      items: initiativeItems,
      estimatedDuration: '2-3 days',
      parallelizable: true
    });

    initiativeItems.forEach(item => processed.add(item.id));

    // Level 2: FEATURES (parallel within each initiative)
    const featureItems: ExecutionItem[] = [];
    plan.structure.initiatives.forEach((initiative, initIndex) => {
      initiative.features.forEach((feature, featIndex) => {
        featureItems.push({
          id: `initiative-${initIndex}-feature-${featIndex}`,
          type: 'feature',
          name: feature.name,
          storyPoints: feature.storyPoints,
          dependencies: [`initiative-${initIndex}`]
        });
      });
    });

    if (featureItems.length > 0) {
      levels.push({
        level: 2,
        items: featureItems,
        estimatedDuration: '3-5 days',
        parallelizable: true
      });
      featureItems.forEach(item => processed.add(item.id));
    }

    // Level 3: STORIES (parallel within each feature)
    const storyItems: ExecutionItem[] = [];
    plan.structure.initiatives.forEach((initiative, initIndex) => {
      initiative.features.forEach((feature, featIndex) => {
        feature.stories.forEach((story, storyIndex) => {
          storyItems.push({
            id: `initiative-${initIndex}-feature-${featIndex}-story-${storyIndex}`,
            type: 'story',
            name: story.name,
            storyPoints: story.storyPoints,
            dependencies: [`initiative-${initIndex}-feature-${featIndex}`]
          });
        });
      });
    });

    if (storyItems.length > 0) {
      levels.push({
        level: 3,
        items: storyItems,
        estimatedDuration: '1-2 days',
        parallelizable: true
      });
      storyItems.forEach(item => processed.add(item.id));
    }

    // Level 4: TASKS (parallel within each story)
    const taskItems: ExecutionItem[] = [];
    plan.structure.initiatives.forEach((initiative, initIndex) => {
      initiative.features.forEach((feature, featIndex) => {
        feature.stories.forEach((story, storyIndex) => {
          story.tasks.forEach((task, taskIndex) => {
            taskItems.push({
              id: `initiative-${initIndex}-feature-${featIndex}-story-${storyIndex}-task-${taskIndex}`,
              type: 'task',
              name: task.name,
              estimate: task.estimate,
              dependencies: [`initiative-${initIndex}-feature-${featIndex}-story-${storyIndex}`]
            });
          });
        });
      });
    });

    if (taskItems.length > 0) {
      levels.push({
        level: 4,
        items: taskItems,
        estimatedDuration: '2-6 hours',
        parallelizable: true
      });
      taskItems.forEach(item => processed.add(item.id));
    }

    return levels;
  }

  private calculateOptimalBatchSize(plan: SynthesizedPlan): number {
    const totalItems = this.countTotalItems(plan);
    
    // Base batch size on total complexity
    if (totalItems <= 20) return 5;
    if (totalItems <= 50) return 10;
    if (totalItems <= 100) return 20;
    return 30;
  }

  private countTotalItems(plan: SynthesizedPlan): number {
    let count = 1; // Project itself
    
    plan.structure.initiatives.forEach(initiative => {
      count += 1; // Initiative
      initiative.features.forEach(feature => {
        count += 1; // Feature
        count += feature.stories.length; // Stories
        feature.stories.forEach(story => {
          count += story.tasks.length; // Tasks
        });
      });
    });

    return count;
  }
}