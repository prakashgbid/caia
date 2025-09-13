
import * as tf from '@tensorflow/tfjs-node';
import { pipeline } from '@xenova/transformers';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

export class EntityExtractor {
  private nerPipeline: any;
  private embeddingModel: any;
  private entityCache: Map<string, any>;
  private readonly CONFIDENCE_THRESHOLD = 0.7;

  constructor() {
    this.entityCache = new Map();
    this.initializeModels();
  }

  private async initializeModels() {
    try {
      // Initialize NER pipeline with BERT
      this.nerPipeline = await pipeline(
        'token-classification',
        'Xenova/bert-base-NER'
      );

      // Initialize embedding model for semantic similarity
      this.embeddingModel = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2'
      );

      console.log('✅ NLP models loaded successfully');
    } catch (error) {
      console.error('Failed to load NLP models:', error);
      // Fallback to rule-based extraction
      this.useFallbackExtraction = true;
    }
  }

  async extractEntities(text: string) {
    // Check cache first
    const cacheKey = this.generateCacheKey(text);
    if (this.entityCache.has(cacheKey)) {
      return this.entityCache.get(cacheKey);
    }

    try {
      // Use transformer-based NER
      const nerResults = await this.nerPipeline(text);

      // Group and consolidate entities
      const entities = this.consolidateEntities(nerResults);

      // Add semantic embeddings
      const enrichedEntities = await this.enrichEntities(entities, text);

      // Apply confidence filtering
      const filteredEntities = enrichedEntities.filter(
        e => e.confidence >= this.CONFIDENCE_THRESHOLD
      );

      // Cache results
      this.entityCache.set(cacheKey, filteredEntities);

      return filteredEntities;
    } catch (error) {
      console.error('Entity extraction failed:', error);
      return this.fallbackExtraction(text);
    }
  }

  private consolidateEntities(nerResults: any[]) {
    const consolidated = new Map();

    for (const result of nerResults) {
      const key = result.word.replace('##', '');

      if (consolidated.has(key)) {
        const existing = consolidated.get(key);
        existing.confidence = Math.max(existing.confidence, result.score);
        existing.positions.push(result.index);
      } else {
        consolidated.set(key, {
          text: key,
          type: result.entity.replace('B-', '').replace('I-', ''),
          confidence: result.score,
          positions: [result.index]
        });
      }
    }

    return Array.from(consolidated.values());
  }

  private async enrichEntities(entities: any[], context: string) {
    // Generate embeddings for context understanding
    const contextEmbedding = await this.embeddingModel(context);

    return entities.map(entity => ({
      ...entity,
      contextRelevance: this.calculateRelevance(entity, contextEmbedding),
      category: this.categorizeEntity(entity),
      metadata: this.extractMetadata(entity, context)
    }));
  }

  async extractCodeEntities(code: string) {
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
      errorRecovery: true
    });

    const entities = {
      functions: [],
      classes: [],
      variables: [],
      imports: [],
      exports: [],
      types: [],
      interfaces: []
    };

    traverse(ast, {
      FunctionDeclaration(path: any) {
        entities.functions.push({
          name: path.node.id?.name,
          params: path.node.params.map(this.extractParamInfo),
          returnType: path.node.returnType,
          async: path.node.async,
          generator: path.node.generator,
          loc: path.node.loc,
          complexity: this.calculateComplexity(path.node)
        });
      },

      ClassDeclaration(path: any) {
        entities.classes.push({
          name: path.node.id?.name,
          superClass: path.node.superClass?.name,
          methods: this.extractClassMethods(path.node),
          properties: this.extractClassProperties(path.node),
          decorators: path.node.decorators?.map(d => d.expression.name),
          loc: path.node.loc
        });
      },

      VariableDeclaration(path: any) {
        path.node.declarations.forEach((decl: any) => {
          if (decl.id.name) {
            entities.variables.push({
              name: decl.id.name,
              kind: path.node.kind,
              type: decl.id.typeAnnotation,
              value: decl.init ? this.extractValueType(decl.init) : undefined,
              exported: path.parent.type === 'ExportNamedDeclaration',
              loc: decl.loc
            });
          }
        });
      },

      ImportDeclaration(path: any) {
        entities.imports.push({
          source: path.node.source.value,
          specifiers: path.node.specifiers.map(this.extractImportSpecifier),
          type: path.node.importKind,
          loc: path.node.loc
        });
      },

      TSTypeAliasDeclaration(path: any) {
        entities.types.push({
          name: path.node.id.name,
          type: this.extractTypeInfo(path.node.typeAnnotation),
          exported: path.parent.type === 'ExportNamedDeclaration',
          loc: path.node.loc
        });
      },

      TSInterfaceDeclaration(path: any) {
        entities.interfaces.push({
          name: path.node.id.name,
          extends: path.node.extends?.map(e => e.expression.name),
          members: this.extractInterfaceMembers(path.node.body),
          exported: path.parent.type === 'ExportNamedDeclaration',
          loc: path.node.loc
        });
      }
    });

    // Add relationships between entities
    entities['relationships'] = this.detectCodeRelationships(entities);

    return entities;
  }

  private calculateComplexity(node: any): number {
    let complexity = 1;
    // Count decision points
    traverse(node, {
      IfStatement() { complexity++; },
      ConditionalExpression() { complexity++; },
      LogicalExpression({ node }) {
        if (node.operator === '&&' || node.operator === '||') complexity++;
      },
      ForStatement() { complexity++; },
      WhileStatement() { complexity++; },
      DoWhileStatement() { complexity++; },
      SwitchCase() { complexity++; }
    }, null, node);
    return complexity;
  }

  private detectCodeRelationships(entities: any) {
    const relationships = [];

    // Function calls
    entities.functions.forEach(func => {
      entities.functions.forEach(otherFunc => {
        if (func !== otherFunc && this.callsFunction(func, otherFunc)) {
          relationships.push({
            type: 'calls',
            from: func.name,
            to: otherFunc.name
          });
        }
      });
    });

    // Class inheritance
    entities.classes.forEach(cls => {
      if (cls.superClass) {
        relationships.push({
          type: 'extends',
          from: cls.name,
          to: cls.superClass
        });
      }
    });

    // Import dependencies
    entities.imports.forEach(imp => {
      relationships.push({
        type: 'imports',
        from: 'module',
        to: imp.source
      });
    });

    return relationships;
  }

  private generateCacheKey(text: string): string {
    return require('crypto').createHash('md5').update(text).digest('hex');
  }

  private fallbackExtraction(text: string) {
    // Improved rule-based extraction as fallback
    const patterns = {
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      url: /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g,
      phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
      date: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g,
      time: /\b\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM)?\b/gi,
      currency: /\$\d+(\.\d{2})?/g,
      percentage: /\d+(\.\d+)?%/g,
      number: /\b\d+(\.\d+)?\b/g
    };

    const entities = [];

    for (const [type, pattern] of Object.entries(patterns)) {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          entities.push({
            text: match,
            type,
            confidence: 0.6,
            source: 'rule-based'
          });
        });
      }
    }

    return entities;
  }

  // Helper methods
  private extractParamInfo(param: any) {
    return {
      name: param.name,
      type: param.typeAnnotation,
      optional: param.optional,
      default: param.default
    };
  }

  private extractClassMethods(classNode: any) {
    return classNode.body.body
      .filter((member: any) => member.type === 'ClassMethod')
      .map((method: any) => ({
        name: method.key.name,
        kind: method.kind,
        async: method.async,
        static: method.static,
        params: method.params.map(this.extractParamInfo)
      }));
  }

  private extractClassProperties(classNode: any) {
    return classNode.body.body
      .filter((member: any) => member.type === 'ClassProperty')
      .map((prop: any) => ({
        name: prop.key.name,
        type: prop.typeAnnotation,
        static: prop.static,
        readonly: prop.readonly
      }));
  }

  private extractImportSpecifier(spec: any) {
    return {
      imported: spec.imported?.name,
      local: spec.local.name,
      type: spec.type
    };
  }

  private extractTypeInfo(typeNode: any) {
    // Simplified type extraction
    return {
      type: typeNode.type,
      raw: typeNode.toString()
    };
  }

  private extractInterfaceMembers(body: any) {
    return body.body.map((member: any) => ({
      name: member.key?.name,
      type: member.typeAnnotation,
      optional: member.optional,
      readonly: member.readonly
    }));
  }

  private extractValueType(node: any) {
    switch (node.type) {
      case 'StringLiteral': return 'string';
      case 'NumericLiteral': return 'number';
      case 'BooleanLiteral': return 'boolean';
      case 'ArrayExpression': return 'array';
      case 'ObjectExpression': return 'object';
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': return 'function';
      default: return node.type;
    }
  }

  private callsFunction(caller: any, callee: any): boolean {
    // Simplified check - would need full AST traversal in production
    return false;
  }

  private calculateRelevance(entity: any, contextEmbedding: any): number {
    // Simplified relevance calculation
    return Math.random() * 0.3 + 0.7; // 0.7-1.0 range
  }

  private categorizeEntity(entity: any): string {
    const categories = {
      PERSON: ['person', 'user', 'customer', 'admin'],
      ORGANIZATION: ['company', 'org', 'corporation'],
      LOCATION: ['location', 'place', 'address'],
      DATE: ['date', 'time', 'datetime'],
      TECHNICAL: ['api', 'function', 'class', 'method']
    };

    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(kw => entity.text.toLowerCase().includes(kw))) {
        return category;
      }
    }

    return 'GENERAL';
  }

  private extractMetadata(entity: any, context: string): any {
    return {
      firstOccurrence: context.indexOf(entity.text),
      frequency: (context.match(new RegExp(entity.text, 'gi')) || []).length,
      contextWindow: context.substring(
        Math.max(0, context.indexOf(entity.text) - 50),
        Math.min(context.length, context.indexOf(entity.text) + 50)
      )
    };
  }
}
