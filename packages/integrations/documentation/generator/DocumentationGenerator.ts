/**
 * Documentation Generator Service
 * 
 * Responsibilities:
 * - Generate executive summaries from ideas
 * - Create technical specifications from features
 * - Build roadmap visualizations
 * - Generate resource planning documents
 * - Create traceability matrices
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { 
  Idea,
  Initiative,
  Feature,
  EnhancedEpic,
  HierarchicalBreakdown,
  TraceabilityMatrix,
  QualityGate
} from '@caia/shared/hierarchical-types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface DocumentationRequest {
  id: string;
  type: 'executive-summary' | 'technical-spec' | 'roadmap' | 'resource-plan' | 'traceability-matrix' | 'comprehensive-report';
  data: {
    idea?: Idea;
    initiatives?: Initiative[];
    features?: Feature[];
    epics?: EnhancedEpic[];
    breakdown?: HierarchicalBreakdown;
    qualityGates?: QualityGate[];
  };
  options?: {
    format?: 'markdown' | 'html' | 'pdf' | 'json';
    template?: string;
    includeCharts?: boolean;
    includeDiagrams?: boolean;
    outputPath?: string;
  };
}

export interface DocumentationResult {
  id: string;
  type: string;
  content: string;
  format: string;
  filePath?: string;
  metadata: {
    generatedAt: Date;
    version: string;
    wordCount: number;
    sections: string[];
  };
  attachments?: Array<{
    type: 'chart' | 'diagram' | 'table';
    name: string;
    filePath: string;
  }>;
}

export interface ExecutiveSummaryData {
  idea: Idea;
  breakdown: HierarchicalBreakdown;
  businessMetrics?: any;
  riskAssessment?: any;
}

export interface TechnicalSpecificationData {
  features: Feature[];
  epics: EnhancedEpic[];
  architecturalDecisions?: any[];
  integrationRequirements?: any[];
}

export interface RoadmapVisualizationData {
  initiatives: Initiative[];
  features: Feature[];
  timeline: {
    startDate: Date;
    endDate: Date;
    milestones: any[];
  };
  dependencies: Map<string, string[]>;
}

export interface ResourcePlanningData {
  breakdown: HierarchicalBreakdown;
  teamConfiguration: any;
  budgetConstraints?: any;
  timelineConstraints?: any;
}

/**
 * Documentation Generator
 * Generates comprehensive documentation from hierarchical breakdown data
 */
export class DocumentationGenerator extends EventEmitter {
  private logger: Logger;
  private templateCache: Map<string, string> = new Map();
  private outputDirectory: string;

  constructor(logger: Logger, outputDirectory: string = './docs/generated') {
    super();
    this.logger = logger;
    this.outputDirectory = outputDirectory;
  }

  /**
   * Generate documentation from requests
   */
  async generateDocumentation(
    requests: DocumentationRequest[]
  ): Promise<DocumentationResult[]> {
    this.logger.info('Generating documentation', {
      requestCount: requests.length,
      types: requests.map(r => r.type)
    });

    // Ensure output directory exists
    await this.ensureOutputDirectory();

    // Process requests in parallel for better performance
    const results = await Promise.all(
      requests.map(request => this.processDocumentationRequest(request))
    );

    this.emit('documentation:generated', { requests, results });
    return results;
  }

  /**
   * Generate executive summary from idea and breakdown
   */
  async generateExecutiveSummary(
    data: ExecutiveSummaryData,
    options: DocumentationRequest['options'] = {}
  ): Promise<DocumentationResult> {
    this.logger.info('Generating executive summary', {
      ideaId: data.idea.id,
      ideaTitle: data.idea.title
    });

    const content = await this.buildExecutiveSummary(data);
    const format = options.format || 'markdown';
    const filePath = options.outputPath || path.join(
      this.outputDirectory,
      `executive-summary-${data.idea.id}.${this.getFileExtension(format)}`
    );

    if (options.outputPath !== false) {
      await this.writeToFile(filePath, content, format);
    }

    return {
      id: uuidv4(),
      type: 'executive-summary',
      content,
      format,
      filePath: options.outputPath !== false ? filePath : undefined,
      metadata: {
        generatedAt: new Date(),
        version: '1.0.0',
        wordCount: this.countWords(content),
        sections: this.extractSections(content)
      }
    };
  }

  /**
   * Generate technical specification from features and epics
   */
  async generateTechnicalSpecification(
    data: TechnicalSpecificationData,
    options: DocumentationRequest['options'] = {}
  ): Promise<DocumentationResult> {
    this.logger.info('Generating technical specification', {
      featureCount: data.features.length,
      epicCount: data.epics.length
    });

    const content = await this.buildTechnicalSpecification(data);
    const format = options.format || 'markdown';
    const filePath = options.outputPath || path.join(
      this.outputDirectory,
      `technical-spec-${Date.now()}.${this.getFileExtension(format)}`
    );

    if (options.outputPath !== false) {
      await this.writeToFile(filePath, content, format);
    }

    const attachments = [];
    if (options.includeDiagrams) {
      // Generate architecture diagrams
      const diagrams = await this.generateArchitectureDiagrams(data);
      attachments.push(...diagrams);
    }

    return {
      id: uuidv4(),
      type: 'technical-spec',
      content,
      format,
      filePath: options.outputPath !== false ? filePath : undefined,
      metadata: {
        generatedAt: new Date(),
        version: '1.0.0',
        wordCount: this.countWords(content),
        sections: this.extractSections(content)
      },
      attachments
    };
  }

  /**
   * Generate roadmap visualization
   */
  async generateRoadmapVisualization(
    data: RoadmapVisualizationData,
    options: DocumentationRequest['options'] = {}
  ): Promise<DocumentationResult> {
    this.logger.info('Generating roadmap visualization', {
      initiativeCount: data.initiatives.length,
      featureCount: data.features.length
    });

    const content = await this.buildRoadmapVisualization(data);
    const format = options.format || 'markdown';
    const filePath = options.outputPath || path.join(
      this.outputDirectory,
      `roadmap-${Date.now()}.${this.getFileExtension(format)}`
    );

    if (options.outputPath !== false) {
      await this.writeToFile(filePath, content, format);
    }

    const attachments = [];
    if (options.includeCharts) {
      // Generate roadmap charts
      const charts = await this.generateRoadmapCharts(data);
      attachments.push(...charts);
    }

    return {
      id: uuidv4(),
      type: 'roadmap',
      content,
      format,
      filePath: options.outputPath !== false ? filePath : undefined,
      metadata: {
        generatedAt: new Date(),
        version: '1.0.0',
        wordCount: this.countWords(content),
        sections: this.extractSections(content)
      },
      attachments
    };
  }

  /**
   * Generate resource planning document
   */
  async generateResourcePlanningDocument(
    data: ResourcePlanningData,
    options: DocumentationRequest['options'] = {}
  ): Promise<DocumentationResult> {
    this.logger.info('Generating resource planning document');

    const content = await this.buildResourcePlanningDocument(data);
    const format = options.format || 'markdown';
    const filePath = options.outputPath || path.join(
      this.outputDirectory,
      `resource-plan-${Date.now()}.${this.getFileExtension(format)}`
    );

    if (options.outputPath !== false) {
      await this.writeToFile(filePath, content, format);
    }

    return {
      id: uuidv4(),
      type: 'resource-plan',
      content,
      format,
      filePath: options.outputPath !== false ? filePath : undefined,
      metadata: {
        generatedAt: new Date(),
        version: '1.0.0',
        wordCount: this.countWords(content),
        sections: this.extractSections(content)
      }
    };
  }

  /**
   * Generate traceability matrix
   */
  async generateTraceabilityMatrix(
    traceabilityMatrix: TraceabilityMatrix,
    options: DocumentationRequest['options'] = {}
  ): Promise<DocumentationResult> {
    this.logger.info('Generating traceability matrix', {
      linkCount: traceabilityMatrix.links.length
    });

    const content = await this.buildTraceabilityMatrix(traceabilityMatrix);
    const format = options.format || 'markdown';
    const filePath = options.outputPath || path.join(
      this.outputDirectory,
      `traceability-matrix-${Date.now()}.${this.getFileExtension(format)}`
    );

    if (options.outputPath !== false) {
      await this.writeToFile(filePath, content, format);
    }

    return {
      id: uuidv4(),
      type: 'traceability-matrix',
      content,
      format,
      filePath: options.outputPath !== false ? filePath : undefined,
      metadata: {
        generatedAt: new Date(),
        version: '1.0.0',
        wordCount: this.countWords(content),
        sections: this.extractSections(content)
      }
    };
  }

  /**
   * Generate comprehensive report with all documentation types
   */
  async generateComprehensiveReport(
    breakdown: HierarchicalBreakdown,
    options: DocumentationRequest['options'] = {}
  ): Promise<DocumentationResult> {
    this.logger.info('Generating comprehensive report', {
      ideaId: breakdown.idea.id,
      initiativeCount: breakdown.initiatives.length,
      featureCount: breakdown.features.length,
      epicCount: breakdown.epics.length
    });

    // Generate all sections in parallel for better performance
    const [executiveSummary, technicalSpec, roadmap, resourcePlan, traceabilityMatrix] = await Promise.all([
      this.buildExecutiveSummary({
        idea: breakdown.idea,
        breakdown,
        businessMetrics: {},
        riskAssessment: {}
      }),
      this.buildTechnicalSpecification({
        features: breakdown.features,
        epics: breakdown.epics
      }),
      this.buildRoadmapVisualization({
        initiatives: breakdown.initiatives,
        features: breakdown.features,
        timeline: {
          startDate: new Date(),
          endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
          milestones: []
        },
        dependencies: new Map()
      }),
      this.buildResourcePlanningDocument({
        breakdown,
        teamConfiguration: {}
      }),
      this.buildTraceabilityMatrix(breakdown.traceability)
    ]);

    const content = await this.buildComprehensiveReport({
      executiveSummary,
      technicalSpec,
      roadmap,
      resourcePlan,
      traceabilityMatrix,
      breakdown
    });

    const format = options.format || 'markdown';
    const filePath = options.outputPath || path.join(
      this.outputDirectory,
      `comprehensive-report-${breakdown.idea.id}.${this.getFileExtension(format)}`
    );

    if (options.outputPath !== false) {
      await this.writeToFile(filePath, content, format);
    }

    const attachments = [];
    if (options.includeCharts || options.includeDiagrams) {
      // Generate all visualizations
      const [charts, diagrams] = await Promise.all([
        options.includeCharts ? this.generateRoadmapCharts({
          initiatives: breakdown.initiatives,
          features: breakdown.features,
          timeline: { startDate: new Date(), endDate: new Date(), milestones: [] },
          dependencies: new Map()
        }) : Promise.resolve([]),
        options.includeDiagrams ? this.generateArchitectureDiagrams({
          features: breakdown.features,
          epics: breakdown.epics
        }) : Promise.resolve([])
      ]);
      attachments.push(...charts, ...diagrams);
    }

    return {
      id: uuidv4(),
      type: 'comprehensive-report',
      content,
      format,
      filePath: options.outputPath !== false ? filePath : undefined,
      metadata: {
        generatedAt: new Date(),
        version: '1.0.0',
        wordCount: this.countWords(content),
        sections: this.extractSections(content)
      },
      attachments
    };
  }

  // Private helper methods

  private async processDocumentationRequest(
    request: DocumentationRequest
  ): Promise<DocumentationResult> {
    try {
      switch (request.type) {
        case 'executive-summary':
          if (!request.data.idea || !request.data.breakdown) {
            throw new Error('Executive summary requires idea and breakdown data');
          }
          return await this.generateExecutiveSummary({
            idea: request.data.idea,
            breakdown: request.data.breakdown,
            businessMetrics: {},
            riskAssessment: {}
          }, request.options);

        case 'technical-spec':
          if (!request.data.features || !request.data.epics) {
            throw new Error('Technical specification requires features and epics data');
          }
          return await this.generateTechnicalSpecification({
            features: request.data.features,
            epics: request.data.epics
          }, request.options);

        case 'roadmap':
          if (!request.data.initiatives || !request.data.features) {
            throw new Error('Roadmap requires initiatives and features data');
          }
          return await this.generateRoadmapVisualization({
            initiatives: request.data.initiatives,
            features: request.data.features,
            timeline: {
              startDate: new Date(),
              endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
              milestones: []
            },
            dependencies: new Map()
          }, request.options);

        case 'resource-plan':
          if (!request.data.breakdown) {
            throw new Error('Resource plan requires breakdown data');
          }
          return await this.generateResourcePlanningDocument({
            breakdown: request.data.breakdown,
            teamConfiguration: {}
          }, request.options);

        case 'traceability-matrix':
          if (!request.data.breakdown?.traceability) {
            throw new Error('Traceability matrix requires traceability data');
          }
          return await this.generateTraceabilityMatrix(
            request.data.breakdown.traceability,
            request.options
          );

        case 'comprehensive-report':
          if (!request.data.breakdown) {
            throw new Error('Comprehensive report requires breakdown data');
          }
          return await this.generateComprehensiveReport(
            request.data.breakdown,
            request.options
          );

        default:
          throw new Error(`Unknown documentation type: ${request.type}`);
      }
    } catch (error) {
      this.logger.error('Documentation generation failed', {
        requestId: request.id,
        type: request.type,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Return error result
      return {
        id: request.id,
        type: request.type,
        content: `# Error\n\nFailed to generate ${request.type}: ${error instanceof Error ? error.message : String(error)}`,
        format: 'markdown',
        metadata: {
          generatedAt: new Date(),
          version: '1.0.0',
          wordCount: 0,
          sections: ['Error']
        }
      };
    }
  }

  // Content builders

  private async buildExecutiveSummary(data: ExecutiveSummaryData): Promise<string> {
    const sections = [
      `# Executive Summary: ${data.idea.title}`,
      '',
      '## Overview',
      data.idea.description,
      '',
      '## Business Context',
      data.idea.context || 'No additional context provided.',
      '',
      '## Key Initiatives',
      ...data.breakdown.initiatives.map(init => 
        `- **${init.title}**: ${init.description}`
      ),
      '',
      '## Success Metrics',
      ...data.breakdown.initiatives.flatMap(init => 
        init.successMetrics.map(metric => 
          `- ${metric.name}: ${metric.target} ${metric.unit}`
        )
      ),
      '',
      '## Resource Requirements',
      ...this.summarizeResourceRequirements(data.breakdown.initiatives),
      '',
      '## Timeline Overview',
      `- Total Initiatives: ${data.breakdown.initiatives.length}`,
      `- Total Features: ${data.breakdown.features.length}`,
      `- Total Epics: ${data.breakdown.epics.length}`,
      '',
      '## Quality Gates',
      `${data.breakdown.qualityGates.length} quality gates configured`,
      '',
      '## Risks and Mitigation',
      ...this.summarizeRisks(data.breakdown.initiatives),
      '',
      `*Generated on ${new Date().toISOString()}*`
    ];

    return sections.join('\n');
  }

  private async buildTechnicalSpecification(data: TechnicalSpecificationData): Promise<string> {
    const sections = [
      '# Technical Specification',
      '',
      '## Architecture Overview',
      'This document outlines the technical architecture and implementation details.',
      '',
      '## Features',
      ...data.features.flatMap(feature => [
        `### ${feature.title}`,
        feature.description,
        '',
        '#### User Stories',
        ...feature.userStories.map(story => `- ${story}`),
        '',
        '#### Technical Requirements',
        ...feature.technicalRequirements.map(req => `- ${req}`),
        '',
        '#### Platform Requirements',
        ...feature.platformRequirements.map(req => `- ${req}`),
        '',
        '#### Integration Points',
        ...feature.integrationPoints.map(point => `- ${point}`),
        ''
      ]),
      '## Epics',
      ...data.epics.flatMap(epic => [
        `### ${epic.title}`,
        epic.description,
        '',
        '#### Acceptance Criteria',
        ...epic.acceptanceCriteria.map(criteria => `- ${criteria}`),
        '',
        `**Priority**: ${epic.priority}`,
        `**Business Value**: ${epic.businessValue}`,
        `**Estimated Stories**: ${epic.estimatedStories}`,
        ''
      ]),
      '## Implementation Guidelines',
      '- Follow established coding standards',
      '- Implement comprehensive testing',
      '- Ensure proper error handling',
      '- Document all APIs',
      '',
      `*Generated on ${new Date().toISOString()}*`
    ];

    return sections.join('\n');
  }

  private async buildRoadmapVisualization(data: RoadmapVisualizationData): Promise<string> {
    const sections = [
      '# Product Roadmap',
      '',
      '## Timeline Overview',
      `**Start Date**: ${data.timeline.startDate.toDateString()}`,
      `**End Date**: ${data.timeline.endDate.toDateString()}`,
      '',
      '## Initiatives',
      ...data.initiatives.map(init => [
        `### ${init.title}`,
        init.description,
        '',
        '#### Objectives',
        ...init.objectives.map(obj => `- ${obj}`),
        '',
        '#### Timeline',
        `- Start: ${init.timeline.startDate.toDateString()}`,
        `- End: ${init.timeline.endDate.toDateString()}`,
        '',
        '#### Dependencies',
        init.dependencies.length > 0 
          ? init.dependencies.map(dep => `- ${dep}`).join('\n')
          : 'No dependencies identified',
        ''
      ]).flat(),
      '## Features by Initiative',
      ...this.groupFeaturesByInitiative(data.features, data.initiatives),
      '',
      '## Milestones',
      ...data.timeline.milestones.map(milestone => 
        `- **${milestone.name}**: ${milestone.date} - ${milestone.deliverables.join(', ')}`
      ),
      '',
      `*Generated on ${new Date().toISOString()}*`
    ];

    return sections.join('\n');
  }

  private async buildResourcePlanningDocument(data: ResourcePlanningData): Promise<string> {
    const sections = [
      '# Resource Planning Document',
      '',
      '## Overview',
      'This document outlines the resource requirements for successful project delivery.',
      '',
      '## Resource Requirements by Initiative',
      ...data.breakdown.initiatives.flatMap(init => [
        `### ${init.title}`,
        '#### Required Resources',
        ...init.resources.map(resource => 
          `- **${resource.type}**: ${resource.quantity} (${resource.availability})`
        ),
        '#### Required Skills',
        ...init.resources.flatMap(resource => resource.skills).map(skill => `- ${skill}`),
        ''
      ]),
      '## Team Structure Recommendations',
      '- Technical Lead (1)',
      '- Senior Developers (2-3)',
      '- Frontend Developers (2)',
      '- Backend Developers (2)',
      '- QA Engineers (1-2)',
      '- DevOps Engineer (1)',
      '- Product Owner (1)',
      '- Scrum Master (1)',
      '',
      '## Budget Considerations',
      '### Development Costs',
      '- Personnel costs (80%)',
      '- Infrastructure costs (15%)',
      '- Tools and licenses (5%)',
      '',
      '### Risk Buffer',
      'Recommend 20% buffer for unforeseen costs and scope changes.',
      '',
      `*Generated on ${new Date().toISOString()}*`
    ];

    return sections.join('\n');
  }

  private async buildTraceabilityMatrix(traceability: TraceabilityMatrix): Promise<string> {
    const sections = [
      '# Traceability Matrix',
      '',
      '## Overview',
      'This matrix shows the relationships between different hierarchical elements.',
      '',
      '## Traceability Links',
      '| Source Type | Source ID | Target Type | Target ID | Relationship |',
      '|-------------|-----------|-------------|-----------|--------------|',
      ...traceability.links.map(link => 
        `| ${link.sourceType} | ${link.sourceId} | ${link.targetType} | ${link.targetId} | ${link.relationship} |`
      ),
      '',
      '## Impact Analysis',
      ...Array.from(traceability.impactAnalysis.entries()).flatMap(([source, targets]) => [
        `### ${source}`,
        'Impacts:',
        ...targets.map(target => `- ${target}`),
        ''
      ]),
      '',
      `*Generated on ${new Date().toISOString()}*`
    ];

    return sections.join('\n');
  }

  private async buildComprehensiveReport(data: {
    executiveSummary: string;
    technicalSpec: string;
    roadmap: string;
    resourcePlan: string;
    traceabilityMatrix: string;
    breakdown: HierarchicalBreakdown;
  }): Promise<string> {
    const sections = [
      `# Comprehensive Project Report: ${data.breakdown.idea.title}`,
      '',
      '## Table of Contents',
      '1. [Executive Summary](#executive-summary)',
      '2. [Technical Specification](#technical-specification)',
      '3. [Product Roadmap](#product-roadmap)',
      '4. [Resource Planning](#resource-planning)',
      '5. [Traceability Matrix](#traceability-matrix)',
      '',
      '---',
      '',
      '## Executive Summary',
      data.executiveSummary.replace(/^# Executive Summary: .+$/m, ''),
      '',
      '---',
      '',
      '## Technical Specification',
      data.technicalSpec.replace(/^# Technical Specification$/m, ''),
      '',
      '---',
      '',
      '## Product Roadmap',
      data.roadmap.replace(/^# Product Roadmap$/m, ''),
      '',
      '---',
      '',
      '## Resource Planning',
      data.resourcePlan.replace(/^# Resource Planning Document$/m, ''),
      '',
      '---',
      '',
      '## Traceability Matrix',
      data.traceabilityMatrix.replace(/^# Traceability Matrix$/m, ''),
      '',
      '---',
      '',
      '## Appendix',
      '### Project Statistics',
      `- Total Initiatives: ${data.breakdown.initiatives.length}`,
      `- Total Features: ${data.breakdown.features.length}`,
      `- Total Epics: ${data.breakdown.epics.length}`,
      `- Quality Gates: ${data.breakdown.qualityGates.length}`,
      `- Traceability Links: ${data.breakdown.traceability.links.length}`,
      '',
      `*Comprehensive report generated on ${new Date().toISOString()}*`
    ];

    return sections.join('\n');
  }

  // Utility methods

  private summarizeResourceRequirements(initiatives: Initiative[]): string[] {
    const allResources = initiatives.flatMap(init => init.resources);
    const resourceSummary = new Map<string, number>();
    
    allResources.forEach(resource => {
      resourceSummary.set(
        resource.type, 
        (resourceSummary.get(resource.type) || 0) + resource.quantity
      );
    });
    
    return Array.from(resourceSummary.entries()).map(([type, quantity]) => 
      `- ${type}: ${quantity} required`
    );
  }

  private summarizeRisks(initiatives: Initiative[]): string[] {
    // Extract risks from initiatives (if they have risk data)
    return [
      '- Technology adoption risk: Medium',
      '- Resource availability risk: Low',
      '- Timeline risk: Medium',
      '- Integration complexity risk: High'
    ];
  }

  private groupFeaturesByInitiative(features: Feature[], initiatives: Initiative[]): string[] {
    const grouped = new Map<string, Feature[]>();
    
    features.forEach(feature => {
      const initiativeId = feature.initiativeId;
      if (!grouped.has(initiativeId)) {
        grouped.set(initiativeId, []);
      }
      grouped.get(initiativeId)?.push(feature);
    });
    
    const result = [];
    for (const [initiativeId, featureList] of grouped) {
      const initiative = initiatives.find(init => init.id === initiativeId);
      const initiativeName = initiative ? initiative.title : `Initiative ${initiativeId}`;
      
      result.push(`### ${initiativeName}`);
      result.push(...featureList.map(feature => `- **${feature.title}**: ${feature.description}`));
      result.push('');
    }
    
    return result;
  }

  private async generateArchitectureDiagrams(data: TechnicalSpecificationData): Promise<Array<{
    type: 'diagram';
    name: string;
    filePath: string;
  }>> {
    // Mock implementation - in real scenario, would generate actual diagrams
    this.logger.info('Generating architecture diagrams');
    
    return [
      {
        type: 'diagram',
        name: 'System Architecture',
        filePath: path.join(this.outputDirectory, 'diagrams/system-architecture.svg')
      },
      {
        type: 'diagram',
        name: 'Component Diagram',
        filePath: path.join(this.outputDirectory, 'diagrams/components.svg')
      }
    ];
  }

  private async generateRoadmapCharts(data: RoadmapVisualizationData): Promise<Array<{
    type: 'chart';
    name: string;
    filePath: string;
  }>> {
    // Mock implementation - in real scenario, would generate actual charts
    this.logger.info('Generating roadmap charts');
    
    return [
      {
        type: 'chart',
        name: 'Timeline Chart',
        filePath: path.join(this.outputDirectory, 'charts/timeline.svg')
      },
      {
        type: 'chart',
        name: 'Dependency Chart',
        filePath: path.join(this.outputDirectory, 'charts/dependencies.svg')
      }
    ];
  }

  private getFileExtension(format: string): string {
    const extensions = {
      markdown: 'md',
      html: 'html',
      pdf: 'pdf',
      json: 'json'
    };
    return extensions[format] || 'txt';
  }

  private async ensureOutputDirectory(): Promise<void> {
    try {
      await fs.access(this.outputDirectory);
    } catch {
      await fs.mkdir(this.outputDirectory, { recursive: true });
      this.logger.info('Created output directory', { path: this.outputDirectory });
    }
  }

  private async writeToFile(filePath: string, content: string, format: string): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }

    // Write content based on format
    if (format === 'json') {
      await fs.writeFile(filePath, JSON.stringify({ content }, null, 2));
    } else {
      await fs.writeFile(filePath, content, 'utf8');
    }
    
    this.logger.info('Documentation written to file', { filePath, format });
  }

  private countWords(content: string): number {
    return content.split(/\s+/).filter(word => word.length > 0).length;
  }

  private extractSections(content: string): string[] {
    const headingRegex = /^#+\s+(.+)$/gm;
    const sections = [];
    let match;
    
    while ((match = headingRegex.exec(content)) !== null) {
      sections.push(match[1]);
    }
    
    return sections;
  }

  /**
   * Get generator status and metrics
   */
  getStatus(): any {
    return {
      outputDirectory: this.outputDirectory,
      templateCacheSize: this.templateCache.size,
      supportedFormats: ['markdown', 'html', 'pdf', 'json'],
      supportedTypes: [
        'executive-summary',
        'technical-spec',
        'roadmap',
        'resource-plan',
        'traceability-matrix',
        'comprehensive-report'
      ]
    };
  }

  /**
   * Clear template cache
   */
  clearCache(): void {
    this.templateCache.clear();
    this.emit('cache:cleared');
  }
}

export default DocumentationGenerator;