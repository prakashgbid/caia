"""
Autonomix
=========

Autonomous AI engine that intelligently determines and executes tasks.
"""

__version__ = "0.1.0"
__author__ = "Autonomix Contributors"

from .core import AutonomixEngine
from .exceptions import AutonomixError

__all__ = [
    "AutonomixEngine",
    "AutonomixError",
]
