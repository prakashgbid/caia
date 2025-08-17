"""Utility functions for auto-coder"""

from typing import Dict, Any, Optional, List, Tuple


def get_code_generator(langchain_engine=None, config: Dict[str, Any]=None) -> CodeGenerator:
    """Get or create the global code generator"""
    global _code_generator
    if _code_generator is None:
        _code_generator = CodeGenerator(langchain_engine, config)
    return _code_generator