/**
 * @caia/coverage-aggregator
 * Universal coverage merging and analysis tool
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

export interface CoverageFile {
  path: string;
  functions: FunctionCoverage;
  branches: BranchCoverage;
  lines: LineCoverage;
  statements: StatementCoverage;
}

export interface FunctionCoverage {
  found: number;
  hit: number;
  details: Array<{
    name: string;
    line: number;
    hit: number;
  }>;
}

export interface BranchCoverage {
  found: number;
  hit: number;
  details: Array<{
    line: number;
    block: number;
    branch: number;
    taken: number;
  }>;
}

export interface LineCoverage {
  found: number;
  hit: number;
  details: Array<{
    line: number;
    hit: number;
  }>;
}

export interface StatementCoverage {
  found: number;
  hit: number;
  details: Array<{
    line: number;
    hit: number;
  }>;
}

export interface CoverageReport {
  files: Map<string, CoverageFile>;
  summary: CoverageSummary;
  timestamp: number;
  sources: string[];
}

export interface CoverageSummary {
  lines: {
    total: number;
    covered: number;
    skipped: number;
    pct: number;
  };
  functions: {
    total: number;
    covered: number;
    skipped: number;
    pct: number;
  };
  statements: {
    total: number;
    covered: number;
    skipped: number;
    pct: number;
  };
  branches: {
    total: number;
    covered: number;
    skipped: number;
    pct: number;
  };
}

export interface CoverageThreshold {
  global: {
    branches?: number;
    functions?: number;
    lines?: number;
    statements?: number;
  };
  each?: {
    branches?: number;
    functions?: number;
    lines?: number;
    statements?: number;
  };
}

export interface CoverageDelta {
  file: string;
  lines: { added: number; removed: number; changed: number };
  functions: { added: number; removed: number; changed: number };
  statements: { added: number; removed: number; changed: number };
  branches: { added: number; removed: number; changed: number };
}

export interface CoverageAnalysis {
  trends: {
    direction: 'improving' | 'declining' | 'stable';
    rate: number;
    confidence: number;
  };
  hotspots: Array<{
    file: string;
    type: 'uncovered_lines' | 'complex_functions' | 'untested_branches';
    severity: 'low' | 'medium' | 'high' | 'critical';
    details: string;
  }>;
  recommendations: string[];
}

export class CoverageAggregator extends EventEmitter {
  private reports: Map<string, CoverageReport> = new Map();
  private thresholds?: CoverageThreshold;

  constructor(thresholds?: CoverageThreshold) {
    super();
    this.thresholds = thresholds;
  }

  /**
   * Load coverage data from various formats
   */
  async loadCoverage(filePath: string, format: 'lcov' | 'json' | 'cobertura' | 'clover' = 'lcov'): Promise<CoverageReport> {
    try {
      const data = await fs.promises.readFile(filePath, 'utf8');
      
      let report: CoverageReport;
      switch (format) {
        case 'lcov':
          report = this.parseLcov(data);
          break;
        case 'json':
          report = this.parseJson(data);
          break;
        case 'cobertura':
          report = this.parseCobertura(data);
          break;
        case 'clover':
          report = this.parseClover(data);
          break;
        default:
          throw new Error(`Unsupported format: ${format}`);
      }
      
      report.sources = [filePath];
      report.timestamp = Date.now();
      
      this.emit('coverage-loaded', { filePath, format, report });
      return report;
    } catch (error) {
      this.emit('error', new Error(`Failed to load coverage from ${filePath}: ${error}`));
      throw error;
    }
  }

  /**
   * Merge multiple coverage reports
   */
  mergeCoverage(reports: CoverageReport[]): CoverageReport {
    if (reports.length === 0) {
      throw new Error('No reports to merge');
    }

    if (reports.length === 1) {
      return reports[0];
    }

    const merged: CoverageReport = {
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

    // Collect all sources
    reports.forEach(report => {
      merged.sources.push(...report.sources);
    });

    // Merge files
    const allFiles = new Set<string>();
    reports.forEach(report => {
      report.files.forEach((_, filePath) => {
        allFiles.add(filePath);
      });
    });

    allFiles.forEach(filePath => {
      const fileReports = reports
        .map(report => report.files.get(filePath))
        .filter(Boolean) as CoverageFile[];
      
      if (fileReports.length > 0) {
        merged.files.set(filePath, this.mergeFileCoverage(fileReports));
      }
    });

    // Calculate merged summary
    merged.summary = this.calculateSummary(merged.files);

    this.emit('coverage-merged', { reportCount: reports.length, merged });
    return merged;
  }

  /**
   * Compare two coverage reports
   */
  compareCoverage(baseline: CoverageReport, current: CoverageReport): CoverageDelta[] {
    const deltas: CoverageDelta[] = [];
    
    // Get all unique files
    const allFiles = new Set([
      ...Array.from(baseline.files.keys()),
      ...Array.from(current.files.keys())
    ]);

    allFiles.forEach(filePath => {
      const baselineFile = baseline.files.get(filePath);
      const currentFile = current.files.get(filePath);
      
      const delta: CoverageDelta = {
        file: filePath,
        lines: { added: 0, removed: 0, changed: 0 },
        functions: { added: 0, removed: 0, changed: 0 },
        statements: { added: 0, removed: 0, changed: 0 },
        branches: { added: 0, removed: 0, changed: 0 }
      };

      if (!baselineFile && currentFile) {
        // New file
        delta.lines.added = currentFile.lines.hit;
        delta.functions.added = currentFile.functions.hit;
        delta.statements.added = currentFile.statements.hit;
        delta.branches.added = currentFile.branches.hit;
      } else if (baselineFile && !currentFile) {
        // Removed file
        delta.lines.removed = baselineFile.lines.hit;
        delta.functions.removed = baselineFile.functions.hit;
        delta.statements.removed = baselineFile.statements.hit;
        delta.branches.removed = baselineFile.branches.hit;
      } else if (baselineFile && currentFile) {
        // Changed file
        delta.lines.changed = currentFile.lines.hit - baselineFile.lines.hit;
        delta.functions.changed = currentFile.functions.hit - baselineFile.functions.hit;
        delta.statements.changed = currentFile.statements.hit - baselineFile.statements.hit;
        delta.branches.changed = currentFile.branches.hit - baselineFile.branches.hit;
      }

      deltas.push(delta);
    });

    this.emit('coverage-compared', { baseline, current, deltas });
    return deltas;
  }

  /**
   * Check if coverage meets thresholds
   */
  checkThresholds(report: CoverageReport, thresholds?: CoverageThreshold): boolean {
    const t = thresholds || this.thresholds;
    if (!t) return true;

    const globalPassed = this.checkGlobalThresholds(report.summary, t.global);
    const eachPassed = t.each ? this.checkEachFileThresholds(report.files, t.each) : true;

    const passed = globalPassed && eachPassed;
    this.emit('threshold-check', { report, thresholds: t, passed });
    
    return passed;
  }

  /**
   * Analyze coverage trends and patterns
   */
  analyzeCoverage(reports: CoverageReport[]): CoverageAnalysis {
    if (reports.length < 2) {
      return {
        trends: { direction: 'stable', rate: 0, confidence: 0 },
        hotspots: [],
        recommendations: ['Need more historical data for trend analysis']
      };
    }

    const trends = this.analyzeTrends(reports);
    const hotspots = this.identifyHotspots(reports[reports.length - 1]);
    const recommendations = this.generateRecommendations(trends, hotspots);

    return { trends, hotspots, recommendations };
  }

  /**
   * Generate coverage report in various formats
   */
  async generateReport(report: CoverageReport, format: 'html' | 'json' | 'lcov' | 'text', outputPath: string): Promise<void> {
    try {
      let content: string;
      
      switch (format) {
        case 'html':
          content = this.generateHtmlReport(report);
          break;
        case 'json':
          content = JSON.stringify(report, null, 2);
          break;
        case 'lcov':
          content = this.generateLcovReport(report);
          break;
        case 'text':
          content = this.generateTextReport(report);
          break;
        default:
          throw new Error(`Unsupported output format: ${format}`);
      }

      await fs.promises.writeFile(outputPath, content, 'utf8');
      this.emit('report-generated', { format, outputPath });
    } catch (error) {
      this.emit('error', new Error(`Failed to generate ${format} report: ${error}`));
      throw error;
    }
  }

  /**
   * Parse LCOV format
   */
  private parseLcov(data: string): CoverageReport {
    const files = new Map<string, CoverageFile>();
    const lines = data.split('\n');
    let currentFile: Partial<CoverageFile> | null = null;
    let currentPath = '';

    for (const line of lines) {
      if (line.startsWith('SF:')) {
        if (currentFile && currentPath) {
          files.set(currentPath, currentFile as CoverageFile);
        }
        currentPath = line.substring(3);
        currentFile = {
          path: currentPath,
          functions: { found: 0, hit: 0, details: [] },
          branches: { found: 0, hit: 0, details: [] },
          lines: { found: 0, hit: 0, details: [] },
          statements: { found: 0, hit: 0, details: [] }
        };
      } else if (line.startsWith('FN:') && currentFile) {
        const [lineNum, name] = line.substring(3).split(',');
        currentFile.functions!.details.push({
          name,
          line: parseInt(lineNum),
          hit: 0
        });
      } else if (line.startsWith('FNDA:') && currentFile) {
        const [hit, name] = line.substring(5).split(',');
        const func = currentFile.functions!.details.find(f => f.name === name);
        if (func) {
          func.hit = parseInt(hit);
        }
      } else if (line.startsWith('FNF:') && currentFile) {
        currentFile.functions!.found = parseInt(line.substring(4));
      } else if (line.startsWith('FNH:') && currentFile) {
        currentFile.functions!.hit = parseInt(line.substring(4));
      } else if (line.startsWith('DA:') && currentFile) {
        const [lineNum, hit] = line.substring(3).split(',');
        currentFile.lines!.details.push({
          line: parseInt(lineNum),
          hit: parseInt(hit)
        });
      } else if (line.startsWith('LF:') && currentFile) {
        currentFile.lines!.found = parseInt(line.substring(3));
      } else if (line.startsWith('LH:') && currentFile) {
        currentFile.lines!.hit = parseInt(line.substring(3));
      }
    }

    if (currentFile && currentPath) {
      files.set(currentPath, currentFile as CoverageFile);
    }

    return {
      files,
      summary: this.calculateSummary(files),
      timestamp: Date.now(),
      sources: []
    };
  }

  /**
   * Parse JSON format (Istanbul/NYC)
   */
  private parseJson(data: string): CoverageReport {
    const json = JSON.parse(data);
    const files = new Map<string, CoverageFile>();

    Object.keys(json).forEach(filePath => {
      const fileData = json[filePath];
      
      const file: CoverageFile = {
        path: filePath,
        functions: {
          found: Object.keys(fileData.f || {}).length,
          hit: Object.values(fileData.f || {}).filter((v: any) => v > 0).length,
          details: Object.entries(fileData.fnMap || {}).map(([id, fn]: [string, any]) => ({
            name: fn.name,
            line: fn.decl.start.line,
            hit: fileData.f[id] || 0
          }))
        },
        branches: {
          found: Object.keys(fileData.b || {}).length,
          hit: Object.values(fileData.b || {}).filter((branches: any) => 
            Array.isArray(branches) && branches.some(b => b > 0)
          ).length,
          details: []
        },
        lines: {
          found: Object.keys(fileData.s || {}).length,
          hit: Object.values(fileData.s || {}).filter((v: any) => v > 0).length,
          details: Object.entries(fileData.s || {}).map(([id, hit]: [string, any]) => {
            const statementMap = fileData.statementMap[id];
            return {
              line: statementMap ? statementMap.start.line : 0,
              hit: hit || 0
            };
          })
        },
        statements: {
          found: Object.keys(fileData.s || {}).length,
          hit: Object.values(fileData.s || {}).filter((v: any) => v > 0).length,
          details: []
        }
      };

      files.set(filePath, file);
    });

    return {
      files,
      summary: this.calculateSummary(files),
      timestamp: Date.now(),
      sources: []
    };
  }

  /**
   * Parse Cobertura XML format
   */
  private parseCobertura(data: string): CoverageReport {
    // Simplified XML parsing - in production would use proper XML parser
    const files = new Map<string, CoverageFile>();
    
    // Basic regex-based parsing for demonstration
    const classMatches = data.match(/<class[^>]*filename="([^"]*)"/g) || [];
    
    classMatches.forEach(match => {
      const filenameMatch = match.match(/filename="([^"]*)"/);;
      if (filenameMatch) {
        const filename = filenameMatch[1];
        // Simplified file creation
        files.set(filename, {
          path: filename,
          functions: { found: 0, hit: 0, details: [] },
          branches: { found: 0, hit: 0, details: [] },
          lines: { found: 0, hit: 0, details: [] },
          statements: { found: 0, hit: 0, details: [] }
        });
      }
    });

    return {
      files,
      summary: this.calculateSummary(files),
      timestamp: Date.now(),
      sources: []
    };
  }

  /**
   * Parse Clover XML format
   */
  private parseClover(data: string): CoverageReport {
    // Simplified implementation
    return this.parseCobertura(data);
  }

  /**
   * Merge coverage data for the same file
   */
  private mergeFileCoverage(files: CoverageFile[]): CoverageFile {
    if (files.length === 1) {
      return files[0];
    }

    const merged: CoverageFile = {
      path: files[0].path,
      functions: { found: 0, hit: 0, details: [] },
      branches: { found: 0, hit: 0, details: [] },
      lines: { found: 0, hit: 0, details: [] },
      statements: { found: 0, hit: 0, details: [] }
    };

    // Merge line coverage
    const allLines = new Map<number, number>();
    files.forEach(file => {
      file.lines.details.forEach(line => {
        const current = allLines.get(line.line) || 0;
        allLines.set(line.line, Math.max(current, line.hit));
      });
    });

    merged.lines.details = Array.from(allLines.entries()).map(([line, hit]) => ({ line, hit }));
    merged.lines.found = merged.lines.details.length;
    merged.lines.hit = merged.lines.details.filter(l => l.hit > 0).length;

    // Similar logic for functions, branches, statements...
    // Simplified for brevity
    merged.functions.found = Math.max(...files.map(f => f.functions.found));
    merged.functions.hit = Math.max(...files.map(f => f.functions.hit));
    
    merged.branches.found = Math.max(...files.map(f => f.branches.found));
    merged.branches.hit = Math.max(...files.map(f => f.branches.hit));
    
    merged.statements.found = Math.max(...files.map(f => f.statements.found));
    merged.statements.hit = Math.max(...files.map(f => f.statements.hit));

    return merged;
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(files: Map<string, CoverageFile>): CoverageSummary {
    const summary: CoverageSummary = {
      lines: { total: 0, covered: 0, skipped: 0, pct: 0 },
      functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
      statements: { total: 0, covered: 0, skipped: 0, pct: 0 },
      branches: { total: 0, covered: 0, skipped: 0, pct: 0 }
    };

    files.forEach(file => {
      summary.lines.total += file.lines.found;
      summary.lines.covered += file.lines.hit;
      
      summary.functions.total += file.functions.found;
      summary.functions.covered += file.functions.hit;
      
      summary.statements.total += file.statements.found;
      summary.statements.covered += file.statements.hit;
      
      summary.branches.total += file.branches.found;
      summary.branches.covered += file.branches.hit;
    });

    // Calculate percentages
    summary.lines.pct = summary.lines.total > 0 ? 
      (summary.lines.covered / summary.lines.total) * 100 : 0;
    summary.functions.pct = summary.functions.total > 0 ? 
      (summary.functions.covered / summary.functions.total) * 100 : 0;
    summary.statements.pct = summary.statements.total > 0 ? 
      (summary.statements.covered / summary.statements.total) * 100 : 0;
    summary.branches.pct = summary.branches.total > 0 ? 
      (summary.branches.covered / summary.branches.total) * 100 : 0;

    return summary;
  }

  /**
   * Check global thresholds
   */
  private checkGlobalThresholds(summary: CoverageSummary, thresholds: CoverageThreshold['global']): boolean {
    if (thresholds.lines && summary.lines.pct < thresholds.lines) return false;
    if (thresholds.functions && summary.functions.pct < thresholds.functions) return false;
    if (thresholds.statements && summary.statements.pct < thresholds.statements) return false;
    if (thresholds.branches && summary.branches.pct < thresholds.branches) return false;
    return true;
  }

  /**
   * Check per-file thresholds
   */
  private checkEachFileThresholds(files: Map<string, CoverageFile>, thresholds: CoverageThreshold['each']): boolean {
    for (const [, file] of files) {
      const fileSummary = this.calculateSummary(new Map([[file.path, file]]));
      if (!this.checkGlobalThresholds(fileSummary, thresholds!)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Analyze coverage trends
   */
  private analyzeTrends(reports: CoverageReport[]): CoverageAnalysis['trends'] {
    if (reports.length < 2) {
      return { direction: 'stable', rate: 0, confidence: 0 };
    }

    const linePercentages = reports.map(r => r.summary.lines.pct);
    const trend = this.calculateTrend(linePercentages);

    return {
      direction: trend.slope > 0.1 ? 'improving' : trend.slope < -0.1 ? 'declining' : 'stable',
      rate: Math.abs(trend.slope),
      confidence: trend.confidence
    };
  }

  /**
   * Calculate linear trend
   */
  private calculateTrend(values: number[]): { slope: number; confidence: number } {
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = values;

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const confidence = Math.min(1, n / 10); // Simple confidence based on sample size

    return { slope, confidence };
  }

  /**
   * Identify coverage hotspots
   */
  private identifyHotspots(report: CoverageReport): CoverageAnalysis['hotspots'] {
    const hotspots: CoverageAnalysis['hotspots'] = [];

    report.files.forEach((file, filePath) => {
      const linesPct = file.lines.found > 0 ? (file.lines.hit / file.lines.found) * 100 : 0;
      const functionsPct = file.functions.found > 0 ? (file.functions.hit / file.functions.found) * 100 : 0;
      
      if (linesPct < 50) {
        hotspots.push({
          file: filePath,
          type: 'uncovered_lines',
          severity: linesPct < 25 ? 'critical' : linesPct < 40 ? 'high' : 'medium',
          details: `Only ${linesPct.toFixed(1)}% of lines are covered`
        });
      }

      if (functionsPct < 60) {
        hotspots.push({
          file: filePath,
          type: 'complex_functions',
          severity: functionsPct < 30 ? 'critical' : functionsPct < 50 ? 'high' : 'medium',
          details: `Only ${functionsPct.toFixed(1)}% of functions are covered`
        });
      }
    });

    return hotspots;
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(trends: CoverageAnalysis['trends'], hotspots: CoverageAnalysis['hotspots']): string[] {
    const recommendations: string[] = [];

    if (trends.direction === 'declining') {
      recommendations.push('Coverage is declining. Consider implementing stricter testing policies.');
    }

    if (hotspots.some(h => h.severity === 'critical')) {
      recommendations.push('Critical coverage gaps detected. Prioritize testing for low-coverage files.');
    }

    if (hotspots.filter(h => h.type === 'uncovered_lines').length > 5) {
      recommendations.push('Many files have low line coverage. Consider integration testing.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Coverage looks good! Consider adding edge case tests.');
    }

    return recommendations;
  }

  /**
   * Generate HTML report
   */
  private generateHtmlReport(report: CoverageReport): string {
    const { summary } = report;
    
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Coverage Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .summary { background: #f5f5f5; padding: 15px; border-radius: 5px; }
        .metric { display: inline-block; margin: 10px; padding: 10px; background: white; border-radius: 3px; }
        .high { color: green; }
        .medium { color: orange; }
        .low { color: red; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>Coverage Report</h1>
    <div class="summary">
        <div class="metric">
            <strong>Lines:</strong> ${summary.lines.pct.toFixed(2)}%
            <span class="${this.getCoverageClass(summary.lines.pct)}">♦</span>
        </div>
        <div class="metric">
            <strong>Functions:</strong> ${summary.functions.pct.toFixed(2)}%
            <span class="${this.getCoverageClass(summary.functions.pct)}">♦</span>
        </div>
        <div class="metric">
            <strong>Statements:</strong> ${summary.statements.pct.toFixed(2)}%
            <span class="${this.getCoverageClass(summary.statements.pct)}">♦</span>
        </div>
        <div class="metric">
            <strong>Branches:</strong> ${summary.branches.pct.toFixed(2)}%
            <span class="${this.getCoverageClass(summary.branches.pct)}">♦</span>
        </div>
    </div>
    
    <table>
        <thead>
            <tr>
                <th>File</th>
                <th>Lines</th>
                <th>Functions</th>
                <th>Statements</th>
                <th>Branches</th>
            </tr>
        </thead>
        <tbody>
            ${Array.from(report.files.entries()).map(([path, file]) => `
                <tr>
                    <td>${path}</td>
                    <td>${this.formatCoverage(file.lines)}</td>
                    <td>${this.formatCoverage(file.functions)}</td>
                    <td>${this.formatCoverage(file.statements)}</td>
                    <td>${this.formatCoverage(file.branches)}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    
    <p><small>Generated on ${new Date(report.timestamp).toLocaleString()}</small></p>
</body>
</html>
    `.trim();
  }

  /**
   * Generate LCOV report
   */
  private generateLcovReport(report: CoverageReport): string {
    let lcov = '';

    report.files.forEach((file, path) => {
      lcov += `SF:${path}\n`;
      
      // Functions
      file.functions.details.forEach(fn => {
        lcov += `FN:${fn.line},${fn.name}\n`;
      });
      file.functions.details.forEach(fn => {
        lcov += `FNDA:${fn.hit},${fn.name}\n`;
      });
      lcov += `FNF:${file.functions.found}\n`;
      lcov += `FNH:${file.functions.hit}\n`;
      
      // Lines
      file.lines.details.forEach(line => {
        lcov += `DA:${line.line},${line.hit}\n`;
      });
      lcov += `LF:${file.lines.found}\n`;
      lcov += `LH:${file.lines.hit}\n`;
      
      lcov += 'end_of_record\n';
    });

    return lcov;
  }

  /**
   * Generate text report
   */
  private generateTextReport(report: CoverageReport): string {
    const { summary } = report;
    
    let text = 'Coverage Report\n';
    text += '================\n\n';
    text += `Lines:      ${summary.lines.pct.toFixed(2)}% (${summary.lines.covered}/${summary.lines.total})\n`;
    text += `Functions:  ${summary.functions.pct.toFixed(2)}% (${summary.functions.covered}/${summary.functions.total})\n`;
    text += `Statements: ${summary.statements.pct.toFixed(2)}% (${summary.statements.covered}/${summary.statements.total})\n`;
    text += `Branches:   ${summary.branches.pct.toFixed(2)}% (${summary.branches.covered}/${summary.branches.total})\n\n`;
    
    text += 'File Details:\n';
    text += '-------------\n';
    
    report.files.forEach((file, path) => {
      const linesPct = file.lines.found > 0 ? (file.lines.hit / file.lines.found) * 100 : 0;
      text += `${path}: ${linesPct.toFixed(2)}%\n`;
    });
    
    return text;
  }

  /**
   * Get CSS class for coverage percentage
   */
  private getCoverageClass(pct: number): string {
    if (pct >= 80) return 'high';
    if (pct >= 60) return 'medium';
    return 'low';
  }

  /**
   * Format coverage for display
   */
  private formatCoverage(coverage: { found: number; hit: number }): string {
    const pct = coverage.found > 0 ? (coverage.hit / coverage.found) * 100 : 0;
    return `${pct.toFixed(1)}% (${coverage.hit}/${coverage.found})`;
  }
}

// Export default
export default CoverageAggregator;