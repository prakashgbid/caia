"""Adapter for using extracted deep-reasoner module"""

try:
    from memcore import DeepReasoner
    AVAILABLE = True
except ImportError:
    AVAILABLE = False
    
    # Fallback to original implementation
    from .Users.MAC.Documents.projects.omnimind.src.core.modules.thinking.py import *

# Compatibility layer
if AVAILABLE:
    # Module has been extracted and installed
    pass
else:
    # Using original MemCore implementation
    pass
