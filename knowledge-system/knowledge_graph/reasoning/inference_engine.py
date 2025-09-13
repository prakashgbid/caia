"""
Inference Engine - Graph-based reasoning and inference
Phase 4 - Advanced Knowledge Graph System
"""

import logging
import networkx as nx
from typing import Dict, List, Set, Optional, Tuple, Any, Union
from dataclasses import dataclass
from collections import defaultdict, deque
import yaml
import itertools
from enum import Enum

from ..core.graph_manager import GraphManager, get_graph_manager
from ..core.graph_schema import RelationshipType, NodeType

logger = logging.getLogger(__name__)

class InferenceType(Enum):
    """Types of inference supported"""
    TRANSITIVE = "transitive"
    ANALOGICAL = "analogical"
    TAXONOMIC = "taxonomic"
    COMPOSITIONAL = "compositional"
    CAUSAL = "causal"
    SIMILARITY = "similarity"

@dataclass
class Inference:
    """Represents an inference result"""
    source_node: str
    target_node: str
    relationship_type: RelationshipType
    confidence: float
    inference_type: InferenceType
    reasoning_chain: List[str]
    evidence: List[Dict[str, Any]]
    metadata: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}

@dataclass
class ReasoningRule:
    """Represents a reasoning rule"""
    name: str
    antecedent_patterns: List[Tuple[str, RelationshipType, str]]  # (source_type, rel_type, target_type)
    consequent_pattern: Tuple[str, RelationshipType, str]
    confidence: float = 0.8
    conditions: List[str] = None
    
    def __post_init__(self):
        if self.conditions is None:
            self.conditions = []

class InferenceEngine:
    """
    Advanced reasoning engine for knowledge graph inference
    
    Performs various types of logical inference to derive new knowledge
    from existing relationships and patterns in the graph.
    """
    
    def __init__(self, config_path: str = "graph_config.yaml"):
        """Initialize the inference engine"""
        self.config = self._load_config(config_path)
        self.graph_manager = get_graph_manager()
        
        # Initialize reasoning rules
        self.reasoning_rules = self._init_reasoning_rules()
        
        # Cache for expensive computations
        self._path_cache = {}
        self._similarity_cache = {}
        
        # Inference parameters
        self.max_inference_depth = self.config.get('reasoning', {}).get('inference', {}).get('max_depth', 5)
        self.confidence_threshold = self.config.get('reasoning', {}).get('inference', {}).get('confidence_threshold', 0.5)
        
        logger.info("Inference engine initialized successfully")
    
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
            'reasoning': {
                'inference': {
                    'max_depth': 5,
                    'confidence_threshold': 0.5,
                    'methods': ['transitive_closure', 'pattern_completion', 'analogical_reasoning']
                }
            }
        }
    
    def _init_reasoning_rules(self) -> List[ReasoningRule]:
        """Initialize reasoning rules for inference"""
        rules = [
            # Transitivity rules
            ReasoningRule(
                name="is_a_transitivity",
                antecedent_patterns=[
                    ("A", RelationshipType.IS_A, "B"),
                    ("B", RelationshipType.IS_A, "C")
                ],
                consequent_pattern=("A", RelationshipType.IS_A, "C"),
                confidence=0.9
            ),
            
            ReasoningRule(
                name="part_of_transitivity", 
                antecedent_patterns=[
                    ("A", RelationshipType.PART_OF, "B"),
                    ("B", RelationshipType.PART_OF, "C")
                ],
                consequent_pattern=("A", RelationshipType.PART_OF, "C"),
                confidence=0.8
            ),
            
            ReasoningRule(
                name="depends_on_transitivity",
                antecedent_patterns=[
                    ("A", RelationshipType.DEPENDS_ON, "B"),
                    ("B", RelationshipType.DEPENDS_ON, "C")
                ],
                consequent_pattern=("A", RelationshipType.DEPENDS_ON, "C"),
                confidence=0.7
            ),
            
            # Inheritance rules
            ReasoningRule(
                name="inheritance_properties",
                antecedent_patterns=[
                    ("A", RelationshipType.IS_A, "B"),
                    ("B", RelationshipType.RELATES_TO, "C")
                ],
                consequent_pattern=("A", RelationshipType.RELATES_TO, "C"),
                confidence=0.6
            ),
            
            # Compositional rules
            ReasoningRule(
                name="part_whole_composition",
                antecedent_patterns=[
                    ("A", RelationshipType.PART_OF, "B"),
                    ("C", RelationshipType.PART_OF, "B")
                ],
                consequent_pattern=("A", RelationshipType.RELATES_TO, "C"),
                confidence=0.5
            ),
            
            # Usage and dependency rules
            ReasoningRule(
                name="usage_dependency",
                antecedent_patterns=[
                    ("A", RelationshipType.USES, "B"),
                    ("B", RelationshipType.DEPENDS_ON, "C")
                ],
                consequent_pattern=("A", RelationshipType.DEPENDS_ON, "C"),
                confidence=0.6
            ),
            
            # Code-specific rules
            ReasoningRule(
                name="call_chain",
                antecedent_patterns=[
                    ("A", RelationshipType.CALLS, "B"),
                    ("B", RelationshipType.CALLS, "C")
                ],
                consequent_pattern=("A", RelationshipType.DEPENDS_ON, "C"),
                confidence=0.7
            ),
            
            # Similarity propagation
            ReasoningRule(
                name="similarity_transitivity",
                antecedent_patterns=[
                    ("A", RelationshipType.SIMILAR_TO, "B"),
                    ("B", RelationshipType.SIMILAR_TO, "C")
                ],
                consequent_pattern=("A", RelationshipType.SIMILAR_TO, "C"),
                confidence=0.4  # Lower confidence for similarity chains
            )
        ]
        
        return rules
    
    def infer_new_relationships(self, max_inferences: int = 100) -> List[Inference]:
        """
        Infer new relationships using various reasoning methods
        
        Args:
            max_inferences: Maximum number of inferences to generate
            
        Returns:
            List of inferred relationships
        """
        inferences = []
        
        try:
            # Method 1: Rule-based inference
            rule_inferences = self._apply_reasoning_rules(max_inferences // 3)
            inferences.extend(rule_inferences)
            
            # Method 2: Pattern-based inference
            pattern_inferences = self._infer_from_patterns(max_inferences // 3)
            inferences.extend(pattern_inferences)
            
            # Method 3: Similarity-based inference
            similarity_inferences = self._infer_from_similarity(max_inferences // 3)
            inferences.extend(similarity_inferences)
            
            # Filter and rank inferences
            inferences = self._filter_and_rank_inferences(inferences)
            
            logger.info(f"Generated {len(inferences)} new inferences")
            
        except Exception as e:
            logger.error(f"Error during inference: {e}")
        
        return inferences[:max_inferences]
    
    def _apply_reasoning_rules(self, max_inferences: int) -> List[Inference]:
        """Apply reasoning rules to generate inferences"""
        inferences = []
        
        for rule in self.reasoning_rules:
            try:
                rule_inferences = self._apply_single_rule(rule, max_inferences - len(inferences))
                inferences.extend(rule_inferences)
                
                if len(inferences) >= max_inferences:
                    break
                    
            except Exception as e:
                logger.error(f"Error applying rule {rule.name}: {e}")
                continue
        
        return inferences
    
    def _apply_single_rule(self, rule: ReasoningRule, max_results: int) -> List[Inference]:
        """Apply a single reasoning rule"""
        inferences = []
        
        # Get all possible instantiations of the rule
        instantiations = self._find_rule_instantiations(rule)
        
        for instantiation in instantiations[:max_results]:
            try:
                # Check if the consequent already exists
                if not self._relationship_exists(instantiation['consequent']):
                    # Create inference
                    inference = Inference(
                        source_node=instantiation['consequent']['source'],
                        target_node=instantiation['consequent']['target'],
                        relationship_type=instantiation['consequent']['type'],
                        confidence=rule.confidence * instantiation['confidence'],
                        inference_type=self._get_rule_inference_type(rule),
                        reasoning_chain=instantiation['chain'],
                        evidence=instantiation['evidence'],
                        metadata={
                            'rule_name': rule.name,
                            'instantiation_id': instantiation.get('id')
                        }
                    )
                    
                    inferences.append(inference)
                    
            except Exception as e:
                logger.error(f"Error creating inference from rule {rule.name}: {e}")
                continue
        
        return inferences
    
    def _find_rule_instantiations(self, rule: ReasoningRule) -> List[Dict[str, Any]]:
        """Find all possible instantiations of a reasoning rule"""
        instantiations = []
        
        try:
            # For each antecedent pattern, find matching relationships
            pattern_matches = []
            
            for i, pattern in enumerate(rule.antecedent_patterns):
                source_var, rel_type, target_var = pattern
                
                # Find relationships of this type
                relationships = self._find_relationships_of_type(rel_type)
                pattern_matches.append(relationships)
            
            # Find combinations where variables are consistently bound
            for combination in itertools.product(*pattern_matches):
                binding = self._try_bind_variables(rule.antecedent_patterns, combination)
                
                if binding:
                    # Create consequent with variable bindings
                    consequent_pattern = rule.consequent_pattern
                    consequent = {
                        'source': binding.get(consequent_pattern[0]),
                        'target': binding.get(consequent_pattern[2]),
                        'type': consequent_pattern[1]
                    }
                    
                    if consequent['source'] and consequent['target']:
                        # Calculate confidence based on evidence strength
                        confidence = self._calculate_rule_confidence(combination, rule)
                        
                        instantiation = {
                            'consequent': consequent,
                            'confidence': confidence,
                            'chain': [f"{r['source']} {r['type'].value} {r['target']}" for r in combination],
                            'evidence': combination,
                            'id': f"{rule.name}_{len(instantiations)}"
                        }
                        
                        instantiations.append(instantiation)
                        
        except Exception as e:
            logger.error(f"Error finding instantiations for rule {rule.name}: {e}")
        
        return instantiations
    
    def _find_relationships_of_type(self, rel_type: RelationshipType) -> List[Dict[str, Any]]:
        """Find all relationships of a specific type"""
        try:
            query = """
            MATCH (source)-[r]->(target)
            WHERE type(r) = $rel_type
            RETURN source, target, r, ID(source) as source_id, ID(target) as target_id
            LIMIT 1000
            """
            
            results = self.graph_manager.execute_query(query, {'rel_type': rel_type.value})
            
            relationships = []
            for record in results:
                relationships.append({
                    'source': str(record['source_id']),
                    'target': str(record['target_id']),
                    'type': rel_type,
                    'properties': dict(record['r']),
                    'source_data': dict(record['source']),
                    'target_data': dict(record['target'])
                })
            
            return relationships
            
        except Exception as e:
            logger.error(f"Error finding relationships of type {rel_type}: {e}")
            return []
    
    def _try_bind_variables(self, patterns: List[Tuple], relationships: List[Dict]) -> Optional[Dict[str, str]]:
        """Try to bind variables consistently across patterns"""
        binding = {}
        
        for i, (pattern, relationship) in enumerate(zip(patterns, relationships)):
            source_var, rel_type, target_var = pattern
            
            # Try to bind source variable
            if source_var in binding:
                if binding[source_var] != relationship['source']:
                    return None  # Inconsistent binding
            else:
                binding[source_var] = relationship['source']
            
            # Try to bind target variable
            if target_var in binding:
                if binding[target_var] != relationship['target']:
                    return None  # Inconsistent binding
            else:
                binding[target_var] = relationship['target']
        
        return binding
    
    def _calculate_rule_confidence(self, evidence: List[Dict], rule: ReasoningRule) -> float:
        """Calculate confidence for a rule application"""
        base_confidence = rule.confidence
        
        # Factor in evidence strength
        evidence_strengths = []
        for rel in evidence:
            strength = rel['properties'].get('confidence', 0.8)
            evidence_strengths.append(strength)
        
        # Average evidence strength
        avg_evidence = sum(evidence_strengths) / len(evidence_strengths) if evidence_strengths else 0.5
        
        # Combined confidence (geometric mean)
        combined = (base_confidence * avg_evidence) ** 0.5
        
        return min(combined, 1.0)
    
    def _get_rule_inference_type(self, rule: ReasoningRule) -> InferenceType:
        """Get inference type for a rule"""
        type_map = {
            'transitivity': InferenceType.TRANSITIVE,
            'inheritance': InferenceType.TAXONOMIC,
            'composition': InferenceType.COMPOSITIONAL,
            'similarity': InferenceType.SIMILARITY
        }
        
        for keyword, inf_type in type_map.items():
            if keyword in rule.name.lower():
                return inf_type
        
        return InferenceType.TRANSITIVE  # Default
    
    def _infer_from_patterns(self, max_inferences: int) -> List[Inference]:
        """Infer relationships from graph patterns"""
        inferences = []
        
        try:
            # Find common patterns in the graph
            patterns = self._discover_graph_patterns()
            
            for pattern in patterns[:max_inferences]:
                # Try to apply pattern to generate new relationships
                pattern_inferences = self._apply_graph_pattern(pattern)
                inferences.extend(pattern_inferences)
                
                if len(inferences) >= max_inferences:
                    break
                    
        except Exception as e:
            logger.error(f"Error in pattern-based inference: {e}")
        
        return inferences[:max_inferences]
    
    def _discover_graph_patterns(self) -> List[Dict[str, Any]]:
        """Discover common patterns in the graph structure"""
        patterns = []
        
        try:
            # Find triangular patterns (A->B, B->C, missing A->C)
            query = """
            MATCH (a)-[r1]->(b)-[r2]->(c)
            WHERE NOT (a)-[]->(c)
            AND ID(a) < ID(c)
            RETURN a, b, c, type(r1) as rel1, type(r2) as rel2, count(*) as frequency
            ORDER BY frequency DESC
            LIMIT 50
            """
            
            results = self.graph_manager.execute_query(query)
            
            for record in results:
                if record['frequency'] > 1:  # Only consider frequent patterns
                    patterns.append({
                        'type': 'triangle',
                        'nodes': [record['a'], record['b'], record['c']],
                        'relationships': [record['rel1'], record['rel2']],
                        'frequency': record['frequency']
                    })
                    
        except Exception as e:
            logger.error(f"Error discovering patterns: {e}")
        
        return patterns
    
    def _apply_graph_pattern(self, pattern: Dict[str, Any]) -> List[Inference]:
        """Apply a discovered pattern to generate inferences"""
        inferences = []
        
        if pattern['type'] == 'triangle':
            # For triangular patterns, infer the missing edge
            nodes = pattern['nodes']
            rels = pattern['relationships']
            
            # Determine relationship type for missing edge
            inferred_rel_type = self._infer_relationship_type_from_pattern(rels)
            
            if inferred_rel_type:
                confidence = min(0.6, pattern['frequency'] / 10.0)  # Frequency-based confidence
                
                inference = Inference(
                    source_node=str(nodes[0]['id']),
                    target_node=str(nodes[2]['id']),
                    relationship_type=inferred_rel_type,
                    confidence=confidence,
                    inference_type=InferenceType.TRANSITIVE,
                    reasoning_chain=[
                        f"Pattern: {rels[0]} -> {rels[1]}",
                        f"Frequency: {pattern['frequency']}"
                    ],
                    evidence=[pattern]
                )
                
                inferences.append(inference)
        
        return inferences
    
    def _infer_relationship_type_from_pattern(self, relationship_types: List[str]) -> Optional[RelationshipType]:
        """Infer relationship type for missing edge in pattern"""
        # Simple heuristics for common patterns
        if relationship_types[0] == relationship_types[1]:
            # Same relationship type - likely transitive
            try:
                return RelationshipType(relationship_types[0])
            except ValueError:
                return RelationshipType.RELATES_TO
        
        # Different types - use general relationship
        return RelationshipType.RELATES_TO
    
    def _infer_from_similarity(self, max_inferences: int) -> List[Inference]:
        """Infer relationships based on node similarity"""
        inferences = []
        
        try:
            # Find similar nodes
            similar_pairs = self._find_similar_nodes(max_pairs=max_inferences * 2)
            
            for pair in similar_pairs[:max_inferences]:
                # Infer similarity relationship
                inference = Inference(
                    source_node=pair['node1'],
                    target_node=pair['node2'],
                    relationship_type=RelationshipType.SIMILAR_TO,
                    confidence=pair['similarity'],
                    inference_type=InferenceType.SIMILARITY,
                    reasoning_chain=[f"Similarity score: {pair['similarity']:.3f}"],
                    evidence=[{'similarity_method': pair['method'], 'features': pair.get('features', [])}]
                )
                
                inferences.append(inference)
                
        except Exception as e:
            logger.error(f"Error in similarity-based inference: {e}")
        
        return inferences
    
    def _find_similar_nodes(self, max_pairs: int = 100) -> List[Dict[str, Any]]:
        """Find pairs of similar nodes"""
        similar_pairs = []
        
        try:
            # Use structural similarity (common neighbors)
            query = """
            MATCH (a)-[]->(common)<-[]-(b)
            WHERE ID(a) < ID(b)
            WITH a, b, count(common) as common_neighbors
            WHERE common_neighbors > 1
            RETURN a, b, common_neighbors
            ORDER BY common_neighbors DESC
            LIMIT $max_pairs
            """
            
            results = self.graph_manager.execute_query(query, {'max_pairs': max_pairs})
            
            for record in results:
                # Calculate similarity based on common neighbors
                similarity = min(0.9, record['common_neighbors'] / 10.0)
                
                similar_pairs.append({
                    'node1': str(record['a']['id']) if 'id' in record['a'] else str(hash(str(record['a']))),
                    'node2': str(record['b']['id']) if 'id' in record['b'] else str(hash(str(record['b']))),
                    'similarity': similarity,
                    'method': 'structural_similarity',
                    'features': [f"common_neighbors: {record['common_neighbors']}"]
                })
                
        except Exception as e:
            logger.error(f"Error finding similar nodes: {e}")
        
        return similar_pairs
    
    def _relationship_exists(self, relationship: Dict[str, Any]) -> bool:
        """Check if a relationship already exists"""
        try:
            query = """
            MATCH (source)-[r]->(target)
            WHERE ID(source) = $source_id AND ID(target) = $target_id
            AND type(r) = $rel_type
            RETURN count(r) as count
            """
            
            result = self.graph_manager.execute_query(query, {
                'source_id': int(relationship['source']),
                'target_id': int(relationship['target']),
                'rel_type': relationship['type'].value
            })
            
            return result[0]['count'] > 0 if result else False
            
        except Exception as e:
            logger.error(f"Error checking relationship existence: {e}")
            return False
    
    def _filter_and_rank_inferences(self, inferences: List[Inference]) -> List[Inference]:
        """Filter and rank inferences by confidence and relevance"""
        # Filter by confidence threshold
        filtered = [inf for inf in inferences if inf.confidence >= self.confidence_threshold]
        
        # Remove duplicates
        seen = set()
        deduplicated = []
        
        for inf in filtered:
            key = (inf.source_node, inf.target_node, inf.relationship_type)
            if key not in seen:
                seen.add(key)
                deduplicated.append(inf)
        
        # Sort by confidence (descending)
        deduplicated.sort(key=lambda x: x.confidence, reverse=True)
        
        return deduplicated
    
    def find_inference_paths(self, source_node: str, target_node: str, 
                           max_depth: int = None) -> List[List[Dict[str, Any]]]:
        """
        Find inference paths between two nodes
        
        Args:
            source_node: Source node ID
            target_node: Target node ID  
            max_depth: Maximum path length
            
        Returns:
            List of paths (each path is list of relationships)
        """
        if max_depth is None:
            max_depth = self.max_inference_depth
        
        paths = []
        
        try:
            # Use Neo4j's path finding
            query = """
            MATCH path = (source)-[*1..$max_depth]->(target)
            WHERE ID(source) = $source_id AND ID(target) = $target_id
            RETURN [r in relationships(path) | {
                type: type(r),
                properties: properties(r),
                start_node: ID(startNode(r)),
                end_node: ID(endNode(r))
            }] as path_relationships
            ORDER BY length(path)
            LIMIT 10
            """
            
            results = self.graph_manager.execute_query(query, {
                'source_id': int(source_node),
                'target_id': int(target_node),
                'max_depth': max_depth
            })
            
            for record in results:
                paths.append(record['path_relationships'])
                
        except Exception as e:
            logger.error(f"Error finding inference paths: {e}")
        
        return paths
    
    def explain_inference(self, inference: Inference) -> Dict[str, Any]:
        """
        Generate explanation for an inference
        
        Args:
            inference: Inference to explain
            
        Returns:
            Dictionary containing explanation details
        """
        explanation = {
            'inference': {
                'source': inference.source_node,
                'target': inference.target_node,
                'relationship': inference.relationship_type.value,
                'confidence': inference.confidence
            },
            'reasoning_type': inference.inference_type.value,
            'reasoning_chain': inference.reasoning_chain,
            'evidence': inference.evidence,
            'explanation_text': self._generate_explanation_text(inference)
        }
        
        return explanation
    
    def _generate_explanation_text(self, inference: Inference) -> str:
        """Generate human-readable explanation text"""
        source = inference.source_node
        target = inference.target_node
        rel_type = inference.relationship_type.value
        confidence = inference.confidence
        
        base_text = f"Inferred that {source} {rel_type.lower()} {target} (confidence: {confidence:.2f})"
        
        reasoning_text = ""
        if inference.inference_type == InferenceType.TRANSITIVE:
            reasoning_text = f" based on transitive reasoning through: {' -> '.join(inference.reasoning_chain)}"
        elif inference.inference_type == InferenceType.SIMILARITY:
            reasoning_text = f" based on similarity analysis: {inference.reasoning_chain[0] if inference.reasoning_chain else ''}"
        elif inference.inference_type == InferenceType.ANALOGICAL:
            reasoning_text = f" based on analogical reasoning from similar patterns"
        
        return base_text + reasoning_text
    
    def batch_infer_for_nodes(self, node_ids: List[str], inference_types: List[InferenceType] = None) -> Dict[str, List[Inference]]:
        """
        Perform batch inference for multiple nodes
        
        Args:
            node_ids: List of node IDs to infer for
            inference_types: Types of inference to perform
            
        Returns:
            Dictionary mapping node IDs to their inferences
        """
        if inference_types is None:
            inference_types = [InferenceType.TRANSITIVE, InferenceType.SIMILARITY]
        
        results = {}
        
        for node_id in node_ids:
            try:
                node_inferences = []
                
                for inf_type in inference_types:
                    if inf_type == InferenceType.TRANSITIVE:
                        inferences = self._infer_transitive_for_node(node_id)
                    elif inf_type == InferenceType.SIMILARITY:
                        inferences = self._infer_similarity_for_node(node_id)
                    else:
                        continue
                    
                    node_inferences.extend(inferences)
                
                results[node_id] = self._filter_and_rank_inferences(node_inferences)
                
            except Exception as e:
                logger.error(f"Error inferring for node {node_id}: {e}")
                results[node_id] = []
        
        return results
    
    def _infer_transitive_for_node(self, node_id: str) -> List[Inference]:
        """Perform transitive inference for a specific node"""
        inferences = []
        
        try:
            # Find 2-hop paths from this node
            query = """
            MATCH (start)-[r1]->(middle)-[r2]->(end)
            WHERE ID(start) = $node_id
            AND NOT (start)-[]->(end)
            AND type(r1) = type(r2)
            RETURN middle, end, type(r1) as rel_type, r1.confidence as conf1, r2.confidence as conf2
            LIMIT 20
            """
            
            results = self.graph_manager.execute_query(query, {'node_id': int(node_id)})
            
            for record in results:
                # Calculate transitive confidence
                conf1 = record.get('conf1', 0.8)
                conf2 = record.get('conf2', 0.8)
                transitive_conf = (conf1 * conf2) ** 0.5  # Geometric mean
                
                if transitive_conf >= self.confidence_threshold:
                    try:
                        rel_type = RelationshipType(record['rel_type'])
                        
                        inference = Inference(
                            source_node=node_id,
                            target_node=str(record['end']['id']) if 'id' in record['end'] else str(hash(str(record['end']))),
                            relationship_type=rel_type,
                            confidence=transitive_conf,
                            inference_type=InferenceType.TRANSITIVE,
                            reasoning_chain=[
                                f"{node_id} -> {record['middle']['id'] if 'id' in record['middle'] else 'unknown'} -> {record['end']['id'] if 'id' in record['end'] else 'unknown'}"
                            ],
                            evidence=[record]
                        )
                        
                        inferences.append(inference)
                        
                    except ValueError:
                        continue  # Skip unknown relationship types
                        
        except Exception as e:
            logger.error(f"Error in transitive inference for node {node_id}: {e}")
        
        return inferences
    
    def _infer_similarity_for_node(self, node_id: str) -> List[Inference]:
        """Perform similarity inference for a specific node"""
        inferences = []
        
        try:
            # Find nodes with similar relationship patterns
            query = """
            MATCH (target)-[r]->(neighbor)
            WHERE ID(target) = $node_id
            WITH collect(type(r)) as target_rels
            
            MATCH (candidate)-[r2]->(neighbor2)
            WHERE ID(candidate) <> $node_id
            WITH candidate, collect(type(r2)) as candidate_rels, target_rels
            
            // Calculate Jaccard similarity of relationship types
            WITH candidate, 
                 size([rel in target_rels WHERE rel in candidate_rels]) as intersection,
                 size(target_rels + [rel in candidate_rels WHERE NOT rel in target_rels]) as union
            WHERE union > 0
            WITH candidate, toFloat(intersection) / toFloat(union) as similarity
            WHERE similarity > 0.5
            
            RETURN candidate, similarity
            ORDER BY similarity DESC
            LIMIT 10
            """
            
            results = self.graph_manager.execute_query(query, {'node_id': int(node_id)})
            
            for record in results:
                inference = Inference(
                    source_node=node_id,
                    target_node=str(record['candidate']['id']) if 'id' in record['candidate'] else str(hash(str(record['candidate']))),
                    relationship_type=RelationshipType.SIMILAR_TO,
                    confidence=record['similarity'],
                    inference_type=InferenceType.SIMILARITY,
                    reasoning_chain=[f"Relationship pattern similarity: {record['similarity']:.3f}"],
                    evidence=[record]
                )
                
                inferences.append(inference)
                
        except Exception as e:
            logger.error(f"Error in similarity inference for node {node_id}: {e}")
        
        return inferences