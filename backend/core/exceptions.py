"""Shared exception types used across backend modules."""
from __future__ import annotations


class TMToolsError(Exception):
    """Base exception for all TMTools application errors."""


class ProcessingError(TMToolsError):
    """Raised by the media processing pipeline (FFmpeg, S3) on failure."""


class ConfigurationError(TMToolsError):
    """Raised when required configuration is missing or invalid."""


class IntegrationError(TMToolsError):
    """Raised by integration clients for unrecoverable errors."""
