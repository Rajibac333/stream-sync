"""
Comments: creation on both resource types, threading, resolution, and the
edit/delete rules.

The permission rules here are unusual enough to be worth stating in tests
rather than only in prose: viewers *can* comment, only the author can edit, and
the workspace owner can delete anyone's comment but cannot rewrite it.
"""

import uuid
from typing import Any

import pytest
from django.urls import reverse

from apps.comments.models import Comment

pytestmark = pytest.mark.django_db

LIST_URL = reverse("comments:list-create")


def detail_url(comment) -> str:
    return reverse("comments:detail", args=[comment.id])


def replies_url(comment) -> str:
    return reverse("comments:replies", args=[comment.id])


def document_payload(document, **overrides) -> dict:
    return {
        "resource_type": "document",
        "resource_id": str(document.id),
        "body": "Should we support Apple Pay too?",
        **overrides,
    }


class TestCommentCreation:
    def test_can_comment_on_a_document(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(LIST_URL, document_payload(document))

        assert response.status_code == 201

        body = response.json()
        assert body["resource_type"] == "document"
        assert body["resource_id"] == str(document.id)
        assert body["author"]["id"] == str(owner.id)
        assert body["resolved"] is False
        assert body["replies"] == []

    def test_can_comment_on_a_task(
        self, client_for: Any, task: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(
            LIST_URL,
            {"resource_type": "task", "resource_id": str(task.id), "body": "Blocked."},
        )

        assert response.status_code == 201
        assert response.json()["resource_type"] == "task"
        assert response.json()["resource_id"] == str(task.id)

    def test_a_viewer_can_comment(
        self, client_for: Any, document: Any, viewer: Any
    ) -> None:
        """
        Deliberate. A viewer who cannot ask a question is not a reviewer, and
        review is the workflow the role exists for. They remain read-only for
        documents, tasks and projects.
        """
        response = client_for(viewer).post(LIST_URL, document_payload(document))

        assert response.status_code == 201

    def test_non_member_cannot_comment(
        self, client_for: Any, document: Any, outsider: Any
    ) -> None:
        response = client_for(outsider).post(LIST_URL, document_payload(document))

        assert response.status_code == 404
        assert not Comment.objects.exists()

    def test_cannot_comment_on_a_resource_in_another_workspace(
        self, client_for: Any, other_document: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(LIST_URL, document_payload(other_document))

        assert response.status_code == 404

    def test_author_comes_from_the_session(
        self, client_for: Any, document: Any, editor: Any, owner: Any
    ) -> None:
        response = client_for(editor).post(
            LIST_URL, document_payload(document, author=str(owner.id))
        )

        assert response.json()["author"]["id"] == str(editor.id)

    def test_rejects_an_empty_body(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(
            LIST_URL, document_payload(document, body="  ")
        )

        assert response.status_code == 400
        assert "body" in response.json()["error"]["details"]

    def test_unknown_resource_is_404(self, client_for: Any, owner: Any) -> None:
        response = client_for(owner).post(
            LIST_URL,
            {
                "resource_type": "document",
                "resource_id": str(uuid.uuid4()),
                "body": "Hello?",
            },
        )

        assert response.status_code == 404

    def test_stores_quoted_text(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        response = client_for(owner).post(
            LIST_URL, document_payload(document, quoted_text="Stripe will be used")
        )

        assert response.json()["quoted_text"] == "Stripe will be used"

    def test_absent_quote_serialises_as_null(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        assert (
            client_for(owner)
            .post(LIST_URL, document_payload(document))
            .json()["quoted_text"]
            is None
        )

    def test_requires_authentication(self, api_client: Any, document: Any) -> None:
        assert api_client.post(LIST_URL, document_payload(document)).status_code == 401


class TestMentions:
    def test_records_mentioned_members(
        self, client_for: Any, document: Any, owner: Any, editor: Any
    ) -> None:
        response = client_for(owner).post(
            LIST_URL, document_payload(document, mention_ids=[str(editor.id)])
        )

        mentions = response.json()["mentions"]
        assert mentions == [{"user_id": str(editor.id), "name": editor.name}]

    def test_drops_mentions_of_non_members(
        self, client_for: Any, document: Any, owner: Any, outsider: Any
    ) -> None:
        """
        Dropped rather than rejected: a stale client can easily name someone
        who has left, and losing the whole comment over that would be worse.
        It also stops mentions being used to probe which user ids exist.
        """
        response = client_for(owner).post(
            LIST_URL, document_payload(document, mention_ids=[str(outsider.id)])
        )

        assert response.status_code == 201
        assert response.json()["mentions"] == []

    def test_captures_the_name_at_mention_time(
        self, client_for: Any, document: Any, owner: Any, editor: Any
    ) -> None:
        """Historical text stays readable after somebody renames themselves."""
        response = client_for(owner).post(
            LIST_URL, document_payload(document, mention_ids=[str(editor.id)])
        )

        editor.name = "Renamed Person"
        editor.save(update_fields=["name"])

        stored = Comment.objects.get(id=response.json()["id"])
        assert stored.mentions[0]["name"] == "Editor User"


class TestThreading:
    def test_can_reply_to_a_thread(
        self, client_for: Any, comment: Any, editor: Any
    ) -> None:
        response = client_for(editor).post(replies_url(comment), {"body": "Good idea."})

        assert response.status_code == 201

        body = response.json()
        # The whole thread comes back so the panel re-renders from one response.
        assert body["id"] == str(comment.id)
        assert len(body["replies"]) == 1
        assert body["replies"][0]["body"] == "Good idea."
        assert body["replies"][0]["author"]["id"] == str(editor.id)

    def test_replies_are_ordered_oldest_first(
        self, client_for: Any, comment: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        client.post(replies_url(comment), {"body": "First"})
        response = client.post(replies_url(comment), {"body": "Second"})

        assert [r["body"] for r in response.json()["replies"]] == ["First", "Second"]

    def test_replying_to_a_reply_attaches_to_the_same_root(
        self, client_for: Any, comment: Any, owner: Any, editor: Any
    ) -> None:
        """
        Threads stay one level deep. The user's intent is unambiguous, so this
        flattens rather than raising.
        """
        first = client_for(owner).post(replies_url(comment), {"body": "First"})
        reply_id = first.json()["replies"][0]["id"]

        response = client_for(editor).post(
            reverse("comments:replies", args=[reply_id]), {"body": "Nested attempt"}
        )

        assert response.status_code == 201
        assert response.json()["id"] == str(comment.id)
        assert len(response.json()["replies"]) == 2

        nested = Comment.objects.get(body="Nested attempt")
        assert nested.parent_id == comment.id

    def test_a_reply_inherits_the_threads_resource(
        self, client_for: Any, comment: Any, document: Any, editor: Any
    ) -> None:
        """A reply must not be able to target a different resource."""
        client_for(editor).post(replies_url(comment), {"body": "Sure."})

        reply = Comment.objects.get(body="Sure.")
        assert reply.document_id == document.id
        assert reply.task_id is None

    def test_a_viewer_can_reply(
        self, client_for: Any, comment: Any, viewer: Any
    ) -> None:
        assert (
            client_for(viewer)
            .post(replies_url(comment), {"body": "Question."})
            .status_code
            == 201
        )

    def test_non_member_cannot_reply(
        self, client_for: Any, comment: Any, outsider: Any
    ) -> None:
        response = client_for(outsider).post(replies_url(comment), {"body": "Hello?"})

        assert response.status_code == 404

    def test_replies_do_not_appear_as_separate_threads(
        self, client_for: Any, comment: Any, document: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        client.post(replies_url(comment), {"body": "A reply"})

        threads = client.get(
            LIST_URL, {"resource_type": "document", "resource_id": str(document.id)}
        ).json()

        assert len(threads) == 1
        assert len(threads[0]["replies"]) == 1

    def test_deleting_a_thread_removes_its_replies(
        self, client_for: Any, comment: Any, owner: Any
    ) -> None:
        client = client_for(owner)
        client.post(replies_url(comment), {"body": "A reply"})

        client.delete(detail_url(comment))

        assert not Comment.objects.exists()


class TestCommentListing:
    def test_lists_threads_on_a_document(
        self, client_for: Any, comment: Any, document: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).get(
            LIST_URL, {"resource_type": "document", "resource_id": str(document.id)}
        )

        assert response.status_code == 200
        # A bare array, not the paginated envelope — see the view's docstring.
        assert isinstance(response.json(), list)
        assert [c["id"] for c in response.json()] == [str(comment.id)]

    def test_lists_threads_on_a_task(
        self, client_for: Any, task_comment: Any, task: Any, owner: Any
    ) -> None:
        response = client_for(owner).get(
            LIST_URL, {"resource_type": "task", "resource_id": str(task.id)}
        )

        assert [c["id"] for c in response.json()] == [str(task_comment.id)]

    def test_document_and_task_threads_do_not_mix(
        self,
        client_for: Any,
        comment: Any,
        task_comment: Any,
        document: Any,
        owner: Any,
    ) -> None:
        response = client_for(owner).get(
            LIST_URL, {"resource_type": "document", "resource_id": str(document.id)}
        )

        ids = [c["id"] for c in response.json()]
        assert ids == [str(comment.id)]
        assert str(task_comment.id) not in ids

    def test_non_member_cannot_list(
        self, client_for: Any, comment: Any, document: Any, outsider: Any
    ) -> None:
        response = client_for(outsider).get(
            LIST_URL, {"resource_type": "document", "resource_id": str(document.id)}
        )

        assert response.status_code == 404

    def test_missing_parameters_are_a_400(self, client_for: Any, owner: Any) -> None:
        response = client_for(owner).get(LIST_URL)

        assert response.status_code == 400
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"


class TestResolution:
    def test_editor_can_resolve_a_thread(
        self, client_for: Any, comment: Any, editor: Any
    ) -> None:
        response = client_for(editor).patch(detail_url(comment), {"resolved": True})

        assert response.status_code == 200
        assert response.json()["resolved"] is True

    def test_resolving_records_who_and_when(
        self, client_for: Any, comment: Any, editor: Any
    ) -> None:
        client_for(editor).patch(detail_url(comment), {"resolved": True})

        comment.refresh_from_db()
        assert comment.resolved_by == editor
        assert comment.resolved_at is not None

    def test_can_reopen(self, client_for: Any, comment: Any, editor: Any) -> None:
        client = client_for(editor)
        client.patch(detail_url(comment), {"resolved": True})

        response = client.patch(detail_url(comment), {"resolved": False})

        assert response.json()["resolved"] is False

        comment.refresh_from_db()
        assert comment.resolved_by is None
        assert comment.resolved_at is None

    def test_the_author_can_resolve_their_own_thread(
        self, client_for: Any, document: Any, viewer: Any
    ) -> None:
        """A viewer who raised a question may mark it answered."""
        created = client_for(viewer).post(LIST_URL, document_payload(document)).json()

        response = client_for(viewer).patch(
            reverse("comments:detail", args=[created["id"]]), {"resolved": True}
        )

        assert response.status_code == 200
        assert response.json()["resolved"] is True

    def test_a_viewer_cannot_resolve_someone_elses_thread(
        self, client_for: Any, comment: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).patch(detail_url(comment), {"resolved": True})

        assert response.status_code == 403
        comment.refresh_from_db()
        assert comment.is_resolved is False

    def test_a_reply_cannot_be_resolved(
        self, client_for: Any, comment: Any, owner: Any
    ) -> None:
        """Resolution describes a conversation, not one message in it."""
        client = client_for(owner)
        client.post(replies_url(comment), {"body": "A reply"})
        reply = Comment.objects.get(body="A reply")

        response = client.patch(
            reverse("comments:detail", args=[reply.id]), {"resolved": True}
        )

        assert response.status_code == 400
        assert response.json()["error"]["code"] == "COMMENT_IS_A_REPLY"

    def test_non_member_cannot_resolve(
        self, client_for: Any, comment: Any, outsider: Any
    ) -> None:
        assert (
            client_for(outsider)
            .patch(detail_url(comment), {"resolved": True})
            .status_code
            == 404
        )


class TestEditRules:
    def test_author_can_edit_their_own_comment(
        self, client_for: Any, comment: Any, owner: Any
    ) -> None:
        response = client_for(owner).patch(detail_url(comment), {"body": "Reworded."})

        assert response.status_code == 200
        assert response.json()["body"] == "Reworded."

    def test_editing_marks_the_comment_as_edited(
        self, client_for: Any, comment: Any, owner: Any
    ) -> None:
        """The UI can say so, rather than silently rewriting the record."""
        assert comment.edited_at is None

        response = client_for(owner).patch(detail_url(comment), {"body": "Reworded."})

        assert response.json()["edited_at"] is not None

    def test_another_member_cannot_edit(
        self, client_for: Any, comment: Any, editor: Any
    ) -> None:
        response = client_for(editor).patch(detail_url(comment), {"body": "Hijacked."})

        assert response.status_code == 403
        comment.refresh_from_db()
        assert comment.body == "Should we support Apple Pay too?"

    def test_the_workspace_owner_cannot_edit_someone_elses_comment(
        self, client_for: Any, document: Any, owner: Any, editor: Any
    ) -> None:
        """
        Deleting another person's comment is moderation. Rewriting it is
        putting words in their mouth, and no role carries that.
        """
        created = client_for(editor).post(LIST_URL, document_payload(document)).json()

        response = client_for(owner).patch(
            reverse("comments:detail", args=[created["id"]]), {"body": "Rewritten."}
        )

        assert response.status_code == 403

    def test_an_empty_patch_is_rejected(
        self, client_for: Any, comment: Any, owner: Any
    ) -> None:
        response = client_for(owner).patch(detail_url(comment), {})

        assert response.status_code == 400


class TestDeleteRules:
    def test_author_can_delete_their_own_comment(
        self, client_for: Any, comment: Any, owner: Any
    ) -> None:
        response = client_for(owner).delete(detail_url(comment))

        assert response.status_code == 204
        assert not Comment.objects.filter(id=comment.id).exists()

    def test_workspace_owner_can_delete_anyones_comment(
        self, client_for: Any, task_comment: Any, owner: Any
    ) -> None:
        """Moderation: a workspace needs a way to remove abusive content."""
        response = client_for(owner).delete(detail_url(task_comment))

        assert response.status_code == 204

    def test_another_member_cannot_delete(
        self, client_for: Any, comment: Any, editor: Any
    ) -> None:
        response = client_for(editor).delete(detail_url(comment))

        assert response.status_code == 403
        assert Comment.objects.filter(id=comment.id).exists()

    def test_a_viewer_cannot_delete_someone_elses_comment(
        self, client_for: Any, comment: Any, viewer: Any
    ) -> None:
        response = client_for(viewer).delete(detail_url(comment))

        assert response.status_code == 403

    def test_a_viewer_can_delete_their_own_comment(
        self, client_for: Any, document: Any, viewer: Any
    ) -> None:
        created = client_for(viewer).post(LIST_URL, document_payload(document)).json()

        response = client_for(viewer).delete(
            reverse("comments:detail", args=[created["id"]])
        )

        assert response.status_code == 204

    def test_non_member_gets_404(
        self, client_for: Any, comment: Any, outsider: Any
    ) -> None:
        response = client_for(outsider).delete(detail_url(comment))

        assert response.status_code == 404
        assert Comment.objects.filter(id=comment.id).exists()


class TestResourceConstraint:
    def test_a_comment_cannot_target_both_a_document_and_a_task(
        self, staffed_workspace: Any, document: Any, task: Any, owner: Any
    ) -> None:
        """README §11, enforced by the database rather than by convention."""
        from django.db import IntegrityError, transaction

        with pytest.raises(IntegrityError), transaction.atomic():
            Comment.objects.create(
                workspace=staffed_workspace,
                document=document,
                task=task,
                author=owner,
                body="Both at once",
            )

    def test_a_comment_must_target_something(
        self, staffed_workspace: Any, owner: Any
    ) -> None:
        from django.db import IntegrityError, transaction

        with pytest.raises(IntegrityError), transaction.atomic():
            Comment.objects.create(
                workspace=staffed_workspace, author=owner, body="Orphan"
            )
