/**
 * @jest-environment node
 */

import * as fs from 'fs';
import * as path from 'path';

import DependencyAnalyzer, {
  DependencyGraph,
  CyclicDependency,
  DependencyAnalysis,
  Vulnerability,
  Optimization,
  AnalysisConfig,
  Parser,
  ImportResolver,
  JavaScriptParser,
  NodeImportResolver,
  TypeScriptImportResolver
} from '../index';

// Type-only import for unused types
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { DependencyNode } from '../index';

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn()
  },
  existsSync: jest.fn()
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('DependencyAnalyzer', () => {
  let dependencyAnalyzer: DependencyAnalyzer;

  beforeEach(() => {
    dependencyAnalyzer = new DependencyAnalyzer();
    jest.clearAllMocks();
  });

  describe('DependencyAnalyzer instantiation', () => {
    it('should create a new instance with default config', () => {
      expect(dependencyAnalyzer).toBeInstanceOf(DependencyAnalyzer);
    });

    it('should create instance with custom config', () => {
      const config: Partial<AnalysisConfig> = {
        includeDevDependencies: true,
        maxDepth: 5,
        enableVulnerabilityScanning: false
      };

      const analyzer = new DependencyAnalyzer(config);
      expect(analyzer).toBeInstanceOf(DependencyAnalyzer);
    });
  });

  describe('analyzePackage', () => {
    const mockPackageJson = {
      name: 'test-package',
      version: '1.0.0',
      dependencies: {
        'lodash': '^4.17.21',
        'express': '^4.18.0'
      },
      devDependencies: {
        'jest': '^29.0.0',
        'typescript': '^4.8.0'
      }
    };

    beforeEach(() => {
      mockFs.promises.readFile.mockResolvedValue(JSON.stringify(mockPackageJson));
      mockFs.promises.readdir.mockResolvedValue([]);
      mockFs.promises.stat.mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true
      } as any);
    });

    it('should analyze package.json dependencies', async () => {
      const analysis = await dependencyAnalyzer.analyzePackage('/path/to/package.json');

      expect(analysis.graph.nodes.size).toBeGreaterThanOrEqual(2);
      expect(analysis.graph.nodes.has('lodash@^4.17.21')).toBe(true);
      expect(analysis.graph.nodes.has('express@^4.18.0')).toBe(true);
      expect(analysis.metrics.dependenciesFound).toBeGreaterThanOrEqual(2);
    });

    it('should emit analysis-completed event', async () => {
      const eventPromise = new Promise((resolve) => {
        dependencyAnalyzer.on('analysis-completed', resolve);
      });

      await dependencyAnalyzer.analyzePackage('/path/to/package.json');
      const result = await eventPromise;

      expect(result).toHaveProperty('graph');
      expect(result).toHaveProperty('cycles');
    });

    it('should handle file read errors', async () => {
      mockFs.promises.readFile.mockRejectedValue(new Error('File not found'));

      const eventPromise = new Promise((resolve) => {
        dependencyAnalyzer.on('analysis-failed', resolve);
      });

      await expect(
        dependencyAnalyzer.analyzePackage('/invalid/package.json')
      ).rejects.toThrow();

      const error = await eventPromise;
      expect(error).toBeInstanceOf(Error);
    });

    it('should include dev dependencies when configured', async () => {
      const config: Partial<AnalysisConfig> = {
        includeDevDependencies: true
      };

      const analyzer = new DependencyAnalyzer(config);
      const analysis = await analyzer.analyzePackage('/path/to/package.json');

      expect(analysis.graph.nodes.size).toBeGreaterThanOrEqual(4);
      expect(analysis.graph.nodes.has('jest@^29.0.0')).toBe(true);
    });
  });

  describe('analyzeSource', () => {
    const mockJsFile = `
      import React from 'react';
      import { Component } from 'react';
      import axios from 'axios';
      const lodash = require('lodash');
      
      export default function MyComponent() {
        return <div>Hello</div>;
      }
    `;

    beforeEach(() => {
      mockFs.promises.readdir.mockImplementation((dir: any) => {
        if (dir === '/src') {
          return Promise.resolve(['component.js', 'utils.js'] as any);
        }
        return Promise.resolve([]);
      });

      mockFs.promises.stat.mockImplementation((filePath: any) => {
        if (filePath.endsWith('.js')) {
          return Promise.resolve({
            isDirectory: () => false,
            isFile: () => true,
            size: 1024,
            mtime: new Date()
          } as any);
        }
        return Promise.resolve({
          isDirectory: () => true,
          isFile: () => false
        } as any);
      });

      mockFs.promises.readFile.mockResolvedValue(mockJsFile);
    });

    it('should analyze source code dependencies', async () => {
      const analysis = await dependencyAnalyzer.analyzeSource('/src');

      expect(analysis.graph.nodes.size).toBeGreaterThan(0);
      expect(analysis.metrics.filesAnalyzed).toBe(2);
    });

    it('should emit file-processing-error for problematic files', async () => {
      mockFs.promises.readFile.mockRejectedValueOnce(new Error('Permission denied'));

      const errorPromise = new Promise((resolve) => {
        dependencyAnalyzer.on('file-processing-error', resolve);
      });

      await dependencyAnalyzer.analyzeSource('/src');
      const error = await errorPromise;

      expect(error).toBeDefined();
    });
  });

  describe('findCycles', () => {
    it('should detect circular dependencies', () => {
      const graph: DependencyGraph = {
        nodes: new Map([
          ['A', { id: 'A', name: 'A', type: 'module', dependencies: ['B'], dependents: ['C'] }],
          ['B', { id: 'B', name: 'B', type: 'module', dependencies: ['C'], dependents: ['A'] }],
          ['C', { id: 'C', name: 'C', type: 'module', dependencies: ['A'], dependents: ['B'] }]
        ]),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
            totalNodes: 3,
            totalEdges: 3,
            maxDepth: 1,
            averageDepth: 1,
            cyclicDependencies: 3,
            criticalNodes: 0,
            orphanNodes: 0,
            leafNodes: 0,
            density: 1,
            complexity: 1
          }
        }
      };

      const cycles = dependencyAnalyzer.findCycles(graph);

      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0].cycle).toContain('A');
      expect(cycles[0].cycle).toContain('B');
      expect(cycles[0].cycle).toContain('C');
    });

    it('should return empty array for acyclic graph', () => {
      const graph: DependencyGraph = {
        nodes: new Map([
          ['A', { id: 'A', name: 'A', type: 'module', dependencies: ['B'], dependents: [] }],
          ['B', { id: 'B', name: 'B', type: 'module', dependencies: ['C'], dependents: ['A'] }],
          ['C', { id: 'C', name: 'C', type: 'module', dependencies: [], dependents: ['B'] }]
        ]),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
            totalNodes: 3,
            totalEdges: 2,
            maxDepth: 2,
            averageDepth: 1,
            cyclicDependencies: 0,
            criticalNodes: 0,
            orphanNodes: 0,
            leafNodes: 1,
            density: 0.33,
            complexity: 1
          }
        }
      };

      const cycles = dependencyAnalyzer.findCycles(graph);
      expect(cycles).toHaveLength(0);
    });

    it('should classify cycle severity correctly', () => {
      const longCycleGraph: DependencyGraph = {
        nodes: new Map([
          ['A', { id: 'A', name: 'A', type: 'module', dependencies: ['B'], dependents: ['F'] }],
          ['B', { id: 'B', name: 'B', type: 'module', dependencies: ['C'], dependents: ['A'] }],
          ['C', { id: 'C', name: 'C', type: 'module', dependencies: ['D'], dependents: ['B'] }],
          ['D', { id: 'D', name: 'D', type: 'module', dependencies: ['E'], dependents: ['C'] }],
          ['E', { id: 'E', name: 'E', type: 'module', dependencies: ['F'], dependents: ['D'] }],
          ['F', { id: 'F', name: 'F', type: 'module', dependencies: ['A'], dependents: ['E'] }]
        ]),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
            totalNodes: 6,
            totalEdges: 6,
            maxDepth: 1,
            averageDepth: 1,
            cyclicDependencies: 6,
            criticalNodes: 0,
            orphanNodes: 0,
            leafNodes: 0,
            density: 1,
            complexity: 1
          }
        }
      };

      const cycles = dependencyAnalyzer.findCycles(longCycleGraph);

      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0].severity).toBe('critical'); // Long cycle should be critical
    });
  });

  describe('findCriticalPath', () => {
    it('should find the longest dependency chain', () => {
      const graph: DependencyGraph = {
        nodes: new Map([
          ['A', { id: 'A', name: 'A', type: 'module', dependencies: [], dependents: ['B'] }],
          ['B', { id: 'B', name: 'B', type: 'module', dependencies: ['A'], dependents: ['C'] }],
          ['C', { id: 'C', name: 'C', type: 'module', dependencies: ['B'], dependents: ['D'] }],
          ['D', { id: 'D', name: 'D', type: 'module', dependencies: ['C'], dependents: [] }],
          ['E', { id: 'E', name: 'E', type: 'module', dependencies: [], dependents: [] }]
        ]),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
            totalNodes: 5,
            totalEdges: 3,
            maxDepth: 3,
            averageDepth: 1.5,
            cyclicDependencies: 0,
            criticalNodes: 0,
            orphanNodes: 1,
            leafNodes: 2,
            density: 0.3,
            complexity: 1
          }
        }
      };

      const criticalPath = dependencyAnalyzer.findCriticalPath(graph);

      expect(criticalPath).toEqual(['A', 'B', 'C', 'D']);
    });

    it('should handle empty graph', () => {
      const emptyGraph: DependencyGraph = {
        nodes: new Map(),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
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
          }
        }
      };

      const criticalPath = dependencyAnalyzer.findCriticalPath(emptyGraph);
      expect(criticalPath).toEqual([]);
    });
  });

  describe('detectVulnerabilities', () => {
    it('should detect known vulnerable packages', async () => {
      const graph: DependencyGraph = {
        nodes: new Map([
          ['lodash@1.0.0', {
            id: 'lodash@1.0.0',
            name: 'lodash',
            version: '1.0.0',
            type: 'package',
            dependencies: [],
            dependents: []
          }],
          ['moment@1.0.0', {
            id: 'moment@1.0.0',
            name: 'moment',
            version: '1.0.0',
            type: 'package',
            dependencies: [],
            dependents: []
          }]
        ]),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
            totalNodes: 2,
            totalEdges: 0,
            maxDepth: 0,
            averageDepth: 0,
            cyclicDependencies: 0,
            criticalNodes: 0,
            orphanNodes: 2,
            leafNodes: 0,
            density: 0,
            complexity: 0
          }
        }
      };

      const vulnerabilities = await dependencyAnalyzer.detectVulnerabilities(graph);

      expect(vulnerabilities.length).toBeGreaterThan(0);
      expect(vulnerabilities.some(v => v.type === 'security')).toBe(true);
    });

    it('should detect performance issues', async () => {
      const graph: DependencyGraph = {
        nodes: new Map([
          ['large-file', {
            id: 'large-file',
            name: 'large-file.js',
            type: 'file',
            size: 2 * 1024 * 1024, // 2MB
            dependencies: [],
            dependents: []
          }],
          ['complex-module', {
            id: 'complex-module',
            name: 'complex-module',
            type: 'module',
            dependencies: Array.from({ length: 25 }, (_, i) => `dep-${i}`),
            dependents: []
          }]
        ]),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
            totalNodes: 2,
            totalEdges: 0,
            maxDepth: 0,
            averageDepth: 0,
            cyclicDependencies: 0,
            criticalNodes: 0,
            orphanNodes: 2,
            leafNodes: 0,
            density: 0,
            complexity: 0
          }
        }
      };

      const vulnerabilities = await dependencyAnalyzer.detectVulnerabilities(graph);

      const perfIssues = vulnerabilities.filter(v => v.type === 'performance');
      expect(perfIssues.length).toBeGreaterThan(0);
    });

    it('should detect maintenance issues', async () => {
      const oldDate = Date.now() - (2 * 365 * 24 * 60 * 60 * 1000); // 2 years ago
      
      const graph: DependencyGraph = {
        nodes: new Map([
          ['old-file', {
            id: 'old-file',
            name: 'old-file.js',
            type: 'file',
            lastModified: oldDate,
            dependencies: [],
            dependents: []
          }]
        ]),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
            totalNodes: 1,
            totalEdges: 0,
            maxDepth: 0,
            averageDepth: 0,
            cyclicDependencies: 0,
            criticalNodes: 0,
            orphanNodes: 1,
            leafNodes: 0,
            density: 0,
            complexity: 0
          }
        }
      };

      const vulnerabilities = await dependencyAnalyzer.detectVulnerabilities(graph);

      const maintIssues = vulnerabilities.filter(v => v.type === 'maintenance');
      expect(maintIssues.length).toBeGreaterThan(0);
    });

    it('should return empty array when vulnerability scanning disabled', async () => {
      const config: Partial<AnalysisConfig> = {
        enableVulnerabilityScanning: false
      };

      const analyzer = new DependencyAnalyzer(config);
      const graph: DependencyGraph = {
        nodes: new Map([
          ['vulnerable-package', {
            id: 'vulnerable-package',
            name: 'lodash',
            type: 'package',
            dependencies: [],
            dependents: []
          }]
        ]),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
            totalNodes: 1,
            totalEdges: 0,
            maxDepth: 0,
            averageDepth: 0,
            cyclicDependencies: 0,
            criticalNodes: 0,
            orphanNodes: 1,
            leafNodes: 0,
            density: 0,
            complexity: 0
          }
        }
      };

      const vulnerabilities = await analyzer.detectVulnerabilities(graph);
      expect(vulnerabilities).toHaveLength(0);
    });
  });

  describe('suggestOptimizations', () => {
    it('should suggest cycle breaking for critical cycles', () => {
      const cycles: CyclicDependency[] = [
        {
          cycle: ['A', 'B', 'C', 'A'],
          length: 3,
          severity: 'critical',
          description: 'Critical cycle',
          suggestions: ['Remove dependency A -> B']
        }
      ];

      const graph: DependencyGraph = {
        nodes: new Map(),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
            totalNodes: 0,
            totalEdges: 0,
            maxDepth: 0,
            averageDepth: 0,
            cyclicDependencies: 3,
            criticalNodes: 0,
            orphanNodes: 0,
            leafNodes: 0,
            density: 0,
            complexity: 0
          }
        }
      };

      const optimizations = dependencyAnalyzer.suggestOptimizations(graph, cycles);

      const cycleOptimizations = optimizations.filter(o => o.type === 'remove');
      expect(cycleOptimizations.length).toBeGreaterThan(0);
    });

    it('should suggest removing unused dependencies', () => {
      const graph: DependencyGraph = {
        nodes: new Map([
          ['unused-package', {
            id: 'unused-package',
            name: 'unused-package',
            type: 'package',
            dependencies: [],
            dependents: [] // No dependents = unused
          }]
        ]),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
            totalNodes: 1,
            totalEdges: 0,
            maxDepth: 0,
            averageDepth: 0,
            cyclicDependencies: 0,
            criticalNodes: 0,
            orphanNodes: 1,
            leafNodes: 0,
            density: 0,
            complexity: 0
          }
        }
      };

      const optimizations = dependencyAnalyzer.suggestOptimizations(graph, []);

      const removalOptimizations = optimizations.filter(o => 
        o.type === 'remove' && o.description.includes('unused')
      );
      expect(removalOptimizations.length).toBeGreaterThan(0);
    });

    it('should suggest lazy loading for heavy dependencies', () => {
      const graph: DependencyGraph = {
        nodes: new Map([
          ['heavy-dep', {
            id: 'heavy-dep',
            name: 'heavy-dependency',
            type: 'package',
            size: 10 * 1024 * 1024, // 10MB
            dependencies: [],
            dependents: ['main']
          }]
        ]),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
            totalNodes: 1,
            totalEdges: 0,
            maxDepth: 0,
            averageDepth: 0,
            cyclicDependencies: 0,
            criticalNodes: 0,
            orphanNodes: 0,
            leafNodes: 1,
            density: 0,
            complexity: 0
          }
        }
      };

      const optimizations = dependencyAnalyzer.suggestOptimizations(graph, []);

      const lazyLoadOptimizations = optimizations.filter(o => o.type === 'lazy-load');
      expect(lazyLoadOptimizations.length).toBeGreaterThan(0);
    });

    it('should return empty array when optimization suggestions disabled', () => {
      const config: Partial<AnalysisConfig> = {
        enableOptimizationSuggestions: false
      };

      const analyzer = new DependencyAnalyzer(config);
      const graph: DependencyGraph = {
        nodes: new Map([
          ['test-node', {
            id: 'test-node',
            name: 'test',
            type: 'package',
            dependencies: [],
            dependents: []
          }]
        ]),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
            totalNodes: 1,
            totalEdges: 0,
            maxDepth: 0,
            averageDepth: 0,
            cyclicDependencies: 0,
            criticalNodes: 0,
            orphanNodes: 1,
            leafNodes: 0,
            density: 0,
            complexity: 0
          }
        }
      };

      const optimizations = analyzer.suggestOptimizations(graph, []);
      expect(optimizations).toHaveLength(0);
    });
  });

  describe('calculateStats', () => {
    it('should calculate graph statistics correctly', () => {
      const graph: DependencyGraph = {
        nodes: new Map([
          ['A', { id: 'A', name: 'A', type: 'module', dependencies: ['B'], dependents: [], depth: 1 }],
          ['B', { id: 'B', name: 'B', type: 'module', dependencies: [], dependents: ['A'], depth: 0 }],
          ['C', { id: 'C', name: 'C', type: 'module', dependencies: [], dependents: [], cyclic: true }]
        ]),
        edges: new Map([
          ['A', [{ from: 'A', to: 'B', type: 'imports' }]]
        ]),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
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
          }
        }
      };

      const stats = dependencyAnalyzer.calculateStats(graph);

      expect(stats.totalNodes).toBe(3);
      expect(stats.totalEdges).toBe(1);
      expect(stats.maxDepth).toBe(1);
      expect(stats.averageDepth).toBeCloseTo(0.33, 1);
      expect(stats.cyclicDependencies).toBe(1);
      expect(stats.orphanNodes).toBe(1); // Node C has no connections
      expect(stats.leafNodes).toBe(1); // Node B has no dependencies
    });

    it('should handle empty graph', () => {
      const emptyGraph: DependencyGraph = {
        nodes: new Map(),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
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
          }
        }
      };

      const stats = dependencyAnalyzer.calculateStats(emptyGraph);

      expect(stats.totalNodes).toBe(0);
      expect(stats.totalEdges).toBe(0);
      expect(stats.density).toBe(0);
      expect(stats.complexity).toBe(0);
    });
  });

  describe('exportGraph', () => {
    const sampleGraph: DependencyGraph = {
      nodes: new Map([
        ['A', { id: 'A', name: 'Module A', type: 'module', dependencies: ['B'], dependents: [] }],
        ['B', { id: 'B', name: 'Module B', type: 'module', dependencies: [], dependents: ['A'] }]
      ]),
      edges: new Map([
        ['A', [{ from: 'A', to: 'B', type: 'imports' }]]
      ]),
      metadata: {
        createdAt: Date.now(),
        lastAnalyzed: Date.now(),
        source: 'test',
        stats: {
          totalNodes: 2,
          totalEdges: 1,
          maxDepth: 1,
          averageDepth: 0.5,
          cyclicDependencies: 0,
          criticalNodes: 0,
          orphanNodes: 0,
          leafNodes: 1,
          density: 0.5,
          complexity: 1
        }
      }
    };

    it('should export to JSON format', () => {
      const json = dependencyAnalyzer.exportGraph(sampleGraph, 'json');
      const parsed = JSON.parse(json);

      expect(parsed.metadata).toBeDefined();
      expect(parsed.nodes).toHaveLength(2);
      expect(parsed.edges).toHaveLength(1);
    });

    it('should export to DOT format', () => {
      const dot = dependencyAnalyzer.exportGraph(sampleGraph, 'dot');

      expect(dot).toContain('digraph dependencies');
      expect(dot).toContain('"A"');
      expect(dot).toContain('"B"');
      expect(dot).toContain('->');
    });

    it('should export to Mermaid format', () => {
      const mermaid = dependencyAnalyzer.exportGraph(sampleGraph, 'mermaid');

      expect(mermaid).toContain('graph TD');
      expect(mermaid).toContain('A["Module A"]');
      expect(mermaid).toContain('B["Module B"]');
      expect(mermaid).toContain('-->');
    });

    it('should export to CSV format', () => {
      const csv = dependencyAnalyzer.exportGraph(sampleGraph, 'csv');

      expect(csv).toContain('from,to,type,optional,weight');
      expect(csv).toContain('A,B,imports,false,1');
    });

    it('should throw error for unsupported format', () => {
      expect(() => {
        dependencyAnalyzer.exportGraph(sampleGraph, 'unsupported' as any);
      }).toThrow('Unsupported export format: unsupported');
    });
  });

  describe('custom parsers and resolvers', () => {
    it('should register custom parser', () => {
      const customParser: Parser = {
        supports: (filePath: string) => filePath.endsWith('.custom'),
        parse: (content: string) => ({
          imports: ['custom-import'],
          exports: ['custom-export']
        })
      };

      const eventPromise = new Promise((resolve) => {
        dependencyAnalyzer.on('parser-registered', resolve);
      });

      dependencyAnalyzer.registerParser('.custom', customParser);

      return eventPromise.then((extension) => {
        expect(extension).toBe('.custom');
      });
    });

    it('should register custom resolver', () => {
      const customResolver: ImportResolver = {
        supports: (importPath: string) => importPath.startsWith('custom:'),
        resolve: (importPath: string) => importPath.replace('custom:', '')
      };

      const eventPromise = new Promise((resolve) => {
        dependencyAnalyzer.on('resolver-registered', resolve);
      });

      dependencyAnalyzer.registerResolver('custom', customResolver);

      return eventPromise.then((name) => {
        expect(name).toBe('custom');
      });
    });
  });

  describe('built-in parsers', () => {
    describe('JavaScriptParser', () => {
      const parser = new JavaScriptParser();

      it('should support JavaScript file types', () => {
        expect(parser.supports('file.js')).toBe(true);
        expect(parser.supports('file.ts')).toBe(true);
        expect(parser.supports('file.jsx')).toBe(true);
        expect(parser.supports('file.tsx')).toBe(true);
        expect(parser.supports('file.py')).toBe(false);
      });

      it('should parse imports and exports', () => {
        const content = `
          import React from 'react';
          import { Component } from 'react-dom';
          const lodash = require('lodash');
          export default function MyComponent() {}
          export const myFunction = () => {};
        `;

        const result = parser.parse(content);

        expect(result.imports).toContain('react');
        expect(result.imports).toContain('react-dom');
        expect(result.imports).toContain('lodash');
        expect(result.exports).toContain('MyComponent');
        expect(result.exports).toContain('myFunction');
      });

      it('should handle empty content', () => {
        const result = parser.parse('');
        expect(result.imports).toHaveLength(0);
        expect(result.exports).toHaveLength(0);
      });
    });
  });

  describe('built-in resolvers', () => {
    describe('NodeImportResolver', () => {
      const resolver = new NodeImportResolver();

      it('should support node modules', () => {
        expect(resolver.supports('lodash')).toBe(true);
        expect(resolver.supports('react')).toBe(true);
        expect(resolver.supports('./local-file')).toBe(false);
        expect(resolver.supports('/absolute/path')).toBe(false);
      });

      it('should resolve node modules', () => {
        const resolved = resolver.resolve('path', '/some/file.js');
        expect(resolved).toBeDefined();
      });
    });

    describe('TypeScriptImportResolver', () => {
      const resolver = new TypeScriptImportResolver();

      beforeEach(() => {
        (fs.existsSync as jest.Mock).mockReturnValue(true);
      });

      it('should support relative and absolute paths', () => {
        expect(resolver.supports('./local-file')).toBe(true);
        expect(resolver.supports('../parent-file')).toBe(true);
        expect(resolver.supports('/absolute/path')).toBe(true);
        expect(resolver.supports('node-module')).toBe(false);
      });

      it('should resolve TypeScript files', () => {
        const resolved = resolver.resolve('./component', '/src/index.ts');
        expect(resolved).toBeDefined();
      });

      it('should try different extensions', () => {
        (fs.existsSync as jest.Mock)
          .mockReturnValueOnce(false) // .ts
          .mockReturnValueOnce(true); // .tsx

        const resolved = resolver.resolve('./component', '/src/index.ts');
        expect(resolved).toBeDefined();
      });

      it('should return null if file not found', () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);

        const resolved = resolver.resolve('./nonexistent', '/src/index.ts');
        expect(resolved).toBeNull();
      });
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle malformed package.json', async () => {
      mockFs.promises.readFile.mockResolvedValue('{ invalid json }');

      await expect(
        dependencyAnalyzer.analyzePackage('/path/to/malformed.json')
      ).rejects.toThrow();
    });

    it('should handle empty dependency graph', () => {
      const emptyGraph: DependencyGraph = {
        nodes: new Map(),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
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
          }
        }
      };

      expect(() => {
        dependencyAnalyzer.findCycles(emptyGraph);
        dependencyAnalyzer.findCriticalPath(emptyGraph);
        dependencyAnalyzer.calculateStats(emptyGraph);
      }).not.toThrow();
    });

    it('should handle files with no parseable content', async () => {
      mockFs.promises.readFile.mockResolvedValue('<!-- HTML comment -->');
      mockFs.promises.readdir.mockResolvedValue(['test.html'] as any);
      mockFs.promises.stat.mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        size: 100,
        mtime: new Date()
      } as any);

      // Should not crash when no parser supports the file
      const analysis = await dependencyAnalyzer.analyzeSource('/src');
      expect(analysis.graph.nodes.size).toBe(0);
    });

    it('should handle circular dependency analysis gracefully', () => {
      const selfReferencingGraph: DependencyGraph = {
        nodes: new Map([
          ['A', { id: 'A', name: 'A', type: 'module', dependencies: ['A'], dependents: ['A'] }]
        ]),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
            totalNodes: 1,
            totalEdges: 1,
            maxDepth: 0,
            averageDepth: 0,
            cyclicDependencies: 1,
            criticalNodes: 0,
            orphanNodes: 0,
            leafNodes: 0,
            density: 1,
            complexity: 1
          }
        }
      };

      const cycles = dependencyAnalyzer.findCycles(selfReferencingGraph);
      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should handle very large dependency graphs', () => {
      const largeGraph: DependencyGraph = {
        nodes: new Map(),
        edges: new Map(),
        metadata: {
          createdAt: Date.now(),
          lastAnalyzed: Date.now(),
          source: 'test',
          stats: {
            totalNodes: 1000,
            totalEdges: 500,
            maxDepth: 10,
            averageDepth: 5,
            cyclicDependencies: 0,
            criticalNodes: 10,
            orphanNodes: 50,
            leafNodes: 100,
            density: 0.5,
            complexity: 50
          }
        }
      };

      // Create 1000 nodes
      for (let i = 0; i < 1000; i++) {
        largeGraph.nodes.set(`node-${i}`, {
          id: `node-${i}`,
          name: `Node ${i}`,
          type: 'module',
          dependencies: i > 0 ? [`node-${i - 1}`] : [],
          dependents: i < 999 ? [`node-${i + 1}`] : []
        });
      }

      const startTime = Date.now();
      const stats = dependencyAnalyzer.calculateStats(largeGraph);
      const endTime = Date.now();

      expect(stats.totalNodes).toBe(1000);
      expect(endTime - startTime).toBeLessThan(1000); // Should be fast
    });
  });

  describe('Performance tests', () => {
    it('should handle many files efficiently', async () => {
      const fileCount = 100;
      const mockFiles = Array.from({ length: fileCount }, (_, i) => `file${i}.js`);

      mockFs.promises.readdir.mockResolvedValue(mockFiles as any);
      mockFs.promises.stat.mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        size: 1024,
        mtime: new Date()
      } as any);
      mockFs.promises.readFile.mockResolvedValue('export default function() {}');

      const startTime = Date.now();
      const analysis = await dependencyAnalyzer.analyzeSource('/large-src');
      const endTime = Date.now();

      expect(analysis.metrics.filesAnalyzed).toBe(fileCount);
      expect(endTime - startTime).toBeLessThan(2000); // Should complete within 2 seconds
    });
  });
});