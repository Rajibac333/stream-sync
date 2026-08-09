"""
Rate limiting on invitations.

README §24 names invitations alongside login and registration. The reason is
not guessing — it is that an invitation is a write that reaches a person, and
an unbounded invite endpoint is an unbounded way to generate messages carrying
StreamSync's name.

The suite disables throttling globally, so this test re-enables it deliberately
by patching `THROTTLE_RATES` on the class. `override_settings` cannot do it:
the rate is bound at import.
"""

from typing import Any
from unittest import mock

import pytest
from django.core.cache import cache
from rest_framework.throttling import SimpleRateThrottle

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def clear_throttle_history() -> Any:
    cache.clear()
    yield
    cache.clear()


def test_invitations_are_capped(
    client_for: Any, owner: Any, workspace: Any, user_factory: Any
) -> None:
    invitees = [user_factory(name=f"Invitee {index}") for index in range(3)]
    client = client_for(owner)
    url = f"/api/workspaces/{workspace.id}/invitations/"

    with mock.patch.object(
        SimpleRateThrottle, "THROTTLE_RATES", {"workspace_invite": "2/hour"}
    ):
        statuses = [
            client.post(
                url, {"email": invitee.email, "role": "editor"}, format="json"
            ).status_code
            for invitee in invitees
        ]

    assert statuses == [201, 201, 429]

    # The refused invitation created nothing.
    assert workspace.memberships.count() == 3  # owner + the two that succeeded


def test_the_limit_is_per_user(
    client_for: Any,
    owner: Any,
    editor: Any,
    workspace: Any,
    other_workspace: Any,
    outsider: Any,
    user_factory: Any,
) -> None:
    """One owner exhausting their budget must not block another workspace."""
    first = user_factory(name="First Invitee")
    second = user_factory(name="Second Invitee")

    with mock.patch.object(
        SimpleRateThrottle, "THROTTLE_RATES", {"workspace_invite": "1/hour"}
    ):
        owner_client = client_for(owner)
        url = f"/api/workspaces/{workspace.id}/invitations/"

        assert (
            owner_client.post(
                url, {"email": first.email, "role": "editor"}, format="json"
            ).status_code
            == 201
        )
        assert (
            owner_client.post(
                url, {"email": second.email, "role": "editor"}, format="json"
            ).status_code
            == 429
        )

        other = client_for(outsider).post(
            f"/api/workspaces/{other_workspace.id}/invitations/",
            {"email": editor.email, "role": "viewer"},
            format="json",
        )
        assert other.status_code == 201
