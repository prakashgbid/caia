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
