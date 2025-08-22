/**
 * Terminal-based live dashboard using blessed-contrib
 */

import * as blessed from 'blessed';
import * as contrib from 'blessed-contrib';
import { EventEmitter } from 'events';
import { MonorepoTestOrchestrator, TestProgress, TestResult } from '../index';

export class TerminalDashboard extends EventEmitter {
  private screen: blessed.Widgets.Screen;
  private grid: any;
  private widgets: {
    progressBar?: any;
    packageList?: any;
    coverageGauge?: any;
    throughputLine?: any;
    log?: any;
    summary?: any;
    failedTests?: any;
    runningTests?: any;
  } = {};
  
  private orchestrator: MonorepoTestOrchestrator;
  private updateInterval: NodeJS.Timeout;
  private throughputData: number[] = [];
  
  constructor(orchestrator: MonorepoTestOrchestrator) {
    super();
    this.orchestrator = orchestrator;
    this.initializeUI();
    this.attachEventListeners();
  }
  
  /**
   * Initialize the terminal UI
   */
  private initializeUI() {
    // Create screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'CAIA Monorepo Test Dashboard',
      fullUnicode: true
    });
    
    // Create grid layout
    this.grid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: this.screen
    });
    
    // Progress Bar (top)
    this.widgets.progressBar = this.grid.set(0, 0, 2, 12, contrib.gauge, {
      label: ' Overall Progress ',
      stroke: 'green',
      fill: 'white',
      percent: 0
    });
    
    // Package List (left)
    this.widgets.packageList = this.grid.set(2, 0, 6, 4, blessed.list, {
      label: ' Packages ',
      border: { type: 'line' },
      style: {
        selected: { bg: 'blue' },
        border: { fg: 'cyan' }
      },
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        style: { bg: 'blue' }
      }
    });
    
    // Running Tests (middle-top)
    this.widgets.runningTests = this.grid.set(2, 4, 3, 4, blessed.box, {
      label: ' Running ',
      border: { type: 'line' },
      style: {
        border: { fg: 'yellow' }
      },
      scrollable: true,
      alwaysScroll: true,
      content: ''
    });
    
    // Failed Tests (middle-bottom)
    this.widgets.failedTests = this.grid.set(5, 4, 3, 4, blessed.box, {
      label: ' Failed ',
      border: { type: 'line' },
      style: {
        border: { fg: 'red' }
      },
      scrollable: true,
      alwaysScroll: true,
      content: ''
    });
    
    // Coverage Gauge (right-top)
    this.widgets.coverageGauge = this.grid.set(2, 8, 3, 4, contrib.gauge, {
      label: ' Coverage ',
      stroke: 'cyan',
      fill: 'white',
      percent: 0
    });
    
    // Throughput Line Chart (right-middle)
    this.widgets.throughputLine = this.grid.set(5, 8, 3, 4, contrib.line, {
      label: ' Throughput (tests/sec) ',
      showLegend: false,
      style: {
        line: 'cyan',
        text: 'white',
        baseline: 'white'
      },
      xLabelPadding: 3,
      xPadding: 5,
      wholeNumbersOnly: true,
      minY: 0
    });
    
    // Summary Box (bottom-left)
    this.widgets.summary = this.grid.set(8, 0, 4, 6, blessed.box, {
      label: ' Summary ',
      border: { type: 'line' },
      style: {
        border: { fg: 'white' }
      },
      content: this.generateSummaryContent({
        totalPackages: 0,
        completedPackages: 0,
        runningPackages: [],
        failedPackages: [],
        passedPackages: [],
        currentThroughput: 0,
        estimatedTimeRemaining: 0,
        coverage: { overall: 0, byPackage: new Map() }
      })
    });
    
    // Log (bottom-right)
    this.widgets.log = this.grid.set(8, 6, 4, 6, contrib.log, {
      label: ' Event Log ',
      border: { type: 'line' },
      style: {
        border: { fg: 'green' }
      },
      bufferLength: 100
    });
    
    // Quit on q, C-c
    this.screen.key(['q', 'C-c'], () => {
      this.cleanup();
      process.exit(0);
    });
    
    // Initial render
    this.screen.render();
  }
  
  /**
   * Attach event listeners to orchestrator
   */
  private attachEventListeners() {
    // Discovery events
    this.orchestrator.on('discovery:start', () => {
      this.widgets.log.log('🔍 Discovering packages...');
    });
    
    this.orchestrator.on('discovery:complete', ({ packages }) => {
      this.widgets.log.log(`✅ Found ${packages.length} packages`);
      this.updatePackageList(packages);
    });
    
    // Planning events
    this.orchestrator.on('planning:start', () => {
      this.widgets.log.log('📋 Creating execution plan...');
    });
    
    this.orchestrator.on('planning:complete', ({ shards, workers, strategy }) => {
      this.widgets.log.log(`✅ Plan: ${shards.length} shards, ${workers} workers, ${strategy} strategy`);
    });
    
    // Test events
    this.orchestrator.on('test:start', ({ package: pkg }) => {
      this.widgets.log.log(`🧪 Testing ${pkg}...`);
      this.updateRunningTests();
    });
    
    this.orchestrator.on('test:complete', ({ package: pkg, result }) => {
      const icon = result.success ? '✅' : '❌';
      this.widgets.log.log(`${icon} ${pkg}: ${result.tests.passed}/${result.tests.total} passed`);
      this.updateTestResults(result);
    });
    
    this.orchestrator.on('test:failed', ({ package: pkg, error }) => {
      this.widgets.log.log(`❌ ${pkg}: ${error.message}`);
      this.updateFailedTests();
    });
    
    // Execution events
    this.orchestrator.on('execution:start', () => {
      this.widgets.log.log('🚀 Starting test execution...');
      this.startProgressUpdates();
    });
    
    this.orchestrator.on('execution:complete', ({ results, report }) => {
      this.widgets.log.log('🎉 All tests complete!');
      this.stopProgressUpdates();
      this.showFinalReport(report);
    });
  }
  
  /**
   * Start periodic progress updates
   */
  private startProgressUpdates() {
    this.updateInterval = setInterval(() => {
      const progress = this.orchestrator.getProgress();
      this.updateProgress(progress);
    }, 100); // Update every 100ms for smooth animation
  }
  
  /**
   * Stop progress updates
   */
  private stopProgressUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
  
  /**
   * Update progress displays
   */
  private updateProgress(progress: TestProgress) {
    // Update progress bar
    const percent = (progress.completedPackages / progress.totalPackages) * 100;
    this.widgets.progressBar.setPercent(percent);
    this.widgets.progressBar.setLabel(
      ` Overall Progress (${progress.completedPackages}/${progress.totalPackages}) `
    );
    
    // Update coverage gauge
    this.widgets.coverageGauge.setPercent(progress.coverage.overall);
    
    // Update throughput chart
    this.throughputData.push(progress.currentThroughput);
    if (this.throughputData.length > 60) {
      this.throughputData.shift();
    }
    
    this.widgets.throughputLine.setData([{
      title: 'Throughput',
      x: Array.from({ length: this.throughputData.length }, (_, i) => i.toString()),
      y: this.throughputData,
      style: { line: 'cyan' }
    }]);
    
    // Update running tests
    this.widgets.runningTests.setContent(
      progress.runningPackages.map(p => `• ${p}`).join('\n')
    );
    this.widgets.runningTests.setLabel(` Running (${progress.runningPackages.length}) `);
    
    // Update failed tests
    this.widgets.failedTests.setContent(
      progress.failedPackages.map(p => `• ${p}`).join('\n')
    );
    this.widgets.failedTests.setLabel(` Failed (${progress.failedPackages.length}) `);
    
    // Update summary
    this.widgets.summary.setContent(this.generateSummaryContent(progress));
    
    // Render changes
    this.screen.render();
  }
  
  /**
   * Generate summary content
   */
  private generateSummaryContent(progress: TestProgress): string {
    const etaSeconds = Math.ceil(progress.estimatedTimeRemaining / 1000);
    const etaMinutes = Math.floor(etaSeconds / 60);
    const etaRemaining = etaSeconds % 60;
    
    return [
      `Total Packages:    ${progress.totalPackages}`,
      `Completed:         ${progress.completedPackages}`,
      `Passed:            ${progress.passedPackages.length}`,
      `Failed:            ${progress.failedPackages.length}`,
      `Running:           ${progress.runningPackages.length}`,
      '',
      `Throughput:        ${progress.currentThroughput.toFixed(2)} pkg/sec`,
      `ETA:               ${etaMinutes}m ${etaRemaining}s`,
      '',
      `Coverage:          ${progress.coverage.overall.toFixed(1)}%`
    ].join('\n');
  }
  
  /**
   * Update package list
   */
  private updatePackageList(packages: any[]) {
    const items = packages.map(pkg => {
      const icon = pkg.hasTests ? '📦' : '⚠️';
      return `${icon} ${pkg.name}`;
    });
    
    this.widgets.packageList.setItems(items);
    this.screen.render();
  }
  
  /**
   * Update test results
   */
  private updateTestResults(result: TestResult) {
    // Update package list item with result
    const items = this.widgets.packageList.items;
    const index = items.findIndex(item => item.content.includes(result.package));
    
    if (index !== -1) {
      const icon = result.success ? '✅' : '❌';
      const coverage = result.coverage ? ` (${result.coverage.lines.toFixed(0)}%)` : '';
      items[index].content = `${icon} ${result.package}${coverage}`;
      this.widgets.packageList.setItems(items.map(i => i.content));
    }
    
    this.updateRunningTests();
    this.updateFailedTests();
    this.screen.render();
  }
  
  /**
   * Update running tests display
   */
  private updateRunningTests() {
    const progress = this.orchestrator.getProgress();
    this.widgets.runningTests.setContent(
      progress.runningPackages.map(p => `• ${p}`).join('\n')
    );
    this.widgets.runningTests.setLabel(` Running (${progress.runningPackages.length}) `);
    this.screen.render();
  }
  
  /**
   * Update failed tests display
   */
  private updateFailedTests() {
    const progress = this.orchestrator.getProgress();
    this.widgets.failedTests.setContent(
      progress.failedPackages.map(p => `• ${p}`).join('\n')
    );
    this.widgets.failedTests.setLabel(` Failed (${progress.failedPackages.length}) `);
    this.screen.render();
  }
  
  /**
   * Show final report
   */
  private showFinalReport(report: any) {
    const box = blessed.box({
      parent: this.screen,
      label: ' Test Report ',
      border: { type: 'line' },
      style: {
        border: { fg: 'green' }
      },
      top: 'center',
      left: 'center',
      width: '80%',
      height: '80%',
      content: this.formatReport(report),
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true
    });
    
    box.key(['escape', 'q'], () => {
      box.destroy();
      this.screen.render();
    });
    
    box.focus();
    this.screen.render();
  }
  
  /**
   * Format report for display
   */
  private formatReport(report: any): string {
    const lines = [
      '═══════════════════════════════════════════════════',
      '              MONOREPO TEST REPORT                 ',
      '═══════════════════════════════════════════════════',
      '',
      `Total Packages:     ${report.summary.totalPackages}`,
      `Passed:            ${report.summary.passed}`,
      `Failed:            ${report.summary.failed}`,
      `Duration:          ${(report.summary.duration / 1000).toFixed(2)}s`,
      '',
      '───────────────────────────────────────────────────',
      '                   COVERAGE                        ',
      '───────────────────────────────────────────────────',
      ''
    ];
    
    if (report.summary.coverage) {
      lines.push(`Lines:             ${report.summary.coverage.lines.toFixed(1)}%`);
      lines.push(`Branches:          ${report.summary.coverage.branches.toFixed(1)}%`);
      lines.push(`Functions:         ${report.summary.coverage.functions.toFixed(1)}%`);
      lines.push(`Statements:        ${report.summary.coverage.statements.toFixed(1)}%`);
    } else {
      lines.push('No coverage data available');
    }
    
    if (report.results.filter(r => !r.success).length > 0) {
      lines.push('');
      lines.push('───────────────────────────────────────────────────');
      lines.push('                FAILED PACKAGES                    ');
      lines.push('───────────────────────────────────────────────────');
      lines.push('');
      
      report.results
        .filter(r => !r.success)
        .forEach(r => {
          lines.push(`❌ ${r.package}`);
          if (r.errors) {
            r.errors.forEach(err => lines.push(`   ${err}`));
          }
        });
    }
    
    lines.push('');
    lines.push('Press ESC or Q to close');
    
    return lines.join('\n');
  }
  
  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopProgressUpdates();
    this.screen.destroy();
  }
}

export default TerminalDashboard;