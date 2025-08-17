"""
auto-coder
=============

A powerful Python package extracted from MemCore.
"""

__version__ = "0.1.0"
__author__ = "MemCore Contributors"

from .core import AutoCoder
from .exceptions import AutoCoderError

__all__ = [
    "AutoCoder",
    "AutoCoderError",
]
