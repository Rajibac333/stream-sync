"""
Task workflows.

Creating and changing a task both write an activity record, so both are
transactional: the task and the entry describing it either both land or
neither does. (README §21, §36)
"""

import logging

from django.db import transaction
from django.utils import timezone

from apps.activity import services as activity
from apps.activity.models import ActivityAction, EntityType
from apps.projects.models import Project
from apps.workspaces.models import MembershipStatus, Workspace, WorkspaceMembership
from common.exceptions import ApplicationError, ErrorCode
from common.tasks import enqueue

from .models import Task, TaskStatus

logger = logging.getLogger("streamsync.tasks")


class ProjectNotInWorkspaceError(ApplicationError):
    """Filing a task under a project belonging to a different workspace."""

    status_code = 400
    default_code = ErrorCode.VALIDATION_ERROR
    default_detail = "That project does not belong to this workspace."


class AssigneeNotAMemberError(ApplicationError):
    """
    Assigning work to somebody outside the workspace.

    Rejected rather than accepted, because an assignee who cannot open the task
    is a silent dead end — and because it would leak the existence of the task
    to someone with no relationship to the team. (README §16)
    """

    status_code = 400
    default_code = "ASSIGNEE_NOT_A_MEMBER"
    default_detail = "That person is not an active member of this workspace."


def resolve_assignee(workspace: Workspace, user):
    """Guard the workspace boundary on assignment."""
    if user is None:
        return None

    is_member = WorkspaceMembership.objects.filter(
        workspace=workspace, user=user, status=MembershipStatus.ACTIVE
    ).exists()
    if not is_member:
        raise AssigneeNotAMemberError

    return user


def _task_href(task: Task) -> str:
    return f"/app/workspaces/{task.workspace_id}/tasks/{task.id}"


@transaction.atomic
def create_task(
    *,
    workspace: Workspace,
    project: Project,
    creator,
    title: str,
    description: str = "",
    status: str | None = None,
    priority: str | None = None,
    assignee=None,
    due_date=None,
) -> Task:
    """Create a task and log it."""
    if project.workspace_id != workspace.id:
        raise ProjectNotInWorkspaceError

    assignee = resolve_assignee(workspace, assignee)

    task = Task(
        workspace=workspace,
        project=project,
        creator=creator,
        title=title,
        description=description,
        assignee=assignee,
        due_date=due_date,
    )
    if status:
        task.status = status
    if priority:
        task.priority = priority

    # A task created directly in the Done column is complete from the outset.
    if task.status == TaskStatus.DONE:
        task.completed_at = timezone.now()

    task.save()

    activity.record(
        workspace=workspace,
        actor=creator,
        action=ActivityAction.TASK_CREATED,
        entity_type=EntityType.TASK,
        entity_id=task.id,
        name=task.title,
        href=_task_href(task),
        context=project.name,
    )

    if task.assignee_id is not None:
        _dispatch_assignment(task=task, actor=creator)

    logger.info(
        "Task created",
        extra={
            "workspace_id": str(workspace.id),
            "task_id": str(task.id),
            "user_id": str(creator.id),
            "event": "task.created",
        },
    )

    return task


@transaction.atomic
def update_task(*, task: Task, editor, **fields) -> Task:
    """
    Apply a partial update.

    `workspace` and `project` are not updatable: moving a task between projects
    would move it between boards, and across workspaces would breach a tenant
    boundary. Both are recreate-and-delete operations, not edits.
    """
    updates: list[str] = []
    was_done = task.status == TaskStatus.DONE
    previous_assignee_id = task.assignee_id

    if "title" in fields:
        task.title = fields["title"]
        updates.append("title")

    if "description" in fields:
        task.description = fields["description"]
        updates.append("description")

    if "priority" in fields:
        task.priority = fields["priority"]
        updates.append("priority")

    if "due_date" in fields:
        task.due_date = fields["due_date"]
        updates.append("due_date")

    if "assignee" in fields:
        task.assignee = resolve_assignee(task.workspace, fields["assignee"])
        updates.append("assignee")

    if "status" in fields:
        task.status = fields["status"]
        updates.append("status")

        now_done = task.status == TaskStatus.DONE
        if now_done and not was_done:
            task.completed_at = timezone.now()
            updates.append("completed_at")
        elif was_done and not now_done:
            # Reopened. Clearing this keeps "when was this finished?" honest
            # rather than reporting a completion that was undone.
            task.completed_at = None
            updates.append("completed_at")

    if not updates:
        return task

    task.save(update_fields=[*updates, "updated_at"])

    # Only the transition into Done is notable enough for the timeline. Logging
    # every field change would bury the events people actually look for.
    if task.status == TaskStatus.DONE and not was_done:
        activity.record(
            workspace=task.workspace,
            actor=editor,
            action=ActivityAction.TASK_COMPLETED,
            entity_type=EntityType.TASK,
            entity_id=task.id,
            name=task.title,
            href=_task_href(task),
            context=task.project.name,
        )
        _dispatch_completion(task=task, actor=editor)

    # Only a *change* of assignee notifies. Re-saving a task that already
    # belonged to someone must not ping them again.
    if task.assignee_id is not None and task.assignee_id != previous_assignee_id:
        _dispatch_assignment(task=task, actor=editor)

    logger.info(
        "Task updated",
        extra={
            "workspace_id": str(task.workspace_id),
            "task_id": str(task.id),
            "user_id": str(editor.id),
            "fields": ",".join(updates),
            "event": "task.updated",
        },
    )

    return task


# ---------------------------------------------------------------------------
# Notification dispatch
#
# Queued with `transaction.on_commit`, not called directly. A task queued
# mid-transaction can start before that transaction commits and find no row —
# `on_commit` guarantees the worker only ever sees committed state. It also
# means a rolled-back transaction sends nothing, rather than notifying about an
# assignment that never happened. (README §21, §22)
# ---------------------------------------------------------------------------


def _dispatch_assignment(*, task: Task, actor) -> None:
    from apps.notifications.tasks import notify_task_assigned

    task_id, actor_id = str(task.id), str(actor.id)
    transaction.on_commit(
        lambda: enqueue(notify_task_assigned, task_id=task_id, actor_id=actor_id)
    )


def _dispatch_completion(*, task: Task, actor) -> None:
    from apps.notifications.tasks import notify_task_completed

    task_id, actor_id = str(task.id), str(actor.id)
    transaction.on_commit(
        lambda: enqueue(notify_task_completed, task_id=task_id, actor_id=actor_id)
    )
