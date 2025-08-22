/**
 * @jest-environment node
 */

import * as fs from 'fs';

import CoverageAggregator, {
  CoverageFile,
  CoverageReport,
  CoverageSummary,
  CoverageThreshold
} from '../index';

// Type-only imports for unused types
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { CoverageDelta, CoverageAnalysis } from '../index';

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn()
  }
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('CoverageAggregator', () => {
  let coverageAggregator: CoverageAggregator;

  beforeEach(() => {
    coverageAggregator = new CoverageAggregator();
    jest.clearAllMocks();
  });

  describe('CoverageAggregator instantiation', () => {
    it('should create a new instance', () => {
      expect(coverageAggregator).toBeInstanceOf(CoverageAggregator);
    });

    it('should create instance with thresholds', () => {
      const thresholds: CoverageThreshold = {
        global: {
          lines: 80,
          functions: 75,
          statements: 80,
          branches: 70
        }
      };

      const aggregator = new CoverageAggregator(thresholds);
      expect(aggregator).toBeInstanceOf(CoverageAggregator);
    });
  });

  describe('loadCoverage', () => {
    const sampleLcovData = `SF:/path/to/file.js
FN:1,functionName
FN:5,anotherFunction
FNDA:1,functionName
FNDA:0,anotherFunction
FNF:2
FNH:1
DA:1,1
DA:2,1
DA:3,0
DA:4,1
DA:5,0
LF:5
LH:3
end_of_record`;

    const sampleJsonData = JSON.stringify({
      '/path/to/file.js': {
        f: { '0': 1, '1': 0 },
        fnMap: {
          '0': { name: 'functionName', decl: { start: { line: 1 } } },
          '1': { name: 'anotherFunction', decl: { start: { line: 5 } } }
        },
        s: { '0': 1, '1': 1, '2': 0, '3': 1, '4': 0 },
        statementMap: {
          '0': { start: { line: 1 } },
          '1': { start: { line: 2 } },
          '2': { start: { line: 3 } },
          '3': { start: { line: 4 } },
          '4': { start: { line: 5 } }
        },
        b: { '0': [1, 0] },
        branchMap: {}
      }
    });

    it('should load LCOV format coverage', async () => {
      mockFs.promises.readFile.mockResolvedValue(sampleLcovData);

      const report = await coverageAggregator.loadCoverage('/path/to/lcov.info', 'lcov');

      expect(report.files.size).toBe(1);
      const file = report.files.get('/path/to/file.js');
      expect(file).toBeDefined();
      expect(file?.functions.found).toBe(2);
      expect(file?.functions.hit).toBe(1);
      expect(file?.lines.found).toBe(5);
      expect(file?.lines.hit).toBe(3);
    });

    it('should load JSON format coverage', async () => {
      mockFs.promises.readFile.mockResolvedValue(sampleJsonData);

      const report = await coverageAggregator.loadCoverage('/path/to/coverage.json', 'json');

      expect(report.files.size).toBe(1);
      const file = report.files.get('/path/to/file.js');
      expect(file).toBeDefined();
      expect(file?.functions.found).toBe(2);
      expect(file?.statements.found).toBe(5);
    });

    it('should emit coverage-loaded event', async () => {
      mockFs.promises.readFile.mockResolvedValue(sampleLcovData);

      const eventPromise = new Promise((resolve) => {
        coverageAggregator.on('coverage-loaded', resolve);
      });

      await coverageAggregator.loadCoverage('/path/to/lcov.info', 'lcov');
      const eventData = await eventPromise;

      expect(eventData).toHaveProperty('filePath', '/path/to/lcov.info');
      expect(eventData).toHaveProperty('format', 'lcov');
      expect(eventData).toHaveProperty('report');
    });

    it('should handle file read errors', async () => {
      mockFs.promises.readFile.mockRejectedValue(new Error('File not found'));

      const eventPromise = new Promise((resolve) => {
        coverageAggregator.on('error', resolve);
      });

      await expect(coverageAggregator.loadCoverage('/invalid/path.info')).rejects.toThrow();
      const error = await eventPromise;

      expect(error).toBeInstanceOf(Error);
    });

    it('should handle unsupported format', async () => {
      mockFs.promises.readFile.mockResolvedValue('data');

      await expect(
        coverageAggregator.loadCoverage('/path/to/file', 'unsupported' as any)
      ).rejects.toThrow('Unsupported format: unsupported');
    });

    it('should parse Cobertura format', async () => {
      const coberturaData = `<?xml version="1.0"?>
<coverage>
  <classes>
    <class filename="file1.js" />
    <class filename="file2.js" />
  </classes>
</coverage>`;

      mockFs.promises.readFile.mockResolvedValue(coberturaData);

      const report = await coverageAggregator.loadCoverage('/path/to/cobertura.xml', 'cobertura');

      expect(report.files.size).toBe(2);
    });
  });

  describe('mergeCoverage', () => {
    const createMockReport = (fileData: Record<string, Partial<CoverageFile>>): CoverageReport => ({
      files: new Map(Object.entries(fileData).map(([path, data]) => [
        path,
        {
          path,
          functions: { found: 2, hit: 1, details: [] },
          branches: { found: 4, hit: 2, details: [] },
          lines: { found: 10, hit: 7, details: [] },
          statements: { found: 8, hit: 6, details: [] },
          ...data
        } as CoverageFile
      ])),
      summary: {
        lines: { total: 0, covered: 0, skipped: 0, pct: 0 },
        functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
        statements: { total: 0, covered: 0, skipped: 0, pct: 0 },
        branches: { total: 0, covered: 0, skipped: 0, pct: 0 }
      },
      timestamp: Date.now(),
      sources: []
    });

    it('should merge multiple coverage reports', () => {
      const report1 = createMockReport({
        'file1.js': { lines: { found: 10, hit: 8, details: [] } },
        'file2.js': { lines: { found: 5, hit: 3, details: [] } }
      });

      const report2 = createMockReport({
        'file2.js': { lines: { found: 5, hit: 4, details: [] } },
        'file3.js': { lines: { found: 8, hit: 6, details: [] } }
      });

      const merged = coverageAggregator.mergeCoverage([report1, report2]);

      expect(merged.files.size).toBe(3);
      expect(merged.files.has('file1.js')).toBe(true);
      expect(merged.files.has('file2.js')).toBe(true);
      expect(merged.files.has('file3.js')).toBe(true);
    });

    it('should handle empty reports array', () => {
      expect(() => coverageAggregator.mergeCoverage([])).toThrow('No reports to merge');
    });

    it('should return single report unchanged', () => {
      const report = createMockReport({ 'file1.js': {} });
      const merged = coverageAggregator.mergeCoverage([report]);

      expect(merged).toBe(report);
    });

    it('should emit coverage-merged event', () => {
      const report1 = createMockReport({ 'file1.js': {} });
      const report2 = createMockReport({ 'file2.js': {} });

      const eventPromise = new Promise((resolve) => {
        coverageAggregator.on('coverage-merged', resolve);
      });

      coverageAggregator.mergeCoverage([report1, report2]);

      return eventPromise.then((eventData: any) => {
        expect(eventData.reportCount).toBe(2);
        expect(eventData.merged).toBeDefined();
      });
    });
  });

  describe('compareCoverage', () => {
    const createMockReport = (files: Record<string, { lines: number; functions: number }>): CoverageReport => ({
      files: new Map(Object.entries(files).map(([path, data]) => [
        path,
        {
          path,
          functions: { found: data.functions + 2, hit: data.functions, details: [] },
          branches: { found: 4, hit: 2, details: [] },
          lines: { found: data.lines + 3, hit: data.lines, details: [] },
          statements: { found: 8, hit: 6, details: [] }
        } as CoverageFile
      ])),
      summary: {
        lines: { total: 0, covered: 0, skipped: 0, pct: 0 },
        functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
        statements: { total: 0, covered: 0, skipped: 0, pct: 0 },
        branches: { total: 0, covered: 0, skipped: 0, pct: 0 }
      },
      timestamp: Date.now(),
      sources: []
    });

    it('should compare two coverage reports', () => {
      const baseline = createMockReport({
        'file1.js': { lines: 8, functions: 2 },
        'file2.js': { lines: 5, functions: 1 }
      });

      const current = createMockReport({
        'file1.js': { lines: 10, functions: 3 },
        'file2.js': { lines: 4, functions: 1 },
        'file3.js': { lines: 6, functions: 2 }
      });

      const deltas = coverageAggregator.compareCoverage(baseline, current);

      expect(deltas).toHaveLength(3);
      
      const file1Delta = deltas.find(d => d.file === 'file1.js');
      expect(file1Delta?.lines.changed).toBe(2); // 10 - 8
      expect(file1Delta?.functions.changed).toBe(1); // 3 - 2

      const file3Delta = deltas.find(d => d.file === 'file3.js');
      expect(file3Delta?.lines.added).toBe(6);
      expect(file3Delta?.functions.added).toBe(2);
    });

    it('should handle removed files', () => {
      const baseline = createMockReport({
        'file1.js': { lines: 8, functions: 2 },
        'file2.js': { lines: 5, functions: 1 }
      });

      const current = createMockReport({
        'file1.js': { lines: 8, functions: 2 }
      });

      const deltas = coverageAggregator.compareCoverage(baseline, current);
      const file2Delta = deltas.find(d => d.file === 'file2.js');

      expect(file2Delta?.lines.removed).toBe(5);
      expect(file2Delta?.functions.removed).toBe(1);
    });

    it('should emit coverage-compared event', () => {
      const baseline = createMockReport({ 'file1.js': { lines: 8, functions: 2 } });
      const current = createMockReport({ 'file1.js': { lines: 10, functions: 3 } });

      const eventPromise = new Promise((resolve) => {
        coverageAggregator.on('coverage-compared', resolve);
      });

      coverageAggregator.compareCoverage(baseline, current);

      return eventPromise.then((eventData: any) => {
        expect(eventData.baseline).toBe(baseline);
        expect(eventData.current).toBe(current);
        expect(eventData.deltas).toBeDefined();
      });
    });
  });

  describe('checkThresholds', () => {
    const createMockSummary = (percentages: { lines: number; functions: number; statements: number; branches: number }): CoverageSummary => ({
      lines: { total: 100, covered: percentages.lines, skipped: 0, pct: percentages.lines },
      functions: { total: 10, covered: percentages.functions / 10, skipped: 0, pct: percentages.functions },
      statements: { total: 80, covered: percentages.statements * 0.8, skipped: 0, pct: percentages.statements },
      branches: { total: 20, covered: percentages.branches / 5, skipped: 0, pct: percentages.branches }
    });

    it('should pass when coverage meets thresholds', () => {
      const thresholds: CoverageThreshold = {
        global: {
          lines: 80,
          functions: 75,
          statements: 80,
          branches: 70
        }
      };

      const aggregator = new CoverageAggregator(thresholds);
      const report: CoverageReport = {
        files: new Map(),
        summary: createMockSummary({ lines: 85, functions: 80, statements: 85, branches: 75 }),
        timestamp: Date.now(),
        sources: []
      };

      const passed = aggregator.checkThresholds(report);
      expect(passed).toBe(true);
    });

    it('should fail when coverage does not meet thresholds', () => {
      const thresholds: CoverageThreshold = {
        global: {
          lines: 80,
          functions: 75,
          statements: 80,
          branches: 70
        }
      };

      const aggregator = new CoverageAggregator(thresholds);
      const report: CoverageReport = {
        files: new Map(),
        summary: createMockSummary({ lines: 75, functions: 70, statements: 75, branches: 65 }),
        timestamp: Date.now(),
        sources: []
      };

      const passed = aggregator.checkThresholds(report);
      expect(passed).toBe(false);
    });

    it('should pass when no thresholds are set', () => {
      const report: CoverageReport = {
        files: new Map(),
        summary: createMockSummary({ lines: 50, functions: 50, statements: 50, branches: 50 }),
        timestamp: Date.now(),
        sources: []
      };

      const passed = coverageAggregator.checkThresholds(report);
      expect(passed).toBe(true);
    });

    it('should emit threshold-check event', () => {
      const thresholds: CoverageThreshold = {
        global: { lines: 80 }
      };

      const report: CoverageReport = {
        files: new Map(),
        summary: createMockSummary({ lines: 85, functions: 80, statements: 85, branches: 75 }),
        timestamp: Date.now(),
        sources: []
      };

      const eventPromise = new Promise((resolve) => {
        coverageAggregator.on('threshold-check', resolve);
      });

      coverageAggregator.checkThresholds(report, thresholds);

      return eventPromise.then((eventData: any) => {
        expect(eventData.report).toBe(report);
        expect(eventData.thresholds).toBe(thresholds);
        expect(eventData.passed).toBe(true);
      });
    });
  });

  describe('analyzeCoverage', () => {
    const createMockReport = (timestamp: number, coverageLevel: number): CoverageReport => ({
      files: new Map([
        ['file1.js', {
          path: 'file1.js',
          functions: { found: 10, hit: Math.floor(coverageLevel * 10), details: [] },
          branches: { found: 10, hit: Math.floor(coverageLevel * 10), details: [] },
          lines: { found: 100, hit: Math.floor(coverageLevel * 100), details: [] },
          statements: { found: 80, hit: Math.floor(coverageLevel * 80), details: [] }
        } as CoverageFile]
      ]),
      summary: {
        lines: { total: 100, covered: Math.floor(coverageLevel * 100), skipped: 0, pct: coverageLevel * 100 },
        functions: { total: 10, covered: Math.floor(coverageLevel * 10), skipped: 0, pct: coverageLevel * 100 },
        statements: { total: 80, covered: Math.floor(coverageLevel * 80), skipped: 0, pct: coverageLevel * 100 },
        branches: { total: 10, covered: Math.floor(coverageLevel * 10), skipped: 0, pct: coverageLevel * 100 }
      },
      timestamp,
      sources: []
    });

    it('should analyze improving coverage trends', () => {
      const reports = [
        createMockReport(Date.now() - 3000, 0.7),
        createMockReport(Date.now() - 2000, 0.75),
        createMockReport(Date.now() - 1000, 0.8),
        createMockReport(Date.now(), 0.85)
      ];

      const analysis = coverageAggregator.analyzeCoverage(reports);

      expect(analysis.trends.direction).toBe('improving');
      expect(analysis.trends.rate).toBeGreaterThan(0);
      expect(analysis.recommendations.length).toBeGreaterThan(0);
    });

    it('should analyze declining coverage trends', () => {
      const reports = [
        createMockReport(Date.now() - 3000, 0.85),
        createMockReport(Date.now() - 2000, 0.8),
        createMockReport(Date.now() - 1000, 0.75),
        createMockReport(Date.now(), 0.7)
      ];

      const analysis = coverageAggregator.analyzeCoverage(reports);

      expect(analysis.trends.direction).toBe('declining');
      expect(analysis.recommendations).toContain('Coverage is declining. Consider implementing stricter testing policies.');
    });

    it('should identify coverage hotspots', () => {
      const report = createMockReport(Date.now(), 0.3); // Low coverage

      const analysis = coverageAggregator.analyzeCoverage([report]);

      expect(analysis.hotspots.length).toBeGreaterThan(0);
      
      const uncoveredLinesHotspot = analysis.hotspots.find(h => h.type === 'uncovered_lines');
      expect(uncoveredLinesHotspot).toBeDefined();
      expect(uncoveredLinesHotspot?.severity).toBeOneOf(['high', 'critical']);
    });

    it('should handle insufficient data for trend analysis', () => {
      const report = createMockReport(Date.now(), 0.8);

      const analysis = coverageAggregator.analyzeCoverage([report]);

      expect(analysis.trends.direction).toBe('stable');
      expect(analysis.trends.confidence).toBe(0);
      expect(analysis.recommendations).toContain('Need more historical data for trend analysis');
    });
  });

  describe('generateReport', () => {
    const mockReport: CoverageReport = {
      files: new Map([
        ['src/file1.js', {
          path: 'src/file1.js',
          functions: { found: 5, hit: 4, details: [] },
          branches: { found: 8, hit: 6, details: [] },
          lines: { found: 50, hit: 40, details: [] },
          statements: { found: 45, hit: 36, details: [] }
        } as CoverageFile]
      ]),
      summary: {
        lines: { total: 50, covered: 40, skipped: 0, pct: 80 },
        functions: { total: 5, covered: 4, skipped: 0, pct: 80 },
        statements: { total: 45, covered: 36, skipped: 0, pct: 80 },
        branches: { total: 8, covered: 6, skipped: 0, pct: 75 }
      },
      timestamp: Date.now(),
      sources: ['/path/to/coverage.info']
    };

    it('should generate HTML report', async () => {
      await coverageAggregator.generateReport(mockReport, 'html', '/tmp/report.html');

      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        '/tmp/report.html',
        expect.stringContaining('<!DOCTYPE html>'),
        'utf8'
      );
    });

    it('should generate JSON report', async () => {
      await coverageAggregator.generateReport(mockReport, 'json', '/tmp/report.json');

      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        '/tmp/report.json',
        expect.stringContaining('"timestamp"'),
        'utf8'
      );
    });

    it('should generate LCOV report', async () => {
      await coverageAggregator.generateReport(mockReport, 'lcov', '/tmp/report.lcov');

      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        '/tmp/report.lcov',
        expect.stringContaining('SF:'),
        'utf8'
      );
    });

    it('should generate text report', async () => {
      await coverageAggregator.generateReport(mockReport, 'text', '/tmp/report.txt');

      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        '/tmp/report.txt',
        expect.stringContaining('Coverage Report'),
        'utf8'
      );
    });

    it('should throw error for unsupported format', async () => {
      await expect(
        coverageAggregator.generateReport(mockReport, 'unsupported' as any, '/tmp/report')
      ).rejects.toThrow('Unsupported output format: unsupported');
    });

    it('should emit report-generated event', async () => {
      const eventPromise = new Promise((resolve) => {
        coverageAggregator.on('report-generated', resolve);
      });

      await coverageAggregator.generateReport(mockReport, 'html', '/tmp/report.html');

      const eventData = await eventPromise;
      expect(eventData).toHaveProperty('format', 'html');
      expect(eventData).toHaveProperty('outputPath', '/tmp/report.html');
    });

    it('should handle file write errors', async () => {
      mockFs.promises.writeFile.mockRejectedValue(new Error('Write error'));

      const eventPromise = new Promise((resolve) => {
        coverageAggregator.on('error', resolve);
      });

      await expect(
        coverageAggregator.generateReport(mockReport, 'html', '/tmp/report.html')
      ).rejects.toThrow();

      const error = await eventPromise;
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle malformed LCOV data', async () => {
      const malformedLcov = 'This is not valid LCOV data';
      mockFs.promises.readFile.mockResolvedValue(malformedLcov);

      const report = await coverageAggregator.loadCoverage('/path/to/bad.info', 'lcov');

      // Should not crash, but might have empty or minimal data
      expect(report.files.size).toBeGreaterThanOrEqual(0);
    });

    it('should handle malformed JSON data', async () => {
      const malformedJson = '{ invalid json }';
      mockFs.promises.readFile.mockResolvedValue(malformedJson);

      await expect(
        coverageAggregator.loadCoverage('/path/to/bad.json', 'json')
      ).rejects.toThrow();
    });

    it('should handle empty coverage files', async () => {
      mockFs.promises.readFile.mockResolvedValue('');

      const report = await coverageAggregator.loadCoverage('/path/to/empty.info', 'lcov');

      expect(report.files.size).toBe(0);
      expect(report.summary.lines.total).toBe(0);
    });

    it('should handle files with zero coverage', () => {
      const report: CoverageReport = {
        files: new Map([
          ['file1.js', {
            path: 'file1.js',
            functions: { found: 5, hit: 0, details: [] },
            branches: { found: 8, hit: 0, details: [] },
            lines: { found: 50, hit: 0, details: [] },
            statements: { found: 45, hit: 0, details: [] }
          } as CoverageFile]
        ]),
        summary: {
          lines: { total: 50, covered: 0, skipped: 0, pct: 0 },
          functions: { total: 5, covered: 0, skipped: 0, pct: 0 },
          statements: { total: 45, covered: 0, skipped: 0, pct: 0 },
          branches: { total: 8, covered: 0, skipped: 0, pct: 0 }
        },
        timestamp: Date.now(),
        sources: []
      };

      // Should handle gracefully
      expect(() => {
        coverageAggregator.checkThresholds(report);
        coverageAggregator.analyzeCoverage([report]);
      }).not.toThrow();
    });

    it('should handle missing file properties', () => {
      const report: CoverageReport = {
        files: new Map([
          ['file1.js', {
            path: 'file1.js',
            functions: { found: 0, hit: 0, details: [] },
            branches: { found: 0, hit: 0, details: [] },
            lines: { found: 0, hit: 0, details: [] },
            statements: { found: 0, hit: 0, details: [] }
          } as CoverageFile]
        ]),
        summary: {
          lines: { total: 0, covered: 0, skipped: 0, pct: 0 },
          functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
          statements: { total: 0, covered: 0, skipped: 0, pct: 0 },
          branches: { total: 0, covered: 0, skipped: 0, pct: 0 }
        },
        timestamp: Date.now(),
        sources: []
      };

      expect(() => {
        coverageAggregator.analyzeCoverage([report]);
      }).not.toThrow();
    });
  });

  describe('Performance tests', () => {
    it('should handle large coverage reports efficiently', async () => {
      const largeReport: CoverageReport = {
        files: new Map(),
        summary: {
          lines: { total: 0, covered: 0, skipped: 0, pct: 0 },
          functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
          statements: { total: 0, covered: 0, skipped: 0, pct: 0 },
          branches: { total: 0, covered: 0, skipped: 0, pct: 0 }
        },
        timestamp: Date.now(),
        sources: []
      };

      // Add many files
      for (let i = 0; i < 1000; i++) {
        largeReport.files.set(`file${i}.js`, {
          path: `file${i}.js`,
          functions: { found: 10, hit: 8, details: [] },
          branches: { found: 20, hit: 15, details: [] },
          lines: { found: 100, hit: 80, details: [] },
          statements: { found: 90, hit: 72, details: [] }
        } as CoverageFile);
      }

      const startTime = Date.now();
      
      coverageAggregator.mergeCoverage([largeReport]);
      coverageAggregator.analyzeCoverage([largeReport]);
      
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(2000); // Should complete within 2 seconds
    });
  });
});