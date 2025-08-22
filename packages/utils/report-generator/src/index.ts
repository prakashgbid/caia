/**
 * @caia/report-generator
 * Universal report generation engine
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

export interface ReportData {
  title: string;
  summary?: string;
  metadata: {
    generatedAt: number;
    generatedBy: string;
    version: string;
    reportId: string;
  };
  sections: ReportSection[];
  attachments?: Attachment[];
}

export interface ReportSection {
  id: string;
  title: string;
  type: 'text' | 'table' | 'chart' | 'list' | 'code' | 'image' | 'metric' | 'custom';
  content: unknown;
  metadata?: Record<string, unknown>;
  subsections?: ReportSection[];
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  content: Buffer | string;
  metadata?: Record<string, unknown>;
}

export interface TableData {
  headers: string[];
  rows: (string | number | boolean)[][];
  summary?: {
    totalRows: number;
    calculations?: Record<string, number>;
  };
}

export interface ChartData {
  type: 'line' | 'bar' | 'pie' | 'scatter' | 'area' | 'histogram';
  title?: string;
  data: {
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
      color?: string;
      backgroundColor?: string;
      borderColor?: string;
    }>;
  };
  options?: Record<string, unknown>;
}

export interface MetricData {
  value: number;
  unit?: string;
  label: string;
  change?: {
    value: number;
    direction: 'up' | 'down' | 'stable';
    period: string;
  };
  target?: number;
  status?: 'good' | 'warning' | 'critical';
}

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  sections: TemplateSection[];
  variables?: TemplateVariable[];
  styles?: ReportStyles;
}

export interface TemplateSection {
  id: string;
  title: string;
  type: ReportSection['type'];
  required: boolean;
  dataSource?: string;
  transform?: (data: unknown) => unknown;
  condition?: (data: unknown) => boolean;
}

export interface TemplateVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  default?: unknown;
  required: boolean;
  description?: string;
}

export interface ReportStyles {
  theme: 'light' | 'dark' | 'corporate' | 'minimal';
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  fontSize: number;
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export interface ExportOptions {
  format: 'html' | 'pdf' | 'json' | 'csv' | 'excel' | 'markdown';
  destination: string;
  compress?: boolean;
  includeAttachments?: boolean;
  watermark?: {
    text: string;
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
    opacity: number;
  };
}

export interface ReportFilter {
  sections?: string[];
  dateRange?: {
    start: number;
    end: number;
  };
  tags?: string[];
  minConfidence?: number;
}

export interface DataSource {
  id: string;
  name: string;
  fetch: (query?: string, params?: Record<string, unknown>) => Promise<unknown>;
  transform?: (data: unknown) => unknown;
  cache?: {
    enabled: boolean;
    ttl: number;
  };
}

export interface ReportSchedule {
  id: string;
  name: string;
  template: string;
  cron: string;
  enabled: boolean;
  recipients: string[];
  format: ExportOptions['format'];
  lastRun?: number;
  nextRun?: number;
}

export interface ReportGenerator {
  generate(data: ReportData, options: ExportOptions): Promise<Buffer | string>;
  supports: ExportOptions['format'][];
}

export class ReportEngine extends EventEmitter {
  private templates: Map<string, ReportTemplate> = new Map();
  private dataSources: Map<string, DataSource> = new Map();
  private generators: Map<string, ReportGenerator> = new Map();
  private schedules: Map<string, ReportSchedule> = new Map();
  private cache: Map<string, { data: unknown; timestamp: number; ttl: number }> = new Map();
  private schedulerInterval?: NodeJS.Timeout;

  constructor() {
    super();
    this.setupDefaultGenerators();
  }

  /**
   * Register a report template
   */
  registerTemplate(template: ReportTemplate): void {
    this.templates.set(template.id, template);
    this.emit('template-registered', template);
  }

  /**
   * Register a data source
   */
  registerDataSource(dataSource: DataSource): void {
    this.dataSources.set(dataSource.id, dataSource);
    this.emit('data-source-registered', dataSource);
  }

  /**
   * Register a report generator
   */
  registerGenerator(format: string, generator: ReportGenerator): void {
    this.generators.set(format, generator);
    this.emit('generator-registered', format);
  }

  /**
   * Generate a report from data
   */
  async generateReport(data: ReportData, options: ExportOptions, filter?: ReportFilter): Promise<Buffer | string> {
    try {
      const startTime = Date.now();
      
      // Apply filter if provided
      const filteredData = filter ? this.applyFilter(data, filter) : data;
      
      // Get appropriate generator
      const generator = this.generators.get(options.format);
      if (!generator) {
        throw new Error(`No generator found for format: ${options.format}`);
      }
      
      // Generate report
      const result = await generator.generate(filteredData, options);
      
      const generationTime = Date.now() - startTime;
      this.emit('report-generated', {
        reportId: data.metadata.reportId,
        format: options.format,
        size: typeof result === 'string' ? result.length : result.length,
        generationTime
      });
      
      return result;
    } catch (error) {
      this.emit('report-generation-failed', error);
      throw error;
    }
  }

  /**
   * Generate a report from template
   */
  async generateFromTemplate(
    templateId: string,
    variables: Record<string, unknown>,
    options: ExportOptions,
    filter?: ReportFilter
  ): Promise<Buffer | string> {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Validate required variables
    const missingVars = template.variables
      ?.filter(v => v.required && !(v.name in variables))
      .map(v => v.name) || [];
    
    if (missingVars.length > 0) {
      throw new Error(`Missing required variables: ${missingVars.join(', ')}`);
    }

    // Build report data from template
    const reportData = await this.buildReportFromTemplate(template, variables);
    
    return this.generateReport(reportData, options, filter);
  }

  /**
   * Get list of available templates
   */
  getTemplates(): ReportTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get template by ID
   */
  getTemplate(id: string): ReportTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Create a new report schedule
   */
  scheduleReport(schedule: ReportSchedule): void {
    this.schedules.set(schedule.id, schedule);
    this.emit('report-scheduled', schedule);
    
    // Start scheduler if not running
    if (!this.schedulerInterval) {
      this.startScheduler();
    }
  }

  /**
   * Remove a report schedule
   */
  unscheduleReport(scheduleId: string): boolean {
    const removed = this.schedules.delete(scheduleId);
    if (removed) {
      this.emit('report-unscheduled', scheduleId);
    }
    return removed;
  }

  /**
   * Get all scheduled reports
   */
  getSchedules(): ReportSchedule[] {
    return Array.from(this.schedules.values());
  }

  /**
   * Start the report scheduler
   */
  startScheduler(): void {
    if (this.schedulerInterval) return;

    this.schedulerInterval = setInterval(() => {
      this.processScheduledReports();
    }, 60000); // Check every minute

    this.emit('scheduler-started');
  }

  /**
   * Stop the report scheduler
   */
  stopScheduler(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = undefined;
      this.emit('scheduler-stopped');
    }
  }

  /**
   * Create a custom section
   */
  createSection(type: ReportSection['type'], title: string, content: unknown): ReportSection {
    return {
      id: this.generateId(),
      title,
      type,
      content
    };
  }

  /**
   * Create a table section
   */
  createTableSection(title: string, data: TableData): ReportSection {
    return this.createSection('table', title, data);
  }

  /**
   * Create a chart section
   */
  createChartSection(title: string, data: ChartData): ReportSection {
    return this.createSection('chart', title, data);
  }

  /**
   * Create a metric section
   */
  createMetricSection(title: string, metrics: MetricData[]): ReportSection {
    return this.createSection('metric', title, metrics);
  }

  /**
   * Create a text section
   */
  createTextSection(title: string, text: string): ReportSection {
    return this.createSection('text', title, text);
  }

  /**
   * Validate report data
   */
  validateReport(data: ReportData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!data.title) {
      errors.push('Report title is required');
    }

    if (!data.metadata) {
      errors.push('Report metadata is required');
    } else {
      if (!data.metadata.reportId) {
        errors.push('Report ID is required');
      }
      if (!data.metadata.generatedBy) {
        errors.push('Generated by field is required');
      }
    }

    if (!data.sections || data.sections.length === 0) {
      errors.push('Report must have at least one section');
    } else {
      data.sections.forEach((section, index) => {
        if (!section.id) {
          errors.push(`Section ${index + 1} missing ID`);
        }
        if (!section.title) {
          errors.push(`Section ${index + 1} missing title`);
        }
        if (section.content === undefined) {
          errors.push(`Section ${index + 1} missing content`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Cache data with TTL
   */
  cacheData(key: string, data: unknown, ttl: number = 300000): void { // 5 minutes default
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  /**
   * Get cached data
   */
  getCachedData(key: string): unknown | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > cached.ttl;
    if (isExpired) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    this.emit('cache-cleared');
  }

  /**
   * Build report data from template
   */
  private async buildReportFromTemplate(
    template: ReportTemplate,
    variables: Record<string, unknown>
  ): Promise<ReportData> {
    const reportData: ReportData = {
      title: this.interpolateString(template.name, variables),
      metadata: {
        generatedAt: Date.now(),
        generatedBy: 'report-engine',
        version: '1.0.0',
        reportId: this.generateId()
      },
      sections: []
    };

    // Process each template section
    for (const templateSection of template.sections) {
      // Check condition if specified
      if (templateSection.condition && !templateSection.condition(variables)) {
        continue;
      }

      // Fetch data if data source specified
      let content: unknown = null;
      if (templateSection.dataSource) {
        const dataSource = this.dataSources.get(templateSection.dataSource);
        if (dataSource) {
          const cacheKey = `${templateSection.dataSource}_${JSON.stringify(variables)}`;
          content = this.getCachedData(cacheKey);
          
          if (!content) {
            content = await dataSource.fetch(undefined, variables);
            if (dataSource.transform) {
              content = dataSource.transform(content);
            }
            if (dataSource.cache?.enabled) {
              this.cacheData(cacheKey, content, dataSource.cache.ttl);
            }
          }
        }
      }

      // Apply template transform if specified
      if (templateSection.transform && content) {
        content = templateSection.transform(content);
      }

      const section: ReportSection = {
        id: templateSection.id,
        title: this.interpolateString(templateSection.title, variables),
        type: templateSection.type,
        content
      };

      reportData.sections.push(section);
    }

    return reportData;
  }

  /**
   * Apply filter to report data
   */
  private applyFilter(data: ReportData, filter: ReportFilter): ReportData {
    const filtered = { ...data };

    // Filter sections
    if (filter.sections) {
      filtered.sections = data.sections.filter(section =>
        filter.sections!.includes(section.id)
      );
    }

    // Filter by date range
    if (filter.dateRange) {
      const { start, end } = filter.dateRange;
      if (data.metadata.generatedAt < start || data.metadata.generatedAt > end) {
        filtered.sections = [];
      }
    }

    return filtered;
  }

  /**
   * Process scheduled reports
   */
  private async processScheduledReports(): Promise<void> {
    const now = Date.now();

    for (const schedule of this.schedules.values()) {
      if (!schedule.enabled) continue;

      const shouldRun = this.shouldRunSchedule(schedule, now);
      if (shouldRun) {
        try {
          await this.runScheduledReport(schedule);
          schedule.lastRun = now;
          schedule.nextRun = this.calculateNextRun(schedule.cron, now);
          this.emit('scheduled-report-completed', schedule);
        } catch (error) {
          this.emit('scheduled-report-failed', schedule, error);
        }
      }
    }
  }

  /**
   * Check if schedule should run
   */
  private shouldRunSchedule(schedule: ReportSchedule, now: number): boolean {
    if (!schedule.nextRun) {
      schedule.nextRun = this.calculateNextRun(schedule.cron, now);
    }
    return now >= schedule.nextRun;
  }

  /**
   * Run a scheduled report
   */
  private async runScheduledReport(schedule: ReportSchedule): Promise<void> {
    const template = this.templates.get(schedule.template);
    if (!template) {
      throw new Error(`Template not found: ${schedule.template}`);
    }

    // Use default values for template variables
    const variables: Record<string, unknown> = {};
    template.variables?.forEach(variable => {
      if (variable.default !== undefined) {
        variables[variable.name] = variable.default;
      }
    });

    const options: ExportOptions = {
      format: schedule.format,
      destination: `/tmp/scheduled_${schedule.id}_${Date.now()}.${schedule.format}`
    };

    const result = await this.generateFromTemplate(
      schedule.template,
      variables,
      options
    );

    // Save to file
    if (typeof result === 'string') {
      await fs.promises.writeFile(options.destination, result, 'utf8');
    } else {
      await fs.promises.writeFile(options.destination, result);
    }

    // Send to recipients (simplified - in practice would integrate with email service)
    this.emit('report-ready-for-delivery', {
      schedule,
      filePath: options.destination,
      recipients: schedule.recipients
    });
  }

  /**
   * Calculate next run time from cron expression (simplified)
   */
  private calculateNextRun(cron: string, from: number): number {
    // Simplified cron parsing - in production would use proper cron library
    const parts = cron.split(' ');
    if (parts.length !== 5) {
      throw new Error('Invalid cron expression');
    }

    // For demo, assume daily at specific hour
    if (cron === '0 9 * * *') { // Daily at 9 AM
      const tomorrow = new Date(from);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      return tomorrow.getTime();
    }

    // Default to 1 hour from now
    return from + 60 * 60 * 1000;
  }

  /**
   * Interpolate variables in string
   */
  private interpolateString(template: string, variables: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      return String(variables[varName] || match);
    });
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Setup default report generators
   */
  private setupDefaultGenerators(): void {
    this.registerGenerator('html', new HTMLReportGenerator());
    this.registerGenerator('json', new JSONReportGenerator());
    this.registerGenerator('csv', new CSVReportGenerator());
    this.registerGenerator('markdown', new MarkdownReportGenerator());
  }
}

/**
 * HTML Report Generator
 */
export class HTMLReportGenerator implements ReportGenerator {
  supports = ['html'];

  async generate(data: ReportData, options: ExportOptions): Promise<string> {
    let html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${data.title}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        .header { border-bottom: 2px solid #333; margin-bottom: 30px; padding-bottom: 20px; }
        .section { margin-bottom: 30px; }
        .section h2 { color: #333; border-bottom: 1px solid #ccc; padding-bottom: 10px; }
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f2f2f2; }
        .metric { display: inline-block; margin: 10px; padding: 20px; background: #f9f9f9; border-radius: 5px; }
        .metric-value { font-size: 2em; font-weight: bold; color: #333; }
        .metric-label { color: #666; }
        .metadata { font-size: 0.9em; color: #666; margin-top: 30px; }
        code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
        pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
    </style>
</head>
<body>
    <div class="header">
        <h1>${data.title}</h1>
        ${data.summary ? `<p>${data.summary}</p>` : ''}
    </div>
    `;

    // Generate sections
    for (const section of data.sections) {
      html += this.generateSection(section);
    }

    // Add metadata footer
    html += `
    <div class="metadata">
        <p><strong>Report ID:</strong> ${data.metadata.reportId}</p>
        <p><strong>Generated:</strong> ${new Date(data.metadata.generatedAt).toLocaleString()}</p>
        <p><strong>Generated by:</strong> ${data.metadata.generatedBy}</p>
    </div>
</body>
</html>
    `;

    return html;
  }

  private generateSection(section: ReportSection): string {
    let html = `<div class="section"><h2>${section.title}</h2>`;

    switch (section.type) {
      case 'text':
        html += `<p>${section.content}</p>`;
        break;
      case 'table':
        html += this.generateTable(section.content as TableData);
        break;
      case 'chart':
        html += this.generateChart(section.content as ChartData);
        break;
      case 'metric':
        html += this.generateMetrics(section.content as MetricData[]);
        break;
      case 'code':
        html += `<pre><code>${section.content}</code></pre>`;
        break;
      case 'list':
        const items = section.content as string[];
        html += `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
        break;
      default:
        html += `<div>${JSON.stringify(section.content, null, 2)}</div>`;
    }

    html += '</div>';
    return html;
  }

  private generateTable(data: TableData): string {
    let html = '<table><thead><tr>';
    data.headers.forEach(header => {
      html += `<th>${header}</th>`;
    });
    html += '</tr></thead><tbody>';
    
    data.rows.forEach(row => {
      html += '<tr>';
      row.forEach(cell => {
        html += `<td>${cell}</td>`;
      });
      html += '</tr>';
    });
    
    html += '</tbody></table>';
    return html;
  }

  private generateChart(data: ChartData): string {
    // Simplified chart representation (in production would use Chart.js or similar)
    return `<div style="background: #f0f0f0; padding: 20px; text-align: center; border-radius: 5px;">
        <h3>${data.title || 'Chart'}</h3>
        <p>Chart Type: ${data.type}</p>
        <p>Data Points: ${data.data.datasets.reduce((sum, ds) => sum + ds.data.length, 0)}</p>
    </div>`;
  }

  private generateMetrics(metrics: MetricData[]): string {
    return metrics.map(metric => `
        <div class="metric">
            <div class="metric-value">${metric.value}${metric.unit || ''}</div>
            <div class="metric-label">${metric.label}</div>
            ${metric.change ? `<div style="color: ${metric.change.direction === 'up' ? 'green' : 'red'}">
                ${metric.change.direction === 'up' ? '↑' : '↓'} ${metric.change.value}% (${metric.change.period})
            </div>` : ''}
        </div>
    `).join('');
  }
}

/**
 * JSON Report Generator
 */
export class JSONReportGenerator implements ReportGenerator {
  supports = ['json'];

  async generate(data: ReportData): Promise<string> {
    return JSON.stringify(data, null, 2);
  }
}

/**
 * CSV Report Generator
 */
export class CSVReportGenerator implements ReportGenerator {
  supports = ['csv'];

  async generate(data: ReportData): Promise<string> {
    const lines: string[] = [];
    
    // Add header
    lines.push(`"${data.title}"`);
    lines.push(`"Generated: ${new Date(data.metadata.generatedAt).toLocaleString()}"`);
    lines.push('');

    // Process sections
    data.sections.forEach(section => {
      lines.push(`"${section.title}"`);
      
      if (section.type === 'table') {
        const tableData = section.content as TableData;
        lines.push(tableData.headers.map(h => `"${h}"`).join(','));
        tableData.rows.forEach(row => {
          lines.push(row.map(cell => `"${cell}"`).join(','));
        });
      } else {
        lines.push(`"${JSON.stringify(section.content)}"`);
      }
      
      lines.push('');
    });

    return lines.join('\n');
  }
}

/**
 * Markdown Report Generator
 */
export class MarkdownReportGenerator implements ReportGenerator {
  supports = ['markdown'];

  async generate(data: ReportData): Promise<string> {
    let markdown = `# ${data.title}\n\n`;
    
    if (data.summary) {
      markdown += `${data.summary}\n\n`;
    }

    // Generate sections
    data.sections.forEach(section => {
      markdown += `## ${section.title}\n\n`;
      
      switch (section.type) {
        case 'text':
          markdown += `${section.content}\n\n`;
          break;
        case 'table':
          markdown += this.generateMarkdownTable(section.content as TableData);
          break;
        case 'code':
          markdown += `\`\`\`\n${section.content}\n\`\`\`\n\n`;
          break;
        case 'list':
          const items = section.content as string[];
          markdown += items.map(item => `- ${item}`).join('\n') + '\n\n';
          break;
        default:
          markdown += `\`\`\`json\n${JSON.stringify(section.content, null, 2)}\n\`\`\`\n\n`;
      }
    });

    // Add metadata
    markdown += `---\n\n`;
    markdown += `**Report ID:** ${data.metadata.reportId}\n`;
    markdown += `**Generated:** ${new Date(data.metadata.generatedAt).toLocaleString()}\n`;
    markdown += `**Generated by:** ${data.metadata.generatedBy}\n`;

    return markdown;
  }

  private generateMarkdownTable(data: TableData): string {
    let table = '| ' + data.headers.join(' | ') + ' |\n';
    table += '| ' + data.headers.map(() => '---').join(' | ') + ' |\n';
    
    data.rows.forEach(row => {
      table += '| ' + row.join(' | ') + ' |\n';
    });
    
    return table + '\n';
  }
}

// Export default
export default ReportEngine;