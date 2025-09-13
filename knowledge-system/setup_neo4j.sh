#!/bin/bash

# Setup Neo4j for CAIA Knowledge Graph System
# Phase 4 - Advanced Knowledge Graph Implementation

set -e

echo "🚀 Setting up Neo4j for CAIA Knowledge Graph System..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
NEO4J_VERSION="5.13.0"
NEO4J_PASSWORD="knowledge_graph"
NEO4J_DATABASE="caia_knowledge"
NEO4J_HOME="/usr/local/var/neo4j"

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Homebrew is installed
if ! command -v brew &> /dev/null; then
    print_error "Homebrew is not installed. Please install Homebrew first."
    exit 1
fi

# Install Neo4j if not present
if ! command -v neo4j &> /dev/null; then
    print_status "Installing Neo4j..."
    brew install neo4j
else
    print_status "Neo4j is already installed"
    neo4j version
fi

# Install Neo4j plugins
print_status "Installing Neo4j plugins..."
NEO4J_PLUGINS_DIR="/usr/local/var/neo4j/plugins"
mkdir -p "$NEO4J_PLUGINS_DIR"

# APOC Plugin for advanced procedures
APOC_URL="https://github.com/neo4j-contrib/neo4j-apoc-procedures/releases/download/5.13.0/apoc-5.13.0-core.jar"
if [ ! -f "$NEO4J_PLUGINS_DIR/apoc-5.13.0-core.jar" ]; then
    print_status "Downloading APOC plugin..."
    curl -L "$APOC_URL" -o "$NEO4J_PLUGINS_DIR/apoc-5.13.0-core.jar"
fi

# Graph Data Science Plugin
GDS_URL="https://github.com/neo4j/graph-data-science/releases/download/2.5.8/neo4j-graph-data-science-2.5.8.jar"
if [ ! -f "$NEO4J_PLUGINS_DIR/neo4j-graph-data-science-2.5.8.jar" ]; then
    print_status "Downloading Graph Data Science plugin..."
    curl -L "$GDS_URL" -o "$NEO4J_PLUGINS_DIR/neo4j-graph-data-science-2.5.8.jar"
fi

# Configure Neo4j
print_status "Configuring Neo4j..."
NEO4J_CONF="/usr/local/etc/neo4j/neo4j.conf"

# Backup original config
if [ -f "$NEO4J_CONF" ] && [ ! -f "$NEO4J_CONF.backup" ]; then
    cp "$NEO4J_CONF" "$NEO4J_CONF.backup"
fi

# Create optimized configuration
cat > "$NEO4J_CONF" << EOF
# Neo4j Configuration for CAIA Knowledge Graph
# Optimized for semantic knowledge representation

# Basic settings
server.default_database=$NEO4J_DATABASE
server.databases.default_to_read_only=false

# Network settings
server.default_listen_address=0.0.0.0
server.bolt.listen_address=:7687
server.http.listen_address=:7474
server.https.listen_address=:7473

# Security settings
dbms.security.auth_enabled=true
dbms.security.allow_csv_import_from_file_urls=true

# Memory settings (optimized for knowledge graph)
server.memory.heap.initial_size=2G
server.memory.heap.max_size=4G
server.memory.pagecache.size=1G

# Performance settings
dbms.transaction.timeout=60s
dbms.lock.acquisition.timeout=60s
dbms.query.cache_size=1000
dbms.query.cache_ttl=600000

# Enable plugins
dbms.security.procedures.unrestricted=apoc.*,gds.*
dbms.security.procedures.allowlist=apoc.*,gds.*

# Logging
server.logs.debug.level=INFO
server.logs.gc.enabled=true

# Import settings
server.directories.import=import
dbms.security.allow_csv_import_from_file_urls=true

# Connection pool settings
server.bolt.connection_keep_alive=120s
server.bolt.connection_keep_alive_for_requests=120s

# Query settings
cypher.default_language_version=5
cypher.render_plan_description=true

# Metrics
server.metrics.enabled=true
server.metrics.prometheus.enabled=false
server.metrics.jmx.enabled=true
EOF

# Create data directories
print_status "Creating data directories..."
mkdir -p "/usr/local/var/neo4j/data/databases"
mkdir -p "/usr/local/var/neo4j/import"
mkdir -p "/usr/local/var/neo4j/logs"

# Start Neo4j service
print_status "Starting Neo4j..."
brew services restart neo4j

# Wait for Neo4j to start
print_status "Waiting for Neo4j to start..."
sleep 10

# Check if Neo4j is running
for i in {1..30}; do
    if curl -f -s http://localhost:7474 > /dev/null; then
        print_status "Neo4j is running!"
        break
    fi
    if [ $i -eq 30 ]; then
        print_error "Neo4j failed to start within 30 seconds"
        exit 1
    fi
    sleep 1
done

# Set initial password
print_status "Setting Neo4j password..."
echo "CALL dbms.security.changePassword('$NEO4J_PASSWORD');" | cypher-shell -u neo4j -p neo4j || {
    print_warning "Password might already be set or Neo4j not ready yet"
}

# Create database if it doesn't exist
print_status "Creating CAIA knowledge database..."
echo "CREATE DATABASE $NEO4J_DATABASE IF NOT EXISTS;" | cypher-shell -u neo4j -p "$NEO4J_PASSWORD" || {
    print_warning "Database creation failed, it might already exist"
}

# Create initial schema and constraints
print_status "Creating database schema..."
cat << 'EOF' | cypher-shell -u neo4j -p "$NEO4J_PASSWORD" -d "$NEO4J_DATABASE"
// Create constraints for unique identifiers
CREATE CONSTRAINT concept_name_unique IF NOT EXISTS FOR (c:Concept) REQUIRE c.name IS UNIQUE;
CREATE CONSTRAINT entity_name_unique IF NOT EXISTS FOR (e:Entity) REQUIRE (e.name, e.type) IS UNIQUE;
CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE;
CREATE CONSTRAINT session_id_unique IF NOT EXISTS FOR (s:Session) REQUIRE s.id IS UNIQUE;
CREATE CONSTRAINT decision_id_unique IF NOT EXISTS FOR (d:Decision) REQUIRE d.id IS UNIQUE;

// Create indexes for performance
CREATE INDEX concept_domain_index IF NOT EXISTS FOR (c:Concept) ON (c.domain);
CREATE INDEX entity_type_index IF NOT EXISTS FOR (e:Entity) ON (e.type);
CREATE INDEX entity_source_index IF NOT EXISTS FOR (e:Entity) ON (e.source);
CREATE INDEX code_element_type_index IF NOT EXISTS FOR (ce:CodeElement) ON (ce.type);
CREATE INDEX code_element_language_index IF NOT EXISTS FOR (ce:CodeElement) ON (ce.language);
CREATE INDEX pattern_type_index IF NOT EXISTS FOR (p:Pattern) ON (p.pattern_type);
CREATE INDEX knowledge_domain_index IF NOT EXISTS FOR (k:Knowledge) ON (k.domain);
CREATE INDEX knowledge_type_index IF NOT EXISTS FOR (k:Knowledge) ON (k.type);

// Create full-text indexes for search
CALL db.index.fulltext.createNodeIndex('concept_search', ['Concept'], ['name', 'description']) YIELD name;
CALL db.index.fulltext.createNodeIndex('entity_search', ['Entity'], ['name', 'value']) YIELD name;
CALL db.index.fulltext.createNodeIndex('code_search', ['CodeElement'], ['name']) YIELD name;
CALL db.index.fulltext.createNodeIndex('knowledge_search', ['Knowledge'], ['content']) YIELD name;
EOF

# Install Python dependencies for the knowledge graph
print_status "Installing Python dependencies..."
pip3 install -r requirements.txt 2>/dev/null || {
    print_warning "requirements.txt not found, installing core dependencies..."
    pip3 install neo4j networkx spacy sentence-transformers flask graphql-core
}

# Download spaCy model
print_status "Downloading spaCy English model..."
python3 -m spacy download en_core_web_lg

# Create import script
print_status "Creating import utilities..."
cat > import_existing_knowledge.py << 'PYTHON_EOF'
#!/usr/bin/env python3
"""
Import existing knowledge from CKS into Neo4j Knowledge Graph
Phase 4 - Advanced Knowledge Graph Implementation
"""

import sqlite3
import json
import yaml
from datetime import datetime
from neo4j import GraphDatabase
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class KnowledgeImporter:
    def __init__(self, config_path="graph_config.yaml"):
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)
        
        self.driver = GraphDatabase.driver(
            self.config['neo4j']['uri'],
            auth=(self.config['neo4j']['user'], self.config['neo4j']['password'])
        )
    
    def import_from_cks(self):
        """Import existing knowledge from CKS database"""
        logger.info("Importing knowledge from CKS database...")
        
        try:
            # Connect to CKS database
            cks_db = sqlite3.connect('data/caia_knowledge.db')
            cursor = cks_db.cursor()
            
            with self.driver.session(database=self.config['neo4j']['database']) as session:
                # Import functions
                cursor.execute("SELECT * FROM functions")
                functions = cursor.fetchall()
                
                for func in functions:
                    session.execute_write(self._create_code_element, {
                        'name': func[1],
                        'type': 'function',
                        'file_path': func[2],
                        'language': func[3] or 'python',
                        'complexity': func[4] or 1
                    })
                
                logger.info(f"Imported {len(functions)} functions")
                
                # Import classes
                cursor.execute("SELECT * FROM classes")
                classes = cursor.fetchall()
                
                for cls in classes:
                    session.execute_write(self._create_code_element, {
                        'name': cls[1],
                        'type': 'class',
                        'file_path': cls[2],
                        'language': cls[3] or 'python'
                    })
                
                logger.info(f"Imported {len(classes)} classes")
            
            cks_db.close()
            
        except Exception as e:
            logger.error(f"Error importing from CKS: {e}")
    
    def import_from_learning_system(self):
        """Import data from learning system"""
        logger.info("Importing from learning system...")
        
        try:
            learning_db = sqlite3.connect('data/learning.db')
            cursor = learning_db.cursor()
            
            with self.driver.session(database=self.config['neo4j']['database']) as session:
                # Import patterns
                cursor.execute("SELECT pattern, frequency, confidence FROM patterns")
                patterns = cursor.fetchall()
                
                for pattern in patterns:
                    session.execute_write(self._create_pattern, {
                        'name': pattern[0],
                        'frequency': pattern[1],
                        'confidence': pattern[2],
                        'pattern_type': 'behavioral'
                    })
                
                logger.info(f"Imported {len(patterns)} patterns")
            
            learning_db.close()
            
        except Exception as e:
            logger.error(f"Error importing from learning system: {e}")
    
    def _create_code_element(self, tx, data):
        query = """
        CREATE (ce:CodeElement {
            name: $name,
            type: $type,
            file_path: $file_path,
            language: $language,
            complexity: $complexity,
            created_at: datetime()
        })
        """
        tx.run(query, **data)
    
    def _create_pattern(self, tx, data):
        query = """
        CREATE (p:Pattern {
            name: $name,
            frequency: $frequency,
            confidence: $confidence,
            pattern_type: $pattern_type,
            created_at: datetime()
        })
        """
        tx.run(query, **data)
    
    def close(self):
        self.driver.close()

if __name__ == "__main__":
    importer = KnowledgeImporter()
    importer.import_from_cks()
    importer.import_from_learning_system()
    importer.close()
    logger.info("Knowledge import completed!")
PYTHON_EOF

chmod +x import_existing_knowledge.py

# Create test script
print_status "Creating test script..."
cat > test_knowledge_graph.py << 'PYTHON_EOF'
#!/usr/bin/env python3
"""
Test Neo4j Knowledge Graph System
Phase 4 - Advanced Knowledge Graph Implementation
"""

import yaml
from neo4j import GraphDatabase
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_connection():
    """Test Neo4j connection"""
    try:
        with open('graph_config.yaml', 'r') as f:
            config = yaml.safe_load(f)
        
        driver = GraphDatabase.driver(
            config['neo4j']['uri'],
            auth=(config['neo4j']['user'], config['neo4j']['password'])
        )
        
        with driver.session(database=config['neo4j']['database']) as session:
            result = session.run("RETURN 'Connection successful!' as message")
            message = result.single()['message']
            logger.info(f"✅ {message}")
            
            # Test creating a sample node
            session.run("""
                CREATE (test:Concept {
                    name: 'Test Concept',
                    description: 'This is a test concept',
                    domain: 'testing',
                    confidence: 1.0,
                    created_at: datetime()
                })
            """)
            logger.info("✅ Created test concept node")
            
            # Test querying
            result = session.run("MATCH (c:Concept {name: 'Test Concept'}) RETURN c")
            if result.single():
                logger.info("✅ Successfully queried test concept")
            
            # Clean up test node
            session.run("MATCH (test:Concept {name: 'Test Concept'}) DELETE test")
            logger.info("✅ Cleaned up test data")
        
        driver.close()
        return True
        
    except Exception as e:
        logger.error(f"❌ Connection test failed: {e}")
        return False

if __name__ == "__main__":
    test_connection()
PYTHON_EOF

chmod +x test_knowledge_graph.py

print_status "Testing Neo4j connection..."
python3 test_knowledge_graph.py

print_status "✅ Neo4j setup completed successfully!"
print_status ""
print_status "Neo4j is now running with the following settings:"
print_status "  • HTTP: http://localhost:7474"
print_status "  • Bolt: bolt://localhost:7687"
print_status "  • Username: neo4j"
print_status "  • Password: $NEO4J_PASSWORD"
print_status "  • Database: $NEO4J_DATABASE"
print_status ""
print_status "Next steps:"
print_status "  1. Run: python3 import_existing_knowledge.py"
print_status "  2. Test the system: python3 test_knowledge_graph.py"
print_status "  3. Access Neo4j Browser: http://localhost:7474"
print_status ""
print_status "🚀 Knowledge Graph System is ready!"