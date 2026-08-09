"""
Reusable DRF permission classes.

Access rules live here rather than in views so that no two endpoints can drift
into subtly different interpretations of the same rule. (README §37)
"""

from .workspace import (
    ROLE_ORDER,
    BaseWorkspacePermission,
    IsWorkspaceEditor,
    IsWorkspaceMember,
    IsWorkspaceMemberOrOwnerForWrite,
    IsWorkspaceOwner,
    get_membership,
    has_workspace_role,
)

__all__ = [
    "ROLE_ORDER",
    "BaseWorkspacePermission",
    "IsWorkspaceEditor",
    "IsWorkspaceMember",
    "IsWorkspaceMemberOrOwnerForWrite",
    "IsWorkspaceOwner",
    "get_membership",
    "has_workspace_role",
]
