"""Custom exceptions for deep-reasoner"""


class DeepReasonerError(Exception):
    """Base exception for deep-reasoner"""
    pass


class ConfigurationError(DeepReasonerError):
    """Raised when configuration is invalid"""
    pass


class ValidationError(DeepReasonerError):
    """Raised when validation fails"""
    pass
