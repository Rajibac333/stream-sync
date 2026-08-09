"""
N+1 guarantees for the project and document lists.

Both payloads embed related rows — a document's project, author, last editor
and contributors; a project's workspace members — so the naive queryset costs
several queries per row. The `select_related` / `prefetch_related` calls in the
views exist to prevent that, and these tests are what stop a later change from
quietly undoing it. (README §27)
"""

from typing import Any

import pytest
from django.urls import reverse

from apps.documents import services as document_services
from apps.projects import services as project_services

pytestmark = pytest.mark.django_db

DOCUMENTS_URL = reverse("documents:list-create")
PROJECTS_URL = reverse("projects:list-create")


class TestDocumentListEfficiency:
    def test_query_count_is_flat_in_the_number_of_documents(
        self,
        client_for: Any,
        staffed_workspace: Any,
        owner: Any,
        editor: Any,
        django_assert_num_queries: Any,
        django_assert_max_num_queries: Any,
    ) -> None:
        """
        The assertion is that the two counts are equal, not what they are.

        The baseline is measured rather than hardcoded, so the test keeps
        checking the property that matters instead of failing whenever an
        unrelated query is added elsewhere.
        """
        client = client_for(owner)

        document_services.create_document(
            workspace=staffed_workspace, author=owner, title="First"
        )
        with django_assert_max_num_queries(15) as baseline:
            client.get(DOCUMENTS_URL)

        for index in range(5):
            document_services.create_document(
                workspace=staffed_workspace,
                # A different author each time, so the related-user joins
                # actually vary rather than hitting one cached row.
                author=editor if index % 2 else owner,
                title=f"Doc {index}",
            )

        with django_assert_num_queries(len(baseline.captured_queries)):
            response = client.get(DOCUMENTS_URL)

        assert response.json()["count"] == 6

    def test_list_does_not_load_document_bodies(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        """
        `defer("content")` keeps the largest column out of the list query.

        Asserted against the emitted SQL because the response omitting
        `content` proves nothing on its own — the serializer would omit it
        either way, having already paid to read it.
        """
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        document_services.create_document(
            workspace=staffed_workspace,
            author=owner,
            title="Heavy",
            content="<p>" + ("x" * 5000) + "</p>",
        )

        with CaptureQueriesContext(connection) as captured:
            client_for(owner).get(DOCUMENTS_URL)

        selects = [
            query["sql"]
            for query in captured.captured_queries
            if 'FROM "documents_document"' in query["sql"]
            and query["sql"].lstrip().upper().startswith("SELECT")
        ]

        assert selects, "expected the document list query to have run"
        assert not any('"documents_document"."content"' in sql for sql in selects)

    def test_detail_does_load_the_body(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        """The deferral must not leak into the editor's payload."""
        response = client_for(owner).get(
            reverse("documents:detail", args=[document.id])
        )

        assert response.json()["content"]


class TestProjectListEfficiency:
    def test_query_count_is_flat_in_the_number_of_projects(
        self,
        client_for: Any,
        staffed_workspace: Any,
        owner: Any,
        django_assert_num_queries: Any,
        django_assert_max_num_queries: Any,
    ) -> None:
        """`members` is prefetched, so it costs one query rather than one per row."""
        client = client_for(owner)

        project_services.create_project(
            workspace=staffed_workspace, owner=owner, name="First"
        )
        with django_assert_max_num_queries(15) as baseline:
            client.get(PROJECTS_URL)

        for index in range(5):
            project_services.create_project(
                workspace=staffed_workspace, owner=owner, name=f"Project {index}"
            )

        with django_assert_num_queries(len(baseline.captured_queries)):
            response = client.get(PROJECTS_URL)

        assert response.json()["count"] == 6
