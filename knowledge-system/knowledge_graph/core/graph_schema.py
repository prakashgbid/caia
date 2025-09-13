"""
Graph Schema - Knowledge Graph Node and Relationship Definitions
Phase 4 - Advanced Knowledge Graph System
"""

from enum import Enum
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)

class NodeType(Enum):
    """Enumeration of all node types in the knowledge graph"""
    CONCEPT = "Concept"
    ENTITY = "Entity" 
    CODE_ELEMENT = "CodeElement"
    PATTERN = "Pattern"
    USER = "User"
    SESSION = "Session"
    DECISION = "Decision"
    KNOWLEDGE = "Knowledge"
    AGENT = "Agent"
    TOOL = "Tool"
    PROJECT = "Project"
    FILE = "File"
    FUNCTION = "Function"
    CLASS = "Class"
    VARIABLE = "Variable"
    IMPORT = "Import"
    ERROR = "Error"
    FEATURE = "Feature"
    REQUIREMENT = "Requirement"
    TEST = "Test"

class RelationshipType(Enum):
    """Enumeration of all relationship types"""
    # Semantic relationships
    RELATES_TO = "RELATES_TO"
    IS_A = "IS_A"
    PART_OF = "PART_OF"
    SIMILAR_TO = "SIMILAR_TO"
    DEPENDS_ON = "DEPENDS_ON"
    
    # Code relationships
    CALLS = "CALLS"
    IMPORTS = "IMPORTS"
    INHERITS_FROM = "INHERITS_FROM"
    IMPLEMENTS = "IMPLEMENTS"
    CONTAINS = "CONTAINS"
    USES = "USES"
    DEFINES = "DEFINES"
    
    # Learning relationships
    LEARNS_FROM = "LEARNS_FROM"
    INFLUENCES = "INFLUENCES"
    CONTRADICTS = "CONTRADICTS"
    SUPPORTS = "SUPPORTS"
    EVOLVES_TO = "EVOLVES_TO"
    
    # User relationships
    PREFERS = "PREFERS"
    CREATED = "CREATED"
    MODIFIED = "MODIFIED"
    ACCESSED = "ACCESSED"
    COLLABORATES_WITH = "COLLABORATES_WITH"
    
    # Agent relationships
    MANAGES = "MANAGES"
    EXECUTES = "EXECUTES"
    REPORTS_TO = "REPORTS_TO"
    DELEGATES_TO = "DELEGATES_TO"
    
    # Temporal relationships
    PRECEDES = "PRECEDES"
    FOLLOWS = "FOLLOWS"
    CONCURRENT_WITH = "CONCURRENT_WITH"
    TRIGGERS = "TRIGGERS"

@dataclass
class PropertyDefinition:
    """Definition of a node or relationship property"""
    name: str
    type: str  # 'string', 'integer', 'float', 'boolean', 'datetime', 'list', 'dict'
    required: bool = False
    default: Any = None
    description: str = ""
    constraints: List[str] = None
    
    def __post_init__(self):
        if self.constraints is None:
            self.constraints = []

@dataclass 
class NodeSchema:
    """Schema definition for a node type"""
    node_type: NodeType
    properties: List[PropertyDefinition]
    indexes: List[str] = None
    constraints: List[str] = None
    description: str = ""
    
    def __post_init__(self):
        if self.indexes is None:
            self.indexes = []
        if self.constraints is None:
            self.constraints = []

@dataclass
class RelationshipSchema:
    """Schema definition for a relationship type"""
    relationship_type: RelationshipType
    properties: List[PropertyDefinition]
    allowed_start_nodes: List[NodeType] = None
    allowed_end_nodes: List[NodeType] = None
    description: str = ""
    
    def __post_init__(self):
        if self.allowed_start_nodes is None:
            self.allowed_start_nodes = []
        if self.allowed_end_nodes is None:
            self.allowed_end_nodes = []

class GraphSchema:
    """Complete schema definition for the knowledge graph"""
    
    def __init__(self):
        self.node_schemas: Dict[NodeType, NodeSchema] = {}
        self.relationship_schemas: Dict[RelationshipType, RelationshipSchema] = {}
        self._initialize_schemas()
    
    def _initialize_schemas(self):
        """Initialize all node and relationship schemas"""
        self._define_node_schemas()
        self._define_relationship_schemas()
    
    def _define_node_schemas(self):
        """Define schemas for all node types"""
        
        # Common properties for all nodes
        common_props = [
            PropertyDefinition("id", "string", description="Unique identifier"),
            PropertyDefinition("created_at", "datetime", required=True, description="Creation timestamp"),
            PropertyDefinition("updated_at", "datetime", description="Last update timestamp"),
            PropertyDefinition("confidence", "float", default=1.0, description="Confidence score 0-1")
        ]
        
        # Concept nodes - abstract ideas and concepts
        concept_props = common_props + [
            PropertyDefinition("name", "string", required=True, description="Concept name"),
            PropertyDefinition("description", "string", description="Concept description"),
            PropertyDefinition("domain", "string", description="Knowledge domain"),
            PropertyDefinition("synonyms", "list", default=[], description="Alternative names"),
            PropertyDefinition("importance", "float", default=0.5, description="Importance score")
        ]
        
        self.node_schemas[NodeType.CONCEPT] = NodeSchema(
            NodeType.CONCEPT, concept_props,
            indexes=["name", "domain"],
            constraints=["UNIQUE (name, domain)"],
            description="Abstract concepts and ideas in the knowledge domain"
        )
        
        # Entity nodes - concrete entities extracted from text/code
        entity_props = common_props + [
            PropertyDefinition("name", "string", required=True, description="Entity name"),
            PropertyDefinition("type", "string", required=True, description="Entity type (PERSON, ORG, etc.)"),
            PropertyDefinition("value", "string", description="Entity value/content"),
            PropertyDefinition("source", "string", description="Source of extraction"),
            PropertyDefinition("source_line", "integer", description="Line number in source"),
            PropertyDefinition("context", "string", description="Surrounding context")
        ]
        
        self.node_schemas[NodeType.ENTITY] = NodeSchema(
            NodeType.ENTITY, entity_props,
            indexes=["name", "type", "source"],
            constraints=["UNIQUE (name, type, source)"],
            description="Named entities extracted from text and code"
        )
        
        # Code element nodes - functions, classes, variables, etc.
        code_props = common_props + [
            PropertyDefinition("name", "string", required=True, description="Code element name"),
            PropertyDefinition("type", "string", required=True, description="Code element type"),
            PropertyDefinition("language", "string", default="python", description="Programming language"),
            PropertyDefinition("file_path", "string", description="File path"),
            PropertyDefinition("line_start", "integer", description="Starting line number"),
            PropertyDefinition("line_end", "integer", description="Ending line number"),
            PropertyDefinition("complexity", "integer", default=1, description="Cyclomatic complexity"),
            PropertyDefinition("parameters", "list", default=[], description="Function parameters"),
            PropertyDefinition("return_type", "string", description="Return type"),
            PropertyDefinition("docstring", "string", description="Documentation string"),
            PropertyDefinition("usage_count", "integer", default=0, description="Usage frequency")
        ]
        
        self.node_schemas[NodeType.CODE_ELEMENT] = NodeSchema(
            NodeType.CODE_ELEMENT, code_props,
            indexes=["name", "type", "language", "file_path"],
            description="Code elements like functions, classes, variables"
        )
        
        # Pattern nodes - behavioral and code patterns
        pattern_props = common_props + [
            PropertyDefinition("name", "string", required=True, description="Pattern name"),
            PropertyDefinition("description", "string", description="Pattern description"),
            PropertyDefinition("pattern_type", "string", required=True, description="Type of pattern"),
            PropertyDefinition("frequency", "integer", default=1, description="Occurrence frequency"),
            PropertyDefinition("quality_score", "float", default=0.5, description="Pattern quality"),
            PropertyDefinition("context", "string", description="Context where pattern occurs"),
            PropertyDefinition("examples", "list", default=[], description="Example instances")
        ]
        
        self.node_schemas[NodeType.PATTERN] = NodeSchema(
            NodeType.PATTERN, pattern_props,
            indexes=["name", "pattern_type"],
            description="Learned behavioral and structural patterns"
        )
        
        # User nodes - system users
        user_props = common_props + [
            PropertyDefinition("name", "string", description="User name"),
            PropertyDefinition("email", "string", description="User email"),
            PropertyDefinition("preferences", "dict", default={}, description="User preferences"),
            PropertyDefinition("behavior_profile", "dict", default={}, description="Behavioral profile"),
            PropertyDefinition("skill_level", "string", default="intermediate", description="Skill level"),
            PropertyDefinition("active_sessions", "integer", default=0, description="Active session count"),
            PropertyDefinition("last_active", "datetime", description="Last activity timestamp")
        ]
        
        self.node_schemas[NodeType.USER] = NodeSchema(
            NodeType.USER, user_props,
            indexes=["name", "email"],
            constraints=["UNIQUE (email)"],
            description="System users and their profiles"
        )
        
        # Session nodes - user sessions
        session_props = common_props + [
            PropertyDefinition("session_id", "string", required=True, description="Session identifier"),
            PropertyDefinition("start_time", "datetime", required=True, description="Session start time"),
            PropertyDefinition("end_time", "datetime", description="Session end time"),
            PropertyDefinition("duration", "integer", description="Session duration in seconds"),
            PropertyDefinition("quality_score", "float", description="Session quality score"),
            PropertyDefinition("interaction_count", "integer", default=0, description="Number of interactions"),
            PropertyDefinition("goals_achieved", "list", default=[], description="Goals accomplished"),
            PropertyDefinition("tools_used", "list", default=[], description="Tools utilized")
        ]
        
        self.node_schemas[NodeType.SESSION] = NodeSchema(
            NodeType.SESSION, session_props,
            indexes=["session_id", "start_time"],
            constraints=["UNIQUE (session_id)"],
            description="User interaction sessions"
        )
        
        # Decision nodes - decisions made by users or agents
        decision_props = common_props + [
            PropertyDefinition("decision_id", "string", required=True, description="Decision identifier"),
            PropertyDefinition("description", "string", required=True, description="Decision description"),
            PropertyDefinition("context", "string", description="Decision context"),
            PropertyDefinition("reasoning", "string", description="Decision reasoning"),
            PropertyDefinition("outcome", "string", description="Decision outcome"),
            PropertyDefinition("alternatives", "list", default=[], description="Alternative options considered"),
            PropertyDefinition("success_score", "float", description="Success measurement"),
            PropertyDefinition("lessons_learned", "string", description="Lessons from decision")
        ]
        
        self.node_schemas[NodeType.DECISION] = NodeSchema(
            NodeType.DECISION, decision_props,
            indexes=["decision_id", "context"],
            constraints=["UNIQUE (decision_id)"],
            description="Decisions made in the system"
        )
        
        # Knowledge nodes - structured knowledge items
        knowledge_props = common_props + [
            PropertyDefinition("content", "string", required=True, description="Knowledge content"),
            PropertyDefinition("type", "string", required=True, description="Knowledge type"),
            PropertyDefinition("domain", "string", description="Knowledge domain"),
            PropertyDefinition("reliability", "float", default=0.5, description="Reliability score"),
            PropertyDefinition("source", "string", description="Knowledge source"),
            PropertyDefinition("tags", "list", default=[], description="Knowledge tags"),
            PropertyDefinition("validation_status", "string", default="pending", description="Validation status")
        ]
        
        self.node_schemas[NodeType.KNOWLEDGE] = NodeSchema(
            NodeType.KNOWLEDGE, knowledge_props,
            indexes=["type", "domain", "source"],
            description="Structured knowledge items"
        )
        
        # Add other node types...
        self._add_additional_node_schemas()
    
    def _add_additional_node_schemas(self):
        """Add schemas for additional node types"""
        
        # Agent nodes
        agent_props = [
            PropertyDefinition("name", "string", required=True),
            PropertyDefinition("type", "string", required=True),
            PropertyDefinition("status", "string", default="active"),
            PropertyDefinition("capabilities", "list", default=[]),
            PropertyDefinition("performance_score", "float", default=0.5),
            PropertyDefinition("created_at", "datetime", required=True)
        ]
        
        self.node_schemas[NodeType.AGENT] = NodeSchema(
            NodeType.AGENT, agent_props,
            indexes=["name", "type"],
            description="AI agents in the system"
        )
        
        # Tool nodes
        tool_props = [
            PropertyDefinition("name", "string", required=True),
            PropertyDefinition("type", "string", required=True),
            PropertyDefinition("usage_count", "integer", default=0),
            PropertyDefinition("success_rate", "float", default=1.0),
            PropertyDefinition("description", "string"),
            PropertyDefinition("created_at", "datetime", required=True)
        ]
        
        self.node_schemas[NodeType.TOOL] = NodeSchema(
            NodeType.TOOL, tool_props,
            indexes=["name", "type"],
            description="Tools used in the system"
        )
    
    def _define_relationship_schemas(self):
        """Define schemas for all relationship types"""
        
        # Common relationship properties
        common_rel_props = [
            PropertyDefinition("created_at", "datetime", required=True, description="Relationship creation time"),
            PropertyDefinition("updated_at", "datetime", description="Last update time"),
            PropertyDefinition("confidence", "float", default=1.0, description="Relationship confidence"),
            PropertyDefinition("strength", "float", default=0.5, description="Relationship strength")
        ]
        
        # RELATES_TO - general semantic relationship
        relates_props = common_rel_props + [
            PropertyDefinition("relation_type", "string", description="Specific type of relation"),
            PropertyDefinition("context", "string", description="Context of relationship")
        ]
        
        self.relationship_schemas[RelationshipType.RELATES_TO] = RelationshipSchema(
            RelationshipType.RELATES_TO, relates_props,
            description="General semantic relationship between concepts"
        )
        
        # IS_A - inheritance/classification relationship
        is_a_props = common_rel_props + [
            PropertyDefinition("inheritance_type", "string", default="conceptual", description="Type of inheritance")
        ]
        
        self.relationship_schemas[RelationshipType.IS_A] = RelationshipSchema(
            RelationshipType.IS_A, is_a_props,
            description="Classification or inheritance relationship"
        )
        
        # CALLS - function/method calls
        calls_props = common_rel_props + [
            PropertyDefinition("frequency", "integer", default=1, description="Call frequency"),
            PropertyDefinition("importance", "float", default=0.5, description="Call importance"),
            PropertyDefinition("parameters", "list", default=[], description="Call parameters")
        ]
        
        self.relationship_schemas[RelationshipType.CALLS] = RelationshipSchema(
            RelationshipType.CALLS, calls_props,
            allowed_start_nodes=[NodeType.CODE_ELEMENT, NodeType.FUNCTION],
            allowed_end_nodes=[NodeType.CODE_ELEMENT, NodeType.FUNCTION],
            description="Function or method call relationship"
        )
        
        # LEARNS_FROM - learning relationship
        learns_props = common_rel_props + [
            PropertyDefinition("learning_strength", "float", default=0.5, description="Learning effectiveness"),
            PropertyDefinition("method", "string", description="Learning method used"),
            PropertyDefinition("evidence", "string", description="Evidence of learning")
        ]
        
        self.relationship_schemas[RelationshipType.LEARNS_FROM] = RelationshipSchema(
            RelationshipType.LEARNS_FROM, learns_props,
            description="Learning relationship between entities"
        )
        
        # Add more relationship schemas...
        self._add_additional_relationship_schemas()
    
    def _add_additional_relationship_schemas(self):
        """Add additional relationship schemas"""
        
        # USES relationship
        uses_props = [
            PropertyDefinition("usage_frequency", "integer", default=1),
            PropertyDefinition("proficiency", "float", default=0.5),
            PropertyDefinition("context", "string"),
            PropertyDefinition("created_at", "datetime", required=True)
        ]
        
        self.relationship_schemas[RelationshipType.USES] = RelationshipSchema(
            RelationshipType.USES, uses_props,
            description="Usage relationship between entities"
        )
        
        # DEPENDS_ON relationship
        depends_props = [
            PropertyDefinition("dependency_type", "string", required=True),
            PropertyDefinition("criticality", "float", default=0.5),
            PropertyDefinition("version", "string"),
            PropertyDefinition("created_at", "datetime", required=True)
        ]
        
        self.relationship_schemas[RelationshipType.DEPENDS_ON] = RelationshipSchema(
            RelationshipType.DEPENDS_ON, depends_props,
            description="Dependency relationship"
        )
    
    def get_node_schema(self, node_type: NodeType) -> Optional[NodeSchema]:
        """Get schema for a specific node type"""
        return self.node_schemas.get(node_type)
    
    def get_relationship_schema(self, rel_type: RelationshipType) -> Optional[RelationshipSchema]:
        """Get schema for a specific relationship type"""
        return self.relationship_schemas.get(rel_type)
    
    def validate_node(self, node_type: NodeType, properties: Dict) -> List[str]:
        """
        Validate node properties against schema
        
        Returns:
            List of validation errors (empty if valid)
        """
        errors = []
        schema = self.get_node_schema(node_type)
        
        if not schema:
            errors.append(f"Unknown node type: {node_type}")
            return errors
        
        # Check required properties
        for prop_def in schema.properties:
            if prop_def.required and prop_def.name not in properties:
                errors.append(f"Required property '{prop_def.name}' missing")
        
        # Validate property types
        for prop_name, prop_value in properties.items():
            prop_def = next((p for p in schema.properties if p.name == prop_name), None)
            if prop_def:
                if not self._validate_property_type(prop_value, prop_def.type):
                    errors.append(f"Property '{prop_name}' has invalid type")
        
        return errors
    
    def validate_relationship(self, rel_type: RelationshipType, properties: Dict, 
                           start_node_type: NodeType = None, end_node_type: NodeType = None) -> List[str]:
        """
        Validate relationship properties against schema
        
        Returns:
            List of validation errors (empty if valid)
        """
        errors = []
        schema = self.get_relationship_schema(rel_type)
        
        if not schema:
            errors.append(f"Unknown relationship type: {rel_type}")
            return errors
        
        # Check node type constraints
        if start_node_type and schema.allowed_start_nodes:
            if start_node_type not in schema.allowed_start_nodes:
                errors.append(f"Invalid start node type: {start_node_type}")
        
        if end_node_type and schema.allowed_end_nodes:
            if end_node_type not in schema.allowed_end_nodes:
                errors.append(f"Invalid end node type: {end_node_type}")
        
        # Check required properties
        for prop_def in schema.properties:
            if prop_def.required and prop_def.name not in properties:
                errors.append(f"Required property '{prop_def.name}' missing")
        
        return errors
    
    def _validate_property_type(self, value: Any, expected_type: str) -> bool:
        """Validate that a property value matches expected type"""
        type_map = {
            'string': str,
            'integer': int,
            'float': (int, float),
            'boolean': bool,
            'list': list,
            'dict': dict
        }
        
        if expected_type == 'datetime':
            # Allow both datetime objects and ISO strings
            from datetime import datetime
            if isinstance(value, datetime):
                return True
            if isinstance(value, str):
                try:
                    datetime.fromisoformat(value.replace('Z', '+00:00'))
                    return True
                except:
                    return False
            return False
        
        expected_python_type = type_map.get(expected_type)
        if expected_python_type:
            return isinstance(value, expected_python_type)
        
        return True  # Unknown type, assume valid
    
    def generate_cypher_constraints(self) -> List[str]:
        """Generate Cypher statements for all constraints"""
        statements = []
        
        for node_type, schema in self.node_schemas.items():
            # Add unique constraints
            for constraint in schema.constraints:
                if constraint.startswith("UNIQUE"):
                    constraint_name = f"{node_type.value.lower()}_{constraint.lower().replace(' ', '_').replace('(', '').replace(')', '').replace(',', '_')}"
                    stmt = f"CREATE CONSTRAINT {constraint_name} IF NOT EXISTS FOR (n:{node_type.value}) REQUIRE {constraint.replace('UNIQUE ', '')} IS UNIQUE"
                    statements.append(stmt)
            
            # Add property existence constraints for required properties
            required_props = [p.name for p in schema.properties if p.required]
            for prop in required_props:
                constraint_name = f"{node_type.value.lower()}_{prop}_exists"
                stmt = f"CREATE CONSTRAINT {constraint_name} IF NOT EXISTS FOR (n:{node_type.value}) REQUIRE n.{prop} IS NOT NULL"
                statements.append(stmt)
        
        return statements
    
    def generate_cypher_indexes(self) -> List[str]:
        """Generate Cypher statements for all indexes"""
        statements = []
        
        for node_type, schema in self.node_schemas.items():
            for index_prop in schema.indexes:
                index_name = f"{node_type.value.lower()}_{index_prop}_index"
                stmt = f"CREATE INDEX {index_name} IF NOT EXISTS FOR (n:{node_type.value}) ON (n.{index_prop})"
                statements.append(stmt)
        
        return statements
    
    def to_dict(self) -> Dict:
        """Export schema as dictionary"""
        return {
            'node_types': {
                nt.value: {
                    'properties': [
                        {
                            'name': prop.name,
                            'type': prop.type,
                            'required': prop.required,
                            'default': prop.default,
                            'description': prop.description
                        }
                        for prop in schema.properties
                    ],
                    'indexes': schema.indexes,
                    'constraints': schema.constraints,
                    'description': schema.description
                }
                for nt, schema in self.node_schemas.items()
            },
            'relationship_types': {
                rt.value: {
                    'properties': [
                        {
                            'name': prop.name,
                            'type': prop.type,
                            'required': prop.required,
                            'default': prop.default,
                            'description': prop.description
                        }
                        for prop in schema.properties
                    ],
                    'allowed_start_nodes': [nt.value for nt in schema.allowed_start_nodes],
                    'allowed_end_nodes': [nt.value for nt in schema.allowed_end_nodes],
                    'description': schema.description
                }
                for rt, schema in self.relationship_schemas.items()
            }
        }

# Global schema instance
_graph_schema = None

def get_graph_schema() -> GraphSchema:
    """Get the global graph schema instance"""
    global _graph_schema
    if _graph_schema is None:
        _graph_schema = GraphSchema()
    return _graph_schema