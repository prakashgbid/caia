"""Adapter for using extracted o-s-a-autonomous module"""

try:
    from memcore import MemCoreAutonomous
    AVAILABLE = True
except ImportError:
    AVAILABLE = False
    
    # Fallback to original implementation
    from .Users.MAC.Documents.projects.omnimind.src.core.osa_autonomous.py import *

# Compatibility layer
if AVAILABLE:
    # Module has been extracted and installed
    pass
else:
    # Using original MemCore implementation
    pass
