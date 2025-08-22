/**
 * @jest-environment node
 */

import * as fs from 'fs';

import ReportEngine, {
  ReportData,
  ReportSection,
  ReportTemplate,
  TemplateSection,
  ExportOptions,
  ReportFilter,
  DataSource,
  ReportSchedule,
  TableData,
  ChartData,
  MetricData,
  HTMLReportGenerator,
  JSONReportGenerator,
  CSVReportGenerator,
  MarkdownReportGenerator
} from '../index';

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn()
  }
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('ReportEngine', () => {
  let reportEngine: ReportEngine;

  beforeEach(() => {
    reportEngine = new ReportEngine();
    jest.clearAllMocks();
  });

  afterEach(() => {
    reportEngine.stopScheduler();
  });

  describe('ReportEngine instantiation', () => {
    it('should create a new instance', () => {
      expect(reportEngine).toBeInstanceOf(ReportEngine);
    });

    it('should register default generators', () => {
      // Try to generate with default generators
      const mockReport: ReportData = {
        title: 'Test Report',
        metadata: {
          generatedAt: Date.now(),
          generatedBy: 'test',
          version: '1.0.0',
          reportId: 'test-report'
        },
        sections: []
      };

      expect(async () => {
        await reportEngine.generateReport(mockReport, { format: 'html', destination: '/tmp/test.html' });
        await reportEngine.generateReport(mockReport, { format: 'json', destination: '/tmp/test.json' });
        await reportEngine.generateReport(mockReport, { format: 'csv', destination: '/tmp/test.csv' });
        await reportEngine.generateReport(mockReport, { format: 'markdown', destination: '/tmp/test.md' });
      }).not.toThrow();
    });
  });

  describe('templates management', () => {
    it('should register a template', () => {
      const template: ReportTemplate = {
        id: 'test-template',
        name: 'Test Template',
        description: 'A test template',
        sections: [
          {
            id: 'intro',
            title: 'Introduction',
            type: 'text',
            required: true
          }
        ]
      };

      const eventPromise = new Promise((resolve) => {
        reportEngine.on('template-registered', resolve);
      });

      reportEngine.registerTemplate(template);

      const templates = reportEngine.getTemplates();
      expect(templates).toHaveLength(1);
      expect(templates[0].id).toBe('test-template');

      return eventPromise.then((registeredTemplate) => {
        expect(registeredTemplate).toEqual(template);
      });
    });

    it('should get template by ID', () => {
      const template: ReportTemplate = {
        id: 'get-template-test',
        name: 'Get Template Test',
        description: 'Test getting template',
        sections: []
      };

      reportEngine.registerTemplate(template);

      const retrieved = reportEngine.getTemplate('get-template-test');
      expect(retrieved).toEqual(template);

      const notFound = reportEngine.getTemplate('non-existent');
      expect(notFound).toBeUndefined();
    });
  });

  describe('data sources management', () => {
    it('should register a data source', () => {
      const dataSource: DataSource = {
        id: 'test-source',
        name: 'Test Data Source',
        fetch: async () => ({ data: 'test' })
      };

      const eventPromise = new Promise((resolve) => {
        reportEngine.on('data-source-registered', resolve);
      });

      reportEngine.registerDataSource(dataSource);

      return eventPromise.then((registeredSource) => {
        expect(registeredSource).toEqual(dataSource);
      });
    });

    it('should cache data source results', async () => {
      let fetchCount = 0;
      const dataSource: DataSource = {
        id: 'cached-source',
        name: 'Cached Source',
        fetch: async () => {
          fetchCount++;
          return { count: fetchCount };
        },
        cache: {
          enabled: true,
          ttl: 10000 // 10 seconds
        }
      };

      reportEngine.registerDataSource(dataSource);

      const template: ReportTemplate = {
        id: 'cache-test',
        name: 'Cache Test',
        description: 'Test caching',
        sections: [
          {
            id: 'cached-section',
            title: 'Cached Section',
            type: 'text',
            required: true,
            dataSource: 'cached-source'
          }
        ]
      };

      reportEngine.registerTemplate(template);

      // Generate report twice
      await reportEngine.generateFromTemplate('cache-test', {}, { format: 'json', destination: '/tmp/cache1.json' });
      await reportEngine.generateFromTemplate('cache-test', {}, { format: 'json', destination: '/tmp/cache2.json' });

      // Fetch should only be called once due to caching
      expect(fetchCount).toBe(1);
    });
  });

  describe('report generation', () => {
    const mockReportData: ReportData = {
      title: 'Test Report',
      summary: 'A test report for unit testing',
      metadata: {
        generatedAt: Date.now(),
        generatedBy: 'unit-test',
        version: '1.0.0',
        reportId: 'test-report-123'
      },
      sections: [
        {
          id: 'text-section',
          title: 'Text Section',
          type: 'text',
          content: 'This is a text section'
        },
        {
          id: 'table-section',
          title: 'Table Section',
          type: 'table',
          content: {
            headers: ['Name', 'Value', 'Status'],
            rows: [
              ['Item 1', 100, 'Active'],
              ['Item 2', 200, 'Inactive'],
              ['Item 3', 150, 'Active']
            ]
          } as TableData
        }
      ]
    };

    it('should generate HTML report', async () => {
      const options: ExportOptions = {
        format: 'html',
        destination: '/tmp/test.html'
      };

      await reportEngine.generateReport(mockReportData, options);

      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        '/tmp/test.html',
        expect.stringContaining('<!DOCTYPE html>'),
        'utf8'
      );
    });

    it('should generate JSON report', async () => {
      const options: ExportOptions = {
        format: 'json',
        destination: '/tmp/test.json'
      };

      await reportEngine.generateReport(mockReportData, options);

      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        '/tmp/test.json',
        expect.stringContaining('"title":"Test Report"'),
        'utf8'
      );
    });

    it('should emit report-generated event', async () => {
      const eventPromise = new Promise((resolve) => {
        reportEngine.on('report-generated', resolve);
      });

      const options: ExportOptions = {
        format: 'html',
        destination: '/tmp/event-test.html'
      };

      await reportEngine.generateReport(mockReportData, options);

      const eventData = await eventPromise;
      expect(eventData).toHaveProperty('format', 'html');
      expect(eventData).toHaveProperty('outputPath', '/tmp/event-test.html');
    });

    it('should handle generation errors', async () => {
      mockFs.promises.writeFile.mockRejectedValue(new Error('Write failed'));

      const errorPromise = new Promise((resolve) => {
        reportEngine.on('error', resolve);
      });

      const options: ExportOptions = {
        format: 'html',
        destination: '/tmp/error-test.html'
      };

      await expect(
        reportEngine.generateReport(mockReportData, options)
      ).rejects.toThrow();

      const error = await errorPromise;
      expect(error).toBeInstanceOf(Error);
    });

    it('should throw error for unsupported format', async () => {
      const options: ExportOptions = {
        format: 'unsupported' as any,
        destination: '/tmp/unsupported.test'
      };

      await expect(
        reportEngine.generateReport(mockReportData, options)
      ).rejects.toThrow('No generator found for format: unsupported');
    });
  });

  describe('template-based generation', () => {
    beforeEach(() => {
      const dataSource: DataSource = {
        id: 'test-data',
        name: 'Test Data',
        fetch: async () => ({
          metrics: [
            { name: 'CPU Usage', value: 75, unit: '%' },
            { name: 'Memory Usage', value: 60, unit: '%' }
          ],
          tableData: {
            headers: ['Process', 'CPU', 'Memory'],
            rows: [
              ['Process A', '25%', '512MB'],
              ['Process B', '15%', '256MB']
            ]
          }
        })
      };

      reportEngine.registerDataSource(dataSource);
    });

    it('should generate report from template', async () => {
      const template: ReportTemplate = {
        id: 'system-report',
        name: 'System Report',
        description: 'System monitoring report',
        sections: [
          {
            id: 'metrics',
            title: 'System Metrics',
            type: 'metric',
            required: true,
            dataSource: 'test-data',
            transform: (data: any) => data.metrics
          },
          {
            id: 'processes',
            title: 'Running Processes',
            type: 'table',
            required: true,
            dataSource: 'test-data',
            transform: (data: any) => data.tableData
          }
        ],
        variables: [
          {
            name: 'serverName',
            type: 'string',
            required: true,
            description: 'Server name'
          }
        ]
      };

      reportEngine.registerTemplate(template);

      const variables = { serverName: 'web-server-01' };
      const options: ExportOptions = { format: 'html', destination: '/tmp/system.html' };

      await reportEngine.generateFromTemplate('system-report', variables, options);

      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        '/tmp/system.html',
        expect.stringContaining('web-server-01'),
        'utf8'
      );
    });

    it('should validate required variables', async () => {
      const template: ReportTemplate = {
        id: 'variable-test',
        name: 'Variable Test',
        description: 'Test variable validation',
        sections: [],
        variables: [
          {
            name: 'required-var',
            type: 'string',
            required: true
          }
        ]
      };

      reportEngine.registerTemplate(template);

      const options: ExportOptions = { format: 'json', destination: '/tmp/var-test.json' };

      await expect(
        reportEngine.generateFromTemplate('variable-test', {}, options)
      ).rejects.toThrow('Missing required variables: required-var');
    });

    it('should handle template not found', async () => {
      const options: ExportOptions = { format: 'json', destination: '/tmp/notfound.json' };

      await expect(
        reportEngine.generateFromTemplate('non-existent', {}, options)
      ).rejects.toThrow('Template not found: non-existent');
    });

    it('should skip conditional sections', async () => {
      const template: ReportTemplate = {
        id: 'conditional-test',
        name: 'Conditional Test',
        description: 'Test conditional sections',
        sections: [
          {
            id: 'always-included',
            title: 'Always Included',
            type: 'text',
            required: true
          },
          {
            id: 'conditional',
            title: 'Conditional Section',
            type: 'text',
            required: false,
            condition: (data: any) => data.includeConditional === true
          }
        ]
      };

      reportEngine.registerTemplate(template);

      const variables = { includeConditional: false };
      const options: ExportOptions = { format: 'json', destination: '/tmp/conditional.json' };

      const result = await reportEngine.generateFromTemplate('conditional-test', variables, options);

      // Parse the JSON result to check sections
      const writeCall = mockFs.promises.writeFile.mock.calls[0];
      const jsonContent = writeCall[1] as string;
      const parsedReport = JSON.parse(jsonContent);

      expect(parsedReport.sections).toHaveLength(1);
      expect(parsedReport.sections[0].id).toBe('always-included');
    });
  });

  describe('filters', () => {
    const mockReportData: ReportData = {
      title: 'Filtered Report',
      metadata: {
        generatedAt: Date.now() - 3600000, // 1 hour ago
        generatedBy: 'test',
        version: '1.0.0',
        reportId: 'filtered-report'
      },
      sections: [
        { id: 'section-1', title: 'Section 1', type: 'text', content: 'Content 1' },
        { id: 'section-2', title: 'Section 2', type: 'text', content: 'Content 2' },
        { id: 'section-3', title: 'Section 3', type: 'text', content: 'Content 3' }
      ]
    };

    it('should filter sections', async () => {
      const filter: ReportFilter = {
        sections: ['section-1', 'section-3']
      };

      const options: ExportOptions = { format: 'json', destination: '/tmp/filtered.json' };

      await reportEngine.generateReport(mockReportData, options, filter);

      const writeCall = mockFs.promises.writeFile.mock.calls[0];
      const jsonContent = writeCall[1] as string;
      const parsedReport = JSON.parse(jsonContent);

      expect(parsedReport.sections).toHaveLength(2);
      expect(parsedReport.sections.map((s: any) => s.id)).toEqual(['section-1', 'section-3']);
    });

    it('should filter by date range', async () => {
      const filter: ReportFilter = {
        dateRange: {
          start: Date.now() - 7200000, // 2 hours ago
          end: Date.now() - 1800000   // 30 minutes ago
        }
      };

      const options: ExportOptions = { format: 'json', destination: '/tmp/date-filtered.json' };

      await reportEngine.generateReport(mockReportData, options, filter);

      const writeCall = mockFs.promises.writeFile.mock.calls[0];
      const jsonContent = writeCall[1] as string;
      const parsedReport = JSON.parse(jsonContent);

      // Report is outside the date range, so sections should be empty
      expect(parsedReport.sections).toHaveLength(0);
    });
  });

  describe('report scheduling', () => {
    beforeEach(() => {
      const template: ReportTemplate = {
        id: 'scheduled-template',
        name: 'Scheduled Template',
        description: 'Template for scheduled reports',
        sections: [
          {
            id: 'daily-metrics',
            title: 'Daily Metrics',
            type: 'text',
            required: true
          }
        ],
        variables: [
          {
            name: 'date',
            type: 'string',
            required: false,
            default: new Date().toISOString().split('T')[0]
          }
        ]
      };

      reportEngine.registerTemplate(template);
    });

    it('should schedule a report', () => {
      const schedule: ReportSchedule = {
        id: 'daily-report',
        name: 'Daily Report',
        template: 'scheduled-template',
        cron: '0 9 * * *', // Daily at 9 AM
        enabled: true,
        recipients: ['admin@example.com'],
        format: 'html'
      };

      const eventPromise = new Promise((resolve) => {
        reportEngine.on('report-scheduled', resolve);
      });

      reportEngine.scheduleReport(schedule);

      const schedules = reportEngine.getSchedules();
      expect(schedules).toHaveLength(1);
      expect(schedules[0].id).toBe('daily-report');

      return eventPromise.then((scheduledReport) => {
        expect(scheduledReport).toEqual(schedule);
      });
    });

    it('should unschedule a report', () => {
      const schedule: ReportSchedule = {
        id: 'removable-schedule',
        name: 'Removable Schedule',
        template: 'scheduled-template',
        cron: '0 9 * * *',
        enabled: true,
        recipients: [],
        format: 'json'
      };

      reportEngine.scheduleReport(schedule);
      expect(reportEngine.getSchedules()).toHaveLength(1);

      const eventPromise = new Promise((resolve) => {
        reportEngine.on('report-unscheduled', resolve);
      });

      const removed = reportEngine.unscheduleReport('removable-schedule');
      expect(removed).toBe(true);
      expect(reportEngine.getSchedules()).toHaveLength(0);

      return eventPromise.then((scheduleId) => {
        expect(scheduleId).toBe('removable-schedule');
      });
    });

    it('should start and stop scheduler', () => {
      expect(() => {
        reportEngine.startScheduler();
        reportEngine.stopScheduler();
      }).not.toThrow();
    });

    it('should emit scheduler events', async () => {
      const startedPromise = new Promise((resolve) => {
        reportEngine.on('scheduler-started', resolve);
      });

      const stoppedPromise = new Promise((resolve) => {
        reportEngine.on('scheduler-stopped', resolve);
      });

      reportEngine.startScheduler();
      await startedPromise;

      reportEngine.stopScheduler();
      await stoppedPromise;
    });

    it('should process scheduled reports', (done) => {
      const schedule: ReportSchedule = {
        id: 'test-process',
        name: 'Test Process',
        template: 'scheduled-template',
        cron: '0 9 * * *',
        enabled: true,
        recipients: ['test@example.com'],
        format: 'html',
        nextRun: Date.now() - 1000 // Past due
      };

      reportEngine.scheduleReport(schedule);

      reportEngine.on('scheduled-report-completed', (completedSchedule) => {
        expect(completedSchedule.id).toBe('test-process');
        done();
      });

      reportEngine.startScheduler();
    });

    it('should handle scheduled report failures', (done) => {
      const schedule: ReportSchedule = {
        id: 'failing-schedule',
        name: 'Failing Schedule',
        template: 'non-existent-template',
        cron: '0 9 * * *',
        enabled: true,
        recipients: [],
        format: 'html',
        nextRun: Date.now() - 1000
      };

      reportEngine.scheduleReport(schedule);

      reportEngine.on('scheduled-report-failed', (failedSchedule, error) => {
        expect(failedSchedule.id).toBe('failing-schedule');
        expect(error).toBeInstanceOf(Error);
        done();
      });

      reportEngine.startScheduler();
    });
  });

  describe('section creation helpers', () => {
    it('should create text section', () => {
      const section = reportEngine.createTextSection('Test Title', 'Test content');

      expect(section.type).toBe('text');
      expect(section.title).toBe('Test Title');
      expect(section.content).toBe('Test content');
      expect(section.id).toBeDefined();
    });

    it('should create table section', () => {
      const tableData: TableData = {
        headers: ['Column 1', 'Column 2'],
        rows: [['Value 1', 'Value 2']]
      };

      const section = reportEngine.createTableSection('Table Title', tableData);

      expect(section.type).toBe('table');
      expect(section.title).toBe('Table Title');
      expect(section.content).toEqual(tableData);
    });

    it('should create chart section', () => {
      const chartData: ChartData = {
        type: 'bar',
        title: 'Sample Chart',
        data: {
          labels: ['A', 'B', 'C'],
          datasets: [{
            label: 'Dataset 1',
            data: [10, 20, 30]
          }]
        }
      };

      const section = reportEngine.createChartSection('Chart Title', chartData);

      expect(section.type).toBe('chart');
      expect(section.title).toBe('Chart Title');
      expect(section.content).toEqual(chartData);
    });

    it('should create metric section', () => {
      const metrics: MetricData[] = [
        {
          value: 85,
          unit: '%',
          label: 'CPU Usage',
          status: 'warning'
        },
        {
          value: 60,
          unit: '%',
          label: 'Memory Usage',
          status: 'good'
        }
      ];

      const section = reportEngine.createMetricSection('Metrics Title', metrics);

      expect(section.type).toBe('metric');
      expect(section.title).toBe('Metrics Title');
      expect(section.content).toEqual(metrics);
    });
  });

  describe('report validation', () => {
    it('should validate valid report', () => {
      const validReport: ReportData = {
        title: 'Valid Report',
        metadata: {
          generatedAt: Date.now(),
          generatedBy: 'test',
          version: '1.0.0',
          reportId: 'valid-report'
        },
        sections: [
          {
            id: 'section-1',
            title: 'Section 1',
            type: 'text',
            content: 'Content'
          }
        ]
      };

      const validation = reportEngine.validateReport(validReport);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect missing title', () => {
      const invalidReport = {
        metadata: {
          generatedAt: Date.now(),
          generatedBy: 'test',
          version: '1.0.0',
          reportId: 'invalid-report'
        },
        sections: []
      } as ReportData;

      const validation = reportEngine.validateReport(invalidReport);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Report title is required');
    });

    it('should detect missing metadata', () => {
      const invalidReport = {
        title: 'Report Without Metadata',
        sections: []
      } as ReportData;

      const validation = reportEngine.validateReport(invalidReport);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Report metadata is required');
    });

    it('should detect missing sections', () => {
      const invalidReport = {
        title: 'Report Without Sections',
        metadata: {
          generatedAt: Date.now(),
          generatedBy: 'test',
          version: '1.0.0',
          reportId: 'no-sections'
        },
        sections: []
      } as ReportData;

      const validation = reportEngine.validateReport(invalidReport);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Report must have at least one section');
    });

    it('should detect section validation errors', () => {
      const invalidReport: ReportData = {
        title: 'Report With Invalid Sections',
        metadata: {
          generatedAt: Date.now(),
          generatedBy: 'test',
          version: '1.0.0',
          reportId: 'invalid-sections'
        },
        sections: [
          {
            id: '',
            title: '',
            type: 'text',
            content: undefined
          } as any
        ]
      };

      const validation = reportEngine.validateReport(invalidReport);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Section 1 missing ID');
      expect(validation.errors).toContain('Section 1 missing title');
      expect(validation.errors).toContain('Section 1 missing content');
    });
  });

  describe('caching', () => {
    it('should cache data', () => {
      const testData = { test: 'data' };
      reportEngine.cacheData('test-key', testData, 5000);

      const cached = reportEngine.getCachedData('test-key');
      expect(cached).toEqual(testData);
    });

    it('should return null for expired cache', (done) => {
      const testData = { test: 'data' };
      reportEngine.cacheData('expire-test', testData, 10); // 10ms TTL

      setTimeout(() => {
        const cached = reportEngine.getCachedData('expire-test');
        expect(cached).toBeNull();
        done();
      }, 20);
    });

    it('should clear cache', () => {
      reportEngine.cacheData('clear-test', { data: 'test' });

      const eventPromise = new Promise((resolve) => {
        reportEngine.on('cache-cleared', resolve);
      });

      reportEngine.clearCache();

      const cached = reportEngine.getCachedData('clear-test');
      expect(cached).toBeNull();

      return eventPromise;
    });
  });

  describe('built-in generators', () => {
    const mockReportData: ReportData = {
      title: 'Generator Test',
      summary: 'Testing generators',
      metadata: {
        generatedAt: Date.now(),
        generatedBy: 'generator-test',
        version: '1.0.0',
        reportId: 'gen-test'
      },
      sections: [
        {
          id: 'text-section',
          title: 'Text Section',
          type: 'text',
          content: 'Sample text content'
        },
        {
          id: 'table-section',
          title: 'Table Section',
          type: 'table',
          content: {
            headers: ['Name', 'Value'],
            rows: [['Item 1', '100'], ['Item 2', '200']]
          } as TableData
        },
        {
          id: 'chart-section',
          title: 'Chart Section',
          type: 'chart',
          content: {
            type: 'bar',
            data: {
              labels: ['A', 'B'],
              datasets: [{ label: 'Data', data: [10, 20] }]
            }
          } as ChartData
        },
        {
          id: 'metric-section',
          title: 'Metrics',
          type: 'metric',
          content: [
            { value: 75, unit: '%', label: 'Performance' }
          ] as MetricData[]
        },
        {
          id: 'code-section',
          title: 'Code',
          type: 'code',
          content: 'console.log("Hello World");'
        },
        {
          id: 'list-section',
          title: 'List',
          type: 'list',
          content: ['Item 1', 'Item 2', 'Item 3']
        }
      ]
    };

    describe('HTMLReportGenerator', () => {
      const generator = new HTMLReportGenerator();

      it('should generate valid HTML', async () => {
        const options: ExportOptions = { format: 'html', destination: '/tmp/test.html' };
        const html = await generator.generate(mockReportData, options);

        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('<title>Generator Test</title>');
        expect(html).toContain('<h1>Generator Test</h1>');
        expect(html).toContain('Sample text content');
        expect(html).toContain('<table>');
        expect(html).toContain('<th>Name</th>');
        expect(html).toContain('<td>Item 1</td>');
      });

      it('should handle different section types', async () => {
        const options: ExportOptions = { format: 'html', destination: '/tmp/test.html' };
        const html = await generator.generate(mockReportData, options);

        expect(html).toContain('Chart Type: bar'); // Chart section
        expect(html).toContain('75%'); // Metric section
        expect(html).toContain('<pre><code>'); // Code section
        expect(html).toContain('<ul>'); // List section
      });
    });

    describe('JSONReportGenerator', () => {
      const generator = new JSONReportGenerator();

      it('should generate valid JSON', async () => {
        const json = await generator.generate(mockReportData);
        const parsed = JSON.parse(json);

        expect(parsed.title).toBe('Generator Test');
        expect(parsed.metadata.reportId).toBe('gen-test');
        expect(parsed.sections).toHaveLength(6);
      });
    });

    describe('CSVReportGenerator', () => {
      const generator = new CSVReportGenerator();

      it('should generate CSV format', async () => {
        const csv = await generator.generate(mockReportData);

        expect(csv).toContain('"Generator Test"');
        expect(csv).toContain('"Generated:');
        expect(csv).toContain('"Text Section"');
        expect(csv).toContain('"Name","Value"');
        expect(csv).toContain('"Item 1","100"');
      });
    });

    describe('MarkdownReportGenerator', () => {
      const generator = new MarkdownReportGenerator();

      it('should generate Markdown format', async () => {
        const markdown = await generator.generate(mockReportData);

        expect(markdown).toContain('# Generator Test');
        expect(markdown).toContain('## Text Section');
        expect(markdown).toContain('Sample text content');
        expect(markdown).toContain('| Name | Value |');
        expect(markdown).toContain('| --- | --- |');
        expect(markdown).toContain('```');
        expect(markdown).toContain('- Item 1');
      });
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle custom generator registration', () => {
      const customGenerator = {
        supports: ['custom'],
        generate: async (data: ReportData) => 'Custom output'
      };

      const eventPromise = new Promise((resolve) => {
        reportEngine.on('generator-registered', resolve);
      });

      reportEngine.registerGenerator('custom', customGenerator);

      return eventPromise.then((format) => {
        expect(format).toBe('custom');
      });
    });

    it('should handle data source fetch errors', async () => {
      const errorDataSource: DataSource = {
        id: 'error-source',
        name: 'Error Source',
        fetch: async () => {
          throw new Error('Data source error');
        }
      };

      reportEngine.registerDataSource(errorDataSource);

      const template: ReportTemplate = {
        id: 'error-template',
        name: 'Error Template',
        description: 'Template with error source',
        sections: [
          {
            id: 'error-section',
            title: 'Error Section',
            type: 'text',
            required: true,
            dataSource: 'error-source'
          }
        ]
      };

      reportEngine.registerTemplate(template);

      const options: ExportOptions = { format: 'json', destination: '/tmp/error.json' };

      // Should still generate report, but with null content for the failing section
      await reportEngine.generateFromTemplate('error-template', {}, options);

      const writeCall = mockFs.promises.writeFile.mock.calls[0];
      const jsonContent = writeCall[1] as string;
      const parsedReport = JSON.parse(jsonContent);

      expect(parsedReport.sections[0].content).toBeNull();
    });

    it('should handle empty report data', async () => {
      const emptyReport: ReportData = {
        title: 'Empty Report',
        metadata: {
          generatedAt: Date.now(),
          generatedBy: 'test',
          version: '1.0.0',
          reportId: 'empty'
        },
        sections: []
      };

      const options: ExportOptions = { format: 'html', destination: '/tmp/empty.html' };

      // Should validate as invalid but still try to generate
      const validation = reportEngine.validateReport(emptyReport);
      expect(validation.valid).toBe(false);

      // Should still generate something
      await expect(
        reportEngine.generateReport(emptyReport, options)
      ).not.toThrow();
    });

    it('should handle very large reports', () => {
      const largeReport: ReportData = {
        title: 'Large Report',
        metadata: {
          generatedAt: Date.now(),
          generatedBy: 'test',
          version: '1.0.0',
          reportId: 'large'
        },
        sections: []
      };

      // Add many sections
      for (let i = 0; i < 1000; i++) {
        largeReport.sections.push({
          id: `section-${i}`,
          title: `Section ${i}`,
          type: 'text',
          content: `Content for section ${i}`
        });
      }

      expect(() => {
        reportEngine.validateReport(largeReport);
      }).not.toThrow();
    });

    it('should handle malformed section content', async () => {
      const malformedReport: ReportData = {
        title: 'Malformed Report',
        metadata: {
          generatedAt: Date.now(),
          generatedBy: 'test',
          version: '1.0.0',
          reportId: 'malformed'
        },
        sections: [
          {
            id: 'malformed-table',
            title: 'Malformed Table',
            type: 'table',
            content: 'This should be table data but is just a string'
          }
        ]
      };

      const options: ExportOptions = { format: 'html', destination: '/tmp/malformed.html' };

      // Should handle gracefully
      await expect(
        reportEngine.generateReport(malformedReport, options)
      ).not.toThrow();
    });
  });

  describe('Performance tests', () => {
    it('should handle rapid report generation', async () => {
      const mockReport: ReportData = {
        title: 'Performance Test',
        metadata: {
          generatedAt: Date.now(),
          generatedBy: 'perf-test',
          version: '1.0.0',
          reportId: 'perf'
        },
        sections: [
          {
            id: 'perf-section',
            title: 'Performance Section',
            type: 'text',
            content: 'Performance test content'
          }
        ]
      };

      const startTime = Date.now();
      const promises = [];

      for (let i = 0; i < 10; i++) {
        const options: ExportOptions = {
          format: 'json',
          destination: `/tmp/perf-${i}.json`
        };
        promises.push(reportEngine.generateReport(mockReport, options));
      }

      await Promise.all(promises);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});