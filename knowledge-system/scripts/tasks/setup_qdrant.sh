#!/bin/bash
# setup_qdrant.sh - Setup Qdrant vector database

set -e

KNOWLEDGE_DIR="/Users/MAC/Documents/projects/caia/knowledge-system"
QDRANT_CONFIG="$KNOWLEDGE_DIR/config/qdrant.yaml"
QDRANT_DATA="$KNOWLEDGE_DIR/data/qdrant"

echo "Setting up Qdrant vector database..."

# Create data directory
mkdir -p "$QDRANT_DATA"

# Create Qdrant configuration
mkdir -p "$(dirname "$QDRANT_CONFIG")"
cat > "$QDRANT_CONFIG" << EOF
service:
  host: 0.0.0.0
  http_port: 6333
  grpc_port: 6334
  
storage:
  storage_path: $QDRANT_DATA
  snapshots_path: $QDRANT_DATA/snapshots
  
log:
  level: INFO
  
collections:
  code_embeddings:
    vectors:
      size: 768
      distance: Cosine
    optimizers_config:
      default_segment_number: 16
      max_segment_size: 100000
EOF

# Check if Qdrant is available via Docker
if command -v docker &> /dev/null; then
    echo "Starting Qdrant with Docker..."
    docker pull qdrant/qdrant:latest
    
    # Stop existing container if running
    docker stop qdrant-knowledge 2>/dev/null || true
    docker rm qdrant-knowledge 2>/dev/null || true
    
    # Start Qdrant container
    docker run -d \
        --name qdrant-knowledge \
        -p 6333:6333 \
        -p 6334:6334 \
        -v "$QDRANT_DATA:/qdrant/storage" \
        -v "$QDRANT_CONFIG:/qdrant/config/production.yaml" \
        qdrant/qdrant:latest
    
    # Wait for startup
    echo "Waiting for Qdrant to start..."
    sleep 5
    
    # Validate Qdrant is running
    if curl -s http://localhost:6333/health > /dev/null; then
        echo "✓ Qdrant is running and healthy"
    else
        echo "✗ Qdrant failed to start"
        exit 1
    fi
else
    echo "Docker not found. Please install Docker to run Qdrant."
    exit 1
fi

# Create collection for code embeddings
curl -X PUT 'http://localhost:6333/collections/code_embeddings' \
    -H 'Content-Type: application/json' \
    --data-raw '{
        "vectors": {
            "size": 768,
            "distance": "Cosine"
        },
        "optimizers_config": {
            "default_segment_number": 16,
            "max_segment_size": 100000
        }
    }'

echo "✓ Qdrant setup complete"
echo "  - Health endpoint: http://localhost:6333/health"
echo "  - Dashboard: http://localhost:6333/dashboard"
echo "  - Data directory: $QDRANT_DATA"

exit 0