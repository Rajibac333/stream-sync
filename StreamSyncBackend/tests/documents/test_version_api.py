"""
Document version history: creation, numbering, ordering, immutability,
restore and permissions.

The invariant this milestone exists to protect is that history only ever grows.
Restoring version 5 writes version 6; version 5 is untouched and versions 6..N
survive. Several tests below check the *absence* of destruction, which is
easier to regress than the presence of a feature.
"""

import uuid
from typing import Any

import pytest
from django.urls import reverse

from apps.documents.models import Document, DocumentVersion

pytestmark = pytest.mark.django_db


def versions_url(document) -> str:
    return reverse("documents:versions", args=[document.id])


def restore_url(document, version) -> str:
    return reverse("documents:version-restore", args=[document.id, version.id])


def detail_url(document) -> str:
    return reverse("documents:detail", args=[document.id])


def numbers_of(document) -> list[int]:
    return list(
        document.versions.order_by("version_number").values_list(
            "version_number", flat=True
        )
    )


class TestVersionCreation:
    def test_creation_writes_version_one(self, document: Any) -> None:
        assert numbers_of(document) == [1]
        assert document.versions.get().content == document.content

    def test_editing_the_body_appends_a_version(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        client_for(editor).patch(detail_url(document), {"content": "<p>Second.</p>"})

        assert numbers_of(document) == [1, 2]

    def test_each_version_captures_the_content_at_that_moment(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        client = client_for(editor)
        client.patch(detail_url(document), {"content": "<p>Second.</p>"})
        client.patch(detail_url(document), {"content": "<p>Third.</p>"})

        bodies = list(
            document.versions.order_by("version_number").values_list(
                "content", flat=True
            )
        )

        assert bodies == [
            "<p>Stripe will be used for payment processing.</p>",
            "<p>Second.</p>",
            "<p>Third.</p>",
        ]

    def test_version_records_its_author(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        client_for(editor).patch(detail_url(document), {"content": "<p>Second.</p>"})

        assert document.versions.get(version_number=2).created_by == editor

    def test_renaming_does_not_append_a_version(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        """A rename does not change text there would be anything to restore."""
        client_for(editor).patch(detail_url(document), {"title": "Renamed"})

        assert numbers_of(document) == [1]

    def test_saving_identical_content_does_not_append_a_version(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        """A no-op save is not a revision. Otherwise autosave floods history."""
        client_for(editor).patch(detail_url(document), {"content": document.content})

        assert numbers_of(document) == [1]

    def test_a_custom_summary_is_stored(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        client_for(editor).patch(
            detail_url(document),
            {"content": "<p>Apple Pay.</p>", "summary": "Added Apple Pay section"},
        )

        assert (
            document.versions.get(version_number=2).summary == "Added Apple Pay section"
        )


class TestVersionNumbering:
    def test_numbers_are_sequential(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        client = client_for(editor)
        for index in range(4):
            client.patch(detail_url(document), {"content": f"<p>Body {index}</p>"})

        assert numbers_of(document) == [1, 2, 3, 4, 5]

    def test_numbers_are_scoped_per_document(
        self, client_for: Any, staffed_workspace: Any, document: Any, owner: Any
    ) -> None:
        """Each document's history starts at 1, independently of any other."""
        from apps.documents import services

        client_for(owner).patch(detail_url(document), {"content": "<p>Second.</p>"})

        second = services.create_document(
            workspace=staffed_workspace, author=owner, title="Another"
        )

        assert numbers_of(document) == [1, 2]
        assert numbers_of(second) == [1]

    def test_duplicate_numbers_are_rejected_by_the_database(
        self, document: Any, owner: Any
    ) -> None:
        """
        The backstop behind the row lock. If a future code path forgets to
        lock, the database refuses the duplicate rather than silently
        producing two "version 1" rows.
        """
        from django.db import IntegrityError, transaction

        with pytest.raises(IntegrityError), transaction.atomic():
            DocumentVersion.objects.create(
                document=document,
                version_number=1,
                content="<p>Collision.</p>",
                created_by=owner,
            )


class TestVersionImmutability:
    def test_a_version_cannot_be_modified(self, document: Any) -> None:
        version = document.versions.get()
        version.content = "<p>Rewritten past.</p>"

        with pytest.raises(ValueError, match="immutable"):
            version.save()

    def test_a_versions_summary_cannot_be_modified(self, document: Any) -> None:
        version = document.versions.get()
        version.summary = "Something else"

        with pytest.raises(ValueError, match="immutable"):
            version.save()

    def test_editing_a_document_never_rewrites_an_earlier_version(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        original = document.versions.get(version_number=1).content

        client_for(editor).patch(detail_url(document), {"content": "<p>Changed.</p>"})

        assert document.versions.get(version_number=1).content == original

    def test_there_is_no_write_endpoint_for_versions(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        """History is written by the operations it describes, never directly."""
        response = client_for(owner).post(
            versions_url(document), {"content": "<p>x</p>"}
        )

        assert response.status_code == 405


class TestVersionListing:
    def test_lists_versions_newest_first(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        client.patch(detail_url(document), {"content": "<p>Second.</p>"})
        client.patch(detail_url(document), {"content": "<p>Third.</p>"})

        body = client.get(versions_url(document)).json()

        assert [v["number"] for v in body["results"]] == [3, 2, 1]

    def test_entries_carry_author_summary_and_timestamp(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        entry = client_for(owner).get(versions_url(document)).json()["results"][0]

        assert entry["author"]["id"] == str(owner.id)
        assert set(entry["author"]) == {"id", "name", "avatar_url"}
        assert entry["summary"] == "Document created"
        assert entry["created_at"]

    def test_only_the_newest_is_marked_current(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        client.patch(detail_url(document), {"content": "<p>Second.</p>"})

        results = client.get(versions_url(document)).json()["results"]

        assert [v["is_current"] for v in results] == [True, False]

    def test_the_list_omits_snapshot_bodies(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        """Shipping every snapshot would make the list heavier than the document."""
        entry = client_for(owner).get(versions_url(document)).json()["results"][0]

        assert "content" not in entry

    def test_is_paginated(self, client_for: Any, document: Any, owner: Any) -> None:
        body = client_for(owner).get(versions_url(document)).json()

        assert {"count", "page", "page_size", "total_pages", "results"} <= set(body)

    def test_a_viewer_can_read_history(
        self, client_for: Any, document: Any, viewer: Any
    ) -> None:
        assert client_for(viewer).get(versions_url(document)).status_code == 200

    def test_non_member_gets_404(
        self, client_for: Any, document: Any, outsider: Any
    ) -> None:
        assert client_for(outsider).get(versions_url(document)).status_code == 404

    def test_history_of_another_workspaces_document_is_404(
        self, client_for: Any, other_document: Any, owner: Any
    ) -> None:
        assert client_for(owner).get(versions_url(other_document)).status_code == 404

    def test_requires_authentication(self, api_client: Any, document: Any) -> None:
        assert api_client.get(versions_url(document)).status_code == 401


class TestRestore:
    @pytest.fixture
    def edited(self, client_for: Any, document: Any, owner: Any) -> Any:
        """A document with three versions: v1 original, v2, v3."""
        client = client_for(owner)
        client.patch(detail_url(document), {"content": "<p>Second.</p>"})
        client.patch(detail_url(document), {"content": "<p>Third.</p>"})
        document.refresh_from_db()
        return document

    def test_restoring_creates_a_new_version(
        self, client_for: Any, edited: Any, owner: Any
    ) -> None:
        """Restoring version 1 creates version 4 — history only grows."""
        first = edited.versions.get(version_number=1)

        response = client_for(owner).post(restore_url(edited, first))

        assert response.status_code == 200
        assert numbers_of(edited) == [1, 2, 3, 4]

    def test_the_new_version_holds_the_restored_content(
        self, client_for: Any, edited: Any, owner: Any
    ) -> None:
        first = edited.versions.get(version_number=1)

        client_for(owner).post(restore_url(edited, first))

        assert edited.versions.get(version_number=4).content == first.content

    def test_the_document_body_becomes_the_restored_content(
        self, client_for: Any, edited: Any, owner: Any
    ) -> None:
        first = edited.versions.get(version_number=1)

        response = client_for(owner).post(restore_url(edited, first))

        assert response.json()["content"] == first.content

        edited.refresh_from_db()
        assert edited.content == first.content

    def test_the_restored_version_is_not_modified(
        self, client_for: Any, edited: Any, owner: Any
    ) -> None:
        """The whole point. Version 1 is read, never written."""
        first = edited.versions.get(version_number=1)
        original_content = first.content
        original_summary = first.summary

        client_for(owner).post(restore_url(edited, first))

        first.refresh_from_db()
        assert first.content == original_content
        assert first.summary == original_summary
        assert first.version_number == 1

    def test_versions_after_the_restored_one_survive(
        self, client_for: Any, edited: Any, owner: Any
    ) -> None:
        """Undoing a restore is just another restore, so nothing is discarded."""
        first = edited.versions.get(version_number=1)

        client_for(owner).post(restore_url(edited, first))

        assert edited.versions.filter(version_number=2).exists()
        assert edited.versions.get(version_number=3).content == "<p>Third.</p>"

    def test_a_restore_can_itself_be_undone(
        self, client_for: Any, edited: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        first = edited.versions.get(version_number=1)
        third = edited.versions.get(version_number=3)

        client.post(restore_url(edited, first))
        response = client.post(restore_url(edited, third))

        assert response.json()["content"] == "<p>Third.</p>"
        assert numbers_of(edited) == [1, 2, 3, 4, 5]

    def test_restore_records_its_provenance(
        self, client_for: Any, edited: Any, owner: Any
    ) -> None:
        first = edited.versions.get(version_number=1)

        client_for(owner).post(restore_url(edited, first))

        assert edited.versions.get(version_number=4).summary == "Restored version 1"

    def test_restore_advances_the_revision(
        self, client_for: Any, edited: Any, owner: Any
    ) -> None:
        before = edited.revision
        first = edited.versions.get(version_number=1)

        response = client_for(owner).post(restore_url(edited, first))

        assert response.json()["revision"] == before + 1

    def test_restore_refreshes_the_excerpt(
        self, client_for: Any, edited: Any, owner: Any
    ) -> None:
        first = edited.versions.get(version_number=1)

        client_for(owner).post(restore_url(edited, first))

        edited.refresh_from_db()
        assert edited.excerpt == "Stripe will be used for payment processing."

    def test_restore_records_who_did_it(
        self, client_for: Any, edited: Any, editor: Any
    ) -> None:
        first = edited.versions.get(version_number=1)

        client_for(editor).post(restore_url(edited, first))

        assert edited.versions.get(version_number=4).created_by == editor
        edited.refresh_from_db()
        assert edited.updated_by == editor


class TestRestorePermissions:
    def test_editor_can_restore(
        self, client_for: Any, document: Any, editor: Any
    ) -> None:
        version = document.versions.get()

        assert (
            client_for(editor).post(restore_url(document, version)).status_code == 200
        )

    def test_viewer_cannot_restore(
        self, client_for: Any, document: Any, viewer: Any
    ) -> None:
        version = document.versions.get()

        response = client_for(viewer).post(restore_url(document, version))

        assert response.status_code == 403
        assert numbers_of(document) == [1]

    def test_non_member_gets_404(
        self, client_for: Any, document: Any, outsider: Any
    ) -> None:
        version = document.versions.get()

        response = client_for(outsider).post(restore_url(document, version))

        assert response.status_code == 404
        assert numbers_of(document) == [1]

    def test_requires_authentication(self, api_client: Any, document: Any) -> None:
        version = document.versions.get()

        assert api_client.post(restore_url(document, version)).status_code == 401

    def test_cannot_restore_a_version_from_another_document(
        self,
        client_for: Any,
        staffed_workspace: Any,
        document: Any,
        owner: Any,
    ) -> None:
        """
        Cross-document id confusion. Both documents are readable by the caller,
        so only the scoping of the version lookup prevents this.
        """
        from apps.documents import services

        other = services.create_document(
            workspace=staffed_workspace, author=owner, title="Other", content="<p>X</p>"
        )
        foreign_version = other.versions.get()

        url = reverse(
            "documents:version-restore", args=[document.id, foreign_version.id]
        )
        response = client_for(owner).post(url)

        assert response.status_code == 404
        assert numbers_of(document) == [1]

    def test_unknown_version_is_404(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        url = reverse("documents:version-restore", args=[document.id, uuid.uuid4()])

        assert client_for(owner).post(url).status_code == 404


class TestVersionLifecycle:
    def test_deleting_a_document_removes_its_versions(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        client_for(owner).delete(detail_url(document))

        assert not DocumentVersion.objects.filter(document_id=document.id).exists()
        assert not Document.objects.filter(id=document.id).exists()
