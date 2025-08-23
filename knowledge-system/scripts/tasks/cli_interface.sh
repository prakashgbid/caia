#!/bin/bash
# cli_interface.sh - Setup command-line interface

set -e

KNOWLEDGE_DIR="/Users/MAC/Documents/projects/caia/knowledge-system"
CLI_DIR="$KNOWLEDGE_DIR/cli"

echo "Setting up CLI interface..."

mkdir -p "$CLI_DIR"

cat > "$CLI_DIR/knowledge_cli.py" << 'EOF'
#!/usr/bin/env python3
"""Command-line interface for knowledge system."""

import click
import json
import sys
from pathlib import Path

sys.path.append('/Users/MAC/Documents/projects/caia/knowledge-system')

@click.group()
def cli():
    """Knowledge system CLI."""
    pass

@cli.command()
@click.argument('query')
def search(query):
    """Search for code entities."""
    try:
        from search.vector_search import VectorSearch
        search_engine = VectorSearch('/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db')
        results = search_engine.search_similar_code(query)
        for i, result in enumerate(results, 1):
            click.echo(f"{i}. {result['entity_name']} - {result['similarity_score']:.3f}")
    except Exception as e:
        click.echo(f"Search error: {e}")

@cli.command()
@click.argument('path')
def extract(path):
    """Extract entities from path."""
    try:
        from pipelines.extractors.entity_extractor import EntityExtractor
        extractor = EntityExtractor('/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db')
        if Path(path).is_file():
            entities = extractor.extract_from_file(path)
            click.echo(f"Extracted {len(entities)} entities")
        else:
            entities = extractor.extract_from_directory(path)
            click.echo(f"Extracted {len(entities)} entities from directory")
    except Exception as e:
        click.echo(f"Extraction error: {e}")

@cli.command()
def stats():
    """Show knowledge base statistics."""
    try:
        from search.vector_search import VectorSearch
        search = VectorSearch('/Users/MAC/Documents/projects/caia/knowledge-system/data/knowledge.db')
        stats = search.get_search_stats()
        click.echo(json.dumps(stats, indent=2))
    except Exception as e:
        click.echo(f"Stats error: {e}")

if __name__ == '__main__':
    cli()
EOF

chmod +x "$CLI_DIR/knowledge_cli.py"

echo " CLI interface setup complete"
echo "  - CLI: $CLI_DIR/knowledge_cli.py"
exit 0