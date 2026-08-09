"""
Shared pytest fixtures.

Tests live in a top-level `tests/` package mirroring the app layout rather than
inside each app, so the suite can be reasoned about (and excluded from the
production image) as one unit. (README §3, §26)
"""

from typing import Any

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

User = get_user_model()

# Long enough to satisfy MinimumLengthValidator and unlike anything in the
# common-password list. Test-only.
DEFAULT_TEST_PASSWORD = "correct-horse-battery-staple-42"


@pytest.fixture
def api_client() -> APIClient:
    """An unauthenticated DRF client."""
    return APIClient()


@pytest.fixture
def user_factory(db: None) -> Any:
    """
    Builds users with sane defaults and a unique email per call.

    A factory rather than a fixed fixture because most permission tests need
    two or three distinct users, and duplicating create_user calls across
    modules is how test setups drift apart.
    """
    created: list[Any] = []

    def factory(**kwargs: Any) -> Any:
        index = len(created)
        defaults: dict[str, Any] = {
            "email": f"user{index}@streamsync.test",
            "name": f"Test User {index}",
            "password": DEFAULT_TEST_PASSWORD,
        }
        defaults.update(kwargs)
        user = User.objects.create_user(**defaults)
        created.append(user)
        return user

    return factory


@pytest.fixture
def user(user_factory: Any) -> Any:
    """A single ordinary, active user."""
    return user_factory()


@pytest.fixture
def superuser(db: None) -> Any:
    return User.objects.create_superuser(
        email="admin@streamsync.test",
        name="Admin User",
        password=DEFAULT_TEST_PASSWORD,
    )


@pytest.fixture
def access_token_factory(db: None) -> Any:
    """Mint a real access token for a user."""

    def factory(target: Any) -> str:
        from rest_framework_simplejwt.tokens import AccessToken

        return str(AccessToken.for_user(target))

    return factory


@pytest.fixture
def authenticated_client(
    api_client: APIClient, user: Any, access_token_factory: Any
) -> APIClient:
    """
    A client bound to `user`, carrying a genuine bearer token.

    Real tokens rather than force_authenticate: this exercises the whole
    JWTAuthentication path — header parsing, signature verification, user
    lookup — which is what production requests actually go through.
    """
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token_factory(user)}")
    return api_client


# ---------------------------------------------------------------------------
# Workspace, project and document fixtures
#
# Defined here rather than in each suite's conftest because all three suites
# need them: a document test needs a project, and a project test needs a
# staffed workspace. Chaining them through `pytest_plugins` in nested
# conftests double-registers the module, so the shared set lives at the root.
# ---------------------------------------------------------------------------


@pytest.fixture
def client_for(access_token_factory: Any) -> Any:
    """Build an API client authenticated as a given user."""

    def factory(target: Any) -> APIClient:
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token_factory(target)}")
        return client

    return factory


@pytest.fixture
def owner(user_factory: Any) -> Any:
    return user_factory(name="Owner User", email="owner@streamsync.test")


@pytest.fixture
def editor(user_factory: Any) -> Any:
    return user_factory(name="Editor User", email="editor@streamsync.test")


@pytest.fixture
def viewer(user_factory: Any) -> Any:
    return user_factory(name="Viewer User", email="viewer@streamsync.test")


@pytest.fixture
def outsider(user_factory: Any) -> Any:
    """Belongs to no shared workspace. The subject of every isolation test."""
    return user_factory(name="Outsider User", email="outsider@streamsync.test")


@pytest.fixture
def workspace(owner: Any) -> Any:
    """A workspace whose only member is its owner."""
    from apps.workspaces import services

    return services.create_workspace(
        owner=owner, name="EverTech", description="Product team workspace"
    )


@pytest.fixture
def staffed_workspace(workspace: Any, editor: Any, viewer: Any) -> Any:
    """
    A workspace with one active member per role.

    Invitations are accepted here so the fixture models a settled team; the
    invitation flow itself is tested explicitly rather than assumed.
    """
    from apps.workspaces import services
    from apps.workspaces.models import WorkspaceRole

    for member, role in (
        (editor, WorkspaceRole.EDITOR),
        (viewer, WorkspaceRole.VIEWER),
    ):
        services.invite_member(
            workspace=workspace,
            invited_by=workspace.owner,
            email=member.email,
            role=role,
        )
        services.accept_invitation(workspace=workspace, user=member)

    return workspace


@pytest.fixture
def other_workspace(outsider: Any) -> Any:
    """
    A workspace belonging to somebody else entirely.

    The subject of every cross-tenant test: its projects and documents must be
    unreachable from `staffed_workspace`'s members.
    """
    from apps.workspaces import services

    return services.create_workspace(owner=outsider, name="Rival Team")


@pytest.fixture
def project(staffed_workspace: Any, owner: Any) -> Any:
    from apps.projects import services

    return services.create_project(
        workspace=staffed_workspace,
        owner=owner,
        name="Checkout Revamp",
        description="Stripe and Apple Pay",
    )


@pytest.fixture
def other_project(other_workspace: Any, outsider: Any) -> Any:
    from apps.projects import services

    return services.create_project(
        workspace=other_workspace, owner=outsider, name="Rival Roadmap"
    )


@pytest.fixture
def document(staffed_workspace: Any, owner: Any) -> Any:
    from apps.documents import services

    return services.create_document(
        workspace=staffed_workspace,
        author=owner,
        title="Payment Requirements",
        content="<p>Stripe will be used for payment processing.</p>",
    )


@pytest.fixture
def other_document(other_workspace: Any, outsider: Any) -> Any:
    """Lives in a workspace none of the role fixtures belong to."""
    from apps.documents import services

    return services.create_document(
        workspace=other_workspace,
        author=outsider,
        title="Rival Secrets",
        content="<p>Confidential rival planning.</p>",
    )


# ---------------------------------------------------------------------------
# Task and comment fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def task(staffed_workspace: Any, project: Any, owner: Any) -> Any:
    from apps.tasks import services

    return services.create_task(
        workspace=staffed_workspace,
        project=project,
        creator=owner,
        title="Implement Stripe API",
        description="Payment intent flow",
    )


@pytest.fixture
def other_task(other_workspace: Any, other_project: Any, outsider: Any) -> Any:
    """Lives in a workspace none of the role fixtures belong to."""
    from apps.tasks import services

    return services.create_task(
        workspace=other_workspace,
        project=other_project,
        creator=outsider,
        title="Rival Task",
    )


@pytest.fixture
def comment(document: Any, owner: Any) -> Any:
    """A thread root on a document."""
    from apps.comments import services

    return services.create_comment(
        workspace=document.workspace,
        author=owner,
        document=document,
        body="Should we support Apple Pay too?",
    )


@pytest.fixture
def task_comment(task: Any, editor: Any) -> Any:
    """A thread root on a task."""
    from apps.comments import services

    return services.create_comment(
        workspace=task.workspace,
        author=editor,
        task=task,
        body="Blocked on API keys.",
    )
