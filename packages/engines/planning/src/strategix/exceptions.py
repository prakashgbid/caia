"""Custom exceptions for smart-planner"""


class SmartPlannerError(Exception):
    """Base exception for smart-planner"""
    pass


class ConfigurationError(SmartPlannerError):
    """Raised when configuration is invalid"""
    pass


class ValidationError(SmartPlannerError):
    """Raised when validation fails"""
    pass
