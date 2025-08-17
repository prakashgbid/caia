"""
smart-planner
================

A powerful Python package extracted from MemCore.
"""

__version__ = "0.1.0"
__author__ = "MemCore Contributors"

from .core import SmartPlanner
from .exceptions import SmartPlannerError

__all__ = [
    "SmartPlanner",
    "SmartPlannerError",
]
