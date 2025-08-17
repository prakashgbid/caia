"""Custom exceptions for auto-coder"""


class AutoCoderError(Exception):
    """Base exception for auto-coder"""
    pass


class ConfigurationError(AutoCoderError):
    """Raised when configuration is invalid"""
    pass


class ValidationError(AutoCoderError):
    """Raised when validation fails"""
    pass
