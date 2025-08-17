"""Custom exceptions for Autonomix"""


class AutonomixError(Exception):
    """Base exception for Autonomix"""
    pass


class ConfigurationError(AutonomixError):
    """Raised when configuration is invalid"""
    pass


class ValidationError(AutonomixError):
    """Raised when validation fails"""
    pass
