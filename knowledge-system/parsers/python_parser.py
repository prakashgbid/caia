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
