"""
The notification API: listing, the unread badge, and marking read.

A notification belongs to one person and to nobody else, so the isolation tests
here matter as much as the happy paths — there is no role that grants access to
somebody else's list.
"""

import uuid
from typing import Any

import pytest
from django.urls import reverse

from apps.notifications.models import EntityType, Notification, NotificationType

pytestmark = pytest.mark.django_db

LIST_URL = reverse("notifications:list")
UNREAD_URL = reverse("notifications:unread-count")
MARK_ALL_URL = reverse("notifications:mark-all-read")


def detail_url(notification) -> str:
    return reverse("notifications:detail", args=[notification.id])


def make_notification(*, recipient, workspace, actor=None, **overrides) -> Notification:
    defaults = {
        "type": NotificationType.TASK_ASSIGNED,
        "title": "Someone assigned you a task",
        "message": "Payment intent flow",
        "entity_type": EntityType.TASK,
        "entity_id": uuid.uuid4(),
        "href": "/app/tasks/1",
    }
    defaults.update(overrides)
    return Notification.objects.create(
        recipient=recipient, workspace=workspace, actor=actor, **defaults
    )


class TestNotificationListing:
    def test_lists_my_notifications(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        make_notification(recipient=owner, workspace=staffed_workspace, actor=editor)

        response = client_for(owner).get(LIST_URL)

        assert response.status_code == 200
        assert response.json()["count"] == 1

    def test_entry_matches_the_client_contract(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        make_notification(recipient=owner, workspace=staffed_workspace, actor=editor)

        entry = client_for(owner).get(LIST_URL).json()["results"][0]

        assert set(entry) == {
            "id",
            "type",
            "title",
            "body",
            "actor",
            "href",
            "created_at",
            "read",
        }
        assert entry["type"] == NotificationType.TASK_ASSIGNED
        assert entry["body"] == "Payment intent flow"
        assert entry["read"] is False
        assert entry["actor"]["id"] == str(editor.id)
        assert set(entry["actor"]) == {"id", "name", "avatar_url"}

    def test_never_shows_someone_elses_notifications(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        """The whole access rule for this resource."""
        make_notification(recipient=editor, workspace=staffed_workspace, actor=owner)

        assert client_for(owner).get(LIST_URL).json()["results"] == []

    def test_newest_first(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        make_notification(
            recipient=owner, workspace=staffed_workspace, actor=editor, title="First"
        )
        make_notification(
            recipient=owner, workspace=staffed_workspace, actor=editor, title="Second"
        )

        titles = [n["title"] for n in client_for(owner).get(LIST_URL).json()["results"]]

        assert titles == ["Second", "First"]

    def test_filters_to_unread(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        read = make_notification(
            recipient=owner, workspace=staffed_workspace, actor=editor, title="Read"
        )
        make_notification(
            recipient=owner, workspace=staffed_workspace, actor=editor, title="Unread"
        )
        Notification.objects.filter(pk=read.pk).update(is_read=True)

        body = client_for(owner).get(LIST_URL, {"unread": "true"}).json()

        assert [n["title"] for n in body["results"]] == ["Unread"]

    def test_filters_by_type(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        make_notification(recipient=owner, workspace=staffed_workspace, actor=editor)
        make_notification(
            recipient=owner,
            workspace=staffed_workspace,
            actor=editor,
            type=NotificationType.MENTION,
            entity_type=EntityType.COMMENT,
            title="Mentioned",
        )

        body = client_for(owner).get(LIST_URL, {"type": "mention"}).json()

        assert [n["title"] for n in body["results"]] == ["Mentioned"]

    def test_is_paginated(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        make_notification(recipient=owner, workspace=staffed_workspace, actor=editor)

        body = client_for(owner).get(LIST_URL).json()

        assert {"count", "page", "page_size", "total_pages", "results"} <= set(body)

    def test_requires_authentication(self, api_client: Any) -> None:
        assert api_client.get(LIST_URL).status_code == 401


class TestUnreadCount:
    def test_counts_only_unread(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        read = make_notification(
            recipient=owner, workspace=staffed_workspace, actor=editor
        )
        make_notification(recipient=owner, workspace=staffed_workspace, actor=editor)
        Notification.objects.filter(pk=read.pk).update(is_read=True)

        response = client_for(owner).get(UNREAD_URL)

        assert response.status_code == 200
        assert response.json() == {"unread_count": 1}

    def test_counts_only_my_own(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        make_notification(recipient=editor, workspace=staffed_workspace, actor=owner)

        assert client_for(owner).get(UNREAD_URL).json()["unread_count"] == 0

    def test_zero_when_nothing_is_pending(self, client_for: Any, owner: Any) -> None:
        assert client_for(owner).get(UNREAD_URL).json()["unread_count"] == 0

    def test_requires_authentication(self, api_client: Any) -> None:
        assert api_client.get(UNREAD_URL).status_code == 401


class TestMarkRead:
    def test_marks_one_read(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        notification = make_notification(
            recipient=owner, workspace=staffed_workspace, actor=editor
        )

        response = client_for(owner).patch(detail_url(notification), {"read": True})

        assert response.status_code == 200
        assert response.json()["read"] is True

        notification.refresh_from_db()
        assert notification.is_read is True
        assert notification.read_at is not None

    def test_can_be_marked_unread_again(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        notification = make_notification(
            recipient=owner, workspace=staffed_workspace, actor=editor
        )
        client = client_for(owner)
        client.patch(detail_url(notification), {"read": True})

        client.patch(detail_url(notification), {"read": False})

        notification.refresh_from_db()
        assert notification.is_read is False
        assert notification.read_at is None

    def test_marking_read_twice_keeps_the_first_timestamp(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        """A double click must not rewrite when it was actually read."""
        notification = make_notification(
            recipient=owner, workspace=staffed_workspace, actor=editor
        )
        client = client_for(owner)
        client.patch(detail_url(notification), {"read": True})

        notification.refresh_from_db()
        first = notification.read_at

        client.patch(detail_url(notification), {"read": True})

        notification.refresh_from_db()
        assert notification.read_at == first

    def test_cannot_mark_someone_elses_read(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        """404, not 403 — it is not theirs to know about."""
        notification = make_notification(
            recipient=editor, workspace=staffed_workspace, actor=owner
        )

        response = client_for(owner).patch(detail_url(notification), {"read": True})

        assert response.status_code == 404
        notification.refresh_from_db()
        assert notification.is_read is False

    def test_only_the_read_flag_is_writable(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        """A client that could edit `title` could rewrite what it was told."""
        notification = make_notification(
            recipient=owner, workspace=staffed_workspace, actor=editor
        )

        client_for(owner).patch(
            detail_url(notification), {"read": True, "title": "Rewritten"}
        )

        notification.refresh_from_db()
        assert notification.title == "Someone assigned you a task"

    def test_unknown_notification_is_404(self, client_for: Any, owner: Any) -> None:
        url = reverse("notifications:detail", args=[uuid.uuid4()])

        assert client_for(owner).patch(url, {"read": True}).status_code == 404


class TestMarkAllRead:
    def test_marks_everything_read(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        for _ in range(3):
            make_notification(
                recipient=owner, workspace=staffed_workspace, actor=editor
            )

        response = client_for(owner).post(MARK_ALL_URL)

        assert response.status_code == 200
        assert response.json() == {"updated": 3}
        assert Notification.objects.for_user(owner).unread().count() == 0

    def test_leaves_other_peoples_alone(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        theirs = make_notification(
            recipient=editor, workspace=staffed_workspace, actor=owner
        )
        make_notification(recipient=owner, workspace=staffed_workspace, actor=editor)

        client_for(owner).post(MARK_ALL_URL)

        theirs.refresh_from_db()
        assert theirs.is_read is False

    def test_is_idempotent(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        make_notification(recipient=owner, workspace=staffed_workspace, actor=editor)
        client = client_for(owner)

        client.post(MARK_ALL_URL)
        second = client.post(MARK_ALL_URL)

        assert second.json() == {"updated": 0}

    def test_clears_the_badge(
        self, client_for: Any, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        make_notification(recipient=owner, workspace=staffed_workspace, actor=editor)
        client = client_for(owner)

        client.post(MARK_ALL_URL)

        assert client.get(UNREAD_URL).json()["unread_count"] == 0

    def test_requires_authentication(self, api_client: Any) -> None:
        assert api_client.post(MARK_ALL_URL).status_code == 401
