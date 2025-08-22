"""Adapter for using extracted auto-coder module"""

try:
    from memcore import AutoCoder
    AVAILABLE = True
except ImportError:
    AVAILABLE = False
    
    # Fallback to original implementation
    from .Users.MAC.Documents.projects.omnimind.src.core.code_generator.py import *

# Compatibility layer
if AVAILABLE:
    # Module has been extracted and installed
    pass
else:
    # Using original MemCore implementation
    pass
