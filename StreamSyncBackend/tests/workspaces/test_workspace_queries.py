"""
Query-count guarantees.

`role` and `member_count` are per-workspace values, so the naive implementation
issues two extra queries for every row returned. The annotations in
`visible_workspaces` exist to prevent that, and these tests are what stop a
later change from quietly reintroducing it. (README §27)
"""

from typing import Any

import pytest
from django.urls import reverse

from apps.workspaces import services
from apps.workspaces.models import WorkspaceRole

pytestmark = pytest.mark.django_db

LIST_URL = reverse("workspaces:list-create")


class TestWorkspaceListQueryCount:
    def test_query_count_does_not_grow_with_the_number_of_workspaces(
        self,
        client_for: Any,
        owner: Any,
        django_assert_num_queries: Any,
        django_assert_max_num_queries: Any,
    ) -> None:
        """
        The assertion is that the two counts are *equal*, not what they are.

        The baseline is measured rather than hardcoded, so the test keeps
        checking the property that matters — cost is independent of result-set
        size — instead of failing whenever an unrelated query is added.
        """
        client = client_for(owner)

        services.create_workspace(owner=owner, name="Alpha")
        with django_assert_max_num_queries(10) as baseline:
            client.get(LIST_URL)

        for name in ("Beta", "Gamma", "Delta", "Epsilon"):
            services.create_workspace(owner=owner, name=name)

        with django_assert_num_queries(len(baseline.captured_queries)):
            response = client.get(LIST_URL)

        assert response.json()["count"] == 5

    def test_member_list_does_not_query_per_member(
        self,
        client_for: Any,
        staffed_workspace: Any,
        owner: Any,
        user_factory: Any,
        django_assert_num_queries: Any,
        django_assert_max_num_queries: Any,
    ) -> None:
        """
        `select_related("user")` is what keeps this flat.

        The fixed cost includes one membership lookup by the permission class,
        which deliberately performs its own authoritative check rather than
        trusting the `request_role` annotation the queryset attached for
        display. Authorization reading from a presentation-layer value is the
        kind of coupling that turns a serializer change into a security bug.
        """
        client = client_for(owner)

        with django_assert_max_num_queries(10) as baseline:
            client.get(reverse("workspaces:members", args=[staffed_workspace.id]))

        for index in range(3):
            extra = user_factory(email=f"extra{index}@streamsync.test")
            services.invite_member(
                workspace=staffed_workspace,
                invited_by=owner,
                email=extra.email,
                role=WorkspaceRole.VIEWER,
            )

        with django_assert_num_queries(len(baseline.captured_queries)):
            response = client.get(
                reverse("workspaces:members", args=[staffed_workspace.id])
            )

        assert response.json()["count"] == 6
