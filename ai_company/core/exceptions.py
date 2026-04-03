class AICompanyError(Exception):
    """Base exception for AI Company."""


class ProjectNotFoundError(AICompanyError):
    """Raised when a project is not found."""


class RequirementNotFoundError(AICompanyError):
    """Raised when a requirement is not found."""


class BuildError(AICompanyError):
    """Raised when a build fails."""
