#!/usr/bin/env python3
"""Data models for code entities using Pydantic."""

from datetime import datetime
from typing import List, Dict, Any, Optional, Union, Set
from enum import Enum
from pydantic import BaseModel, Field, validator
import uuid

class EntityType(str, Enum):
    """Types of code entities."""
    FUNCTION = "function"
    ASYNC_FUNCTION = "async_function"
    METHOD = "method"
    CLASS = "class"
    INTERFACE = "interface"
    VARIABLE = "variable"
    CONSTANT = "constant"
    MODULE = "module"
    FILE = "file"
    PACKAGE = "package"
    IMPORT = "import"
    DECORATOR = "decorator"
    ANNOTATION = "annotation"

class RelationshipType(str, Enum):
    """Types of relationships between entities."""
    CALLS = "calls"
    IMPORTS = "imports"
    INHERITS = "inherits"
    IMPLEMENTS = "implements"
    USES = "uses"
    CONTAINS = "contains"
    OVERRIDES = "overrides"
    DECORATES = "decorates"
    RETURNS = "returns"
    PARAMETER = "parameter"
    DEPENDS_ON = "depends_on"
    SIMILAR_TO = "similar_to"

class Language(str, Enum):
    """Supported programming languages."""
    PYTHON = "python"
    JAVASCRIPT = "javascript"
    TYPESCRIPT = "typescript"
    JSX = "jsx"
    TSX = "tsx"
    JAVA = "java"
    CPP = "cpp"
    C = "c"
    GO = "go"
    RUST = "rust"
    UNKNOWN = "unknown"

class Location(BaseModel):
    """Location within a file."""
    file_path: str
    start_line: int
    end_line: int
    start_column: Optional[int] = None
    end_column: Optional[int] = None
    
    @validator('end_line')
    def end_line_must_be_ge_start_line(cls, v, values):
        if 'start_line' in values and v < values['start_line']:
            raise ValueError('end_line must be >= start_line')
        return v

class Complexity(BaseModel):
    """Code complexity metrics."""
    cyclomatic: int = 1
    cognitive: Optional[int] = None
    halstead_volume: Optional[float] = None
    lines_of_code: Optional[int] = None
    maintainability_index: Optional[float] = None

class Documentation(BaseModel):
    """Documentation associated with an entity."""
    docstring: Optional[str] = None
    comments: List[str] = Field(default_factory=list)
    examples: List[str] = Field(default_factory=list)
    parameters: Dict[str, str] = Field(default_factory=dict)
    returns: Optional[str] = None
    raises: Dict[str, str] = Field(default_factory=dict)
    see_also: List[str] = Field(default_factory=list)

class SecurityInfo(BaseModel):
    """Security-related information."""
    is_sensitive: bool = False
    contains_secrets: bool = False
    access_level: str = "public"  # public, private, protected, internal
    security_tags: Set[str] = Field(default_factory=set)
    vulnerability_score: Optional[float] = None

class PerformanceInfo(BaseModel):
    """Performance-related information."""
    is_critical_path: bool = False
    estimated_runtime: Optional[str] = None  # O(n), O(log n), etc.
    memory_usage: Optional[str] = None
    io_operations: List[str] = Field(default_factory=list)
    async_operations: List[str] = Field(default_factory=list)

class Entity(BaseModel):
    """Base model for code entities."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: EntityType
    name: str
    qualified_name: Optional[str] = None  # Full qualified name (e.g., module.Class.method)
    language: Language
    location: Location
    
    # Code information
    signature: Optional[str] = None
    raw_code: Optional[str] = None
    hash: Optional[str] = None
    
    # Documentation
    documentation: Documentation = Field(default_factory=Documentation)
    
    # Metrics
    complexity: Complexity = Field(default_factory=Complexity)
    security: SecurityInfo = Field(default_factory=SecurityInfo)
    performance: PerformanceInfo = Field(default_factory=PerformanceInfo)
    
    # Dependencies and usage
    dependencies: Set[str] = Field(default_factory=set)  # Entity IDs
    dependents: Set[str] = Field(default_factory=set)   # Entity IDs
    
    # Metadata
    tags: Set[str] = Field(default_factory=set)
    custom_metadata: Dict[str, Any] = Field(default_factory=dict)
    
    # Timestamps
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    last_modified: Optional[datetime] = None
    
    # Vector embedding (will be populated by embedding service)
    embedding: Optional[List[float]] = None
    embedding_model: Optional[str] = None
    
    class Config:
        use_enum_values = True
        json_encoders = {
            datetime: lambda v: v.isoformat(),
            set: lambda v: list(v)
        }
    
    def add_dependency(self, entity_id: str):
        """Add a dependency."""
        self.dependencies.add(entity_id)
        self.updated_at = datetime.now()
    
    def remove_dependency(self, entity_id: str):
        """Remove a dependency."""
        self.dependencies.discard(entity_id)
        self.updated_at = datetime.now()
    
    def add_tag(self, tag: str):
        """Add a tag."""
        self.tags.add(tag)
        self.updated_at = datetime.now()
    
    def get_full_context(self) -> str:
        """Get full context for embedding."""
        parts = []
        
        # Basic info
        parts.append(f"{self.type} {self.name}")
        
        # Signature
        if self.signature:
            parts.append(self.signature)
        
        # Documentation
        if self.documentation.docstring:
            parts.append(self.documentation.docstring)
        
        # Comments
        if self.documentation.comments:
            parts.extend(self.documentation.comments)
        
        return " ".join(parts)

class FunctionEntity(Entity):
    """Specialized model for functions."""
    type: EntityType = EntityType.FUNCTION
    parameters: List[Dict[str, Any]] = Field(default_factory=list)
    return_type: Optional[str] = None
    is_async: bool = False
    is_generator: bool = False
    decorators: List[str] = Field(default_factory=list)
    
class ClassEntity(Entity):
    """Specialized model for classes."""
    type: EntityType = EntityType.CLASS
    base_classes: List[str] = Field(default_factory=list)
    interfaces: List[str] = Field(default_factory=list)
    methods: Set[str] = Field(default_factory=set)  # Method entity IDs
    attributes: Set[str] = Field(default_factory=set)  # Attribute entity IDs
    is_abstract: bool = False
    
class ModuleEntity(Entity):
    """Specialized model for modules/files."""
    type: EntityType = EntityType.MODULE
    imports: List[str] = Field(default_factory=list)
    exports: List[str] = Field(default_factory=list)
    contained_entities: Set[str] = Field(default_factory=set)
    file_size: Optional[int] = None
    encoding: str = "utf-8"

class Relationship(BaseModel):
    """Model for relationships between entities."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    from_entity_id: str
    to_entity_id: str
    relationship_type: RelationshipType
    
    # Relationship metadata
    weight: float = 1.0
    confidence: float = 1.0
    source: str = "ast_analysis"  # ast_analysis, static_analysis, runtime, manual
    
    # Context information
    context: Optional[str] = None
    location: Optional[Location] = None
    
    # Metadata
    metadata: Dict[str, Any] = Field(default_factory=dict)
    tags: Set[str] = Field(default_factory=set)
    
    # Timestamps
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    
    class Config:
        use_enum_values = True
        json_encoders = {
            datetime: lambda v: v.isoformat(),
            set: lambda v: list(v)
        }

class KnowledgeGraph(BaseModel):
    """Model for the complete knowledge graph."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: Optional[str] = None
    
    # Entities and relationships
    entities: Dict[str, Entity] = Field(default_factory=dict)
    relationships: Dict[str, Relationship] = Field(default_factory=dict)
    
    # Statistics
    total_entities: int = 0
    total_relationships: int = 0
    entity_type_counts: Dict[str, int] = Field(default_factory=dict)
    relationship_type_counts: Dict[str, int] = Field(default_factory=dict)
    
    # Metadata
    languages: Set[Language] = Field(default_factory=set)
    root_paths: List[str] = Field(default_factory=list)
    tags: Set[str] = Field(default_factory=set)
    
    # Timestamps
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    last_scan: Optional[datetime] = None
    
    class Config:
        use_enum_values = True
        json_encoders = {
            datetime: lambda v: v.isoformat(),
            set: lambda v: list(v)
        }
    
    def add_entity(self, entity: Entity):
        """Add an entity to the graph."""
        self.entities[entity.id] = entity
        self.total_entities = len(self.entities)
        
        # Update entity type counts
        entity_type = entity.type.value
        self.entity_type_counts[entity_type] = self.entity_type_counts.get(entity_type, 0) + 1
        
        # Update languages
        self.languages.add(entity.language)
        
        self.updated_at = datetime.now()
    
    def add_relationship(self, relationship: Relationship):
        """Add a relationship to the graph."""
        self.relationships[relationship.id] = relationship
        self.total_relationships = len(self.relationships)
        
        # Update relationship type counts
        rel_type = relationship.relationship_type.value
        self.relationship_type_counts[rel_type] = self.relationship_type_counts.get(rel_type, 0) + 1
        
        self.updated_at = datetime.now()
    
    def get_entity_by_name(self, name: str, entity_type: Optional[EntityType] = None) -> Optional[Entity]:
        """Find entity by name and optionally type."""
        for entity in self.entities.values():
            if entity.name == name:
                if entity_type is None or entity.type == entity_type:
                    return entity
        return None
    
    def get_entities_by_type(self, entity_type: EntityType) -> List[Entity]:
        """Get all entities of a specific type."""
        return [entity for entity in self.entities.values() if entity.type == entity_type]
    
    def get_relationships_for_entity(self, entity_id: str) -> List[Relationship]:
        """Get all relationships involving an entity."""
        return [
            rel for rel in self.relationships.values()
            if rel.from_entity_id == entity_id or rel.to_entity_id == entity_id
        ]
    
    def export_summary(self) -> Dict[str, Any]:
        """Export a summary of the knowledge graph."""
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'total_entities': self.total_entities,
            'total_relationships': self.total_relationships,
            'entity_types': self.entity_type_counts,
            'relationship_types': self.relationship_type_counts,
            'languages': list(self.languages),
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'last_scan': self.last_scan.isoformat() if self.last_scan else None
        }

# Factory functions for creating entities
def create_function_entity(
    name: str,
    location: Location,
    language: Language,
    signature: Optional[str] = None,
    **kwargs
) -> FunctionEntity:
    """Create a function entity."""
    return FunctionEntity(
        name=name,
        location=location,
        language=language,
        signature=signature,
        **kwargs
    )

def create_class_entity(
    name: str,
    location: Location,
    language: Language,
    **kwargs
) -> ClassEntity:
    """Create a class entity."""
    return ClassEntity(
        name=name,
        location=location,
        language=language,
        **kwargs
    )

def create_module_entity(
    name: str,
    location: Location,
    language: Language,
    **kwargs
) -> ModuleEntity:
    """Create a module entity."""
    return ModuleEntity(
        name=name,
        location=location,
        language=language,
        **kwargs
    )

def create_relationship(
    from_entity_id: str,
    to_entity_id: str,
    relationship_type: RelationshipType,
    **kwargs
) -> Relationship:
    """Create a relationship."""
    return Relationship(
        from_entity_id=from_entity_id,
        to_entity_id=to_entity_id,
        relationship_type=relationship_type,
        **kwargs
    )
