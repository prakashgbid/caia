// TypeScript type definitions for code entities

export enum EntityType {
  FUNCTION = 'function',
  ASYNC_FUNCTION = 'async_function',
  METHOD = 'method',
  CLASS = 'class',
  INTERFACE = 'interface',
  VARIABLE = 'variable',
  CONSTANT = 'constant',
  MODULE = 'module',
  FILE = 'file',
  PACKAGE = 'package',
  IMPORT = 'import',
  DECORATOR = 'decorator',
  ANNOTATION = 'annotation'
}

export enum RelationshipType {
  CALLS = 'calls',
  IMPORTS = 'imports',
  INHERITS = 'inherits',
  IMPLEMENTS = 'implements',
  USES = 'uses',
  CONTAINS = 'contains',
  OVERRIDES = 'overrides',
  DECORATES = 'decorates',
  RETURNS = 'returns',
  PARAMETER = 'parameter',
  DEPENDS_ON = 'depends_on',
  SIMILAR_TO = 'similar_to'
}

export enum Language {
  PYTHON = 'python',
  JAVASCRIPT = 'javascript',
  TYPESCRIPT = 'typescript',
  JSX = 'jsx',
  TSX = 'tsx',
  JAVA = 'java',
  CPP = 'cpp',
  C = 'c',
  GO = 'go',
  RUST = 'rust',
  UNKNOWN = 'unknown'
}

export interface Location {
  file_path: string;
  start_line: number;
  end_line: number;
  start_column?: number;
  end_column?: number;
}

export interface Documentation {
  docstring?: string;
  comments: string[];
  examples: string[];
  parameters: Record<string, string>;
  returns?: string;
  raises: Record<string, string>;
  see_also: string[];
}

export interface Complexity {
  cyclomatic: number;
  cognitive?: number;
  halstead_volume?: number;
  lines_of_code?: number;
  maintainability_index?: number;
}

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  qualified_name?: string;
  language: Language;
  location: Location;
  signature?: string;
  raw_code?: string;
  hash?: string;
  documentation: Documentation;
  complexity: Complexity;
  dependencies: string[];
  dependents: string[];
  tags: string[];
  custom_metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  last_modified?: string;
  embedding?: number[];
  embedding_model?: string;
}

export interface Relationship {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  relationship_type: RelationshipType;
  weight: number;
  confidence: number;
  source: string;
  context?: string;
  location?: Location;
  metadata: Record<string, any>;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface KnowledgeGraph {
  id: string;
  name: string;
  description?: string;
  entities: Record<string, Entity>;
  relationships: Record<string, Relationship>;
  total_entities: number;
  total_relationships: number;
  entity_type_counts: Record<string, number>;
  relationship_type_counts: Record<string, number>;
  languages: Language[];
  root_paths: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
  last_scan?: string;
}
