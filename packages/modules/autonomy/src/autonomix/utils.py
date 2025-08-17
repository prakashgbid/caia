"""Utility functions for Autonomix"""

import logging
from typing import Optional


def setup_logger(name: str, level: str = 'INFO') -> logging.Logger:
    """Setup logger with specified name and level"""
    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, level.upper()))
    
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    
    return logger