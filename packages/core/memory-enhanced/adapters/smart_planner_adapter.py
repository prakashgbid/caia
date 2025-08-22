"""Adapter for using extracted smart-planner module"""

try:
    from memcore import SmartPlanner
    AVAILABLE = True
except ImportError:
    AVAILABLE = False
    
    # Fallback to original implementation
    from .Users.MAC.Documents.projects.omnimind.src.core.task_planner.py import *

# Compatibility layer
if AVAILABLE:
    # Module has been extracted and installed
    pass
else:
    # Using original MemCore implementation
    pass
