/**
 * @caia/dependency-analyzer
 * Dependency graph analysis and optimization
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

export interface DependencyNode {
  id: string;
  name: string;
  version?: string;
  type: 'package' | 'module' | 'file' | 'function' | 'service' | 'resource';
  source?: string; // file path or package name
  dependencies: string[];
  dependents: string[];
  metadata?: Record<string, unknown>;
  size?: number;
  lastModified?: number;
  cyclic?: boolean;
  depth?: number;
  critical?: boolean;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'imports' | 'requires' | 'uses' | 'extends' | 'implements' | 'calls' | 'depends';
  weight?: number;
  optional?: boolean;
  dynamic?: boolean;
  metadata?: Record<string, unknown>;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: Map<string, DependencyEdge[]>;
  metadata: {
    createdAt: number;
    lastAnalyzed: number;
    source: string;
    stats: GraphStats;
  };
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  maxDepth: number;
  averageDepth: number;
  cyclicDependencies: number;
  criticalNodes: number;
  orphanNodes: number;
  leafNodes: number;
  density: number;
  complexity: number;
}

export interface CyclicDependency {
  cycle: string[];
  length: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  suggestions: string[];
}

export interface DependencyAnalysis {
  graph: DependencyGraph;
  cycles: CyclicDependency[];
  criticalPath: string[];
  vulnerabilities: Vulnerability[];
  optimizations: Optimization[];
  metrics: AnalysisMetrics;
}

export interface Vulnerability {
  nodeId: string;
  type: 'security' | 'performance' | 'maintenance' | 'compatibility';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  impact: string;
  recommendation: string;
  cve?: string;
  affectedVersions?: string[];
}

export interface Optimization {
  type: 'remove' | 'replace' | 'update' | 'bundle' | 'lazy-load' | 'cache';
  target: string;
  description: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
  benefit: 'low' | 'medium' | 'high';
  steps: string[];
}

export interface AnalysisMetrics {
  analysisTime: number;
  memoryUsage: number;
  filesAnalyzed: number;
  dependenciesFound: number;
  issuesIdentified: number;
  optimizationsProposed: number;
}

export interface AnalysisConfig {
  includeDevDependencies: boolean;
  includePeerDependencies: boolean;
  followDynamicImports: boolean;
  analyzeFileSystem: boolean;
  maxDepth: number;
  excludePatterns: string[];
  includePatterns: string[];
  enableVulnerabilityScanning: boolean;
  enableOptimizationSuggestions: boolean;
  cachePath?: string;
}

export interface ImportResolver {
  resolve(importPath: string, fromFile: string): string | null;
  supports(importPath: string): boolean;
}

export interface Parser {
  parse(content: string, filePath: string): { imports: string[]; exports: string[] };
  supports(filePath: string): boolean;
}

export class DependencyAnalyzer extends EventEmitter {
  private config: AnalysisConfig;
  private parsers: Map<string, Parser> = new Map();
  private resolvers: Map<string, ImportResolver> = new Map();
  private cache: Map<string, DependencyAnalysis> = new Map();

  constructor(config: Partial<AnalysisConfig> = {}) {
    super();
    this.config = {
      includeDevDependencies: false,
      includePeerDependencies: false,
      followDynamicImports: true,
      analyzeFileSystem: true,
      maxDepth: 10,
      excludePatterns: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
      includePatterns: ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx'],
      enableVulnerabilityScanning: true,
      enableOptimizationSuggestions: true,
      ...config
    };

    this.setupDefaultParsers();
    this.setupDefaultResolvers();
  }

  /**
   * Analyze dependencies from a package.json file
   */
  async analyzePackage(packagePath: string): Promise<DependencyAnalysis> {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage().heapUsed;

    try {
      const packageJson = JSON.parse(await fs.promises.readFile(packagePath, 'utf8'));
      const graph = await this.buildPackageGraph(packageJson, path.dirname(packagePath));
      
      const analysis = await this.performAnalysis(graph);
      
      analysis.metrics = {
        analysisTime: Date.now() - startTime,
        memoryUsage: process.memoryUsage().heapUsed - initialMemory,
        filesAnalyzed: 1,
        dependenciesFound: graph.nodes.size,
        issuesIdentified: analysis.cycles.length + analysis.vulnerabilities.length,
        optimizationsProposed: analysis.optimizations.length
      };

      this.emit('analysis-completed', analysis);
      return analysis;
    } catch (error) {
      this.emit('analysis-failed', error);
      throw error;
    }
  }

  /**
   * Analyze dependencies from source code
   */
  async analyzeSource(rootPath: string): Promise<DependencyAnalysis> {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage().heapUsed;
    let filesAnalyzed = 0;

    try {
      const files = await this.findSourceFiles(rootPath);
      const graph = await this.buildSourceGraph(files, rootPath);
      
      filesAnalyzed = files.length;
      const analysis = await this.performAnalysis(graph);
      
      analysis.metrics = {
        analysisTime: Date.now() - startTime,
        memoryUsage: process.memoryUsage().heapUsed - initialMemory,
        filesAnalyzed,
        dependenciesFound: graph.nodes.size,
        issuesIdentified: analysis.cycles.length + analysis.vulnerabilities.length,
        optimizationsProposed: analysis.optimizations.length
      };

      this.emit('analysis-completed', analysis);
      return analysis;
    } catch (error) {
      this.emit('analysis-failed', error);
      throw error;
    }
  }

  /**
   * Find circular dependencies
   */
  findCycles(graph: DependencyGraph): CyclicDependency[] {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (nodeId: string, path: string[]): void => {
      if (recursionStack.has(nodeId)) {
        // Found a cycle
        const cycleStart = path.indexOf(nodeId);
        const cycle = [...path.slice(cycleStart), nodeId];
        cycles.push(cycle);
        return;
      }

      if (visited.has(nodeId)) return;

      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const node = graph.nodes.get(nodeId);
      if (node) {
        node.dependencies.forEach(depId => {
          dfs(depId, [...path]);
        });
      }

      recursionStack.delete(nodeId);
      path.pop();
    };

    // Check all nodes
    graph.nodes.forEach((_, nodeId) => {
      if (!visited.has(nodeId)) {
        dfs(nodeId, []);
      }
    });

    return cycles.map(cycle => this.analyzeCycle(cycle, graph));
  }

  /**
   * Find critical path (longest dependency chain)
   */
  findCriticalPath(graph: DependencyGraph): string[] {
    const depths = new Map<string, number>();
    const parents = new Map<string, string>();

    // Calculate depths using topological sort
    const visited = new Set<string>();
    const stack: string[] = [];

    const dfs = (nodeId: string): void => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = graph.nodes.get(nodeId);
      if (node) {
        node.dependencies.forEach(depId => {
          if (graph.nodes.has(depId)) {
            dfs(depId);
          }
        });
      }
      stack.push(nodeId);
    };

    // Visit all nodes
    graph.nodes.forEach((_, nodeId) => dfs(nodeId));

    // Calculate depths
    stack.reverse().forEach(nodeId => {
      const node = graph.nodes.get(nodeId);
      if (!node) return;

      let maxDepth = 0;
      let deepestParent = '';

      node.dependencies.forEach(depId => {
        const depDepth = depths.get(depId) || 0;
        if (depDepth + 1 > maxDepth) {
          maxDepth = depDepth + 1;
          deepestParent = depId;
        }
      });

      depths.set(nodeId, maxDepth);
      if (deepestParent) {
        parents.set(nodeId, deepestParent);
      }
    });

    // Find the node with maximum depth
    let maxDepth = 0;
    let deepestNode = '';
    depths.forEach((depth, nodeId) => {
      if (depth > maxDepth) {
        maxDepth = depth;
        deepestNode = nodeId;
      }
    });

    // Reconstruct critical path
    const path: string[] = [];
    let current = deepestNode;
    while (current) {
      path.unshift(current);
      current = parents.get(current) || '';
    }

    return path;
  }

  /**
   * Detect vulnerabilities in dependencies
   */
  async detectVulnerabilities(graph: DependencyGraph): Promise<Vulnerability[]> {
    if (!this.config.enableVulnerabilityScanning) {
      return [];
    }

    const vulnerabilities: Vulnerability[] = [];

    for (const [nodeId, node] of graph.nodes) {
      // Check for known security issues
      if (node.type === 'package') {
        const packageVulns = await this.checkPackageVulnerabilities(node);
        vulnerabilities.push(...packageVulns);
      }

      // Check for performance issues
      const perfIssues = this.checkPerformanceIssues(node, graph);
      vulnerabilities.push(...perfIssues);

      // Check for maintenance issues
      const maintIssues = this.checkMaintenanceIssues(node);
      vulnerabilities.push(...maintIssues);
    }

    return vulnerabilities;
  }

  /**
   * Suggest optimizations
   */
  suggestOptimizations(graph: DependencyGraph, cycles: CyclicDependency[]): Optimization[] {
    if (!this.config.enableOptimizationSuggestions) {
      return [];
    }

    const optimizations: Optimization[] = [];

    // Suggest cycle breaking
    cycles.forEach(cycle => {
      if (cycle.severity === 'high' || cycle.severity === 'critical') {
        optimizations.push({
          type: 'remove',
          target: cycle.cycle[cycle.cycle.length - 2],
          description: `Break circular dependency in ${cycle.cycle.join(' -> ')}`,
          impact: 'Improves maintainability and reduces build complexity',
          effort: 'medium',
          benefit: 'high',
          steps: cycle.suggestions
        });
      }
    });

    // Suggest unused dependency removal
    graph.nodes.forEach((node, nodeId) => {
      if (node.dependents.length === 0 && node.type === 'package') {
        optimizations.push({
          type: 'remove',
          target: nodeId,
          description: `Remove unused dependency: ${node.name}`,
          impact: 'Reduces bundle size and installation time',
          effort: 'low',
          benefit: 'medium',
          steps: [
            `Remove ${node.name} from package.json`,
            'Verify no runtime dependencies',
            'Test application functionality'
          ]
        });
      }
    });

    // Suggest dependency consolidation
    const similarPackages = this.findSimilarPackages(graph);
    similarPackages.forEach(group => {
      if (group.length > 1) {
        optimizations.push({
          type: 'replace',
          target: group.map(p => p.id).join(', '),
          description: `Consolidate similar packages: ${group.map(p => p.name).join(', ')}`,
          impact: 'Reduces bundle size and maintenance overhead',
          effort: 'medium',
          benefit: 'medium',
          steps: [
            'Evaluate functionality overlap',
            'Choose the best alternative',
            'Migrate to single solution',
            'Update imports and configuration'
          ]
        });
      }
    });

    // Suggest lazy loading opportunities
    const heavyDependencies = this.findHeavyDependencies(graph);
    heavyDependencies.forEach(node => {
      optimizations.push({
        type: 'lazy-load',
        target: node.id,
        description: `Lazy load heavy dependency: ${node.name}`,
        impact: 'Improves initial load time',
        effort: 'medium',
        benefit: 'high',
        steps: [
          'Implement dynamic imports',
          'Add loading states',
          'Handle async dependency loading',
          'Test lazy loading behavior'
        ]
      });
    });

    return optimizations;
  }

  /**
   * Calculate graph statistics
   */
  calculateStats(graph: DependencyGraph): GraphStats {
    const nodes = Array.from(graph.nodes.values());
    const totalEdges = Array.from(graph.edges.values())
      .reduce((sum, edges) => sum + edges.length, 0);

    // Calculate depths
    const depths = this.calculateNodeDepths(graph);
    const depthValues = Array.from(depths.values());
    
    const maxDepth = Math.max(...depthValues);
    const averageDepth = depthValues.reduce((sum, d) => sum + d, 0) / depthValues.length;

    // Count special node types
    const orphanNodes = nodes.filter(n => n.dependencies.length === 0 && n.dependents.length === 0).length;
    const leafNodes = nodes.filter(n => n.dependencies.length === 0 && n.dependents.length > 0).length;
    const criticalNodes = nodes.filter(n => n.critical).length;
    const cyclicNodes = nodes.filter(n => n.cyclic).length;

    // Calculate density (edges / possible edges)
    const possibleEdges = nodes.length * (nodes.length - 1);
    const density = possibleEdges > 0 ? totalEdges / possibleEdges : 0;

    // Calculate complexity (subjective metric)
    const complexity = (
      maxDepth * 0.3 +
      (totalEdges / nodes.length) * 0.3 +
      cyclicNodes * 0.2 +
      density * 100 * 0.2
    );

    return {
      totalNodes: nodes.length,
      totalEdges,
      maxDepth,
      averageDepth,
      cyclicDependencies: cyclicNodes,
      criticalNodes,
      orphanNodes,
      leafNodes,
      density,
      complexity
    };
  }

  /**
   * Export graph in various formats
   */
  exportGraph(graph: DependencyGraph, format: 'json' | 'dot' | 'mermaid' | 'csv'): string {
    switch (format) {
      case 'json':
        return this.exportToJson(graph);
      case 'dot':
        return this.exportToDot(graph);
      case 'mermaid':
        return this.exportToMermaid(graph);
      case 'csv':
        return this.exportToCsv(graph);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Register a custom parser
   */
  registerParser(extension: string, parser: Parser): void {
    this.parsers.set(extension, parser);
    this.emit('parser-registered', extension);
  }

  /**
   * Register a custom import resolver
   */
  registerResolver(name: string, resolver: ImportResolver): void {
    this.resolvers.set(name, resolver);
    this.emit('resolver-registered', name);
  }

  /**
   * Build dependency graph from package.json
   */
  private async buildPackageGraph(packageJson: any, basePath: string): Promise<DependencyGraph> {
    const graph: DependencyGraph = {
      nodes: new Map(),
      edges: new Map(),
      metadata: {
        createdAt: Date.now(),
        lastAnalyzed: Date.now(),
        source: 'package.json',
        stats: this.initializeStats()
      }
    };

    const dependencies = {
      ...packageJson.dependencies || {},
      ...(this.config.includeDevDependencies ? packageJson.devDependencies || {} : {}),
      ...(this.config.includePeerDependencies ? packageJson.peerDependencies || {} : {})
    };

    // Create nodes for each dependency
    Object.entries(dependencies).forEach(([name, version]) => {
      const nodeId = `${name}@${version}`;
      graph.nodes.set(nodeId, {
        id: nodeId,
        name,
        version: version as string,
        type: 'package',
        dependencies: [],
        dependents: []
      });
    });

    // If file system analysis is enabled, also analyze source files
    if (this.config.analyzeFileSystem) {
      const sourceGraph = await this.buildSourceGraph(await this.findSourceFiles(basePath), basePath);
      this.mergeGraphs(graph, sourceGraph);
    }

    graph.metadata.stats = this.calculateStats(graph);
    return graph;
  }

  /**
   * Build dependency graph from source files
   */
  private async buildSourceGraph(files: string[], basePath: string): Promise<DependencyGraph> {
    const graph: DependencyGraph = {
      nodes: new Map(),
      edges: new Map(),
      metadata: {
        createdAt: Date.now(),
        lastAnalyzed: Date.now(),
        source: 'source-code',
        stats: this.initializeStats()
      }
    };

    // Process each file
    for (const file of files) {
      await this.processFile(file, basePath, graph);
    }

    // Calculate depths and identify cycles
    this.markCyclicNodes(graph);
    this.calculateNodeDepths(graph);

    graph.metadata.stats = this.calculateStats(graph);
    return graph;
  }

  /**
   * Process a single file and add to graph
   */
  private async processFile(filePath: string, basePath: string, graph: DependencyGraph): Promise<void> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      const relativePath = path.relative(basePath, filePath);
      
      // Find appropriate parser
      const parser = this.findParser(filePath);
      if (!parser) return;

      const { imports } = parser.parse(content, filePath);
      
      // Create node for this file
      const stats = await fs.promises.stat(filePath);
      const nodeId = relativePath;
      
      const node: DependencyNode = {
        id: nodeId,
        name: path.basename(filePath),
        type: 'file',
        source: filePath,
        dependencies: [],
        dependents: [],
        size: stats.size,
        lastModified: stats.mtime.getTime()
      };

      graph.nodes.set(nodeId, node);

      // Process imports
      for (const importPath of imports) {
        const resolvedPath = this.resolveImport(importPath, filePath, basePath);
        if (resolvedPath) {
          const depId = path.relative(basePath, resolvedPath);
          node.dependencies.push(depId);

          // Add edge
          if (!graph.edges.has(nodeId)) {
            graph.edges.set(nodeId, []);
          }
          graph.edges.get(nodeId)!.push({
            from: nodeId,
            to: depId,
            type: 'imports'
          });

          // Update dependent's dependents list
          const depNode = graph.nodes.get(depId);
          if (depNode && !depNode.dependents.includes(nodeId)) {
            depNode.dependents.push(nodeId);
          }
        }
      }
    } catch (error) {
      this.emit('file-processing-error', filePath, error);
    }
  }

  /**
   * Find source files matching patterns
   */
  private async findSourceFiles(rootPath: string): Promise<string[]> {
    const files: string[] = [];
    
    const walk = async (dir: string): Promise<void> => {
      const items = await fs.promises.readdir(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const relativePath = path.relative(rootPath, fullPath);
        
        // Check exclude patterns
        if (this.config.excludePatterns.some(pattern => 
          this.matchPattern(relativePath, pattern))) {
          continue;
        }
        
        const stat = await fs.promises.stat(fullPath);
        
        if (stat.isDirectory()) {
          await walk(fullPath);
        } else if (stat.isFile()) {
          // Check include patterns
          if (this.config.includePatterns.some(pattern => 
            this.matchPattern(relativePath, pattern))) {
            files.push(fullPath);
          }
        }
      }
    };

    await walk(rootPath);
    return files;
  }

  /**
   * Setup default parsers for common file types
   */
  private setupDefaultParsers(): void {
    // JavaScript/TypeScript parser
    this.registerParser('.js', new JavaScriptParser());
    this.registerParser('.ts', new JavaScriptParser());
    this.registerParser('.jsx', new JavaScriptParser());
    this.registerParser('.tsx', new JavaScriptParser());
  }

  /**
   * Setup default import resolvers
   */
  private setupDefaultResolvers(): void {
    this.registerResolver('node', new NodeImportResolver());
    this.registerResolver('typescript', new TypeScriptImportResolver());
  }

  /**
   * Find appropriate parser for file
   */
  private findParser(filePath: string): Parser | undefined {
    const ext = path.extname(filePath);
    return this.parsers.get(ext);
  }

  /**
   * Resolve import path to actual file
   */
  private resolveImport(importPath: string, fromFile: string, basePath: string): string | null {
    for (const resolver of this.resolvers.values()) {
      if (resolver.supports(importPath)) {
        const resolved = resolver.resolve(importPath, fromFile);
        if (resolved) return resolved;
      }
    }
    return null;
  }

  /**
   * Simple pattern matching (supports * wildcard)
   */
  private matchPattern(str: string, pattern: string): boolean {
    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
    return regex.test(str);
  }

  /**
   * Perform complete analysis
   */
  private async performAnalysis(graph: DependencyGraph): Promise<DependencyAnalysis> {
    const cycles = this.findCycles(graph);
    const criticalPath = this.findCriticalPath(graph);
    const vulnerabilities = await this.detectVulnerabilities(graph);
    const optimizations = this.suggestOptimizations(graph, cycles);

    return {
      graph,
      cycles,
      criticalPath,
      vulnerabilities,
      optimizations,
      metrics: this.initializeMetrics()
    };
  }

  /**
   * Analyze a cycle and determine its severity
   */
  private analyzeCycle(cycle: string[], graph: DependencyGraph): CyclicDependency {
    const severity = this.determineCycleSeverity(cycle, graph);
    const suggestions = this.generateCycleSuggestions(cycle, graph);
    
    return {
      cycle,
      length: cycle.length,
      severity,
      description: `Circular dependency: ${cycle.join(' -> ')}`,
      suggestions
    };
  }

  /**
   * Determine cycle severity
   */
  private determineCycleSeverity(cycle: string[], graph: DependencyGraph): CyclicDependency['severity'] {
    // Longer cycles are generally more problematic
    if (cycle.length > 5) return 'critical';
    if (cycle.length > 3) return 'high';
    
    // Check if any nodes in cycle are critical
    const hasCriticalNode = cycle.some(nodeId => {
      const node = graph.nodes.get(nodeId);
      return node?.critical;
    });
    
    if (hasCriticalNode) return 'high';
    return 'medium';
  }

  /**
   * Generate suggestions for breaking cycles
   */
  private generateCycleSuggestions(cycle: string[], graph: DependencyGraph): string[] {
    const suggestions: string[] = [];
    
    // Suggest removing the weakest link
    const weakestLink = this.findWeakestLink(cycle, graph);
    if (weakestLink) {
      suggestions.push(`Consider removing dependency from ${weakestLink.from} to ${weakestLink.to}`);
    }
    
    // Suggest dependency injection
    suggestions.push('Consider using dependency injection to break the cycle');
    
    // Suggest interface extraction
    suggestions.push('Extract common interface to break direct dependencies');
    
    return suggestions;
  }

  /**
   * Find the weakest link in a cycle
   */
  private findWeakestLink(cycle: string[], graph: DependencyGraph): { from: string; to: string } | null {
    // Simple heuristic: find the edge with lowest weight or newest modification
    for (let i = 0; i < cycle.length - 1; i++) {
      const from = cycle[i];
      const to = cycle[i + 1];
      
      const edges = graph.edges.get(from);
      const edge = edges?.find(e => e.to === to);
      
      if (edge?.optional) {
        return { from, to };
      }
    }
    
    return null;
  }

  /**
   * Calculate node depths in the graph
   */
  private calculateNodeDepths(graph: DependencyGraph): Map<string, number> {
    const depths = new Map<string, number>();
    const visited = new Set<string>();
    
    const dfs = (nodeId: string): number => {
      if (depths.has(nodeId)) return depths.get(nodeId)!;
      if (visited.has(nodeId)) return 0; // Cycle detected
      
      visited.add(nodeId);
      
      const node = graph.nodes.get(nodeId);
      if (!node) return 0;
      
      let maxDepth = 0;
      node.dependencies.forEach(depId => {
        const depDepth = dfs(depId);
        maxDepth = Math.max(maxDepth, depDepth + 1);
      });
      
      depths.set(nodeId, maxDepth);
      node.depth = maxDepth;
      
      visited.delete(nodeId);
      return maxDepth;
    };
    
    graph.nodes.forEach((_, nodeId) => {
      if (!depths.has(nodeId)) {
        dfs(nodeId);
      }
    });
    
    return depths;
  }

  /**
   * Mark nodes that are part of cycles
   */
  private markCyclicNodes(graph: DependencyGraph): void {
    const cycles = this.findCycles(graph);
    const cyclicNodes = new Set<string>();
    
    cycles.forEach(cycle => {
      cycle.cycle.forEach(nodeId => {
        cyclicNodes.add(nodeId);
      });
    });
    
    cyclicNodes.forEach(nodeId => {
      const node = graph.nodes.get(nodeId);
      if (node) {
        node.cyclic = true;
      }
    });
  }

  /**
   * Check package vulnerabilities (simplified)
   */
  private async checkPackageVulnerabilities(node: DependencyNode): Promise<Vulnerability[]> {
    const vulnerabilities: Vulnerability[] = [];
    
    // This would integrate with actual vulnerability databases
    // For demo purposes, flagging some common vulnerable patterns
    const vulnerablePatterns = ['eval', 'lodash', 'moment'];
    
    if (vulnerablePatterns.some(pattern => node.name.includes(pattern))) {
      vulnerabilities.push({
        nodeId: node.id,
        type: 'security',
        severity: 'medium',
        description: `Package ${node.name} may have security vulnerabilities`,
        impact: 'Potential security risk',
        recommendation: 'Update to latest version or find alternative'
      });
    }
    
    return vulnerabilities;
  }

  /**
   * Check performance issues
   */
  private checkPerformanceIssues(node: DependencyNode, graph: DependencyGraph): Vulnerability[] {
    const issues: Vulnerability[] = [];
    
    // Check for large files
    if (node.size && node.size > 1024 * 1024) { // 1MB
      issues.push({
        nodeId: node.id,
        type: 'performance',
        severity: 'medium',
        description: `Large file size: ${(node.size / 1024 / 1024).toFixed(2)}MB`,
        impact: 'Increased load time and memory usage',
        recommendation: 'Consider code splitting or optimization'
      });
    }
    
    // Check for excessive dependencies
    if (node.dependencies.length > 20) {
      issues.push({
        nodeId: node.id,
        type: 'performance',
        severity: 'low',
        description: `High number of dependencies: ${node.dependencies.length}`,
        impact: 'Complex dependency resolution',
        recommendation: 'Consider refactoring to reduce dependencies'
      });
    }
    
    return issues;
  }

  /**
   * Check maintenance issues
   */
  private checkMaintenanceIssues(node: DependencyNode): Vulnerability[] {
    const issues: Vulnerability[] = [];
    
    // Check for old files (older than 1 year)
    if (node.lastModified && Date.now() - node.lastModified > 365 * 24 * 60 * 60 * 1000) {
      issues.push({
        nodeId: node.id,
        type: 'maintenance',
        severity: 'low',
        description: 'File not modified in over a year',
        impact: 'May contain outdated code or patterns',
        recommendation: 'Review and update if necessary'
      });
    }
    
    return issues;
  }

  /**
   * Find similar packages that could be consolidated
   */
  private findSimilarPackages(graph: DependencyGraph): DependencyNode[][] {
    const packages = Array.from(graph.nodes.values())
      .filter(node => node.type === 'package');
    
    const groups: DependencyNode[][] = [];
    const processed = new Set<string>();
    
    packages.forEach(pkg => {
      if (processed.has(pkg.id)) return;
      
      const similar = packages.filter(other => 
        !processed.has(other.id) && 
        this.arePackagesSimilar(pkg, other)
      );
      
      if (similar.length > 1) {
        groups.push(similar);
        similar.forEach(p => processed.add(p.id));
      }
    });
    
    return groups;
  }

  /**
   * Check if two packages are similar
   */
  private arePackagesSimilar(pkg1: DependencyNode, pkg2: DependencyNode): boolean {
    // Simple similarity check based on name
    const name1 = pkg1.name.toLowerCase();
    const name2 = pkg2.name.toLowerCase();
    
    // Check for common prefixes/suffixes
    const commonPrefixes = ['react-', 'vue-', 'babel-', 'webpack-', 'eslint-'];
    const commonSuffixes = ['-plugin', '-loader', '-cli', '-core'];
    
    for (const prefix of commonPrefixes) {
      if (name1.startsWith(prefix) && name2.startsWith(prefix)) {
        return true;
      }
    }
    
    for (const suffix of commonSuffixes) {
      if (name1.endsWith(suffix) && name2.endsWith(suffix)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Find heavy dependencies
   */
  private findHeavyDependencies(graph: DependencyGraph): DependencyNode[] {
    return Array.from(graph.nodes.values())
      .filter(node => {
        // Consider size, dependency count, and depth
        const isLarge = (node.size || 0) > 500 * 1024; // 500KB
        const hasManyDeps = node.dependencies.length > 10;
        const isDeep = (node.depth || 0) > 5;
        
        return isLarge || hasManyDeps || isDeep;
      })
      .sort((a, b) => (b.size || 0) - (a.size || 0));
  }

  /**
   * Merge two graphs
   */
  private mergeGraphs(target: DependencyGraph, source: DependencyGraph): void {
    // Merge nodes
    source.nodes.forEach((node, nodeId) => {
      target.nodes.set(nodeId, node);
    });
    
    // Merge edges
    source.edges.forEach((edges, nodeId) => {
      if (target.edges.has(nodeId)) {
        target.edges.get(nodeId)!.push(...edges);
      } else {
        target.edges.set(nodeId, edges);
      }
    });
  }

  /**
   * Export to JSON format
   */
  private exportToJson(graph: DependencyGraph): string {
    const exportData = {
      metadata: graph.metadata,
      nodes: Array.from(graph.nodes.values()),
      edges: Array.from(graph.edges.entries()).map(([nodeId, edges]) => ({
        nodeId,
        edges
      }))
    };
    
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Export to DOT format (Graphviz)
   */
  private exportToDot(graph: DependencyGraph): string {
    let dot = 'digraph dependencies {\n';
    dot += '  rankdir=TB;\n';
    dot += '  node [shape=box];\n\n';
    
    // Add nodes
    graph.nodes.forEach((node, nodeId) => {
      const label = node.name || nodeId;
      const style = node.cyclic ? 'filled,color=red' : 'filled,color=lightblue';
      dot += `  "${nodeId}" [label="${label}", style="${style}"];\n`;
    });
    
    dot += '\n';
    
    // Add edges
    graph.edges.forEach((edges, fromId) => {
      edges.forEach(edge => {
        const style = edge.optional ? 'dashed' : 'solid';
        dot += `  "${fromId}" -> "${edge.to}" [style="${style}"];\n`;
      });
    });
    
    dot += '}';
    return dot;
  }

  /**
   * Export to Mermaid format
   */
  private exportToMermaid(graph: DependencyGraph): string {
    let mermaid = 'graph TD\n';
    
    // Add edges (nodes are implicit)
    graph.edges.forEach((edges, fromId) => {
      edges.forEach(edge => {
        const fromLabel = graph.nodes.get(fromId)?.name || fromId;
        const toLabel = graph.nodes.get(edge.to)?.name || edge.to;
        const style = edge.optional ? '-.->|optional|' : '-->';
        mermaid += `  ${fromId}["${fromLabel}"] ${style} ${edge.to}["${toLabel}"]\n`;
      });
    });
    
    return mermaid;
  }

  /**
   * Export to CSV format
   */
  private exportToCsv(graph: DependencyGraph): string {
    const lines = ['from,to,type,optional,weight'];
    
    graph.edges.forEach((edges, fromId) => {
      edges.forEach(edge => {
        lines.push([
          fromId,
          edge.to,
          edge.type,
          edge.optional || false,
          edge.weight || 1
        ].join(','));
      });
    });
    
    return lines.join('\n');
  }

  /**
   * Initialize empty stats
   */
  private initializeStats(): GraphStats {
    return {
      totalNodes: 0,
      totalEdges: 0,
      maxDepth: 0,
      averageDepth: 0,
      cyclicDependencies: 0,
      criticalNodes: 0,
      orphanNodes: 0,
      leafNodes: 0,
      density: 0,
      complexity: 0
    };
  }

  /**
   * Initialize empty metrics
   */
  private initializeMetrics(): AnalysisMetrics {
    return {
      analysisTime: 0,
      memoryUsage: 0,
      filesAnalyzed: 0,
      dependenciesFound: 0,
      issuesIdentified: 0,
      optimizationsProposed: 0
    };
  }
}

/**
 * JavaScript/TypeScript parser
 */
export class JavaScriptParser implements Parser {
  supports(filePath: string): boolean {
    const ext = path.extname(filePath);
    return ['.js', '.ts', '.jsx', '.tsx'].includes(ext);
  }

  parse(content: string): { imports: string[]; exports: string[] } {
    const imports: string[] = [];
    const exports: string[] = [];

    // Simple regex-based parsing (in production, use proper AST parser)
    const importRegex = /(?:import|require)\s*\(?['"]([^'"]+)['"]\)?/g;
    const exportRegex = /export\s+(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)/g;

    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    while ((match = exportRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }

    return { imports, exports };
  }
}

/**
 * Node.js import resolver
 */
export class NodeImportResolver implements ImportResolver {
  supports(importPath: string): boolean {
    return !importPath.startsWith('.') && !importPath.startsWith('/');
  }

  resolve(importPath: string, fromFile: string): string | null {
    // Simplified Node.js resolution
    try {
      return require.resolve(importPath, { paths: [path.dirname(fromFile)] });
    } catch {
      return null;
    }
  }
}

/**
 * TypeScript import resolver
 */
export class TypeScriptImportResolver implements ImportResolver {
  supports(importPath: string): boolean {
    return importPath.startsWith('.') || importPath.startsWith('/');
  }

  resolve(importPath: string, fromFile: string): string | null {
    const dir = path.dirname(fromFile);
    let resolvedPath = path.resolve(dir, importPath);

    // Try common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    
    for (const ext of extensions) {
      const withExt = resolvedPath + ext;
      if (fs.existsSync(withExt)) {
        return withExt;
      }
    }

    // Try index files
    for (const ext of extensions) {
      const indexFile = path.join(resolvedPath, `index${ext}`);
      if (fs.existsSync(indexFile)) {
        return indexFile;
      }
    }

    return null;
  }
}

// Export default
export default DependencyAnalyzer;