"""
API Server - GraphQL API for Knowledge Graph Integration
Phase 4 - Advanced Knowledge Graph System
"""

import json
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_cors import CORS
import yaml
import traceback

# Import knowledge graph components
from ..core.graph_manager import get_graph_manager
from ..core.graph_schema import get_graph_schema, NodeType, RelationshipType
from ..semantic.entity_extractor import EntityExtractor
from ..semantic.relationship_builder import RelationshipBuilder
from ..reasoning.inference_engine import InferenceEngine
from ..visualization.graph_visualizer import GraphVisualizer

# Import integration components
from ...learning.learning_manager import get_learning_manager

logger = logging.getLogger(__name__)

class KnowledgeGraphAPI:
    """
    Complete API server for CAIA Knowledge Graph System
    
    Provides REST and GraphQL endpoints for all knowledge graph operations
    including entity extraction, relationship building, reasoning, and visualization.
    """
    
    def __init__(self, config_path: str = "graph_config.yaml"):
        """Initialize the API server"""
        self.app = Flask(__name__, 
                        template_folder='../../knowledge_explorer_ui/templates',
                        static_folder='../../knowledge_explorer_ui/static')
        CORS(self.app)
        
        # Load configuration
        self.config = self._load_config(config_path)
        
        # Initialize components
        self.graph_manager = get_graph_manager()
        self.schema = get_graph_schema()
        self.entity_extractor = EntityExtractor(config_path)
        self.relationship_builder = RelationshipBuilder(config_path)
        self.inference_engine = InferenceEngine(config_path)
        self.visualizer = GraphVisualizer(config_path)
        
        # Try to get learning manager if available
        try:
            self.learning_manager = get_learning_manager()
        except Exception as e:
            logger.warning(f"Learning manager not available: {e}")
            self.learning_manager = None
        
        # Setup routes
        self._setup_routes()
        
        logger.info("Knowledge Graph API server initialized successfully")
    
    def _load_config(self, config_path: str) -> Dict:
        """Load configuration"""
        try:
            with open(config_path, 'r') as f:
                return yaml.safe_load(f)
        except Exception as e:
            logger.warning(f"Could not load config from {config_path}: {e}")
            return {}
    
    def _setup_routes(self):
        """Setup all API routes"""
        
        # Web Interface Routes
        @self.app.route('/')
        def index():
            """Main knowledge explorer interface"""
            return render_template('explorer.html')
        
        @self.app.route('/health')
        def health():
            """Health check endpoint"""
            try:
                # Test graph connection
                stats = self.graph_manager.get_graph_statistics()
                return jsonify({
                    'status': 'healthy',
                    'timestamp': datetime.now().isoformat(),
                    'components': {
                        'graph_manager': 'ok',
                        'entity_extractor': 'ok',
                        'relationship_builder': 'ok',
                        'inference_engine': 'ok',
                        'visualizer': 'ok',
                        'learning_manager': 'ok' if self.learning_manager else 'unavailable'
                    },
                    'graph_stats': stats
                })
            except Exception as e:
                logger.error(f"Health check failed: {e}")
                return jsonify({
                    'status': 'unhealthy',
                    'error': str(e),
                    'timestamp': datetime.now().isoformat()
                }), 500
        
        # Graph Data Routes
        @self.app.route('/api/graph/stats')
        def get_graph_stats():
            """Get graph statistics"""
            try:
                stats = self.graph_manager.get_graph_statistics()
                return jsonify(stats)
            except Exception as e:
                logger.error(f"Error getting graph stats: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/graph/nodes')
        def get_nodes():
            """Get nodes with optional filtering"""
            try:
                # Parse query parameters
                node_types = request.args.getlist('types')
                limit = int(request.args.get('limit', 100))
                confidence_min = float(request.args.get('confidence_min', 0.0))
                
                # Build filters
                filters = {}
                if node_types:
                    filters['node_types'] = node_types
                if confidence_min > 0:
                    filters['confidence_min'] = confidence_min
                
                # Get nodes
                nodes = self.graph_manager.find_nodes(limit=limit)
                
                return jsonify({
                    'nodes': [node.to_dict() for node in nodes],
                    'count': len(nodes)
                })
            except Exception as e:
                logger.error(f"Error getting nodes: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/graph/relationships')
        def get_relationships():
            """Get relationships with optional filtering"""
            try:
                # Parse query parameters
                rel_types = request.args.getlist('types')
                limit = int(request.args.get('limit', 100))
                
                # Get relationships
                relationships = []
                if rel_types:
                    for rel_type in rel_types:
                        try:
                            rel_type_enum = RelationshipType(rel_type)
                            rels = self.graph_manager.find_relationships(
                                relationship_type=rel_type_enum.value
                            )
                            relationships.extend(rels[:limit])
                        except ValueError:
                            continue
                else:
                    relationships = self.graph_manager.find_relationships()[:limit]
                
                return jsonify({
                    'relationships': [rel.to_dict() for rel in relationships],
                    'count': len(relationships)
                })
            except Exception as e:
                logger.error(f"Error getting relationships: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/graph/search')
        def search_graph():
            """Search the knowledge graph"""
            try:
                query = request.args.get('q', '')
                limit = int(request.args.get('limit', 20))
                
                if not query:
                    return jsonify({'error': 'Query parameter required'}), 400
                
                # Search using full-text indexes
                results = self.graph_manager.search_full_text('concept_search', query, limit)
                
                return jsonify({
                    'results': [node.to_dict() for node in results],
                    'count': len(results),
                    'query': query
                })
            except Exception as e:
                logger.error(f"Error searching graph: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/graph/node/<node_id>')
        def get_node(node_id):
            """Get specific node with details"""
            try:
                # Get node
                nodes = self.graph_manager.find_nodes(properties={'id': node_id})
                
                if not nodes:
                    return jsonify({'error': 'Node not found'}), 404
                
                node = nodes[0]
                
                # Get neighbors
                neighbors = self.graph_manager.get_node_neighbors(node_id, limit=20)
                
                return jsonify({
                    'node': node.to_dict(),
                    'neighbors': [
                        {
                            'node': neighbor.to_dict(),
                            'relationship': relationship.to_dict()
                        }
                        for neighbor, relationship in neighbors
                    ]
                })
            except Exception as e:
                logger.error(f"Error getting node {node_id}: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/graph/neighborhood/<node_id>')
        def get_neighborhood(node_id):
            """Get node neighborhood for visualization"""
            try:
                depth = int(request.args.get('depth', 1))
                viz_data = self.visualizer.get_node_neighborhood(node_id, depth)
                return jsonify(viz_data)
            except Exception as e:
                logger.error(f"Error getting neighborhood for {node_id}: {e}")
                return jsonify({'error': str(e)}), 500
        
        # Entity Extraction Routes
        @self.app.route('/api/extract/text', methods=['POST'])
        def extract_from_text():
            """Extract entities from text"""
            try:
                data = request.get_json()
                text = data.get('text', '')
                source = data.get('source', 'api')
                
                if not text:
                    return jsonify({'error': 'Text required'}), 400
                
                # Extract entities
                entities = self.entity_extractor.extract_from_text(text, source)
                
                # Extract relationships
                relationships = self.relationship_builder.extract_relationships_from_text(text, entities)
                
                return jsonify({
                    'entities': [
                        {
                            'text': entity.text,
                            'type': entity.entity_type,
                            'confidence': entity.confidence,
                            'start_pos': entity.start_pos,
                            'end_pos': entity.end_pos,
                            'context': entity.context,
                            'metadata': entity.metadata
                        }
                        for entity in entities
                    ],
                    'relationships': [
                        {
                            'source': rel.source_entity,
                            'target': rel.target_entity,
                            'type': rel.relationship_type.value,
                            'confidence': rel.confidence,
                            'evidence': rel.evidence,
                            'method': rel.extraction_method
                        }
                        for rel in relationships
                    ]
                })
            except Exception as e:
                logger.error(f"Error extracting from text: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/extract/code', methods=['POST'])
        def extract_from_code():
            """Extract entities from code"""
            try:
                data = request.get_json()
                code = data.get('code', '')
                file_path = data.get('file_path', 'unknown')
                language = data.get('language', 'python')
                
                if not code:
                    return jsonify({'error': 'Code required'}), 400
                
                # Extract code entities
                entities = self.entity_extractor.extract_from_code(code, file_path, language)
                
                # Extract code relationships
                relationships = self.relationship_builder.extract_code_relationships(entities, code)
                
                return jsonify({
                    'entities': [
                        {
                            'name': entity.name,
                            'type': entity.entity_type,
                            'file_path': entity.file_path,
                            'line_start': entity.line_start,
                            'line_end': entity.line_end,
                            'language': entity.language,
                            'parameters': entity.parameters,
                            'return_type': entity.return_type,
                            'docstring': entity.docstring,
                            'complexity': entity.complexity
                        }
                        for entity in entities
                    ],
                    'relationships': [
                        {
                            'source': rel.source_entity,
                            'target': rel.target_entity,
                            'type': rel.relationship_type.value,
                            'confidence': rel.confidence,
                            'method': rel.extraction_method,
                            'properties': rel.properties
                        }
                        for rel in relationships
                    ]
                })
            except Exception as e:
                logger.error(f"Error extracting from code: {e}")
                return jsonify({'error': str(e)}), 500
        
        # Reasoning Routes
        @self.app.route('/api/reasoning/infer')
        def infer_relationships():
            """Generate new relationship inferences"""
            try:
                max_inferences = int(request.args.get('max', 50))
                
                # Generate inferences
                inferences = self.inference_engine.infer_new_relationships(max_inferences)
                
                return jsonify({
                    'inferences': [
                        {
                            'source': inf.source_node,
                            'target': inf.target_node,
                            'relationship_type': inf.relationship_type.value,
                            'confidence': inf.confidence,
                            'inference_type': inf.inference_type.value,
                            'reasoning_chain': inf.reasoning_chain,
                            'evidence': inf.evidence,
                            'metadata': inf.metadata
                        }
                        for inf in inferences
                    ],
                    'count': len(inferences)
                })
            except Exception as e:
                logger.error(f"Error generating inferences: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/reasoning/paths/<source_id>/<target_id>')
        def find_inference_paths(source_id, target_id):
            """Find inference paths between nodes"""
            try:
                max_depth = int(request.args.get('depth', 3))
                
                paths = self.inference_engine.find_inference_paths(
                    source_id, target_id, max_depth
                )
                
                return jsonify({
                    'paths': paths,
                    'count': len(paths),
                    'source': source_id,
                    'target': target_id
                })
            except Exception as e:
                logger.error(f"Error finding paths: {e}")
                return jsonify({'error': str(e)}), 500
        
        # Visualization Routes
        @self.app.route('/api/visualize/subgraph')
        def visualize_subgraph():
            """Create subgraph visualization"""
            try:
                # Parse parameters
                node_ids = request.args.getlist('nodes')
                node_types = request.args.getlist('node_types')
                rel_types = request.args.getlist('relationship_types')
                layout = request.args.get('layout', 'force')
                confidence_min = float(request.args.get('confidence_min', 0.0))
                
                # Build filters
                filters = {}
                if node_types:
                    filters['node_types'] = node_types
                if rel_types:
                    filters['relationship_types'] = rel_types
                if confidence_min > 0:
                    filters['confidence_min'] = confidence_min
                
                # Create visualization
                from ..visualization.graph_visualizer import GraphLayout
                layout_config = GraphLayout(layout)
                
                if node_ids:
                    viz_data = self.visualizer.create_subgraph_visualization(
                        node_ids, filters, layout_config
                    )
                else:
                    viz_data = self.visualizer.create_subgraph_visualization(
                        None, filters, layout_config
                    )
                
                return jsonify(viz_data)
            except Exception as e:
                logger.error(f"Error creating visualization: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/visualize/statistics')
        def visualize_statistics():
            """Get visualization statistics"""
            try:
                # Get current visualization data
                viz_data = self.visualizer.create_subgraph_visualization()
                
                # Calculate statistics
                stats = self.visualizer.create_network_statistics(viz_data)
                
                return jsonify(stats)
            except Exception as e:
                logger.error(f"Error calculating visualization statistics: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/visualize/search')
        def visualize_search():
            """Search and visualize results"""
            try:
                query = request.args.get('q', '')
                limit = int(request.args.get('limit', 50))
                
                if not query:
                    return jsonify({'error': 'Query required'}), 400
                
                viz_data = self.visualizer.search_and_visualize(query, limit)
                return jsonify(viz_data)
            except Exception as e:
                logger.error(f"Error in search visualization: {e}")
                return jsonify({'error': str(e)}), 500
        
        # Integration Routes
        @self.app.route('/api/integration/import_knowledge', methods=['POST'])
        def import_knowledge():
            """Import knowledge from external sources"""
            try:
                data = request.get_json()
                source = data.get('source', 'api')
                knowledge_data = data.get('data', [])
                
                imported_count = 0
                
                for item in knowledge_data:
                    try:
                        # Create knowledge nodes
                        if item.get('type') == 'concept':
                            node = self.graph_manager.create_node(
                                labels=['Concept'],
                                properties=item.get('properties', {})
                            )
                        elif item.get('type') == 'entity':
                            node = self.graph_manager.create_node(
                                labels=['Entity'],
                                properties=item.get('properties', {})
                            )
                        else:
                            continue
                        
                        imported_count += 1
                        
                    except Exception as e:
                        logger.error(f"Error importing item: {e}")
                        continue
                
                return jsonify({
                    'imported': imported_count,
                    'total': len(knowledge_data),
                    'source': source
                })
            except Exception as e:
                logger.error(f"Error importing knowledge: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/integration/update_from_learning', methods=['POST'])
        def update_from_learning():
            """Update graph from learning system"""
            try:
                if not self.learning_manager:
                    return jsonify({'error': 'Learning manager not available'}), 503
                
                # Get recent learning data
                recent_patterns = self.learning_manager.get_recent_patterns(limit=100)
                
                updated_count = 0
                
                for pattern in recent_patterns:
                    try:
                        # Create pattern node
                        node = self.graph_manager.create_node(
                            labels=['Pattern'],
                            properties={
                                'name': pattern.get('name', 'Unknown Pattern'),
                                'pattern_type': 'behavioral',
                                'frequency': pattern.get('frequency', 1),
                                'confidence': pattern.get('confidence', 0.5),
                                'description': pattern.get('description', ''),
                                'source': 'learning_system'
                            }
                        )
                        
                        updated_count += 1
                        
                    except Exception as e:
                        logger.error(f"Error updating from learning pattern: {e}")
                        continue
                
                return jsonify({
                    'updated': updated_count,
                    'patterns_processed': len(recent_patterns)
                })
            except Exception as e:
                logger.error(f"Error updating from learning system: {e}")
                return jsonify({'error': str(e)}), 500
        
        # Schema Routes
        @self.app.route('/api/schema')
        def get_schema():
            """Get graph schema information"""
            try:
                schema_dict = self.schema.to_dict()
                return jsonify(schema_dict)
            except Exception as e:
                logger.error(f"Error getting schema: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/schema/validate', methods=['POST'])
        def validate_data():
            """Validate data against schema"""
            try:
                data = request.get_json()
                node_type_str = data.get('node_type', '')
                properties = data.get('properties', {})
                
                try:
                    node_type = NodeType(node_type_str)
                except ValueError:
                    return jsonify({'error': f'Unknown node type: {node_type_str}'}), 400
                
                # Validate node
                errors = self.schema.validate_node(node_type, properties)
                
                return jsonify({
                    'valid': len(errors) == 0,
                    'errors': errors,
                    'node_type': node_type_str
                })
            except Exception as e:
                logger.error(f"Error validating data: {e}")
                return jsonify({'error': str(e)}), 500
        
        # Error handlers
        @self.app.errorhandler(404)
        def not_found(error):
            return jsonify({'error': 'Not found'}), 404
        
        @self.app.errorhandler(500)
        def internal_error(error):
            return jsonify({'error': 'Internal server error'}), 500
    
    def run(self, host='0.0.0.0', port=5556, debug=False):
        """Run the API server"""
        logger.info(f"Starting Knowledge Graph API server on {host}:{port}")
        self.app.run(host=host, port=port, debug=debug)

def create_app(config_path: str = "graph_config.yaml") -> Flask:
    """Create Flask app instance"""
    api = KnowledgeGraphAPI(config_path)
    return api.app

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='CAIA Knowledge Graph API Server')
    parser.add_argument('--host', default='0.0.0.0', help='Host to bind to')
    parser.add_argument('--port', type=int, default=5556, help='Port to bind to')
    parser.add_argument('--debug', action='store_true', help='Enable debug mode')
    parser.add_argument('--config', default='graph_config.yaml', help='Configuration file path')
    
    args = parser.parse_args()
    
    # Setup logging
    logging.basicConfig(
        level=logging.INFO if not args.debug else logging.DEBUG,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Create and run API server
    api = KnowledgeGraphAPI(args.config)
    api.run(host=args.host, port=args.port, debug=args.debug)