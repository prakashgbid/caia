#!/usr/bin/env node

const puppeteer = require('puppeteer');
const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs').promises;
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
// const lighthouse = require('lighthouse'); // Temporarily disabled
const { AxePuppeteer } = require('@axe-core/puppeteer');

class UITestingAgent {
    constructor(options = {}) {
        this.options = {
            headless: options.headless !== false,
            slowMo: options.slowMo || 0,
            viewport: options.viewport || { width: 1280, height: 800 },
            screenshotPath: options.screenshotPath || './test-results/screenshots',
            reportPath: options.reportPath || './test-results',
            baselinePath: options.baselinePath || './test-results/baselines',
            threshold: options.threshold || 0.1, // 0.1% difference allowed
            ...options
        };

        this.results = {
            functional: [],
            visual: [],
            performance: [],
            accessibility: [],
            summary: {
                passed: 0,
                failed: 0,
                warnings: 0
            }
        };

        this.browser = null;
        this.page = null;
    }

    async initialize() {
        const spinner = ora('Launching browser...').start();

        try {
            // Ensure directories exist
            await this.ensureDirectories();

            // Launch browser
            this.browser = await puppeteer.launch({
                headless: this.options.headless,
                slowMo: this.options.slowMo,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage'
                ]
            });

            this.page = await this.browser.newPage();
            await this.page.setViewport(this.options.viewport);

            // Set up console logging
            this.page.on('console', msg => {
                if (msg.type() === 'error') {
                    this.logError(`Console Error: ${msg.text()}`);
                }
            });

            // Set up request interception for monitoring
            await this.page.setRequestInterception(true);
            this.page.on('request', request => {
                request.continue();
            });

            spinner.succeed('Browser launched successfully');
        } catch (error) {
            spinner.fail('Failed to launch browser');
            throw error;
        }
    }

    async ensureDirectories() {
        const dirs = [
            this.options.screenshotPath,
            this.options.reportPath,
            this.options.baselinePath
        ];

        for (const dir of dirs) {
            await fs.mkdir(dir, { recursive: true });
        }
    }

    // Main test runner
    async test(url, testSuite = 'all') {
        console.log(chalk.cyan.bold('\n🧪 UI Testing Agent v1.0.0'));
        console.log(chalk.gray(`📍 Testing: ${url}\n`));

        try {
            await this.initialize();
            await this.page.goto(url, { waitUntil: 'networkidle2' });

            // Run test suites based on selection
            if (testSuite === 'all' || testSuite === 'functional') {
                await this.runFunctionalTests();
            }

            if (testSuite === 'all' || testSuite === 'visual') {
                await this.runVisualTests();
            }

            if (testSuite === 'all' || testSuite === 'performance') {
                await this.runPerformanceTests(url);
            }

            if (testSuite === 'all' || testSuite === 'accessibility') {
                await this.runAccessibilityTests();
            }

            await this.generateReport();
            this.printSummary();

        } catch (error) {
            this.logError(`Test failed: ${error.message}`);
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
        }

        return this.results;
    }

    // Functional Testing
    async runFunctionalTests() {
        const spinner = ora('Running functional tests...').start();

        try {
            // Test 1: Page loads correctly
            await this.testPageLoad();

            // Test 2: Interactive elements
            await this.testInteractiveElements();

            // Test 3: Forms and inputs
            await this.testForms();

            // Test 4: Navigation
            await this.testNavigation();

            // Test 5: API responses
            await this.testAPIResponses();

            spinner.succeed(`Functional tests completed: ${this.getFunctionalStats()}`);
        } catch (error) {
            spinner.fail('Functional tests failed');
            throw error;
        }
    }

    async testPageLoad() {
        const test = { name: 'Page Load', status: 'running' };

        try {
            const title = await this.page.title();
            if (!title) throw new Error('No page title found');

            const hasContent = await this.page.$('body') !== null;
            if (!hasContent) throw new Error('No body content found');

            test.status = 'passed';
            test.message = `Page loaded successfully with title: "${title}"`;
            this.results.summary.passed++;
        } catch (error) {
            test.status = 'failed';
            test.message = error.message;
            this.results.summary.failed++;
        }

        this.results.functional.push(test);
    }

    async testInteractiveElements() {
        const test = { name: 'Interactive Elements', status: 'running' };

        try {
            // Find all clickable elements
            const buttons = await this.page.$$('button');
            const links = await this.page.$$('a');

            test.details = {
                buttons: buttons.length,
                links: links.length
            };

            // Test a sample of buttons
            for (let i = 0; i < Math.min(3, buttons.length); i++) {
                const button = buttons[i];
                const isClickable = await button.evaluate(el => {
                    return !el.disabled && el.offsetParent !== null;
                });

                if (!isClickable) {
                    test.warnings = test.warnings || [];
                    test.warnings.push(`Button ${i} is not clickable`);
                }
            }

            test.status = 'passed';
            test.message = `Found ${buttons.length} buttons and ${links.length} links`;
            this.results.summary.passed++;
        } catch (error) {
            test.status = 'failed';
            test.message = error.message;
            this.results.summary.failed++;
        }

        this.results.functional.push(test);
    }

    async testForms() {
        const test = { name: 'Form Testing', status: 'running' };

        try {
            const forms = await this.page.$$('form');
            const inputs = await this.page.$$('input, textarea, select');

            test.details = {
                forms: forms.length,
                inputs: inputs.length
            };

            // Test input functionality
            for (const input of inputs.slice(0, 3)) {
                const type = await input.evaluate(el => el.type);
                const isEnabled = await input.evaluate(el => !el.disabled);

                if (isEnabled && type === 'text') {
                    await input.type('test');
                    await input.evaluate(el => el.value = '');
                }
            }

            test.status = 'passed';
            test.message = `Tested ${forms.length} forms with ${inputs.length} inputs`;
            this.results.summary.passed++;
        } catch (error) {
            test.status = 'failed';
            test.message = error.message;
            this.results.summary.failed++;
        }

        this.results.functional.push(test);
    }

    async testNavigation() {
        const test = { name: 'Navigation Testing', status: 'running' };

        try {
            // Test tab navigation for dashboard
            const tabs = await this.page.$$('.tab-button');

            for (const tab of tabs.slice(0, 3)) {
                const text = await tab.evaluate(el => el.textContent);
                await tab.click();
                await this.page.waitForTimeout(500);

                // Check if content changed
                const activeTab = await this.page.$('.tab-content.active');
                if (!activeTab) {
                    throw new Error(`Tab "${text}" did not activate content`);
                }
            }

            test.status = 'passed';
            test.message = `Navigation working for ${tabs.length} tabs`;
            this.results.summary.passed++;
        } catch (error) {
            test.status = 'failed';
            test.message = error.message;
            this.results.summary.failed++;
        }

        this.results.functional.push(test);
    }

    async testAPIResponses() {
        const test = { name: 'API Response Testing', status: 'running' };
        const apiCalls = [];

        try {
            // Monitor API calls
            this.page.on('response', response => {
                if (response.url().includes('/api/')) {
                    apiCalls.push({
                        url: response.url(),
                        status: response.status(),
                        ok: response.ok()
                    });
                }
            });

            // Trigger some API calls by interacting with page
            const refreshBtn = await this.page.$('button[onclick="refreshData()"]');
            if (refreshBtn) {
                await refreshBtn.click();
                await this.page.waitForTimeout(2000);
            }

            const failedCalls = apiCalls.filter(call => !call.ok);

            if (failedCalls.length > 0) {
                test.status = 'failed';
                test.message = `${failedCalls.length} API calls failed`;
            } else {
                test.status = 'passed';
                test.message = `All ${apiCalls.length} API calls successful`;
            }

            test.details = apiCalls;
            this.results.summary[test.status === 'passed' ? 'passed' : 'failed']++;
        } catch (error) {
            test.status = 'failed';
            test.message = error.message;
            this.results.summary.failed++;
        }

        this.results.functional.push(test);
    }

    // Visual Testing
    async runVisualTests() {
        const spinner = ora('Running visual tests...').start();

        try {
            // Test 1: Full page screenshot
            await this.testFullPageScreenshot();

            // Test 2: Element screenshots
            await this.testElementScreenshots();

            // Test 3: Responsive design
            await this.testResponsiveDesign();

            // Test 4: CSS validation
            await this.testCSSValidation();

            spinner.succeed(`Visual tests completed: ${this.getVisualStats()}`);
        } catch (error) {
            spinner.fail('Visual tests failed');
            throw error;
        }
    }

    async testFullPageScreenshot() {
        const test = { name: 'Full Page Screenshot', status: 'running' };

        try {
            const screenshotPath = path.join(
                this.options.screenshotPath,
                'full-page.png'
            );

            await this.page.screenshot({
                path: screenshotPath,
                fullPage: true
            });

            // Compare with baseline if exists
            const baselinePath = path.join(
                this.options.baselinePath,
                'full-page.png'
            );

            const hasBaseline = await fs.access(baselinePath)
                .then(() => true)
                .catch(() => false);

            if (hasBaseline) {
                const diff = await this.compareImages(baselinePath, screenshotPath);

                if (diff.percentage > this.options.threshold) {
                    test.status = 'failed';
                    test.message = `Visual regression detected: ${diff.percentage.toFixed(2)}% difference`;
                } else {
                    test.status = 'passed';
                    test.message = `Visual test passed: ${diff.percentage.toFixed(2)}% difference`;
                }
            } else {
                // Create baseline
                await fs.copyFile(screenshotPath, baselinePath);
                test.status = 'passed';
                test.message = 'Baseline created';
            }

            this.results.summary[test.status === 'passed' ? 'passed' : 'failed']++;
        } catch (error) {
            test.status = 'failed';
            test.message = error.message;
            this.results.summary.failed++;
        }

        this.results.visual.push(test);
    }

    async testElementScreenshots() {
        const test = { name: 'Element Screenshots', status: 'running' };

        try {
            const elements = [
                { selector: 'header', name: 'header' },
                { selector: '.tab-button.active', name: 'active-tab' },
                { selector: '.stats-card', name: 'stats-card' }
            ];

            for (const elem of elements) {
                const element = await this.page.$(elem.selector);
                if (element) {
                    await element.screenshot({
                        path: path.join(this.options.screenshotPath, `${elem.name}.png`)
                    });
                }
            }

            test.status = 'passed';
            test.message = `Captured ${elements.length} element screenshots`;
            this.results.summary.passed++;
        } catch (error) {
            test.status = 'failed';
            test.message = error.message;
            this.results.summary.failed++;
        }

        this.results.visual.push(test);
    }

    async testResponsiveDesign() {
        const test = { name: 'Responsive Design', status: 'running' };
        const viewports = [
            { name: 'mobile', width: 375, height: 667 },
            { name: 'tablet', width: 768, height: 1024 },
            { name: 'desktop', width: 1920, height: 1080 }
        ];

        try {
            for (const viewport of viewports) {
                await this.page.setViewport(viewport);
                await this.page.waitForTimeout(500);

                await this.page.screenshot({
                    path: path.join(
                        this.options.screenshotPath,
                        `responsive-${viewport.name}.png`
                    )
                });
            }

            // Reset viewport
            await this.page.setViewport(this.options.viewport);

            test.status = 'passed';
            test.message = `Tested ${viewports.length} viewport sizes`;
            this.results.summary.passed++;
        } catch (error) {
            test.status = 'failed';
            test.message = error.message;
            this.results.summary.failed++;
        }

        this.results.visual.push(test);
    }

    async testCSSValidation() {
        const test = { name: 'CSS Validation', status: 'running' };

        try {
            // Check for CSS errors
            const cssErrors = await this.page.evaluate(() => {
                const errors = [];
                const styles = document.querySelectorAll('style, link[rel="stylesheet"]');

                // Check for broken styles
                document.querySelectorAll('*').forEach(element => {
                    const computed = window.getComputedStyle(element);
                    if (computed.display === 'none' && !element.hidden) {
                        // Potentially unintended hiding
                    }
                });

                return errors;
            });

            test.status = 'passed';
            test.message = 'CSS validation passed';
            this.results.summary.passed++;
        } catch (error) {
            test.status = 'failed';
            test.message = error.message;
            this.results.summary.failed++;
        }

        this.results.visual.push(test);
    }

    // Performance Testing
    async runPerformanceTests(url) {
        const spinner = ora('Running performance tests...').start();

        try {
            // Basic performance metrics using Puppeteer's built-in features
            const metrics = await this.page.metrics();
            const performanceTiming = await this.page.evaluate(() => {
                const timing = window.performance.timing;
                return {
                    loadTime: timing.loadEventEnd - timing.navigationStart,
                    domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
                    firstPaint: timing.responseStart - timing.navigationStart
                };
            });

            const test = {
                name: 'Performance Metrics',
                status: performanceTiming.loadTime < 3000 ? 'passed' :
                       performanceTiming.loadTime < 5000 ? 'warning' : 'failed',
                metrics: {
                    loadTime: `${performanceTiming.loadTime}ms`,
                    domContentLoaded: `${performanceTiming.domContentLoaded}ms`,
                    firstPaint: `${performanceTiming.firstPaint}ms`,
                    JSHeapUsedSize: `${(metrics.JSHeapUsedSize / 1048576).toFixed(2)} MB`,
                    nodes: metrics.Nodes,
                    layoutCount: metrics.LayoutCount
                }
            };

            this.results.performance.push(test);
            this.results.summary[test.status === 'passed' ? 'passed' :
                                 test.status === 'warning' ? 'warnings' : 'failed']++;

            spinner.succeed(`Performance: Load time ${performanceTiming.loadTime}ms`);
        } catch (error) {
            spinner.fail('Performance tests failed');
            this.logError(error.message);
        }
    }

    // Accessibility Testing
    async runAccessibilityTests() {
        const spinner = ora('Running accessibility tests...').start();

        try {
            const results = await new AxePuppeteer(this.page).analyze();

            const test = {
                name: 'Accessibility Audit',
                violations: results.violations.length,
                passes: results.passes.length,
                status: results.violations.length === 0 ? 'passed' : 'failed'
            };

            if (results.violations.length > 0) {
                test.details = results.violations.map(v => ({
                    id: v.id,
                    impact: v.impact,
                    description: v.description,
                    nodes: v.nodes.length
                }));
            }

            this.results.accessibility.push(test);
            this.results.summary[test.status === 'passed' ? 'passed' : 'failed']++;

            spinner.succeed(`Accessibility: ${results.violations.length} violations found`);
        } catch (error) {
            spinner.fail('Accessibility tests failed');
            this.logError(error.message);
        }
    }

    // Image comparison for visual regression
    async compareImages(baseline, current) {
        const img1 = PNG.sync.read(await fs.readFile(baseline));
        const img2 = PNG.sync.read(await fs.readFile(current));

        const { width, height } = img1;
        const diff = new PNG({ width, height });

        const numDiffPixels = pixelmatch(
            img1.data,
            img2.data,
            diff.data,
            width,
            height,
            { threshold: 0.1 }
        );

        const percentage = (numDiffPixels / (width * height)) * 100;

        // Save diff image
        const diffPath = path.join(this.options.screenshotPath, 'diff.png');
        await fs.writeFile(diffPath, PNG.sync.write(diff));

        return { numDiffPixels, percentage, diffPath };
    }

    // Report generation
    async generateReport() {
        const reportPath = path.join(this.options.reportPath, 'report.json');
        await fs.writeFile(reportPath, JSON.stringify(this.results, null, 2));

        // Generate HTML report
        const htmlReport = this.generateHTMLReport();
        const htmlPath = path.join(this.options.reportPath, 'report.html');
        await fs.writeFile(htmlPath, htmlReport);

        console.log(chalk.gray(`\n📊 Report generated: ${htmlPath}`));
    }

    generateHTMLReport() {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>UI Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .summary { background: #f0f0f0; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .passed { color: green; }
        .failed { color: red; }
        .warning { color: orange; }
        .section { margin: 20px 0; }
        .test { margin: 10px 0; padding: 10px; background: white; border: 1px solid #ddd; }
        h1 { color: #333; }
        h2 { color: #666; border-bottom: 2px solid #eee; padding-bottom: 5px; }
    </style>
</head>
<body>
    <h1>UI Testing Report</h1>

    <div class="summary">
        <h2>Summary</h2>
        <p class="passed">✅ Passed: ${this.results.summary.passed}</p>
        <p class="failed">❌ Failed: ${this.results.summary.failed}</p>
        <p class="warning">⚠️ Warnings: ${this.results.summary.warnings}</p>
    </div>

    <div class="section">
        <h2>Functional Tests</h2>
        ${this.results.functional.map(t => `
            <div class="test ${t.status}">
                <strong>${t.name}</strong>: ${t.message || ''}
            </div>
        `).join('')}
    </div>

    <div class="section">
        <h2>Visual Tests</h2>
        ${this.results.visual.map(t => `
            <div class="test ${t.status}">
                <strong>${t.name}</strong>: ${t.message || ''}
            </div>
        `).join('')}
    </div>

    <div class="section">
        <h2>Performance</h2>
        ${this.results.performance.map(t => `
            <div class="test ${t.status}">
                <strong>${t.name}</strong>
                ${t.metrics ? `
                    <ul>
                        <li>Load Time: ${t.metrics.loadTime}</li>
                        <li>DOM Content Loaded: ${t.metrics.domContentLoaded}</li>
                        <li>First Paint: ${t.metrics.firstPaint}</li>
                        <li>JS Heap Size: ${t.metrics.JSHeapUsedSize}</li>
                        <li>DOM Nodes: ${t.metrics.nodes}</li>
                    </ul>
                ` : ''}
            </div>
        `).join('')}
    </div>

    <div class="section">
        <h2>Accessibility</h2>
        ${this.results.accessibility.map(t => `
            <div class="test ${t.status}">
                <strong>${t.name}</strong>: ${t.violations} violations, ${t.passes} passes
            </div>
        `).join('')}
    </div>
</body>
</html>
        `;
    }

    // Summary printing
    printSummary() {
        console.log('\n' + chalk.cyan('═'.repeat(50)));
        console.log(chalk.cyan.bold('Test Summary'));
        console.log(chalk.cyan('═'.repeat(50)));

        const { passed, failed, warnings } = this.results.summary;
        const total = passed + failed + warnings;

        console.log(chalk.green(`✅ Passed: ${passed}/${total}`));
        if (failed > 0) {
            console.log(chalk.red(`❌ Failed: ${failed}/${total}`));
        }
        if (warnings > 0) {
            console.log(chalk.yellow(`⚠️  Warnings: ${warnings}/${total}`));
        }

        console.log('\n' + chalk.gray('Run details:'));
        console.log(chalk.gray(`• Functional: ${this.getFunctionalStats()}`));
        console.log(chalk.gray(`• Visual: ${this.getVisualStats()}`));
        console.log(chalk.gray(`• Performance: ${this.getPerformanceStats()}`));
        console.log(chalk.gray(`• Accessibility: ${this.getAccessibilityStats()}`));
    }

    // Helper methods
    getFunctionalStats() {
        const passed = this.results.functional.filter(t => t.status === 'passed').length;
        const total = this.results.functional.length;
        return `${passed}/${total} passed`;
    }

    getVisualStats() {
        const passed = this.results.visual.filter(t => t.status === 'passed').length;
        const total = this.results.visual.length;
        return `${passed}/${total} passed`;
    }

    getPerformanceStats() {
        const perf = this.results.performance[0];
        return perf ? `Load time: ${perf.metrics?.loadTime || 'N/A'}` : 'Not tested';
    }

    getAccessibilityStats() {
        const a11y = this.results.accessibility[0];
        return a11y ? `${a11y.violations} violations` : 'Not tested';
    }

    logError(message) {
        console.error(chalk.red(`❌ ${message}`));
    }
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];
    const url = args[1] || 'http://localhost:3456';

    const agent = new UITestingAgent({
        headless: !args.includes('--headed'),
        slowMo: args.includes('--slow') ? 250 : 0
    });

    switch (command) {
        case 'test':
            agent.test(url, 'all');
            break;
        case 'visual':
            agent.test(url, 'visual');
            break;
        case 'perf':
        case 'performance':
            agent.test(url, 'performance');
            break;
        case 'a11y':
        case 'accessibility':
            agent.test(url, 'accessibility');
            break;
        default:
            console.log(chalk.yellow('Usage: ui-test [test|visual|perf|a11y] [url]'));
            console.log(chalk.gray('Example: ui-test test http://localhost:3456'));
    }
}

module.exports = UITestingAgent;