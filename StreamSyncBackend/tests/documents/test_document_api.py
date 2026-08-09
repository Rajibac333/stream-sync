"""
Document CRUD, permissions, filtering and search.

The initial-version guarantee gets its own class: it is the one invariant this
milestone is explicitly required to establish, and it is the kind of thing that
breaks silently.
"""

import uuid
from typing import Any

import pytest
from django.urls import reverse

from apps.documents.models import Document, DocumentVersion

pytestmark = pytest.mark.django_db

LIST_URL = reverse("documents:list-create")


def detail_url(document) -> str:
    return reverse("documents:detail", args=[document.id])


class TestDocumentCreation:
    def test_editor_can_create_a_document(
        self, client_for: Any, staffed_workspace: Any, editor: Any
    ) -> None:
        response = client_for(editor).post(
            LIST_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "title": "Payment Requirements",
                "content": "<p>Stripe it is.</p>",
            },
        )

        assert response.status_code == 201

        body = response.json()
        assert body["title"] == "Payment Requirements"
        assert body["author"]["id"] == str(editor.id)
        assert body["last_edited_by"]["id"] == str(editor.id)

    def test_viewer_cannot_create_a_document(
        self, client_for: Any, staffed_workspace: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).post(
            LIST_URL, {"workspace_id": str(staffed_workspace.id), "title": "Notes"}
        )

        assert response.status_code == 403
        assert not Document.objects.exists()

    def test_non_member_cannot_create_a_document(
        self, client_for: Any, staffed_workspace: Any, outsider: Any
    ) -> None:
        response = client_for(outsider).post(
            LIST_URL, {"workspace_id": str(staffed_workspace.id), "title": "Intrusion"}
        )

        assert response.status_code == 404
        assert not Document.objects.exists()

    def test_can_be_filed_under_a_project(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(
            LIST_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "title": "Spec",
                "project_id": str(project.id),
            },
        )

        assert response.status_code == 201
        assert response.json()["project_id"] == str(project.id)
        assert response.json()["project_name"] == project.name

    def test_project_is_optional(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(
            LIST_URL, {"workspace_id": str(staffed_workspace.id), "title": "Unfiled"}
        )

        assert response.status_code == 201
        assert response.json()["project_id"] is None
        assert response.json()["project_name"] is None

    def test_cannot_file_under_a_project_from_another_workspace(
        self, client_for: Any, staffed_workspace: Any, other_project: Any, owner: Any
    ) -> None:
        """
        Honouring this would place a document from one tenant inside another's
        project. Ignoring it would silently misfile the user's work.
        """
        response = client_for(owner).post(
            LIST_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "title": "Spec",
                "project_id": str(other_project.id),
            },
        )

        assert response.status_code == 404
        assert not Document.objects.exists()

    def test_rejects_a_blank_title(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(
            LIST_URL, {"workspace_id": str(staffed_workspace.id), "title": "   "}
        )

        assert response.status_code == 400
        assert "title" in response.json()["error"]["details"]

    def test_requires_authentication(
        self, api_client: Any, staffed_workspace: Any
    ) -> None:
        response = api_client.post(
            LIST_URL, {"workspace_id": str(staffed_workspace.id), "title": "Notes"}
        )

        assert response.status_code == 401


class TestInitialVersion:
    """
    The transactional guarantee this milestone is required to establish.

    A document whose history starts at version 2 has lost its original state
    permanently — nothing later can reconstruct it.
    """

    def test_creation_writes_version_one(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(
            LIST_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "title": "Spec",
                "content": "<p>Original body.</p>",
            },
        )

        versions = DocumentVersion.objects.filter(document_id=response.json()["id"])

        assert versions.count() == 1
        version = versions.get()
        assert version.version_number == 1
        assert version.content == "<p>Original body.</p>"
        assert version.created_by == owner

    def test_document_starts_at_revision_one(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        body = client_for(owner).get(detail_url(document)).json()

        assert body["revision"] == 1

    def test_no_document_is_left_without_its_version(
        self, staffed_workspace: Any, owner: Any
    ) -> None:
        """
        Both rows or neither. Asserted over the whole table so a future code
        path that creates documents directly cannot quietly skip the version.
        """
        from apps.documents import services

        for index in range(3):
            services.create_document(
                workspace=staffed_workspace, author=owner, title=f"Doc {index}"
            )

        for doc in Document.objects.all():
            assert doc.versions.count() >= 1

    def test_creation_rolls_back_entirely_if_the_version_fails(
        self, staffed_workspace: Any, owner: Any, monkeypatch: Any
    ) -> None:
        """The transaction is what makes 'both or neither' true."""
        from apps.documents import services
        from apps.documents.models import DocumentVersion as Version

        def explode(*args, **kwargs):
            raise RuntimeError("version store unavailable")

        monkeypatch.setattr(Version.objects, "create", explode)

        with pytest.raises(RuntimeError):
            services.create_document(
                workspace=staffed_workspace, author=owner, title="Doomed"
            )

        assert not Document.objects.filter(title="Doomed").exists()

    def test_versions_are_immutable(self, document: Any) -> None:
        """History that can be edited is not history. (README §9)"""
        version = document.versions.get()
        version.content = "<p>Rewritten past.</p>"

        with pytest.raises(ValueError, match="immutable"):
            version.save()

    def test_version_numbers_are_unique_per_document(
        self, document: Any, owner: Any
    ) -> None:
        from django.db import IntegrityError, transaction

        with pytest.raises(IntegrityError), transaction.atomic():
            DocumentVersion.objects.create(
                document=document, version_number=1, content="x", created_by=owner
            )


class TestDocumentListing:
    def test_lists_documents_in_my_workspaces(
        self, client_for: Any, document: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).get(LIST_URL)

        assert response.status_code == 200
        assert [d["id"] for d in response.json()["results"]] == [str(document.id)]

    def test_excludes_documents_from_other_workspaces(
        self, client_for: Any, document: Any, other_document: Any, viewer: Any
    ) -> None:
        """The core isolation guarantee for documents."""
        ids = [d["id"] for d in client_for(viewer).get(LIST_URL).json()["results"]]

        assert ids == [str(document.id)]
        assert str(other_document.id) not in ids

    def test_list_omits_the_body(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        """
        Shipping every body would transfer megabytes to render a list of
        titles. `excerpt` is what the preview uses.
        """
        row = client_for(owner).get(LIST_URL).json()["results"][0]

        assert "content" not in row
        assert row["excerpt"] == "Stripe will be used for payment processing."

    def test_excerpt_strips_markup(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        """A preview that began mid-tag would render markup at the user."""
        client = client_for(owner)
        client.post(
            LIST_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "title": "Marked up",
                "content": "<h1>Title</h1><p>Body <strong>text</strong>.</p>",
            },
        )

        row = client.get(LIST_URL, {"search": "Marked up"}).json()["results"][0]

        assert "<" not in (row["excerpt"] or "")
        assert row["excerpt"] == "Title Body text."

    def test_empty_body_serialises_excerpt_as_null(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        client.post(
            LIST_URL, {"workspace_id": str(staffed_workspace.id), "title": "Empty"}
        )

        row = client.get(LIST_URL, {"search": "Empty"}).json()["results"][0]

        assert row["excerpt"] is None

    def test_active_collaborators_are_empty_without_websockets(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        """Nobody is connected because there is no socket yet. (Milestone 7)"""
        row = client_for(owner).get(LIST_URL).json()["results"][0]

        assert row["active_collaborator_ids"] == []

    def test_collaborators_include_the_author(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        row = client_for(owner).get(LIST_URL).json()["results"][0]

        assert [c["id"] for c in row["collaborators"]] == [str(owner.id)]

    def test_is_paginated(self, client_for: Any, document: Any, owner: Any) -> None:
        body = client_for(owner).get(LIST_URL).json()

        assert {"count", "page", "page_size", "total_pages", "results"} <= set(body)


class TestDocumentFiltering:
    def test_filters_by_workspace(
        self, client_for: Any, document: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        response = client_for(owner).get(
            LIST_URL, {"workspace": str(staffed_workspace.id)}
        )

        assert [d["id"] for d in response.json()["results"]] == [str(document.id)]

    def test_filtering_by_someone_elses_workspace_returns_nothing(
        self, client_for: Any, document: Any, other_workspace: Any, owner: Any
    ) -> None:
        response = client_for(owner).get(
            LIST_URL, {"workspace": str(other_workspace.id)}
        )

        assert response.json()["results"] == []

    def test_filters_by_project(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        base = {"workspace_id": str(staffed_workspace.id)}
        client.post(LIST_URL, {**base, "title": "Filed", "project_id": str(project.id)})
        client.post(LIST_URL, {**base, "title": "Unfiled"})

        body = client.get(LIST_URL, {"project": str(project.id)}).json()

        assert body["count"] == 1
        assert body["results"][0]["title"] == "Filed"

    def test_filters_for_unfiled_documents(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        base = {"workspace_id": str(staffed_workspace.id)}
        client.post(LIST_URL, {**base, "title": "Filed", "project_id": str(project.id)})
        client.post(LIST_URL, {**base, "title": "Unfiled"})

        body = client.get(LIST_URL, {"project": "none"}).json()

        assert body["count"] == 1
        assert body["results"][0]["title"] == "Unfiled"

    def test_orders_by_the_requested_field(
        self, client_for: Any, staffed_workspace: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        base = {"workspace_id": str(staffed_workspace.id)}
        client.post(LIST_URL, {**base, "title": "Zebra"})
        client.post(LIST_URL, {**base, "title": "Alpha"})

        body = client.get(LIST_URL, {"ordering": "title"}).json()

        assert [d["title"] for d in body["results"]] == ["Alpha", "Zebra"]


class TestDocumentSearch:
    def test_matches_the_title(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        body = client_for(owner).get(LIST_URL, {"search": "payment"}).json()

        assert body["count"] == 1

    def test_matches_the_body(self, client_for: Any, document: Any, owner: Any) -> None:
        """Searching content works even though content is deferred from output."""
        body = client_for(owner).get(LIST_URL, {"search": "Stripe"}).json()

        assert body["count"] == 1
        assert "content" not in body["results"][0]

    def test_returns_nothing_for_a_miss(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        assert (
            client_for(owner).get(LIST_URL, {"search": "kangaroo"}).json()["count"] == 0
        )

    def test_search_cannot_reach_another_workspace(
        self, client_for: Any, document: Any, other_document: Any, owner: Any
    ) -> None:
        """A body in another tenant must not be searchable from here."""
        body = client_for(owner).get(LIST_URL, {"search": "Confidential"}).json()

        assert body["count"] == 0


class TestDocumentDetail:
    def test_member_can_read_it_with_the_body(
        self, client_for: Any, document: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).get(detail_url(document))

        assert response.status_code == 200

        body = response.json()
        assert body["content"] == "<p>Stripe will be used for payment processing.</p>"
        assert body["revision"] == 1

    def test_non_member_gets_404(
        self, client_for: Any, document: Any, outsider: Any
    ) -> None:
        response = client_for(outsider).get(detail_url(document))

        assert response.status_code == 404

    def test_cannot_read_a_document_in_another_workspace(
        self, client_for: Any, other_document: Any, owner: Any
    ) -> None:
        assert client_for(owner).get(detail_url(other_document)).status_code == 404

    def test_unknown_document_is_404(self, client_for: Any, owner: Any) -> None:
        url = reverse("documents:detail", args=[uuid.uuid4()])

        assert client_for(owner).get(url).status_code == 404

    def test_requires_authentication(self, api_client: Any, document: Any) -> None:
        assert api_client.get(detail_url(document)).status_code == 401


class TestDocumentEditing:
    def test_editor_can_save_the_body(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        response = client_for(editor).patch(
            detail_url(document), {"content": "<p>Apple Pay too.</p>"}
        )

        assert response.status_code == 200
        assert response.json()["content"] == "<p>Apple Pay too.</p>"

    def test_saving_advances_the_revision(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        response = client_for(editor).patch(
            detail_url(document), {"content": "<p>Changed.</p>"}
        )

        assert response.json()["revision"] == 2

    def test_saving_records_the_editor(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        response = client_for(editor).patch(
            detail_url(document), {"content": "<p>Changed.</p>"}
        )

        assert response.json()["last_edited_by"]["id"] == str(editor.id)
        # The original author is unchanged.
        assert response.json()["author"]["id"] != str(editor.id)

    def test_saving_refreshes_the_excerpt(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        client_for(editor).patch(
            detail_url(document), {"content": "<p>Completely new body.</p>"}
        )
        document.refresh_from_db()

        assert document.excerpt == "Completely new body."

    def test_renaming_does_not_advance_the_revision(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        """A rename must not invalidate an edit someone else is composing."""
        response = client_for(editor).patch(detail_url(document), {"title": "Renamed"})

        assert response.json()["title"] == "Renamed"
        assert response.json()["revision"] == 1

    def test_viewer_cannot_edit(
        self, client_for: Any, document: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).patch(
            detail_url(document), {"content": "<p>Vandalism.</p>"}
        )

        assert response.status_code == 403
        document.refresh_from_db()
        assert "Vandalism" not in document.content

    def test_non_member_cannot_edit(
        self, client_for: Any, document: Any, outsider: Any
    ) -> None:
        response = client_for(outsider).patch(
            detail_url(document), {"content": "<p>Vandalism.</p>"}
        )

        assert response.status_code == 404

    def test_matching_revision_is_accepted(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        response = client_for(editor).patch(
            detail_url(document), {"content": "<p>New.</p>", "revision": 1}
        )

        assert response.status_code == 200

    def test_stale_revision_is_rejected(
        self, client_for: Any, document: Any, editor: Any, owner: Any
    ) -> None:
        """
        Someone else saved first. 409 lets the client reconcile instead of
        silently discarding the other person's work.
        """
        client_for(owner).patch(detail_url(document), {"content": "<p>Theirs.</p>"})

        response = client_for(editor).patch(
            detail_url(document), {"content": "<p>Mine.</p>", "revision": 1}
        )

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "DOCUMENT_REVISION_CONFLICT"

        document.refresh_from_db()
        assert document.content == "<p>Theirs.</p>"

    def test_can_be_moved_between_projects_in_the_same_workspace(
        self, client_for: Any, document: Any, project: Any, owner: Any
    ) -> None:
        response = client_for(owner).patch(
            detail_url(document), {"project_id": str(project.id)}
        )

        assert response.json()["project_id"] == str(project.id)

    def test_can_be_unfiled(
        self, client_for: Any, document: Any, project: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        client.patch(detail_url(document), {"project_id": str(project.id)})

        response = client.patch(detail_url(document), {"project_id": None})

        assert response.json()["project_id"] is None

    def test_cannot_be_moved_to_a_project_in_another_workspace(
        self, client_for: Any, document: Any, other_project: Any, owner: Any
    ) -> None:
        response = client_for(owner).patch(
            detail_url(document), {"project_id": str(other_project.id)}
        )

        assert response.status_code == 404
        document.refresh_from_db()
        assert document.project_id is None


class TestDocumentDelete:
    def test_editor_can_delete(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        response = client_for(editor).delete(detail_url(document))

        assert response.status_code == 204
        assert not Document.objects.filter(id=document.id).exists()

    def test_deleting_removes_its_versions(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        client_for(editor).delete(detail_url(document))

        assert not DocumentVersion.objects.filter(document_id=document.id).exists()

    def test_viewer_cannot_delete(
        self, client_for: Any, document: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).delete(detail_url(document))

        assert response.status_code == 403
        assert Document.objects.filter(id=document.id).exists()

    def test_non_member_gets_404(
        self, client_for: Any, document: Any, outsider: Any
    ) -> None:
        response = client_for(outsider).delete(detail_url(document))

        assert response.status_code == 404
        assert Document.objects.filter(id=document.id).exists()


class TestProjectDocumentRelationship:
    def test_deleting_a_project_keeps_its_documents(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        """
        Documents outlive the project they were filed under; they become
        unfiled rather than being destroyed with it.
        """
        client = client_for(owner)
        created = client.post(
            LIST_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "title": "Spec",
                "project_id": str(project.id),
            },
        ).json()

        client.delete(reverse("projects:detail", args=[project.id]))

        document = Document.objects.get(id=created["id"])
        assert document.project_id is None
