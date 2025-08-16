/**
 * ResearchCrawler
 * Crawls various sources for CC optimization discoveries
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import { Logger } from '../utils/logger';

interface CrawlResult {
  source: string;
  url: string;
  title: string;
  content: string;
  extractedConfigs: any[];
  timestamp: Date;
}

export class ResearchCrawler {
  private logger: Logger;
  private browser?: puppeteer.Browser;

  constructor() {
    this.logger = new Logger('ResearchCrawler');
  }

  /**
   * Initialize crawler with browser for dynamic content
   */
  async initialize(): Promise<void> {
    try {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      this.logger.info('Research crawler initialized');
    } catch (error) {
      this.logger.error('Failed to initialize crawler', error);
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.logger.info('Browser closed');
    }
  }

  /**
   * Crawl documentation for configuration patterns
   */
  async crawlDocumentation(url: string): Promise<CrawlResult> {
    this.logger.info(`Crawling documentation: ${url}`);

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        },
        timeout: 30000
      });

      const $ = cheerio.load(response.data);
      const title = $('title').text() || $('h1').first().text();
      
      // Extract main content
      const content = this.extractContent($);
      
      // Extract configuration patterns
      const configs = this.extractConfigurationPatterns(content, $);

      return {
        source: 'documentation',
        url,
        title,
        content,
        extractedConfigs: configs,
        timestamp: new Date()
      };

    } catch (error) {
      this.logger.error(`Failed to crawl documentation: ${url}`, error);
      throw error;
    }
  }

  /**
   * Crawl GitHub repository for configuration updates
   */
  async crawlRepository(repoUrl: string, sinceDate?: Date): Promise<CrawlResult[]> {
    this.logger.info(`Crawling repository: ${repoUrl}`);

    const results: CrawlResult[] = [];
    
    try {
      // Extract repo info from URL
      const repoMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!repoMatch) {
        throw new Error('Invalid GitHub repository URL');
      }

      const [, owner, repo] = repoMatch;
      
      // Get recent commits
      const commitsUrl = `https://api.github.com/repos/${owner}/${repo}/commits`;
      const params: any = { per_page: 50 };
      
      if (sinceDate) {
        params.since = sinceDate.toISOString();
      }

      const response = await axios.get(commitsUrl, { params });

      for (const commit of response.data) {
        // Check if commit is configuration-related
        if (this.isConfigurationCommit(commit)) {
          const commitResult = await this.analyzeCommit(commit, owner, repo);
          if (commitResult) {
            results.push(commitResult);
          }
        }
      }

      // Get recent issues with configuration labels
      const issuesUrl = `https://api.github.com/repos/${owner}/${repo}/issues`;
      const issueParams = {
        labels: 'configuration,performance,optimization',
        state: 'all',
        per_page: 50
      };

      const issuesResponse = await axios.get(issuesUrl, { params: issueParams });

      for (const issue of issuesResponse.data) {
        const issueResult = this.analyzeIssue(issue);
        if (issueResult.extractedConfigs.length > 0) {
          results.push(issueResult);
        }
      }

      return results;

    } catch (error) {
      this.logger.error(`Failed to crawl repository: ${repoUrl}`, error);
      return [];
    }
  }

  /**
   * Crawl blog/news sites for CC optimization articles
   */
  async crawlBlog(url: string): Promise<CrawlResult> {
    this.logger.info(`Crawling blog: ${url}`);

    if (!this.browser) {
      await this.initialize();
    }

    try {
      const page = await this.browser!.newPage();
      await page.goto(url, { waitUntil: 'networkidle0' });

      // Extract article content
      const content = await page.evaluate(() => {
        // Try common article selectors
        const selectors = [
          'article',
          '.post-content',
          '.entry-content',
          '.content',
          'main'
        ];

        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            return element.textContent || '';
          }
        }

        return document.body.textContent || '';
      });

      const title = await page.title();

      await page.close();

      // Extract configurations from content
      const configs = this.extractConfigurationsFromText(content);

      return {
        source: 'blog',
        url,
        title,
        content,
        extractedConfigs: configs,
        timestamp: new Date()
      };

    } catch (error) {
      this.logger.error(`Failed to crawl blog: ${url}`, error);
      throw error;
    }
  }

  /**
   * Extract main content from documentation
   */
  private extractContent($: cheerio.CheerioAPI): string {
    // Remove navigation, headers, footers
    $('nav, header, footer, .sidebar, .navigation').remove();
    
    // Extract from main content areas
    const contentSelectors = [
      'main',
      '.content',
      '.documentation',
      'article',
      '.main-content'
    ];

    for (const selector of contentSelectors) {
      const content = $(selector).text();
      if (content && content.length > 1000) {
        return content;
      }
    }

    // Fallback to body
    return $('body').text();
  }

  /**
   * Extract configuration patterns from content and DOM
   */
  private extractConfigurationPatterns(content: string, $: cheerio.CheerioAPI): any[] {
    const configurations: any[] = [];

    // Extract from code blocks
    $('pre code, .code-block, .highlight').each((_, elem) => {
      const code = $(elem).text();
      const configs = this.parseCodeForConfigurations(code);
      configurations.push(...configs);
    });

    // Extract from configuration tables
    $('table').each((_, table) => {
      const configs = this.parseTableForConfigurations($(table));
      configurations.push(...configs);
    });

    // Extract from text patterns
    const textConfigs = this.extractConfigurationsFromText(content);
    configurations.push(...textConfigs);

    return configurations;
  }

  /**
   * Parse code blocks for configuration patterns
   */
  private parseCodeForConfigurations(code: string): any[] {
    const configurations: any[] = [];

    // JSON configuration patterns
    const jsonMatches = code.match(/\{[^}]*"[^"]*":\s*[^,}]+[^}]*\}/g);
    if (jsonMatches) {
      for (const match of jsonMatches) {
        try {
          const config = JSON.parse(match);
          configurations.push(this.normalizeConfiguration(config));
        } catch {
          // Ignore invalid JSON
        }
      }
    }

    // YAML configuration patterns
    const yamlMatches = code.match(/^[a-zA-Z_][a-zA-Z0-9_]*:\s*.+$/gm);
    if (yamlMatches) {
      for (const match of yamlMatches) {
        const [key, value] = match.split(':', 2);
        if (key && value) {
          configurations.push({
            setting: key.trim(),
            value: value.trim(),
            description: `Configuration setting from code example`
          });
        }
      }
    }

    return configurations;
  }

  /**
   * Parse configuration tables
   */
  private parseTableForConfigurations($table: cheerio.Cheerio<any>): any[] {
    const configurations: any[] = [];

    $table.find('tr').each((_, row) => {
      const cells = $(row).find('td, th');
      if (cells.length >= 2) {
        const setting = $(cells[0]).text().trim();
        const value = $(cells[1]).text().trim();
        const description = cells.length > 2 ? $(cells[2]).text().trim() : '';

        if (setting && value && this.looksLikeConfiguration(setting)) {
          configurations.push({
            setting,
            value: this.parseValue(value),
            description: description || `Configuration setting from documentation table`
          });
        }
      }
    });

    return configurations;
  }

  /**
   * Extract configurations from plain text
   */
  private extractConfigurationsFromText(text: string): any[] {
    const configurations: any[] = [];

    // Pattern: setting = value
    const settingMatches = text.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([^\n\r;]+)/g);
    if (settingMatches) {
      for (const match of settingMatches) {
        const [, setting, value] = match.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([^\n\r;]+)/) || [];
        if (setting && value && this.looksLikeConfiguration(setting)) {
          configurations.push({
            setting: setting.trim(),
            value: this.parseValue(value.trim()),
            description: `Configuration setting extracted from text`
          });
        }
      }
    }

    return configurations;
  }

  /**
   * Check if commit is configuration-related
   */
  private isConfigurationCommit(commit: any): boolean {
    const message = commit.commit.message.toLowerCase();
    const keywords = [
      'config', 'configuration', 'setting', 'option',
      'performance', 'optimize', 'optimization',
      'parallel', 'async', 'cache', 'memory',
      'rate limit', 'timeout', 'retry'
    ];

    return keywords.some(keyword => message.includes(keyword));
  }

  /**
   * Analyze a commit for configuration changes
   */
  private async analyzeCommit(commit: any, owner: string, repo: string): Promise<CrawlResult | null> {
    try {
      // Get commit details
      const commitUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${commit.sha}`;
      const response = await axios.get(commitUrl);
      const commitData = response.data;

      const configs: any[] = [];

      // Analyze changed files
      for (const file of commitData.files || []) {
        if (this.isConfigurationFile(file.filename)) {
          const fileConfigs = this.extractConfigurationsFromDiff(file.patch || '');
          configs.push(...fileConfigs);
        }
      }

      if (configs.length === 0) {
        return null;
      }

      return {
        source: 'repository',
        url: commit.html_url,
        title: commit.commit.message,
        content: commitData.commit.message,
        extractedConfigs: configs,
        timestamp: new Date(commit.commit.author.date)
      };

    } catch (error) {
      this.logger.error(`Failed to analyze commit: ${commit.sha}`, error);
      return null;
    }
  }

  /**
   * Analyze an issue for configuration information
   */
  private analyzeIssue(issue: any): CrawlResult {
    const content = issue.body || '';
    const configs = this.extractConfigurationsFromText(content);

    return {
      source: 'repository',
      url: issue.html_url,
      title: issue.title,
      content,
      extractedConfigs: configs,
      timestamp: new Date(issue.created_at)
    };
  }

  /**
   * Extract configurations from git diff
   */
  private extractConfigurationsFromDiff(diff: string): any[] {
    const configurations: any[] = [];
    
    // Look for added lines with configurations
    const addedLines = diff.split('\n').filter(line => line.startsWith('+'));
    
    for (const line of addedLines) {
      const cleanLine = line.substring(1).trim();
      const configs = this.extractConfigurationsFromText(cleanLine);
      configurations.push(...configs);
    }

    return configurations;
  }

  /**
   * Check if filename suggests configuration
   */
  private isConfigurationFile(filename: string): boolean {
    const configPatterns = [
      /config/i,
      /settings/i,
      /\.env/i,
      /\.yaml$/i,
      /\.yml$/i,
      /\.json$/i,
      /\.toml$/i
    ];

    return configPatterns.some(pattern => pattern.test(filename));
  }

  /**
   * Check if setting name looks like a configuration
   */
  private looksLikeConfiguration(setting: string): boolean {
    // Skip common non-configuration words
    const skipWords = ['the', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'with'];
    if (skipWords.includes(setting.toLowerCase())) {
      return false;
    }

    // Look for configuration-like patterns
    const configPatterns = [
      /^[a-z][a-zA-Z0-9_]*$/,  // camelCase or snake_case
      /_/,                      // contains underscore
      /timeout/i,
      /limit/i,
      /size/i,
      /max/i,
      /min/i,
      /enable/i,
      /disable/i
    ];

    return configPatterns.some(pattern => pattern.test(setting));
  }

  /**
   * Parse value from string
   */
  private parseValue(value: string): any {
    const trimmed = value.trim();

    // Boolean
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;

    // Number
    if (/^\d+$/.test(trimmed)) return parseInt(trimmed);
    if (/^\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);

    // Array (simple comma-separated)
    if (trimmed.includes(',') && !trimmed.includes(' ')) {
      return trimmed.split(',').map(item => this.parseValue(item));
    }

    // String
    return trimmed.replace(/^['"]|['"]$/g, '');
  }

  /**
   * Normalize configuration object
   */
  private normalizeConfiguration(config: any): any {
    if (typeof config === 'object' && config !== null) {
      const keys = Object.keys(config);
      if (keys.length === 1) {
        const key = keys[0];
        return {
          setting: key,
          value: config[key],
          description: `Configuration extracted from JSON`
        };
      }
    }

    return config;
  }
}