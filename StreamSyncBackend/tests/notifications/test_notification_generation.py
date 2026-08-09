"""
Notification generation, deduplication and retry safety.

Tasks run eagerly under test (`CELERY_TASK_ALWAYS_EAGER`), so a notification is
observable the moment the request returns. The retry-safety tests deliberately
call the task *function* directly and run it twice, which is what a redelivery
actually looks like — eager mode proves nothing about that on its own.

`transaction=True` is required, not incidental. Dispatch happens in
`transaction.on_commit`, and the transaction pytest-django normally wraps a
test in is never committed — so with the default marker the callbacks never
fire and every one of these tests would fail for a reason that has nothing to
do with notifications. Real commits also make these tests prove that the
`on_commit` wiring itself works, which is the part most likely to be got wrong.
"""

import uuid
from typing import Any

import pytest
from django.urls import reverse

from apps.notifications.models import EntityType, Notification, NotificationType

pytestmark = pytest.mark.django_db(transaction=True)

TASKS_URL = reverse("tasks:list-create")
COMMENTS_URL = reverse("comments:list-create")


def notifications_for(user, **filters):
    """
    One person's notifications, always narrowed by `type`.

    The shared `staffed_workspace` fixture issues invitations, which are
    themselves notifiable — so an unfiltered "has no notifications" assertion
    would be testing the fixture, not the behaviour under test.
    """
    return Notification.objects.for_user(user).filter(**filters)


class TestTaskAssignment:
    def test_assigning_notifies_the_assignee(
        self,
        client_for: Any,
        staffed_workspace: Any,
        project: Any,
        owner: Any,
        editor: Any,
    ) -> None:
        client_for(owner).post(
            TASKS_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "project_id": str(project.id),
                "title": "Implement Stripe API",
                "assignee_id": str(editor.id),
            },
        )

        notification = notifications_for(
            editor, type=NotificationType.TASK_ASSIGNED
        ).get()

        assert "Implement Stripe API" in notification.title
        assert notification.actor == owner
        assert notification.entity_type == EntityType.TASK
        assert notification.href

    def test_reassigning_notifies_the_new_assignee(
        self, client_for: Any, task: Any, owner: Any, editor: Any
    ) -> None:
        client_for(owner).patch(
            reverse("tasks:detail", args=[task.id]), {"assignee_id": str(editor.id)}
        )

        assert notifications_for(editor, type=NotificationType.TASK_ASSIGNED).exists()

    def test_assigning_to_yourself_notifies_nobody(
        self, client_for: Any, staffed_workspace: Any, project: Any, owner: Any
    ) -> None:
        """The most common source of notification noise."""
        client_for(owner).post(
            TASKS_URL,
            {
                "workspace_id": str(staffed_workspace.id),
                "project_id": str(project.id),
                "title": "My own task",
                "assignee_id": str(owner.id),
            },
        )

        assert not notifications_for(
            owner, type=NotificationType.TASK_ASSIGNED
        ).exists()

    def test_an_unrelated_edit_does_not_re_notify(
        self, client_for: Any, task: Any, owner: Any, editor: Any
    ) -> None:
        """Re-saving a task that already belonged to someone must not ping them."""
        client = client_for(owner)
        url = reverse("tasks:detail", args=[task.id])
        client.patch(url, {"assignee_id": str(editor.id)})
        notifications_for(editor).update(is_read=True)

        client.patch(url, {"title": "Renamed", "priority": "urgent"})

        assert not notifications_for(
            editor, type=NotificationType.TASK_ASSIGNED, is_read=False
        ).exists()

    def test_completing_notifies_the_creator(
        self, client_for: Any, task: Any, owner: Any, editor: Any
    ) -> None:
        client_for(editor).patch(
            reverse("tasks:detail", args=[task.id]), {"status": "done"}
        )

        notification = notifications_for(
            owner, type=NotificationType.TASK_COMPLETED
        ).get()

        assert notification.actor == editor

    def test_completing_your_own_task_notifies_nobody(
        self, client_for: Any, task: Any, owner: Any
    ) -> None:
        client_for(owner).patch(
            reverse("tasks:detail", args=[task.id]), {"status": "done"}
        )

        assert not notifications_for(
            owner, type=NotificationType.TASK_COMPLETED
        ).exists()


class TestMentions:
    def test_mentioning_someone_notifies_them(
        self, client_for: Any, document: Any, owner: Any, editor: Any
    ) -> None:
        client_for(owner).post(
            COMMENTS_URL,
            {
                "resource_type": "document",
                "resource_id": str(document.id),
                "body": "Can you look at this?",
                "mention_ids": [str(editor.id)],
            },
        )

        notification = notifications_for(editor, type=NotificationType.MENTION).get()

        assert notification.actor == owner
        assert document.title in notification.title
        assert notification.message == "Can you look at this?"

    def test_mentioning_yourself_notifies_nobody(
        self, client_for: Any, document: Any, owner: Any
    ) -> None:
        client_for(owner).post(
            COMMENTS_URL,
            {
                "resource_type": "document",
                "resource_id": str(document.id),
                "body": "Note to self.",
                "mention_ids": [str(owner.id)],
            },
        )

        assert not notifications_for(owner, type=NotificationType.MENTION).exists()

    def test_a_comment_with_no_mentions_notifies_nobody(
        self, client_for: Any, document: Any, owner: Any, editor: Any
    ) -> None:
        client_for(owner).post(
            COMMENTS_URL,
            {
                "resource_type": "document",
                "resource_id": str(document.id),
                "body": "Just a thought.",
            },
        )

        assert not notifications_for(editor, type=NotificationType.MENTION).exists()

    def test_a_mention_in_a_reply_also_notifies(
        self, client_for: Any, comment: Any, owner: Any, editor: Any
    ) -> None:
        client_for(owner).post(
            reverse("comments:replies", args=[comment.id]),
            {"body": "Thoughts?", "mention_ids": [str(editor.id)]},
        )

        assert notifications_for(editor, type=NotificationType.MENTION).exists()

    def test_two_mentions_in_two_comments_are_two_notifications(
        self, client_for: Any, document: Any, owner: Any, editor: Any
    ) -> None:
        """
        The entity is the comment, not the document, so separate conversations
        do not collapse into one ping.
        """
        client = client_for(owner)
        for body in ("First question", "Second question"):
            client.post(
                COMMENTS_URL,
                {
                    "resource_type": "document",
                    "resource_id": str(document.id),
                    "body": body,
                    "mention_ids": [str(editor.id)],
                },
            )

        assert notifications_for(editor, type=NotificationType.MENTION).count() == 2


class TestProjectAndInvitation:
    def test_a_status_change_notifies_the_workspace(
        self, client_for: Any, project: Any, owner: Any, editor: Any, viewer: Any
    ) -> None:
        client_for(owner).patch(
            reverse("projects:detail", args=[project.id]), {"status": "completed"}
        )

        assert notifications_for(editor, type=NotificationType.PROJECT_UPDATE).exists()
        assert notifications_for(viewer, type=NotificationType.PROJECT_UPDATE).exists()
        # Not the person who made the change.
        assert not notifications_for(
            owner, type=NotificationType.PROJECT_UPDATE
        ).exists()

    def test_a_rename_does_not_notify(
        self, client_for: Any, project: Any, owner: Any, editor: Any
    ) -> None:
        """Notifying on every edit is how a notification list gets muted."""
        client_for(owner).patch(
            reverse("projects:detail", args=[project.id]), {"name": "Renamed"}
        )

        assert not notifications_for(
            editor, type=NotificationType.PROJECT_UPDATE
        ).exists()

    def test_setting_the_same_status_does_not_notify(
        self, client_for: Any, project: Any, owner: Any, editor: Any
    ) -> None:
        client_for(owner).patch(
            reverse("projects:detail", args=[project.id]),
            {"status": project.status},
        )

        assert not notifications_for(
            editor, type=NotificationType.PROJECT_UPDATE
        ).exists()

    def test_an_invitation_notifies_the_invitee(
        self, client_for: Any, staffed_workspace: Any, owner: Any, outsider: Any
    ) -> None:
        client_for(owner).post(
            reverse("workspaces:invite", args=[staffed_workspace.id]),
            {"email": outsider.email, "role": "editor"},
        )

        notification = notifications_for(
            outsider, type=NotificationType.WORKSPACE_INVITATION
        ).get()

        assert staffed_workspace.name in notification.title
        assert notification.actor == owner


class TestDeduplication:
    def test_a_second_unread_ping_about_the_same_thing_is_suppressed(
        self, client_for: Any, task: Any, owner: Any, editor: Any, viewer: Any
    ) -> None:
        """
        You already have an unread "you were assigned X". Reassigning back and
        forth should not stack up three of them.
        """
        client = client_for(owner)
        url = reverse("tasks:detail", args=[task.id])

        client.patch(url, {"assignee_id": str(editor.id)})
        client.patch(url, {"assignee_id": str(viewer.id)})
        client.patch(url, {"assignee_id": str(editor.id)})

        assert (
            notifications_for(editor, type=NotificationType.TASK_ASSIGNED).count() == 1
        )

    def test_a_new_event_notifies_again_once_the_first_is_read(
        self, client_for: Any, task: Any, owner: Any, editor: Any, viewer: Any
    ) -> None:
        """Dedupe collapses *unread* pings, it does not silence the topic forever."""
        client = client_for(owner)
        url = reverse("tasks:detail", args=[task.id])

        client.patch(url, {"assignee_id": str(editor.id)})
        notifications_for(editor).update(is_read=True)

        client.patch(url, {"assignee_id": str(viewer.id)})
        client.patch(url, {"assignee_id": str(editor.id)})

        assert (
            notifications_for(editor, type=NotificationType.TASK_ASSIGNED).count() == 2
        )

    def test_different_types_about_one_entity_do_not_collide(
        self, client_for: Any, task: Any, owner: Any, editor: Any
    ) -> None:
        """Assigned and completed are different facts about the same task."""
        url = reverse("tasks:detail", args=[task.id])

        client_for(owner).patch(url, {"assignee_id": str(editor.id)})
        # Completed by the editor, not the owner: the owner created this task,
        # and nobody is notified about their own action.
        client_for(editor).patch(url, {"status": "done"})

        assert notifications_for(editor, type=NotificationType.TASK_ASSIGNED).exists()
        assert notifications_for(owner, type=NotificationType.TASK_COMPLETED).exists()

    def test_the_constraint_is_enforced_by_the_database(
        self, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        """
        Not just a service-level check. A retried Celery task racing the check
        must still be unable to write a duplicate.
        """
        from django.db import IntegrityError, transaction

        entity_id = uuid.uuid4()
        common = {
            "recipient": owner,
            "workspace": staffed_workspace,
            "actor": editor,
            "type": NotificationType.TASK_ASSIGNED,
            "entity_type": EntityType.TASK,
            "entity_id": entity_id,
        }
        Notification.objects.create(title="First", **common)

        with pytest.raises(IntegrityError), transaction.atomic():
            Notification.objects.create(title="Duplicate", **common)


class TestRetrySafety:
    """
    `CELERY_TASK_ACKS_LATE` redelivers work whose worker died mid-run, so every
    task must survive being executed twice. These call the task functions
    directly and run them again, which is what a redelivery looks like.
    """

    def test_running_the_assignment_task_twice_creates_one_notification(
        self, task: Any, owner: Any, editor: Any
    ) -> None:
        from apps.notifications.tasks import notify_task_assigned

        task.assignee = editor
        task.save(update_fields=["assignee"])

        notify_task_assigned(task_id=str(task.id), actor_id=str(owner.id))
        notify_task_assigned(task_id=str(task.id), actor_id=str(owner.id))

        assert (
            notifications_for(editor, type=NotificationType.TASK_ASSIGNED).count() == 1
        )

    def test_running_the_mention_task_twice_creates_one_notification(
        self, comment: Any, editor: Any
    ) -> None:
        from apps.notifications.tasks import notify_comment_mentions

        comment.mentions = [{"user_id": str(editor.id), "name": editor.name}]
        comment.save(update_fields=["mentions"])

        notify_comment_mentions(comment_id=str(comment.id))
        notify_comment_mentions(comment_id=str(comment.id))

        assert notifications_for(editor, type=NotificationType.MENTION).count() == 1

    def test_a_deleted_subject_is_success_not_an_error(self, owner: Any) -> None:
        """
        A task retried after its subject was deleted has nothing to do and
        nothing to fix. Raising would retry forever.
        """
        from apps.notifications.tasks import notify_task_assigned

        # Returns rather than raising.
        assert (
            notify_task_assigned(task_id=str(uuid.uuid4()), actor_id=str(owner.id))
            is None
        )

    def test_an_unassigned_task_is_skipped(self, task: Any, owner: Any) -> None:
        """Unassigned again before the task ran — also nothing to do."""
        from apps.notifications.tasks import notify_task_assigned

        assert task.assignee_id is None

        notify_task_assigned(task_id=str(task.id), actor_id=str(owner.id))

        assert not Notification.objects.filter(
            type=NotificationType.TASK_ASSIGNED
        ).exists()

    def test_a_deleted_comment_is_skipped(self) -> None:
        from apps.notifications.tasks import notify_comment_mentions

        assert notify_comment_mentions(comment_id=str(uuid.uuid4())) is None

    def test_a_deleted_project_is_skipped(self, owner: Any) -> None:
        from apps.notifications.tasks import notify_project_updated

        assert (
            notify_project_updated(
                project_id=str(uuid.uuid4()), actor_id=str(owner.id), summary="x"
            )
            is None
        )

    def test_tasks_are_configured_to_retry(self) -> None:
        """
        Transient failures must back off rather than dying on first contact.
        Asserted on the registered task so a future refactor cannot quietly
        drop the policy.
        """
        from apps.notifications.tasks import notify_task_assigned

        assert notify_task_assigned.max_retries == 5
        assert notify_task_assigned.acks_late is True
        assert notify_task_assigned.retry_backoff == 2
        assert notify_task_assigned.retry_jitter is True


class TestPurge:
    def test_removes_only_long_read_notifications(
        self, staffed_workspace: Any, owner: Any, editor: Any
    ) -> None:
        from datetime import timedelta

        from django.utils import timezone

        from apps.notifications.tasks import purge_read_notifications

        old_read = Notification.objects.create(
            recipient=owner,
            workspace=staffed_workspace,
            actor=editor,
            type=NotificationType.TASK_ASSIGNED,
            title="Old",
            entity_type=EntityType.TASK,
            entity_id=uuid.uuid4(),
            is_read=True,
            read_at=timezone.now() - timedelta(days=200),
        )
        unread = Notification.objects.create(
            recipient=owner,
            workspace=staffed_workspace,
            actor=editor,
            type=NotificationType.MENTION,
            title="Unread",
            entity_type=EntityType.COMMENT,
            entity_id=uuid.uuid4(),
        )

        purge_read_notifications(older_than_days=90)

        assert not Notification.objects.filter(pk=old_read.pk).exists()
        # Nothing unseen is ever deleted, however old.
        assert Notification.objects.filter(pk=unread.pk).exists()
