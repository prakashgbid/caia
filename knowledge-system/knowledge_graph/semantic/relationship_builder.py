"""
Relationship Builder - Build semantic relationships between entities
Phase 4 - Advanced Knowledge Graph System
"""

import re
import logging
import networkx as nx
from typing import Dict, List, Set, Optional, Tuple, Any
from dataclasses import dataclass
from collections import defaultdict, Counter
import yaml
from itertools import combinations
import spacy

from ..core.graph_schema import RelationshipType, get_graph_schema
from .entity_extractor import ExtractedEntity, CodeEntity

logger = logging.getLogger(__name__)

@dataclass
class ExtractedRelationship:
    """Represents an extracted relationship between entities"""
    source_entity: str
    target_entity: str
    relationship_type: RelationshipType
    confidence: float
    properties: Dict[str, Any] = None
    evidence: str = ""
    extraction_method: str = ""
    
    def __post_init__(self):
        if self.properties is None:
            self.properties = {}

@dataclass
class RelationshipPattern:
    """Pattern for relationship extraction"""
    pattern: str
    relationship_type: RelationshipType
    confidence: float = 0.8
    requires_entities: List[str] = None
    
    def __post_init__(self):
        if self.requires_entities is None:
            self.requires_entities = []

class RelationshipBuilder:
    """
    Builds semantic relationships between entities using multiple approaches
    
    Combines pattern matching, dependency parsing, semantic similarity,
    and code analysis to identify meaningful relationships.
    """
    
    def __init__(self, config_path: str = "graph_config.yaml"):
        """Initialize the relationship builder"""
        self.config = self._load_config(config_path)
        self.schema = get_graph_schema()
        
        # Initialize NLP components
        self.nlp = self._init_spacy_model()
        
        # Relationship patterns
        self.patterns = self._init_relationship_patterns()
        
        # Co-occurrence tracking
        self.cooccurrence_graph = nx.Graph()
        
        logger.info("Relationship builder initialized successfully")
    
    def _load_config(self, config_path: str) -> Dict:
        """Load configuration"""
        try:
            with open(config_path, 'r') as f:
                return yaml.safe_load(f)
        except Exception as e:
            logger.warning(f"Could not load config from {config_path}: {e}")
            return self._default_config()
    
    def _default_config(self) -> Dict:
        """Default configuration"""
        return {
            'semantic': {
                'relationship_extraction': {
                    'methods': ['dependency_parsing', 'pattern_matching', 'semantic_similarity', 'code_analysis'],
                    'confidence_threshold': 0.6,
                    'max_distance': 3
                }
            }
        }
    
    def _init_spacy_model(self):
        """Initialize spaCy model for dependency parsing"""
        try:
            nlp = spacy.load("en_core_web_lg")
            logger.info("Loaded spaCy model for relationship extraction")
        except OSError:
            try:
                nlp = spacy.load("en_core_web_md")
            except OSError:
                try:
                    nlp = spacy.load("en_core_web_sm")
                except OSError:
                    logger.warning("No spaCy model available for dependency parsing")
                    nlp = None
        
        return nlp
    
    def _init_relationship_patterns(self) -> List[RelationshipPattern]:
        """Initialize relationship extraction patterns"""
        patterns = [
            # IS_A relationships
            RelationshipPattern(
                pattern=r'(\w+)\s+(?:is an?|are)\s+(\w+)',
                relationship_type=RelationshipType.IS_A,
                confidence=0.9
            ),
            RelationshipPattern(
                pattern=r'(\w+)\s+(?:inherits from|extends)\s+(\w+)',
                relationship_type=RelationshipType.INHERITS_FROM,
                confidence=0.95
            ),
            
            # PART_OF relationships
            RelationshipPattern(
                pattern=r'(\w+)\s+(?:contains|includes|has)\s+(\w+)',
                relationship_type=RelationshipType.PART_OF,
                confidence=0.8
            ),
            RelationshipPattern(
                pattern=r'(\w+)\s+(?:is part of|belongs to)\s+(\w+)',
                relationship_type=RelationshipType.PART_OF,
                confidence=0.85
            ),
            
            # USES relationships
            RelationshipPattern(
                pattern=r'(\w+)\s+(?:uses|utilizes|employs)\s+(\w+)',
                relationship_type=RelationshipType.USES,
                confidence=0.8
            ),
            
            # DEPENDS_ON relationships
            RelationshipPattern(
                pattern=r'(\w+)\s+(?:depends on|requires|needs)\s+(\w+)',
                relationship_type=RelationshipType.DEPENDS_ON,
                confidence=0.85
            ),
            
            # SIMILAR_TO relationships
            RelationshipPattern(
                pattern=r'(\w+)\s+(?:is similar to|resembles|is like)\s+(\w+)',
                relationship_type=RelationshipType.SIMILAR_TO,
                confidence=0.7
            ),
            
            # CALLS relationships (for code)
            RelationshipPattern(
                pattern=r'(\w+)\s*\(\s*\)\s*',  # Function call pattern
                relationship_type=RelationshipType.CALLS,
                confidence=0.9,
                requires_entities=['CODE_FUNCTION']
            ),
            
            # IMPORTS relationships
            RelationshipPattern(
                pattern=r'import\s+(\w+)|from\s+(\w+)\s+import',
                relationship_type=RelationshipType.IMPORTS,
                confidence=0.95
            )
        ]
        
        return patterns
    
    def extract_relationships_from_text(self, text: str, entities: List[ExtractedEntity]) -> List[ExtractedRelationship]:
        """
        Extract relationships from text using multiple methods
        
        Args:
            text: Input text
            entities: List of entities found in the text
            
        Returns:
            List of extracted relationships
        """
        relationships = []
        
        # Method 1: Pattern-based extraction
        pattern_rels = self._extract_with_patterns(text, entities)
        relationships.extend(pattern_rels)
        
        # Method 2: Dependency parsing (if spaCy available)
        if self.nlp:
            dep_rels = self._extract_with_dependencies(text, entities)
            relationships.extend(dep_rels)
        
        # Method 3: Co-occurrence analysis
        cooccur_rels = self._extract_cooccurrence_relationships(entities, text)
        relationships.extend(cooccur_rels)
        
        # Method 4: Semantic similarity
        similarity_rels = self._extract_similarity_relationships(entities, text)
        relationships.extend(similarity_rels)
        
        # Deduplicate and filter by confidence
        relationships = self._filter_relationships(relationships)
        
        logger.debug(f"Extracted {len(relationships)} relationships from text")
        return relationships
    
    def extract_code_relationships(self, code_entities: List[CodeEntity], code: str) -> List[ExtractedRelationship]:
        """
        Extract relationships from code entities
        
        Args:
            code_entities: List of code entities
            code: Source code string
            
        Returns:
            List of code relationships
        """
        relationships = []
        
        # Group entities by type
        functions = [e for e in code_entities if e.entity_type == 'function']
        classes = [e for e in code_entities if e.entity_type == 'class']
        imports = [e for e in code_entities if e.entity_type == 'import']
        
        # Function call relationships
        call_rels = self._extract_function_calls(functions, code)
        relationships.extend(call_rels)
        
        # Class inheritance relationships
        inheritance_rels = self._extract_inheritance_relationships(classes, code)
        relationships.extend(inheritance_rels)
        
        # Import relationships
        import_rels = self._extract_import_relationships(imports, code_entities)
        relationships.extend(import_rels)
        
        # Container relationships (functions within classes)
        container_rels = self._extract_containment_relationships(code_entities, code)
        relationships.extend(container_rels)
        
        logger.debug(f"Extracted {len(relationships)} code relationships")
        return relationships
    
    def _extract_with_patterns(self, text: str, entities: List[ExtractedEntity]) -> List[ExtractedRelationship]:
        """Extract relationships using regex patterns"""
        relationships = []
        entity_texts = {e.text.lower(): e for e in entities}
        
        for pattern in self.patterns:
            matches = re.finditer(pattern.pattern, text, re.IGNORECASE)
            
            for match in matches:
                groups = match.groups()
                if len(groups) >= 2:
                    source_text = groups[0].lower()
                    target_text = groups[1].lower()
                    
                    # Check if both entities exist
                    if source_text in entity_texts and target_text in entity_texts:
                        # Check entity type requirements
                        if self._satisfies_entity_requirements(
                            entity_texts[source_text], 
                            entity_texts[target_text], 
                            pattern.requires_entities
                        ):
                            relationships.append(ExtractedRelationship(
                                source_entity=source_text,
                                target_entity=target_text,
                                relationship_type=pattern.relationship_type,
                                confidence=pattern.confidence,
                                evidence=match.group(0),
                                extraction_method='pattern_matching'
                            ))
        
        return relationships
    
    def _extract_with_dependencies(self, text: str, entities: List[ExtractedEntity]) -> List[ExtractedRelationship]:
        """Extract relationships using dependency parsing"""
        if not self.nlp:
            return []
        
        relationships = []
        doc = self.nlp(text)
        entity_spans = {(e.start_pos, e.end_pos): e for e in entities}
        
        for sent in doc.sents:
            # Find entities in this sentence
            sent_entities = []
            for span, entity in entity_spans.items():
                if sent.start_char <= span[0] < sent.end_char:
                    sent_entities.append((entity, span))
            
            if len(sent_entities) < 2:
                continue
            
            # Analyze dependency relationships
            for token in sent:
                if token.dep_ in ['nsubj', 'dobj', 'pobj']:  # Subject/object relationships
                    # Find related entities
                    source_entity = self._find_entity_for_token(token.head, sent_entities, sent)
                    target_entity = self._find_entity_for_token(token, sent_entities, sent)
                    
                    if source_entity and target_entity and source_entity != target_entity:
                        rel_type = self._infer_relationship_from_dependency(token.dep_, token.head.lemma_)
                        if rel_type:
                            relationships.append(ExtractedRelationship(
                                source_entity=source_entity.text.lower(),
                                target_entity=target_entity.text.lower(),
                                relationship_type=rel_type,
                                confidence=0.7,
                                evidence=sent.text,
                                extraction_method='dependency_parsing'
                            ))
        
        return relationships
    
    def _extract_cooccurrence_relationships(self, entities: List[ExtractedEntity], text: str) -> List[ExtractedRelationship]:
        """Extract relationships based on entity co-occurrence"""
        relationships = []
        
        # Create co-occurrence matrix
        entity_pairs = list(combinations(entities, 2))
        
        for entity1, entity2 in entity_pairs:
            # Check if entities co-occur within a reasonable distance
            distance = abs(entity1.start_pos - entity2.start_pos)
            max_distance = self.config.get('semantic', {}).get('relationship_extraction', {}).get('max_distance', 100)
            
            if distance <= max_distance:
                # Calculate co-occurrence strength
                strength = self._calculate_cooccurrence_strength(entity1, entity2, text)
                
                if strength > 0.5:  # Threshold for co-occurrence relationships
                    relationships.append(ExtractedRelationship(
                        source_entity=entity1.text.lower(),
                        target_entity=entity2.text.lower(),
                        relationship_type=RelationshipType.RELATES_TO,
                        confidence=strength,
                        properties={'cooccurrence_distance': distance},
                        extraction_method='cooccurrence_analysis'
                    ))
        
        return relationships
    
    def _extract_similarity_relationships(self, entities: List[ExtractedEntity], text: str) -> List[ExtractedRelationship]:
        """Extract relationships based on semantic similarity"""
        relationships = []
        
        if not self.nlp or not self.nlp.vocab.vectors_length:
            return relationships
        
        # Calculate similarity between entity texts
        entity_pairs = list(combinations(entities, 2))
        
        for entity1, entity2 in entity_pairs:
            doc1 = self.nlp(entity1.text)
            doc2 = self.nlp(entity2.text)
            
            similarity = doc1.similarity(doc2)
            
            if similarity > 0.7:  # High similarity threshold
                relationships.append(ExtractedRelationship(
                    source_entity=entity1.text.lower(),
                    target_entity=entity2.text.lower(),
                    relationship_type=RelationshipType.SIMILAR_TO,
                    confidence=similarity,
                    properties={'similarity_score': similarity},
                    extraction_method='semantic_similarity'
                ))
        
        return relationships
    
    def _extract_function_calls(self, functions: List[CodeEntity], code: str) -> List[ExtractedRelationship]:
        """Extract function call relationships"""
        relationships = []
        function_names = {f.name: f for f in functions}
        
        # Pattern for function calls
        call_pattern = re.compile(r'(\w+)\s*\(')
        
        for func in functions:
            # Find function definition in code
            func_start = self._find_function_in_code(func, code)
            if func_start == -1:
                continue
            
            # Get function body (simplified)
            func_end = self._find_function_end(func_start, code)
            func_body = code[func_start:func_end]
            
            # Find function calls within this function
            for match in call_pattern.finditer(func_body):
                called_func = match.group(1)
                
                if called_func in function_names and called_func != func.name:
                    relationships.append(ExtractedRelationship(
                        source_entity=func.name.lower(),
                        target_entity=called_func.lower(),
                        relationship_type=RelationshipType.CALLS,
                        confidence=0.9,
                        properties={'call_location': func_start + match.start()},
                        extraction_method='code_analysis'
                    ))
        
        return relationships
    
    def _extract_inheritance_relationships(self, classes: List[CodeEntity], code: str) -> List[ExtractedRelationship]:
        """Extract class inheritance relationships"""
        relationships = []
        class_names = {c.name: c for c in classes}
        
        # Pattern for class inheritance
        inheritance_pattern = re.compile(r'class\s+(\w+)\s*\(([^)]+)\)')
        
        for match in inheritance_pattern.finditer(code):
            child_class = match.group(1)
            parent_classes = [p.strip() for p in match.group(2).split(',')]
            
            if child_class in class_names:
                for parent_class in parent_classes:
                    if parent_class in class_names:
                        relationships.append(ExtractedRelationship(
                            source_entity=child_class.lower(),
                            target_entity=parent_class.lower(),
                            relationship_type=RelationshipType.INHERITS_FROM,
                            confidence=0.95,
                            extraction_method='code_analysis'
                        ))
        
        return relationships
    
    def _extract_import_relationships(self, imports: List[CodeEntity], all_entities: List[CodeEntity]) -> List[ExtractedRelationship]:
        """Extract import relationships"""
        relationships = []
        
        # Create mapping of all entities
        entity_names = {e.name: e for e in all_entities}
        
        for import_entity in imports:
            # Check if imported module contains any of our entities
            for entity in all_entities:
                if (entity.entity_type in ['function', 'class'] and 
                    entity.file_path and import_entity.name in entity.file_path):
                    
                    relationships.append(ExtractedRelationship(
                        source_entity=entity.name.lower(),
                        target_entity=import_entity.name.lower(),
                        relationship_type=RelationshipType.DEPENDS_ON,
                        confidence=0.8,
                        properties={'dependency_type': 'import'},
                        extraction_method='code_analysis'
                    ))
        
        return relationships
    
    def _extract_containment_relationships(self, code_entities: List[CodeEntity], code: str) -> List[ExtractedRelationship]:
        """Extract containment relationships (e.g., methods within classes)"""
        relationships = []
        
        classes = [e for e in code_entities if e.entity_type == 'class']
        functions = [e for e in code_entities if e.entity_type == 'function']
        
        for cls in classes:
            for func in functions:
                # Check if function is defined within class line range
                if (cls.line_start < func.line_start < cls.line_end and
                    cls.file_path == func.file_path):
                    
                    relationships.append(ExtractedRelationship(
                        source_entity=cls.name.lower(),
                        target_entity=func.name.lower(),
                        relationship_type=RelationshipType.CONTAINS,
                        confidence=0.95,
                        properties={'containment_type': 'method'},
                        extraction_method='code_analysis'
                    ))
        
        return relationships
    
    def _satisfies_entity_requirements(self, source: ExtractedEntity, target: ExtractedEntity, requirements: List[str]) -> bool:
        """Check if entities satisfy pattern requirements"""
        if not requirements:
            return True
        
        return (source.entity_type in requirements or 
                target.entity_type in requirements)
    
    def _find_entity_for_token(self, token, sent_entities: List[Tuple], sent) -> Optional[ExtractedEntity]:
        """Find entity that corresponds to a spaCy token"""
        token_start = sent.start_char + token.idx
        token_end = token_start + len(token.text)
        
        for entity, (start, end) in sent_entities:
            if start <= token_start < end:
                return entity
        
        return None
    
    def _infer_relationship_from_dependency(self, dep_label: str, head_lemma: str) -> Optional[RelationshipType]:
        """Infer relationship type from dependency label and head word"""
        # Map dependency labels to relationship types
        dep_map = {
            'nsubj': RelationshipType.RELATES_TO,  # Subject relationship
            'dobj': RelationshipType.RELATES_TO,   # Direct object
            'pobj': RelationshipType.RELATES_TO,   # Object of preposition
        }
        
        # Verb-specific mappings
        verb_map = {
            'use': RelationshipType.USES,
            'call': RelationshipType.CALLS,
            'contain': RelationshipType.CONTAINS,
            'depend': RelationshipType.DEPENDS_ON,
            'inherit': RelationshipType.INHERITS_FROM,
        }
        
        # Check verb-specific mapping first
        if head_lemma in verb_map:
            return verb_map[head_lemma]
        
        return dep_map.get(dep_label)
    
    def _calculate_cooccurrence_strength(self, entity1: ExtractedEntity, entity2: ExtractedEntity, text: str) -> float:
        """Calculate co-occurrence strength between entities"""
        # Base strength from proximity
        distance = abs(entity1.start_pos - entity2.start_pos)
        max_distance = 200  # Maximum distance to consider
        
        if distance > max_distance:
            return 0.0
        
        proximity_score = 1.0 - (distance / max_distance)
        
        # Boost for similar entity types
        type_bonus = 0.1 if entity1.entity_type == entity2.entity_type else 0.0
        
        # Boost for high-confidence entities
        confidence_bonus = (entity1.confidence + entity2.confidence) / 2 * 0.1
        
        return min(proximity_score + type_bonus + confidence_bonus, 1.0)
    
    def _find_function_in_code(self, func: CodeEntity, code: str) -> int:
        """Find function definition position in code"""
        lines = code.split('\n')
        if func.line_start <= len(lines):
            return sum(len(line) + 1 for line in lines[:func.line_start - 1])
        return -1
    
    def _find_function_end(self, func_start: int, code: str) -> int:
        """Find end of function definition (simplified)"""
        # Simple heuristic: find next function or class definition or end of file
        remaining_code = code[func_start:]
        next_def = re.search(r'\n(?:def|class)\s+', remaining_code)
        
        if next_def:
            return func_start + next_def.start()
        else:
            return len(code)
    
    def _filter_relationships(self, relationships: List[ExtractedRelationship]) -> List[ExtractedRelationship]:
        """Filter relationships by confidence and remove duplicates"""
        confidence_threshold = self.config.get('semantic', {}).get('relationship_extraction', {}).get('confidence_threshold', 0.6)
        
        # Filter by confidence
        filtered = [r for r in relationships if r.confidence >= confidence_threshold]
        
        # Remove duplicates (same source, target, and type)
        seen = set()
        deduplicated = []
        
        for rel in filtered:
            key = (rel.source_entity, rel.target_entity, rel.relationship_type)
            if key not in seen:
                seen.add(key)
                deduplicated.append(rel)
            else:
                # If duplicate, keep the one with higher confidence
                existing_rel = next(r for r in deduplicated if 
                                  (r.source_entity, r.target_entity, r.relationship_type) == key)
                if rel.confidence > existing_rel.confidence:
                    deduplicated.remove(existing_rel)
                    deduplicated.append(rel)
        
        return deduplicated
    
    def build_relationship_graph(self, relationships: List[ExtractedRelationship]) -> nx.MultiDiGraph:
        """Build a NetworkX graph from relationships"""
        graph = nx.MultiDiGraph()
        
        for rel in relationships:
            graph.add_edge(
                rel.source_entity,
                rel.target_entity,
                relationship_type=rel.relationship_type.value,
                confidence=rel.confidence,
                properties=rel.properties,
                evidence=rel.evidence,
                extraction_method=rel.extraction_method
            )
        
        return graph
    
    def analyze_relationship_patterns(self, relationships: List[ExtractedRelationship]) -> Dict[str, Any]:
        """Analyze patterns in extracted relationships"""
        analysis = {
            'total_relationships': len(relationships),
            'by_type': Counter(r.relationship_type.value for r in relationships),
            'by_method': Counter(r.extraction_method for r in relationships),
            'avg_confidence': sum(r.confidence for r in relationships) / len(relationships) if relationships else 0,
            'confidence_distribution': self._analyze_confidence_distribution(relationships)
        }
        
        return analysis
    
    def _analyze_confidence_distribution(self, relationships: List[ExtractedRelationship]) -> Dict[str, int]:
        """Analyze confidence score distribution"""
        if not relationships:
            return {}
        
        confidences = [r.confidence for r in relationships]
        
        return {
            'very_high': sum(1 for c in confidences if c >= 0.9),
            'high': sum(1 for c in confidences if 0.7 <= c < 0.9),
            'medium': sum(1 for c in confidences if 0.5 <= c < 0.7),
            'low': sum(1 for c in confidences if c < 0.5),
        }