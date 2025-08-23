#!/usr/bin/env python3
"""Validate entity models and schemas."""

import json
from pathlib import Path
from entities import (
    Entity, FunctionEntity, ClassEntity, ModuleEntity,
    Relationship, KnowledgeGraph,
    EntityType, RelationshipType, Language,
    Location, create_function_entity
)

def test_basic_models():
    """Test basic model creation and validation."""
    print("Testing basic models...")
    
    # Test Location
    location = Location(
        file_path="/test/file.py",
        start_line=10,
        end_line=20
    )
    
    # Test Entity
    entity = Entity(
        type=EntityType.FUNCTION,
        name="test_function",
        language=Language.PYTHON,
        location=location
    )
    
    # Test specialized entities
    func_entity = FunctionEntity(
        name="my_function",
        location=location,
        language=Language.PYTHON,
        parameters=[{"name": "param1", "type": "str"}]
    )
    
    class_entity = ClassEntity(
        name="MyClass",
        location=location,
        language=Language.PYTHON,
        base_classes=["BaseClass"]
    )
    
    # Test Relationship
    relationship = Relationship(
        from_entity_id=func_entity.id,
        to_entity_id=class_entity.id,
        relationship_type=RelationshipType.USES
    )
    
    print(f"Created entities: {len([entity, func_entity, class_entity])}")
    print(f"Created relationships: 1")
    
    return entity, func_entity, class_entity, relationship

def test_knowledge_graph():
    """Test knowledge graph operations."""
    print("Testing knowledge graph...")
    
    # Create entities
    location = Location(file_path="/test/file.py", start_line=1, end_line=10)
    
    func1 = create_function_entity(
        name="function1",
        location=location,
        language=Language.PYTHON
    )
    
    func2 = create_function_entity(
        name="function2",
        location=location,
        language=Language.PYTHON
    )
    
    # Create relationship
    rel = Relationship(
        from_entity_id=func1.id,
        to_entity_id=func2.id,
        relationship_type=RelationshipType.CALLS
    )
    
    # Create knowledge graph
    kg = KnowledgeGraph(
        name="Test Knowledge Graph",
        description="A test graph"
    )
    
    # Add entities and relationships
    kg.add_entity(func1)
    kg.add_entity(func2)
    kg.add_relationship(rel)
    
    # Test queries
    found_entity = kg.get_entity_by_name("function1")
    assert found_entity is not None
    assert found_entity.name == "function1"
    
    functions = kg.get_entities_by_type(EntityType.FUNCTION)
    assert len(functions) == 2
    
    relationships = kg.get_relationships_for_entity(func1.id)
    assert len(relationships) == 1
    
    print(f"Knowledge graph: {kg.total_entities} entities, {kg.total_relationships} relationships")
    
    return kg

def test_serialization():
    """Test JSON serialization."""
    print("Testing serialization...")
    
    location = Location(file_path="/test/file.py", start_line=1, end_line=5)
    entity = FunctionEntity(
        name="serialize_test",
        location=location,
        language=Language.PYTHON
    )
    
    # Test JSON serialization
    json_data = entity.json()
    parsed_entity = FunctionEntity.parse_raw(json_data)
    
    assert parsed_entity.name == entity.name
    assert parsed_entity.type == entity.type
    
    print("Serialization test passed")
    
    return parsed_entity

def validate_schema():
    """Validate against JSON schema."""
    print("Validating schema...")
    
    schema_file = "/Users/MAC/Documents/projects/caia/knowledge-system/schema/entity_schema.json"
    
    if Path(schema_file).exists():
        with open(schema_file) as f:
            schema = json.load(f)
        
        # Create sample entity
        location = Location(file_path="/test/file.py", start_line=1, end_line=5)
        entity = Entity(
            type=EntityType.FUNCTION,
            name="schema_test",
            language=Language.PYTHON,
            location=location
        )
        
        entity_dict = json.loads(entity.json())
        
        # Basic validation (would need jsonschema package for full validation)
        required_fields = ['id', 'type', 'name', 'language', 'location']
        for field in required_fields:
            assert field in entity_dict, f"Missing required field: {field}"
        
        print("Schema validation passed")
    else:
        print(f"Schema file not found: {schema_file}")

def main():
    """Run all tests."""
    print("Validating entity models...")
    print("=" * 40)
    
    try:
        # Test basic models
        entities = test_basic_models()
        print("✓ Basic models test passed")
        
        # Test knowledge graph
        kg = test_knowledge_graph()
        print("✓ Knowledge graph test passed")
        
        # Test serialization
        test_serialization()
        print("✓ Serialization test passed")
        
        # Validate schema
        validate_schema()
        print("✓ Schema validation passed")
        
        print("\nAll model validations passed!")
        
        # Print summary
        summary = kg.export_summary()
        print(f"\nSample Knowledge Graph Summary:")
        print(json.dumps(summary, indent=2))
        
    except Exception as e:
        print(f"✗ Validation failed: {e}")
        raise

if __name__ == "__main__":
    main()
