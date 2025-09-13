
import { SprintPriorizerBridge } from './bridge';

export class SprintPriorizerImplementation extends SprintPriorizerBridge {
  constructor(config: any) {
    super(config);
  }

  async prioritizeSprint(backlog: any[], capacity: number) {
    // Score each item
    const scoredItems = backlog.map(item => ({
      ...item,
      score: this.calculateWSJF(item),
      effort: this.estimateEffort(item),
      risk: this.assessRisk(item)
    }));

    // Sort by WSJF score
    scoredItems.sort((a, b) => b.score - a.score);

    // Fit to capacity
    const selected = [];
    let currentCapacity = 0;

    for (const item of scoredItems) {
      if (currentCapacity + item.effort <= capacity) {
        selected.push(item);
        currentCapacity += item.effort;
      }
    }

    return {
      items: selected,
      totalEffort: currentCapacity,
      totalValue: selected.reduce((sum, item) => sum + item.score, 0),
      velocity: capacity,
      utilization: (currentCapacity / capacity) * 100
    };
  }

  private calculateWSJF(item: any) {
    // Weighted Shortest Job First calculation
    const businessValue = item.businessValue || 5;
    const timeCriticality = item.timeCriticality || 5;
    const riskReduction = item.riskReduction || 5;
    const opportunityEnablement = item.opportunityEnablement || 5;

    const costOfDelay = businessValue + timeCriticality + riskReduction + opportunityEnablement;
    const jobDuration = this.estimateEffort(item);

    return jobDuration > 0 ? costOfDelay / jobDuration : costOfDelay;
  }

  private estimateEffort(item: any) {
    // Simple effort estimation based on complexity
    const complexity = item.complexity || 'medium';
    const effortMap = {
      'trivial': 1,
      'simple': 2,
      'medium': 5,
      'complex': 8,
      'very_complex': 13
    };

    return effortMap[complexity] || 5;
  }

  private assessRisk(item: any) {
    let riskScore = 0;

    // Technical risk
    if (item.newTechnology) riskScore += 3;
    if (item.complexIntegration) riskScore += 2;

    // Business risk
    if (item.highVisibility) riskScore += 2;
    if (item.regulatoryRequirement) riskScore += 3;

    // Resource risk
    if (item.requiresSpecialist) riskScore += 2;
    if (item.externalDependency) riskScore += 3;

    return Math.min(riskScore, 10); // Cap at 10
  }

  async generateSprintPlan(items: any[]) {
    const plan = {
      sprintGoal: this.generateSprintGoal(items),
      dailySchedule: this.createDailySchedule(items),
      dependencies: this.identifyDependencies(items),
      risks: this.identifyRisks(items),
      successCriteria: this.defineSuccessCriteria(items)
    };

    return plan;
  }

  private generateSprintGoal(items: any[]) {
    // Find common theme
    const themes = items.map(i => i.theme || 'general');
    const mostCommon = this.mostFrequent(themes);

    return `Deliver ${items.length} features focused on ${mostCommon} to improve user experience`;
  }

  private createDailySchedule(items: any[]) {
    const schedule = {};
    const daysInSprint = 10; // 2 weeks
    const itemsPerDay = Math.ceil(items.length / daysInSprint);

    let currentDay = 1;
    let dayItems = [];

    for (const item of items) {
      dayItems.push(item);

      if (dayItems.length >= itemsPerDay) {
        schedule[`Day ${currentDay}`] = [...dayItems];
        dayItems = [];
        currentDay++;
      }
    }

    if (dayItems.length > 0) {
      schedule[`Day ${currentDay}`] = dayItems;
    }

    return schedule;
  }

  private identifyDependencies(items: any[]) {
    const deps = [];

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (items[i].dependsOn?.includes(items[j].id)) {
          deps.push({
            from: items[i].id,
            to: items[j].id,
            type: 'blocks'
          });
        }
      }
    }

    return deps;
  }

  private identifyRisks(items: any[]) {
    const risks = [];

    for (const item of items) {
      if (item.risk > 5) {
        risks.push({
          item: item.id,
          level: item.risk > 7 ? 'high' : 'medium',
          mitigation: 'Allocate senior developer and daily check-ins'
        });
      }
    }

    return risks;
  }

  private defineSuccessCriteria(items: any[]) {
    return [
      `Complete ${items.length} user stories`,
      'All acceptance criteria met',
      'Zero critical bugs',
      'Test coverage > 80%',
      'Sprint demo prepared'
    ];
  }

  private mostFrequent(arr: string[]) {
    const freq = {};
    let max = 0;
    let result = arr[0];

    for (const item of arr) {
      freq[item] = (freq[item] || 0) + 1;
      if (freq[item] > max) {
        max = freq[item];
        result = item;
      }
    }

    return result;
  }
}
