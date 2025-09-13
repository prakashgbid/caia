"""
Graph Manager - Core Neo4j Operations
Phase 4 - Advanced Knowledge Graph System
"""

import yaml
import json
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from neo4j import GraphDatabase, Result
from neo4j.exceptions import ServiceUnavailable, TransientError
import time
import threading
from contextlib import contextmanager

logger = logging.getLogger(__name__)

@dataclass
class GraphNode:
    """Represents a node in the knowledge graph"""
    id: Optional[str]
    labels: List[str]
    properties: Dict[str, Any]
    
    def to_dict(self) -> Dict:
        return {
            'id': self.id,
            'labels': self.labels,
            'properties': self.properties
        }

@dataclass
class GraphRelationship:
    """Represents a relationship in the knowledge graph"""
    id: Optional[str]
    type: str
    start_node: str
    end_node: str
    properties: Dict[str, Any]
    
    def to_dict(self) -> Dict:
        return {
            'id': self.id,
            'type': self.type,
            'start_node': self.start_node,
            'end_node': self.end_node,
            'properties': self.properties
        }

class GraphManager:
    """
    Core graph database manager for CAIA Knowledge Graph
    
    Handles all Neo4j operations, connection management, and provides
    high-level graph operations for the knowledge system.
    """
    
    def __init__(self, config_path: str = "graph_config.yaml"):
        """Initialize the graph manager"""
        self.config_path = config_path
        self.config = self._load_config()
        self.driver = None
        self._connection_lock = threading.Lock()
        self._retry_settings = {
            'max_retries': 3,
            'base_delay': 1,
            'max_delay': 10
        }
        
        self._connect()
        
    def _load_config(self) -> Dict:
        """Load configuration from YAML file"""
        try:
            with open(self.config_path, 'r') as f:
                return yaml.safe_load(f)
        except Exception as e:
            logger.error(f"Failed to load config from {self.config_path}: {e}")
            # Fallback configuration
            return {
                'neo4j': {
                    'uri': 'bolt://localhost:7687',
                    'user': 'neo4j',
                    'password': 'knowledge_graph',
                    'database': 'caia_knowledge'
                }
            }
    
    def _connect(self):
        """Establish connection to Neo4j database"""
        try:
            neo4j_config = self.config.get('neo4j', {})
            
            self.driver = GraphDatabase.driver(
                neo4j_config.get('uri', 'bolt://localhost:7687'),
                auth=(
                    neo4j_config.get('user', 'neo4j'),
                    neo4j_config.get('password', 'knowledge_graph')
                ),
                max_connection_lifetime=neo4j_config.get('max_connection_lifetime', 3600),
                max_connection_pool_size=neo4j_config.get('max_connection_pool_size', 50),
                connection_acquisition_timeout=neo4j_config.get('connection_acquisition_timeout', 60)
            )
            
            # Test connection
            self._verify_connection()
            logger.info("Successfully connected to Neo4j database")
            
        except Exception as e:
            logger.error(f"Failed to connect to Neo4j: {e}")
            raise
    
    def _verify_connection(self):
        """Verify database connection is working"""
        with self.get_session() as session:
            session.run("RETURN 1")
    
    @contextmanager
    def get_session(self):
        """Get a database session with automatic retry logic"""
        database = self.config.get('neo4j', {}).get('database', 'neo4j')
        
        for attempt in range(self._retry_settings['max_retries']):
            try:
                session = self.driver.session(database=database)
                yield session
                session.close()
                return
                
            except (ServiceUnavailable, TransientError) as e:
                if attempt == self._retry_settings['max_retries'] - 1:
                    logger.error(f"Failed to get session after {self._retry_settings['max_retries']} attempts: {e}")
                    raise
                
                delay = min(
                    self._retry_settings['base_delay'] * (2 ** attempt),
                    self._retry_settings['max_delay']
                )
                logger.warning(f"Session attempt {attempt + 1} failed, retrying in {delay}s: {e}")
                time.sleep(delay)
                
            except Exception as e:
                logger.error(f"Unexpected error getting session: {e}")
                raise
    
    def execute_query(self, query: str, parameters: Dict = None) -> List[Dict]:
        """
        Execute a Cypher query and return results
        
        Args:
            query: Cypher query string
            parameters: Query parameters
            
        Returns:
            List of result records as dictionaries
        """
        parameters = parameters or {}
        
        try:
            with self.get_session() as session:
                result = session.run(query, parameters)
                return [record.data() for record in result]
                
        except Exception as e:
            logger.error(f"Query execution failed: {e}")
            logger.error(f"Query: {query}")
            logger.error(f"Parameters: {parameters}")
            raise
    
    def execute_write_query(self, query: str, parameters: Dict = None) -> List[Dict]:
        """Execute a write query with transaction"""
        parameters = parameters or {}
        
        try:
            with self.get_session() as session:
                result = session.execute_write(lambda tx: tx.run(query, parameters))
                return [record.data() for record in result] if result else []
                
        except Exception as e:
            logger.error(f"Write query execution failed: {e}")
            logger.error(f"Query: {query}")
            logger.error(f"Parameters: {parameters}")
            raise
    
    def create_node(self, labels: List[str], properties: Dict) -> GraphNode:
        """
        Create a new node in the graph
        
        Args:
            labels: Node labels
            properties: Node properties
            
        Returns:
            Created GraphNode
        """
        # Add timestamp if not present
        if 'created_at' not in properties:
            properties['created_at'] = datetime.now().isoformat()
        
        # Build query
        labels_str = ':'.join(labels)
        query = f"""
        CREATE (n:{labels_str} $properties)
        RETURN n, ID(n) as node_id
        """
        
        result = self.execute_write_query(query, {'properties': properties})
        
        if result:
            record = result[0]
            return GraphNode(
                id=str(record['node_id']),
                labels=labels,
                properties=properties
            )
        
        raise Exception("Failed to create node")
    
    def create_relationship(self, start_node_id: str, end_node_id: str, 
                          relationship_type: str, properties: Dict = None) -> GraphRelationship:
        """
        Create a relationship between two nodes
        
        Args:
            start_node_id: ID of start node
            end_node_id: ID of end node
            relationship_type: Type of relationship
            properties: Relationship properties
            
        Returns:
            Created GraphRelationship
        """
        properties = properties or {}
        
        # Add timestamp if not present
        if 'created_at' not in properties:
            properties['created_at'] = datetime.now().isoformat()
        
        query = f"""
        MATCH (start), (end)
        WHERE ID(start) = $start_id AND ID(end) = $end_id
        CREATE (start)-[r:{relationship_type} $properties]->(end)
        RETURN r, ID(r) as rel_id, ID(start) as start_id, ID(end) as end_id
        """
        
        result = self.execute_write_query(query, {
            'start_id': int(start_node_id),
            'end_id': int(end_node_id),
            'properties': properties
        })
        
        if result:
            record = result[0]
            return GraphRelationship(
                id=str(record['rel_id']),
                type=relationship_type,
                start_node=start_node_id,
                end_node=end_node_id,
                properties=properties
            )
        
        raise Exception("Failed to create relationship")
    
    def find_nodes(self, labels: List[str] = None, properties: Dict = None, 
                   limit: int = None) -> List[GraphNode]:
        """
        Find nodes matching criteria
        
        Args:
            labels: Node labels to match
            properties: Properties to match
            limit: Maximum number of results
            
        Returns:
            List of matching GraphNodes
        """
        # Build query
        query_parts = []
        params = {}
        
        if labels:
            labels_str = ':'.join(labels)
            query_parts.append(f"(n:{labels_str})")
        else:
            query_parts.append("(n)")
        
        where_clauses = []
        if properties:
            for key, value in properties.items():
                param_name = f"prop_{key}"
                where_clauses.append(f"n.{key} = ${param_name}")
                params[param_name] = value
        
        query = f"MATCH {query_parts[0]}"
        if where_clauses:
            query += f" WHERE {' AND '.join(where_clauses)}"
        
        query += " RETURN n, ID(n) as node_id, labels(n) as node_labels"
        
        if limit:
            query += f" LIMIT {limit}"
        
        result = self.execute_query(query, params)
        
        nodes = []
        for record in result:
            node_data = dict(record['n'])
            nodes.append(GraphNode(
                id=str(record['node_id']),
                labels=record['node_labels'],
                properties=node_data
            ))
        
        return nodes
    
    def find_relationships(self, start_node_id: str = None, end_node_id: str = None,
                          relationship_type: str = None) -> List[GraphRelationship]:
        """Find relationships matching criteria"""
        query_parts = []
        params = {}
        
        if start_node_id:
            query_parts.append("WHERE ID(start) = $start_id")
            params['start_id'] = int(start_node_id)
        
        if end_node_id:
            connector = "AND" if query_parts else "WHERE"
            query_parts.append(f"{connector} ID(end) = $end_id")
            params['end_id'] = int(end_node_id)
        
        rel_pattern = f"[r:{relationship_type}]" if relationship_type else "[r]"
        
        query = f"""
        MATCH (start)-{rel_pattern}->(end)
        {' '.join(query_parts)}
        RETURN r, ID(r) as rel_id, ID(start) as start_id, ID(end) as end_id, type(r) as rel_type
        """
        
        result = self.execute_query(query, params)
        
        relationships = []
        for record in result:
            rel_data = dict(record['r'])
            relationships.append(GraphRelationship(
                id=str(record['rel_id']),
                type=record['rel_type'],
                start_node=str(record['start_id']),
                end_node=str(record['end_id']),
                properties=rel_data
            ))
        
        return relationships
    
    def update_node(self, node_id: str, properties: Dict) -> bool:
        """Update node properties"""
        # Add update timestamp
        properties['updated_at'] = datetime.now().isoformat()
        
        # Build SET clauses
        set_clauses = [f"n.{key} = $prop_{key}" for key in properties.keys()]
        params = {f"prop_{key}": value for key, value in properties.items()}
        params['node_id'] = int(node_id)
        
        query = f"""
        MATCH (n)
        WHERE ID(n) = $node_id
        SET {', '.join(set_clauses)}
        RETURN n
        """
        
        result = self.execute_write_query(query, params)
        return len(result) > 0
    
    def delete_node(self, node_id: str, force: bool = False) -> bool:
        """
        Delete a node from the graph
        
        Args:
            node_id: ID of node to delete
            force: If True, delete relationships too
            
        Returns:
            True if deleted successfully
        """
        if force:
            query = """
            MATCH (n)
            WHERE ID(n) = $node_id
            DETACH DELETE n
            """
        else:
            query = """
            MATCH (n)
            WHERE ID(n) = $node_id AND NOT (n)--()
            DELETE n
            """
        
        result = self.execute_write_query(query, {'node_id': int(node_id)})
        return True  # If no exception, deletion succeeded
    
    def get_node_neighbors(self, node_id: str, relationship_type: str = None,
                          direction: str = "both", limit: int = None) -> List[Tuple[GraphNode, GraphRelationship]]:
        """
        Get neighboring nodes and their relationships
        
        Args:
            node_id: ID of central node
            relationship_type: Filter by relationship type
            direction: "in", "out", or "both"
            limit: Maximum results
            
        Returns:
            List of (neighbor_node, relationship) tuples
        """
        # Build relationship pattern
        if relationship_type:
            rel_pattern = f":{relationship_type}"
        else:
            rel_pattern = ""
        
        if direction == "in":
            pattern = f"(neighbor)-[r{rel_pattern}]->(center)"
        elif direction == "out":
            pattern = f"(center)-[r{rel_pattern}]->(neighbor)"
        else:  # both
            pattern = f"(center)-[r{rel_pattern}]-(neighbor)"
        
        query = f"""
        MATCH {pattern}
        WHERE ID(center) = $node_id
        RETURN neighbor, ID(neighbor) as neighbor_id, labels(neighbor) as neighbor_labels,
               r, ID(r) as rel_id, type(r) as rel_type, ID(startNode(r)) as start_id, ID(endNode(r)) as end_id
        """
        
        if limit:
            query += f" LIMIT {limit}"
        
        result = self.execute_query(query, {'node_id': int(node_id)})
        
        neighbors = []
        for record in result:
            neighbor = GraphNode(
                id=str(record['neighbor_id']),
                labels=record['neighbor_labels'],
                properties=dict(record['neighbor'])
            )
            
            relationship = GraphRelationship(
                id=str(record['rel_id']),
                type=record['rel_type'],
                start_node=str(record['start_id']),
                end_node=str(record['end_id']),
                properties=dict(record['r'])
            )
            
            neighbors.append((neighbor, relationship))
        
        return neighbors
    
    def search_full_text(self, index_name: str, query: str, limit: int = 10) -> List[GraphNode]:
        """Search using full-text index"""
        cypher_query = f"""
        CALL db.index.fulltext.queryNodes('{index_name}', $query)
        YIELD node, score
        RETURN node, ID(node) as node_id, labels(node) as node_labels, score
        ORDER BY score DESC
        LIMIT $limit
        """
        
        result = self.execute_query(cypher_query, {'query': query, 'limit': limit})
        
        nodes = []
        for record in result:
            node = GraphNode(
                id=str(record['node_id']),
                labels=record['node_labels'],
                properties=dict(record['node'])
            )
            node.properties['_search_score'] = record['score']
            nodes.append(node)
        
        return nodes
    
    def get_graph_statistics(self) -> Dict:
        """Get graph statistics"""
        queries = {
            'total_nodes': "MATCH (n) RETURN count(n) as count",
            'total_relationships': "MATCH ()-[r]->() RETURN count(r) as count",
            'node_labels': "MATCH (n) RETURN labels(n) as labels, count(n) as count",
            'relationship_types': "MATCH ()-[r]->() RETURN type(r) as type, count(r) as count"
        }
        
        stats = {}
        
        for stat_name, query in queries.items():
            try:
                result = self.execute_query(query)
                if stat_name in ['total_nodes', 'total_relationships']:
                    stats[stat_name] = result[0]['count'] if result else 0
                else:
                    stats[stat_name] = result
            except Exception as e:
                logger.error(f"Failed to get {stat_name}: {e}")
                stats[stat_name] = None
        
        return stats
    
    def export_subgraph(self, node_ids: List[str], include_relationships: bool = True) -> Dict:
        """Export a subgraph containing specified nodes"""
        if not node_ids:
            return {'nodes': [], 'relationships': []}
        
        # Convert to integers for Neo4j
        int_node_ids = [int(nid) for nid in node_ids]
        
        # Get nodes
        nodes_query = """
        MATCH (n)
        WHERE ID(n) IN $node_ids
        RETURN n, ID(n) as node_id, labels(n) as node_labels
        """
        
        node_results = self.execute_query(nodes_query, {'node_ids': int_node_ids})
        nodes = []
        for record in node_results:
            nodes.append({
                'id': str(record['node_id']),
                'labels': record['node_labels'],
                'properties': dict(record['n'])
            })
        
        relationships = []
        if include_relationships:
            # Get relationships between these nodes
            rels_query = """
            MATCH (start)-[r]->(end)
            WHERE ID(start) IN $node_ids AND ID(end) IN $node_ids
            RETURN r, ID(r) as rel_id, type(r) as rel_type, 
                   ID(start) as start_id, ID(end) as end_id
            """
            
            rel_results = self.execute_query(rels_query, {'node_ids': int_node_ids})
            for record in rel_results:
                relationships.append({
                    'id': str(record['rel_id']),
                    'type': record['rel_type'],
                    'start_node': str(record['start_id']),
                    'end_node': str(record['end_id']),
                    'properties': dict(record['r'])
                })
        
        return {
            'nodes': nodes,
            'relationships': relationships,
            'metadata': {
                'exported_at': datetime.now().isoformat(),
                'node_count': len(nodes),
                'relationship_count': len(relationships)
            }
        }
    
    def close(self):
        """Close the database connection"""
        if self.driver:
            self.driver.close()
            logger.info("Neo4j driver closed")
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

# Singleton instance for global access
_graph_manager = None

def get_graph_manager() -> GraphManager:
    """Get the global graph manager instance"""
    global _graph_manager
    if _graph_manager is None:
        _graph_manager = GraphManager()
    return _graph_manager