"""Utility functions for smart-planner"""

from typing import Dict, Any, Optional, List, Tuple, Union, Callable


def get_task_planner(llm_engine=None, config: Dict[str, Any]=None) -> TaskPlanner:
    """Get or create the global task planner"""
    global _task_planner
    if _task_planner is None:
        _task_planner = TaskPlanner(llm_engine, config)
    return _task_planner