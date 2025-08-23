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
