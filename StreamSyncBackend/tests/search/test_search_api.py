"""
Global search.

The endpoint that backs the command menu. Two things matter more than ranking
quality: it must never return something the caller could not already open, and
it must stay cheap enough to run on every keystroke.
"""

from typing import Any

import pytest

pytestmark = pytest.mark.django_db

URL = "/api/search/"


@pytest.fixture
def searchable(
    staffed_workspace: Any, owner: Any, project: Any, document: Any, task: Any
) -> Any:
    from apps.documents import services as document_services
    from apps.tasks import services as task_services

    document_services.update_document(
        document=document, editor=owner, title="Billing", content="<p>Stripe notes.</p>"
    )
    task_services.update_task(task=task, editor=owner, title="Billing migration plan")
    project.name = "Billing v2"
    project.save(update_fields=["name", "updated_at"])
    return staffed_workspace


class TestResults:
    def test_finds_documents_projects_and_tasks(
        self, client_for: Any, owner: Any, searchable: Any
    ) -> None:
        response = client_for(owner).get(URL, {"q": "billing"})

        assert response.status_code == 200
        found = {(hit["type"], hit["title"]) for hit in response.json()}
        assert ("document", "Billing") in found
        assert ("project", "Billing v2") in found
        assert ("task", "Billing migration plan") in found

    def test_results_are_a_flat_ranked_array(
        self, client_for: Any, owner: Any, searchable: Any
    ) -> None:
        """
        Not paginated and not bucketed by type.

        The command menu ranks across kinds — an exactly-named document should
        outrank a project that merely contains the word — which is only
        possible if the transport hands over one ordered list.
        """
        body = client_for(owner).get(URL, {"q": "billing"}).json()

        assert isinstance(body, list)
        scores = [hit["score"] for hit in body]
        assert scores == sorted(scores, reverse=True)
        assert body[0]["title"] == "Billing"

    def test_people_are_searchable(
        self, client_for: Any, owner: Any, editor: Any, staffed_workspace: Any
    ) -> None:
        body = client_for(owner).get(URL, {"q": editor.name}).json()

        people = [hit for hit in body if hit["type"] == "person"]
        assert [hit["title"] for hit in people] == [editor.name]
        assert people[0]["subtitle"] == editor.email

    def test_each_hit_carries_a_link(
        self, client_for: Any, owner: Any, searchable: Any
    ) -> None:
        """The menu navigates on select; a hit with no href is a dead row."""
        for hit in client_for(owner).get(URL, {"q": "billing"}).json():
            assert hit["href"].startswith("/app/workspaces/")


class TestIsolation:
    def test_another_workspaces_content_is_never_returned(
        self,
        client_for: Any,
        outsider: Any,
        other_workspace: Any,
        owner: Any,
        searchable: Any,
    ) -> None:
        """
        The titles alone would be the leak.

        Search is the endpoint where a missed scope check discloses that other
        tenants exist and what they are working on, without granting access to
        anything.
        """
        from apps.documents import services as document_services

        document_services.create_document(
            workspace=other_workspace,
            author=outsider,
            title="Billing secrets",
            content="<p>Private.</p>",
        )

        titles = [
            hit["title"] for hit in client_for(owner).get(URL, {"q": "billing"}).json()
        ]

        assert "Billing secrets" not in titles

    def test_a_workspace_filter_narrows_but_does_not_widen(
        self,
        client_for: Any,
        outsider: Any,
        other_workspace: Any,
        owner: Any,
        searchable: Any,
    ) -> None:
        """Naming somebody else's workspace grants nothing."""
        response = client_for(owner).get(
            URL, {"q": "billing", "workspace": str(other_workspace.id)}
        )

        assert response.status_code == 200
        assert response.json() == []


class TestGuards:
    def test_authentication_is_required(self, api_client: Any) -> None:
        assert api_client.get(URL, {"q": "billing"}).status_code == 401

    @pytest.mark.parametrize("query", ["", "b", "   "])
    def test_queries_shorter_than_two_characters_return_nothing(
        self, client_for: Any, owner: Any, searchable: Any, query: str
    ) -> None:
        """A one-letter query matches most of a corpus and ranks meaninglessly."""
        response = client_for(owner).get(URL, {"q": query})

        assert response.status_code == 200
        assert response.json() == []

    def test_a_malformed_workspace_id_is_empty_not_an_error(
        self, client_for: Any, owner: Any, searchable: Any
    ) -> None:
        """A stale bookmark should show "no results", not an error page."""
        response = client_for(owner).get(
            URL, {"q": "billing", "workspace": "not-a-uuid"}
        )

        assert response.status_code == 200
        assert response.json() == []

    def test_the_result_set_is_bounded(
        self, client_for: Any, owner: Any, staffed_workspace: Any
    ) -> None:
        """Unpaginated must not mean unbounded."""
        from apps.documents import services as document_services
        from apps.search.services import TOTAL_LIMIT

        for index in range(30):
            document_services.create_document(
                workspace=staffed_workspace,
                author=owner,
                title=f"Billing report {index}",
                content="",
            )

        body = client_for(owner).get(URL, {"q": "billing"}).json()

        assert len(body) <= TOTAL_LIMIT

    def test_the_query_count_does_not_grow_with_results(
        self,
        client_for: Any,
        owner: Any,
        staffed_workspace: Any,
        searchable: Any,
        django_assert_num_queries: Any,
        django_assert_max_num_queries: Any,
    ) -> None:
        """
        Four entity queries plus auth, however many rows match.

        This endpoint is called on every keystroke, so a per-result query would
        be felt immediately. The baseline is measured rather than hardcoded, so
        the test keeps checking the property that matters.
        """
        from apps.documents import services as document_services

        client = client_for(owner)
        with django_assert_max_num_queries(15) as baseline:
            client.get(URL, {"q": "billing"})

        for index in range(8):
            document_services.create_document(
                workspace=staffed_workspace,
                author=owner,
                title=f"Billing extra {index}",
                content="",
            )

        with django_assert_num_queries(len(baseline.captured_queries)):
            client.get(URL, {"q": "billing"})
