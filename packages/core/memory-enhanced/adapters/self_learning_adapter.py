"""Adapter for using the extracted self-learning module"""

import sys
from pathlib import Path

# Add module path (temporary until pip install)
module_path = Path(__file__).parent.parent.parent / "modules" / "self-learning" / "src"
sys.path.insert(0, str(module_path))

# Import from the extracted module
try:
    import self_learning
    # TODO: Import specific components
except ImportError:
    print(f"Warning: self-learning not installed. Install with: pip install self-learning")
    self_learning = None

# Re-export for backward compatibility
__all__ = [
    # TODO: Add exports
]
