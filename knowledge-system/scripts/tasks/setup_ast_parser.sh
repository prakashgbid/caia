#!/bin/bash
# setup_ast_parser.sh - Setup AST parsing components

set -e

KNOWLEDGE_DIR="/Users/MAC/Documents/projects/caia/knowledge-system"
PARSERS_DIR="$KNOWLEDGE_DIR/parsers"
REQUIREMENTS_FILE="$KNOWLEDGE_DIR/requirements.txt"

echo "Setting up AST parsers..."

# Create parsers directory
mkdir -p "$PARSERS_DIR"

# Create Python AST parser
cat > "$PARSERS_DIR/python_parser.py" << 'EOF'
#!/usr/bin/env python3
"""Python AST parser for code analysis."""

import ast
import os
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from pathlib import Path

@dataclass
class Entity:
    """Represents a code entity (function, class, etc.)."""
    type: str
    name: str
    file_path: str
    start_line: int
    end_line: int
    signature: str = ""
    docstring: str = ""
    complexity: int = 0
    dependencies: List[str] = None
    
    def __post_init__(self):
        if self.dependencies is None:
            self.dependencies = []

class PythonParser:
    """AST-based Python code parser."""
    
    def __init__(self):
        self.entities = []
        self.relationships = []
    
    def parse_file(self, file_path: str) -> List[Entity]:
        """Parse a Python file and extract entities."""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            tree = ast.parse(content, filename=file_path)
            entities = []
            
            for node in ast.walk(tree):
                entity = self._extract_entity(node, file_path)
                if entity:
                    entities.append(entity)
            
            return entities
            
        except Exception as e:
            print(f"Error parsing {file_path}: {e}")
            return []
    
    def _extract_entity(self, node: ast.AST, file_path: str) -> Optional[Entity]:
        """Extract entity from AST node."""
        if isinstance(node, ast.FunctionDef):
            return self._extract_function(node, file_path)
        elif isinstance(node, ast.ClassDef):
            return self._extract_class(node, file_path)
        elif isinstance(node, ast.AsyncFunctionDef):
            return self._extract_async_function(node, file_path)
        return None
    
    def _extract_function(self, node: ast.FunctionDef, file_path: str) -> Entity:
        """Extract function entity."""
        signature = self._get_function_signature(node)
        docstring = ast.get_docstring(node) or ""
        complexity = self._calculate_complexity(node)
        
        return Entity(
            type="function",
            name=node.name,
            file_path=file_path,
            start_line=node.lineno,
            end_line=getattr(node, 'end_lineno', node.lineno),
            signature=signature,
            docstring=docstring,
            complexity=complexity
        )
    
    def _extract_class(self, node: ast.ClassDef, file_path: str) -> Entity:
        """Extract class entity."""
        docstring = ast.get_docstring(node) or ""
        bases = [self._get_name(base) for base in node.bases]
        signature = f"class {node.name}({', '.join(bases)})"
        
        return Entity(
            type="class",
            name=node.name,
            file_path=file_path,
            start_line=node.lineno,
            end_line=getattr(node, 'end_lineno', node.lineno),
            signature=signature,
            docstring=docstring,
            dependencies=bases
        )
    
    def _extract_async_function(self, node: ast.AsyncFunctionDef, file_path: str) -> Entity:
        """Extract async function entity."""
        signature = f"async {self._get_function_signature(node)}"
        docstring = ast.get_docstring(node) or ""
        complexity = self._calculate_complexity(node)
        
        return Entity(
            type="async_function",
            name=node.name,
            file_path=file_path,
            start_line=node.lineno,
            end_line=getattr(node, 'end_lineno', node.lineno),
            signature=signature,
            docstring=docstring,
            complexity=complexity
        )
    
    def _get_function_signature(self, node: ast.FunctionDef) -> str:
        """Generate function signature string."""
        args = []
        
        # Regular arguments
        for arg in node.args.args:
            arg_str = arg.arg
            if arg.annotation:
                arg_str += f": {self._get_name(arg.annotation)}"
            args.append(arg_str)
        
        # Varargs
        if node.args.vararg:
            args.append(f"*{node.args.vararg.arg}")
        
        # Keyword arguments
        if node.args.kwarg:
            args.append(f"**{node.args.kwarg.arg}")
        
        # Return annotation
        return_type = ""
        if node.returns:
            return_type = f" -> {self._get_name(node.returns)}"
        
        return f"{node.name}({', '.join(args)}){return_type}"
    
    def _get_name(self, node: ast.AST) -> str:
        """Get name from AST node."""
        if isinstance(node, ast.Name):
            return node.id
        elif isinstance(node, ast.Attribute):
            return f"{self._get_name(node.value)}.{node.attr}"
        elif isinstance(node, ast.Constant):
            return str(node.value)
        return "Unknown"
    
    def _calculate_complexity(self, node: ast.AST) -> int:
        """Calculate cyclomatic complexity."""
        complexity = 1  # Base complexity
        
        for child in ast.walk(node):
            if isinstance(child, (ast.If, ast.While, ast.For, ast.AsyncFor)):
                complexity += 1
            elif isinstance(child, ast.ExceptHandler):
                complexity += 1
            elif isinstance(child, (ast.And, ast.Or)):
                complexity += 1
        
        return complexity

def main():
    """CLI interface for the parser."""
    import sys
    import json
    
    if len(sys.argv) != 2:
        print("Usage: python_parser.py <file_path>")
        sys.exit(1)
    
    parser = PythonParser()
    entities = parser.parse_file(sys.argv[1])
    
    # Convert to JSON for output
    result = [{
        'type': e.type,
        'name': e.name,
        'file_path': e.file_path,
        'start_line': e.start_line,
        'end_line': e.end_line,
        'signature': e.signature,
        'docstring': e.docstring,
        'complexity': e.complexity,
        'dependencies': e.dependencies
    } for e in entities]
    
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
EOF

# Create JavaScript/TypeScript parser
cat > "$PARSERS_DIR/js_parser.py" << 'EOF'
#!/usr/bin/env python3
"""JavaScript/TypeScript parser using esprima."""

import json
import subprocess
from typing import List, Dict, Any
from pathlib import Path

class JSParser:
    """JavaScript/TypeScript parser."""
    
    def __init__(self):
        self.ensure_esprima()
    
    def ensure_esprima(self):
        """Ensure esprima is available."""
        try:
            subprocess.run(["node", "-e", "require('esprima')"], 
                         check=True, capture_output=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            print("Installing esprima...")
            subprocess.run(["npm", "install", "-g", "esprima"], check=True)
    
    def parse_file(self, file_path: str) -> List[Dict[str, Any]]:
        """Parse JavaScript/TypeScript file."""
        try:
            # Use esprima to parse JavaScript
            result = subprocess.run([
                "node", "-e", f"""
                const esprima = require('esprima');
                const fs = require('fs');
                const code = fs.readFileSync('{file_path}', 'utf8');
                const ast = esprima.parseScript(code, {{ loc: true, range: true }});
                console.log(JSON.stringify(ast, null, 2));
                """
            ], capture_output=True, text=True, check=True)
            
            ast = json.loads(result.stdout)
            return self._extract_entities(ast, file_path)
            
        except Exception as e:
            print(f"Error parsing {file_path}: {e}")
            return []
    
    def _extract_entities(self, ast: Dict, file_path: str) -> List[Dict[str, Any]]:
        """Extract entities from AST."""
        entities = []
        
        def walk(node):
            if isinstance(node, dict):
                if node.get('type') == 'FunctionDeclaration':
                    entities.append(self._extract_function(node, file_path))
                elif node.get('type') == 'ClassDeclaration':
                    entities.append(self._extract_class(node, file_path))
                elif node.get('type') == 'VariableDeclaration':
                    for decl in node.get('declarations', []):
                        if decl.get('init', {}).get('type') == 'ArrowFunctionExpression':
                            entities.append(self._extract_arrow_function(decl, file_path))
                
                # Recursively walk child nodes
                for key, value in node.items():
                    if isinstance(value, (list, dict)):
                        walk(value)
            elif isinstance(node, list):
                for item in node:
                    walk(item)
        
        walk(ast)
        return entities
    
    def _extract_function(self, node: Dict, file_path: str) -> Dict[str, Any]:
        """Extract function entity."""
        name = node.get('id', {}).get('name', 'anonymous')
        start_line = node.get('loc', {}).get('start', {}).get('line', 0)
        end_line = node.get('loc', {}).get('end', {}).get('line', 0)
        
        params = [p.get('name', '') for p in node.get('params', [])]
        signature = f"function {name}({', '.join(params)})"
        
        return {
            'type': 'function',
            'name': name,
            'file_path': file_path,
            'start_line': start_line,
            'end_line': end_line,
            'signature': signature,
            'docstring': '',
            'complexity': 1,  # TODO: Calculate complexity
            'dependencies': []
        }
    
    def _extract_class(self, node: Dict, file_path: str) -> Dict[str, Any]:
        """Extract class entity."""
        name = node.get('id', {}).get('name', 'anonymous')
        start_line = node.get('loc', {}).get('start', {}).get('line', 0)
        end_line = node.get('loc', {}).get('end', {}).get('line', 0)
        
        signature = f"class {name}"
        
        return {
            'type': 'class',
            'name': name,
            'file_path': file_path,
            'start_line': start_line,
            'end_line': end_line,
            'signature': signature,
            'docstring': '',
            'complexity': 1,
            'dependencies': []
        }
    
    def _extract_arrow_function(self, node: Dict, file_path: str) -> Dict[str, Any]:
        """Extract arrow function entity."""
        name = node.get('id', {}).get('name', 'anonymous')
        start_line = node.get('loc', {}).get('start', {}).get('line', 0)
        end_line = node.get('loc', {}).get('end', {}).get('line', 0)
        
        init = node.get('init', {})
        params = [p.get('name', '') for p in init.get('params', [])]
        signature = f"const {name} = ({', '.join(params)}) => {{}}"
        
        return {
            'type': 'arrow_function',
            'name': name,
            'file_path': file_path,
            'start_line': start_line,
            'end_line': end_line,
            'signature': signature,
            'docstring': '',
            'complexity': 1,
            'dependencies': []
        }

def main():
    """CLI interface."""
    import sys
    
    if len(sys.argv) != 2:
        print("Usage: js_parser.py <file_path>")
        sys.exit(1)
    
    parser = JSParser()
    entities = parser.parse_file(sys.argv[1])
    print(json.dumps(entities, indent=2))

if __name__ == "__main__":
    main()
EOF

# Make parsers executable
chmod +x "$PARSERS_DIR/python_parser.py"
chmod +x "$PARSERS_DIR/js_parser.py"

# Update requirements.txt
cat >> "$REQUIREMENTS_FILE" << 'EOF'
# AST Parser requirements
ast
typing-extensions
pathlib
EOF

# Create parser factory
cat > "$PARSERS_DIR/parser_factory.py" << 'EOF'
#!/usr/bin/env python3
"""Parser factory for different file types."""

from pathlib import Path
from typing import List, Dict, Any, Optional
from .python_parser import PythonParser
from .js_parser import JSParser

class ParserFactory:
    """Factory for creating appropriate parsers based on file type."""
    
    def __init__(self):
        self.parsers = {
            '.py': PythonParser(),
            '.js': JSParser(),
            '.ts': JSParser(),
            '.jsx': JSParser(),
            '.tsx': JSParser(),
        }
    
    def get_parser(self, file_path: str):
        """Get appropriate parser for file type."""
        extension = Path(file_path).suffix
        return self.parsers.get(extension)
    
    def parse_file(self, file_path: str) -> List[Dict[str, Any]]:
        """Parse file using appropriate parser."""
        parser = self.get_parser(file_path)
        if parser:
            return parser.parse_file(file_path)
        else:
            print(f"No parser available for {file_path}")
            return []
    
    def supported_extensions(self) -> List[str]:
        """Get list of supported file extensions."""
        return list(self.parsers.keys())
EOF

# Test the parsers
echo "Testing Python parser..."
cat > "/tmp/test_python.py" << 'EOF'
def hello_world(name: str) -> str:
    """Greet someone."""
    return f"Hello, {name}!"

class TestClass:
    """A test class."""
    def __init__(self):
        pass
EOF

if python3 "$PARSERS_DIR/python_parser.py" "/tmp/test_python.py" > /dev/null 2>&1; then
    echo "✓ Python parser working"
else
    echo "✗ Python parser failed"
    exit 1
fi

echo "✓ AST parsers setup complete"
echo "  - Python parser: $PARSERS_DIR/python_parser.py"
echo "  - JavaScript parser: $PARSERS_DIR/js_parser.py"
echo "  - Parser factory: $PARSERS_DIR/parser_factory.py"

# Cleanup test file
rm -f "/tmp/test_python.py"

exit 0