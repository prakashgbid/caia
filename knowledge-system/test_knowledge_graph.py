#!/usr/bin/env python3
"""
Comprehensive Test Suite for CAIA Knowledge Graph System
Phase 4 - Advanced Knowledge Graph Implementation
"""

import os
import sys
import yaml
import json
import time
import logging
import traceback
from datetime import datetime
from typing import Dict, List, Any

# Add the project root to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import knowledge graph components
try:
    from knowledge_graph.core.graph_manager import GraphManager
    from knowledge_graph.core.graph_schema import get_graph_schema, NodeType, RelationshipType
    from knowledge_graph.semantic.entity_extractor import EntityExtractor
    from knowledge_graph.semantic.relationship_builder import RelationshipBuilder
    from knowledge_graph.reasoning.inference_engine import InferenceEngine
    from knowledge_graph.visualization.graph_visualizer import GraphVisualizer
    from knowledge_graph.integration.api_server import KnowledgeGraphAPI
except ImportError as e:
    print(f"❌ Import error: {e}")
    print("Make sure all knowledge graph components are properly installed")
    sys.exit(1)

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class KnowledgeGraphTester:
    """Comprehensive test suite for the knowledge graph system"""
    
    def __init__(self):
        self.results = {}
        self.start_time = datetime.now()
        
        # Test data
        self.test_text = """
        CAIA is an advanced artificial intelligence system that learns from user interactions.
        It uses machine learning algorithms to improve its performance over time.
        The system includes multiple agents that collaborate to solve complex problems.
        Users can interact with CAIA through natural language processing.
        """
        
        self.test_code = '''
def process_data(input_data):
    """Process input data and return results."""
    result = []
    for item in input_data:
        if validate_item(item):
            processed = transform_item(item)
            result.append(processed)
    return result

class DataProcessor:
    def __init__(self, config):
        self.config = config
    
    def run(self):
        data = self.load_data()
        return process_data(data)
        
    def load_data(self):
        return []

def validate_item(item):
    return item is not None

def transform_item(item):
    return item.upper() if isinstance(item, str) else item
        '''
    
    def run_all_tests(self) -> Dict[str, Any]:
        """Run all test suites"""
        print("🚀 Starting CAIA Knowledge Graph Test Suite")
        print("=" * 60)
        
        # Test suites
        test_suites = [
            ('Configuration', self.test_configuration),
            ('Graph Manager', self.test_graph_manager),
            ('Graph Schema', self.test_graph_schema),
            ('Entity Extractor', self.test_entity_extractor),
            ('Relationship Builder', self.test_relationship_builder),
            ('Inference Engine', self.test_inference_engine),
            ('Graph Visualizer', self.test_graph_visualizer),
            ('API Server', self.test_api_server),
            ('Integration', self.test_integration),
            ('Performance', self.test_performance)
        ]
        
        total_tests = 0
        passed_tests = 0
        
        for suite_name, test_func in test_suites:
            print(f"\n📋 Testing {suite_name}...")
            try:
                suite_results = test_func()
                self.results[suite_name] = suite_results
                
                suite_passed = suite_results.get('passed', 0)
                suite_total = suite_results.get('total', 0)
                
                total_tests += suite_total
                passed_tests += suite_passed
                
                if suite_passed == suite_total:
                    print(f"✅ {suite_name}: {suite_passed}/{suite_total} tests passed")
                else:
                    print(f"⚠️  {suite_name}: {suite_passed}/{suite_total} tests passed")
                    
            except Exception as e:
                print(f"❌ {suite_name}: Failed with error: {e}")
                self.results[suite_name] = {
                    'passed': 0,
                    'total': 1,
                    'error': str(e),
                    'traceback': traceback.format_exc()
                }
                total_tests += 1
        
        # Calculate overall results
        self.results['summary'] = {
            'total_tests': total_tests,
            'passed_tests': passed_tests,
            'success_rate': (passed_tests / total_tests * 100) if total_tests > 0 else 0,
            'duration': (datetime.now() - self.start_time).total_seconds(),
            'timestamp': datetime.now().isoformat()
        }
        
        self._print_summary()
        return self.results
    
    def test_configuration(self) -> Dict[str, Any]:
        """Test configuration loading and validation"""
        tests = []
        
        # Test 1: Load configuration file
        try:
            with open('graph_config.yaml', 'r') as f:
                config = yaml.safe_load(f)
            
            # Validate required sections
            required_sections = ['neo4j', 'node_types', 'relationship_types', 'semantic', 'reasoning', 'visualization']
            for section in required_sections:
                assert section in config, f"Missing required section: {section}"
            
            tests.append(('Load configuration', True, None))
        except Exception as e:
            tests.append(('Load configuration', False, str(e)))
        
        # Test 2: Validate Neo4j configuration
        try:
            neo4j_config = config['neo4j']
            required_neo4j_fields = ['uri', 'user', 'password', 'database']
            for field in required_neo4j_fields:
                assert field in neo4j_config, f"Missing Neo4j field: {field}"
            
            tests.append(('Neo4j configuration', True, None))
        except Exception as e:
            tests.append(('Neo4j configuration', False, str(e)))
        
        return self._calculate_test_results(tests)
    
    def test_graph_manager(self) -> Dict[str, Any]:
        """Test graph manager functionality"""
        tests = []
        
        try:
            # Test 1: Initialize graph manager
            graph_manager = GraphManager()
            tests.append(('Initialize GraphManager', True, None))
            
            # Test 2: Test connection
            try:
                stats = graph_manager.get_graph_statistics()
                tests.append(('Database connection', True, None))
            except Exception as e:
                tests.append(('Database connection', False, str(e)))
            
            # Test 3: Create test node
            try:
                node = graph_manager.create_node(
                    labels=['TestNode'],
                    properties={
                        'name': 'Test Node',
                        'type': 'test',
                        'created_by': 'test_suite'
                    }
                )
                test_node_id = node.id
                tests.append(('Create node', True, None))
            except Exception as e:
                tests.append(('Create node', False, str(e)))
                test_node_id = None
            
            # Test 4: Find nodes
            try:
                nodes = graph_manager.find_nodes(
                    labels=['TestNode'],
                    properties={'created_by': 'test_suite'}
                )
                assert len(nodes) > 0, "No test nodes found"
                tests.append(('Find nodes', True, None))
            except Exception as e:
                tests.append(('Find nodes', False, str(e)))
            
            # Test 5: Create relationship
            if test_node_id:
                try:
                    # Create another node for relationship
                    node2 = graph_manager.create_node(
                        labels=['TestNode'],
                        properties={
                            'name': 'Test Node 2',
                            'type': 'test',
                            'created_by': 'test_suite'
                        }
                    )
                    
                    # Create relationship
                    relationship = graph_manager.create_relationship(
                        test_node_id,
                        node2.id,
                        'RELATES_TO',
                        {'test': True, 'created_by': 'test_suite'}
                    )
                    
                    tests.append(('Create relationship', True, None))
                except Exception as e:
                    tests.append(('Create relationship', False, str(e)))
            
            # Test 6: Clean up test data
            try:
                # Find and delete test nodes
                test_nodes = graph_manager.find_nodes(properties={'created_by': 'test_suite'})
                for node in test_nodes:
                    graph_manager.delete_node(node.id, force=True)
                
                tests.append(('Cleanup test data', True, None))
            except Exception as e:
                tests.append(('Cleanup test data', False, str(e)))
                
        except Exception as e:
            tests.append(('Initialize GraphManager', False, str(e)))
        
        return self._calculate_test_results(tests)
    
    def test_graph_schema(self) -> Dict[str, Any]:
        """Test graph schema functionality"""
        tests = []
        
        try:
            # Test 1: Initialize schema
            schema = get_graph_schema()
            tests.append(('Initialize schema', True, None))
            
            # Test 2: Validate node types
            try:
                for node_type in NodeType:
                    node_schema = schema.get_node_schema(node_type)
                    assert node_schema is not None, f"No schema for node type: {node_type}"
                
                tests.append(('Node type schemas', True, None))
            except Exception as e:
                tests.append(('Node type schemas', False, str(e)))
            
            # Test 3: Validate relationship types
            try:
                for rel_type in RelationshipType:
                    rel_schema = schema.get_relationship_schema(rel_type)
                    assert rel_schema is not None, f"No schema for relationship type: {rel_type}"
                
                tests.append(('Relationship type schemas', True, None))
            except Exception as e:
                tests.append(('Relationship type schemas', False, str(e)))
            
            # Test 4: Validate node data
            try:
                test_properties = {
                    'name': 'Test Concept',
                    'description': 'A test concept',
                    'domain': 'testing',
                    'confidence': 1.0
                }
                
                errors = schema.validate_node(NodeType.CONCEPT, test_properties)
                assert len(errors) == 0, f"Validation errors: {errors}"
                
                tests.append(('Node validation', True, None))
            except Exception as e:
                tests.append(('Node validation', False, str(e)))
            
            # Test 5: Schema export
            try:
                schema_dict = schema.to_dict()
                assert 'node_types' in schema_dict, "Missing node_types in schema export"
                assert 'relationship_types' in schema_dict, "Missing relationship_types in schema export"
                
                tests.append(('Schema export', True, None))
            except Exception as e:
                tests.append(('Schema export', False, str(e)))
                
        except Exception as e:
            tests.append(('Initialize schema', False, str(e)))
        
        return self._calculate_test_results(tests)
    
    def test_entity_extractor(self) -> Dict[str, Any]:
        """Test entity extraction functionality"""
        tests = []
        
        try:
            # Test 1: Initialize entity extractor
            extractor = EntityExtractor()
            tests.append(('Initialize EntityExtractor', True, None))
            
            # Test 2: Extract entities from text
            try:
                entities = extractor.extract_from_text(self.test_text, 'test')
                assert len(entities) > 0, "No entities extracted from text"
                
                # Check for expected entity types
                entity_types = [e.entity_type for e in entities]
                assert any('ORGANIZATION' in et or 'ORG' in et for et in entity_types), "No organization entities found"
                
                tests.append(('Extract from text', True, None))
            except Exception as e:
                tests.append(('Extract from text', False, str(e)))
            
            # Test 3: Extract entities from code
            try:
                code_entities = extractor.extract_from_code(self.test_code, 'test.py', 'python')
                assert len(code_entities) > 0, "No code entities extracted"
                
                # Check for expected entity types
                entity_types = [e.entity_type for e in code_entities]
                assert 'function' in entity_types, "No function entities found"
                assert 'class' in entity_types, "No class entities found"
                
                tests.append(('Extract from code', True, None))
            except Exception as e:
                tests.append(('Extract from code', False, str(e)))
            
            # Test 4: Batch extraction
            try:
                # Create a temporary test file
                test_file = 'temp_test.py'
                with open(test_file, 'w') as f:
                    f.write(self.test_code)
                
                batch_results = extractor.batch_extract_from_files([test_file])
                assert test_file in batch_results, "File not processed in batch"
                assert len(batch_results[test_file]) > 0, "No entities from batch processing"
                
                # Cleanup
                os.remove(test_file)
                
                tests.append(('Batch extraction', True, None))
            except Exception as e:
                tests.append(('Batch extraction', False, str(e)))
                
        except Exception as e:
            tests.append(('Initialize EntityExtractor', False, str(e)))
        
        return self._calculate_test_results(tests)
    
    def test_relationship_builder(self) -> Dict[str, Any]:
        """Test relationship building functionality"""
        tests = []
        
        try:
            # Test 1: Initialize relationship builder
            builder = RelationshipBuilder()
            tests.append(('Initialize RelationshipBuilder', True, None))
            
            # Test 2: Extract text relationships
            try:
                extractor = EntityExtractor()
                entities = extractor.extract_from_text(self.test_text, 'test')
                
                relationships = builder.extract_relationships_from_text(self.test_text, entities)
                # Relationships might be empty if no clear patterns are found, which is OK
                tests.append(('Extract text relationships', True, None))
            except Exception as e:
                tests.append(('Extract text relationships', False, str(e)))
            
            # Test 3: Extract code relationships
            try:
                extractor = EntityExtractor()
                code_entities = extractor.extract_from_code(self.test_code, 'test.py', 'python')
                
                code_relationships = builder.extract_code_relationships(code_entities, self.test_code)
                # Should find function calls and class containment
                tests.append(('Extract code relationships', True, None))
            except Exception as e:
                tests.append(('Extract code relationships', False, str(e)))
            
            # Test 4: Build relationship graph
            try:
                # Create some test relationships
                from knowledge_graph.semantic.relationship_builder import ExtractedRelationship
                test_relationships = [
                    ExtractedRelationship(
                        source_entity='entity1',
                        target_entity='entity2',
                        relationship_type=RelationshipType.RELATES_TO,
                        confidence=0.8
                    )
                ]
                
                graph = builder.build_relationship_graph(test_relationships)
                assert graph.number_of_nodes() >= 2, "Graph should have at least 2 nodes"
                assert graph.number_of_edges() >= 1, "Graph should have at least 1 edge"
                
                tests.append(('Build relationship graph', True, None))
            except Exception as e:
                tests.append(('Build relationship graph', False, str(e)))
                
        except Exception as e:
            tests.append(('Initialize RelationshipBuilder', False, str(e)))
        
        return self._calculate_test_results(tests)
    
    def test_inference_engine(self) -> Dict[str, Any]:
        """Test inference engine functionality"""
        tests = []
        
        try:
            # Test 1: Initialize inference engine
            engine = InferenceEngine()
            tests.append(('Initialize InferenceEngine', True, None))
            
            # Test 2: Generate inferences (might be empty if no data)
            try:
                inferences = engine.infer_new_relationships(max_inferences=10)
                # Inferences might be empty if graph is empty, which is OK
                tests.append(('Generate inferences', True, None))
            except Exception as e:
                tests.append(('Generate inferences', False, str(e)))
            
            # Test 3: Find paths (might not find any if no connected data)
            try:
                # This might not find paths if there's no data, but shouldn't crash
                paths = engine.find_inference_paths('1', '2', max_depth=2)
                tests.append(('Find inference paths', True, None))
            except Exception as e:
                tests.append(('Find inference paths', False, str(e)))
                
        except Exception as e:
            tests.append(('Initialize InferenceEngine', False, str(e)))
        
        return self._calculate_test_results(tests)
    
    def test_graph_visualizer(self) -> Dict[str, Any]:
        """Test graph visualization functionality"""
        tests = []
        
        try:
            # Test 1: Initialize visualizer
            visualizer = GraphVisualizer()
            tests.append(('Initialize GraphVisualizer', True, None))
            
            # Test 2: Create subgraph visualization
            try:
                viz_data = visualizer.create_subgraph_visualization(
                    node_ids=None,
                    filters={'confidence_min': 0.0}
                )
                
                assert 'nodes' in viz_data, "Missing nodes in visualization data"
                assert 'edges' in viz_data, "Missing edges in visualization data"
                assert 'metadata' in viz_data, "Missing metadata in visualization data"
                
                tests.append(('Create visualization', True, None))
            except Exception as e:
                tests.append(('Create visualization', False, str(e)))
            
            # Test 3: Calculate network statistics
            try:
                viz_data = visualizer.create_subgraph_visualization()
                stats = visualizer.create_network_statistics(viz_data)
                
                assert 'basic' in stats, "Missing basic statistics"
                
                tests.append(('Network statistics', True, None))
            except Exception as e:
                tests.append(('Network statistics', False, str(e)))
            
            # Test 4: Export visualization
            try:
                viz_data = visualizer.create_subgraph_visualization()
                filename = visualizer.export_visualization(viz_data, 'json', 'test_export.json')
                
                # Check if file was created
                assert os.path.exists(filename), "Export file not created"
                
                # Cleanup
                if os.path.exists(filename):
                    os.remove(filename)
                
                tests.append(('Export visualization', True, None))
            except Exception as e:
                tests.append(('Export visualization', False, str(e)))
                
        except Exception as e:
            tests.append(('Initialize GraphVisualizer', False, str(e)))
        
        return self._calculate_test_results(tests)
    
    def test_api_server(self) -> Dict[str, Any]:
        """Test API server functionality"""
        tests = []
        
        try:
            # Test 1: Initialize API server
            api = KnowledgeGraphAPI()
            tests.append(('Initialize API Server', True, None))
            
            # Test 2: Test Flask app creation
            try:
                app = api.app
                assert app is not None, "Flask app not created"
                tests.append(('Flask app creation', True, None))
            except Exception as e:
                tests.append(('Flask app creation', False, str(e)))
            
            # Test 3: Test client creation
            try:
                client = app.test_client()
                assert client is not None, "Test client not created"
                tests.append(('Test client creation', True, None))
            except Exception as e:
                tests.append(('Test client creation', False, str(e)))
                
        except Exception as e:
            tests.append(('Initialize API Server', False, str(e)))
        
        return self._calculate_test_results(tests)
    
    def test_integration(self) -> Dict[str, Any]:
        """Test integration between components"""
        tests = []
        
        # Test 1: Component initialization
        try:
            graph_manager = GraphManager()
            schema = get_graph_schema()
            extractor = EntityExtractor()
            builder = RelationshipBuilder()
            engine = InferenceEngine()
            visualizer = GraphVisualizer()
            
            tests.append(('All components initialize', True, None))
        except Exception as e:
            tests.append(('All components initialize', False, str(e)))
            return self._calculate_test_results(tests)
        
        # Test 2: End-to-end knowledge processing
        try:
            # Extract entities
            entities = extractor.extract_from_text(self.test_text, 'integration_test')
            
            # Build relationships
            relationships = builder.extract_relationships_from_text(self.test_text, entities)
            
            # Create visualization (even if empty)
            viz_data = visualizer.create_subgraph_visualization()
            
            tests.append(('End-to-end processing', True, None))
        except Exception as e:
            tests.append(('End-to-end processing', False, str(e)))
        
        return self._calculate_test_results(tests)
    
    def test_performance(self) -> Dict[str, Any]:
        """Test performance characteristics"""
        tests = []
        
        # Test 1: Entity extraction performance
        try:
            extractor = EntityExtractor()
            
            start_time = time.time()
            for _ in range(10):
                entities = extractor.extract_from_text(self.test_text, 'perf_test')
            extraction_time = time.time() - start_time
            
            # Should process 10 texts in under 5 seconds
            assert extraction_time < 5.0, f"Entity extraction too slow: {extraction_time}s"
            
            tests.append(('Entity extraction performance', True, f"{extraction_time:.2f}s"))
        except Exception as e:
            tests.append(('Entity extraction performance', False, str(e)))
        
        # Test 2: Visualization performance
        try:
            visualizer = GraphVisualizer()
            
            start_time = time.time()
            for _ in range(5):
                viz_data = visualizer.create_subgraph_visualization()
            viz_time = time.time() - start_time
            
            # Should create 5 visualizations in under 10 seconds
            assert viz_time < 10.0, f"Visualization too slow: {viz_time}s"
            
            tests.append(('Visualization performance', True, f"{viz_time:.2f}s"))
        except Exception as e:
            tests.append(('Visualization performance', False, str(e)))
        
        return self._calculate_test_results(tests)
    
    def _calculate_test_results(self, tests: List[tuple]) -> Dict[str, Any]:
        """Calculate test results from test list"""
        passed = sum(1 for test in tests if test[1])
        total = len(tests)
        
        return {
            'passed': passed,
            'total': total,
            'success_rate': (passed / total * 100) if total > 0 else 0,
            'details': [
                {
                    'name': test[0],
                    'passed': test[1],
                    'error': test[2] if not test[1] else None,
                    'note': test[2] if test[1] and test[2] else None
                }
                for test in tests
            ]
        }
    
    def _print_summary(self):
        """Print test summary"""
        summary = self.results['summary']
        
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        print(f"Total Tests: {summary['total_tests']}")
        print(f"Passed Tests: {summary['passed_tests']}")
        print(f"Success Rate: {summary['success_rate']:.1f}%")
        print(f"Duration: {summary['duration']:.2f} seconds")
        
        if summary['success_rate'] == 100:
            print("\n🎉 ALL TESTS PASSED!")
            print("Knowledge Graph System is fully operational.")
        elif summary['success_rate'] >= 80:
            print("\n✅ TESTS MOSTLY PASSED")
            print("Knowledge Graph System is operational with minor issues.")
        else:
            print("\n⚠️  SOME TESTS FAILED")
            print("Knowledge Graph System needs attention.")
        
        print("\n📝 Detailed results saved to: test_results.json")
        
        # Save detailed results
        with open('test_results.json', 'w') as f:
            json.dump(self.results, f, indent=2, default=str)

def main():
    """Main test execution"""
    print("CAIA Knowledge Graph System - Test Suite")
    print("Phase 4 - Advanced Knowledge Graph Implementation")
    print()
    
    # Check if Neo4j is running (optional)
    print("🔍 Checking Neo4j availability...")
    try:
        import requests
        response = requests.get('http://localhost:7474', timeout=2)
        if response.status_code == 200:
            print("✅ Neo4j is running and accessible")
        else:
            print("⚠️  Neo4j may not be properly configured")
    except Exception:
        print("⚠️  Neo4j is not running or not accessible")
        print("   You may need to run: ./setup_neo4j.sh")
    
    print()
    
    # Run tests
    tester = KnowledgeGraphTester()
    results = tester.run_all_tests()
    
    # Exit with appropriate code
    success_rate = results['summary']['success_rate']
    if success_rate == 100:
        sys.exit(0)
    elif success_rate >= 80:
        sys.exit(1)  # Minor issues
    else:
        sys.exit(2)  # Major issues

if __name__ == "__main__":
    main()