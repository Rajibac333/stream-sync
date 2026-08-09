"""Project workflows. (README §36)"""

import logging
import secrets

from django.db import transaction
from django.utils.text import slugify

from apps.activity import services as activity
from apps.activity.models import ActivityAction, EntityType
from apps.workspaces.models import Workspace
from common.tasks import enqueue

from .models import Project

logger = logging.getLogger("streamsync.projects")

MAX_SLUG_LENGTH = 140


def generate_unique_slug(workspace: Workspace, name: str) -> str:
    """
    A slug unique within the workspace.

    Assigned once at creation and never regenerated on rename, so existing
    links keep working.
    """
    base = slugify(name)[: MAX_SLUG_LENGTH - 8] or "project"

    taken = Project.objects.filter(workspace=workspace)
    if not taken.filter(slug=base).exists():
        return base

    for _attempt in range(5):
        candidate = f"{base}-{secrets.token_hex(3)}"
        if not taken.filter(slug=candidate).exists():
            return candidate

    return f"{base}-{secrets.token_hex(6)}"


@transaction.atomic
def create_project(
    *,
    workspace: Workspace,
    owner,
    name: str,
    description: str = "",
    status: str | None = None,
    due_date=None,
) -> Project:
    """Create a project inside a workspace the caller already has access to."""
    project = Project(
        workspace=workspace,
        owner=owner,
        name=name,
        slug=generate_unique_slug(workspace, name),
        description=description,
        due_date=due_date,
    )
    if status:
        project.status = status
    project.save()

    activity.record(
        workspace=workspace,
        actor=owner,
        action=ActivityAction.PROJECT_CREATED,
        entity_type=EntityType.PROJECT,
        entity_id=project.id,
        name=project.name,
        href=f"/app/workspaces/{workspace.id}/projects/{project.id}",
    )

    logger.info(
        "Project created",
        extra={
            "workspace_id": str(workspace.id),
            "project_id": str(project.id),
            "user_id": str(owner.id),
            "event": "project.created",
        },
    )

    return project


@transaction.atomic
def update_project(*, project: Project, actor=None, **fields) -> Project:
    """
    Apply a partial update.

    `workspace` and `owner` are not updatable here: moving a project between
    workspaces would carry its documents across a tenant boundary, which is a
    migration, not an edit.
    """
    allowed = {"name", "description", "status", "due_date"}
    changed = [field for field in fields if field in allowed]

    previous_status = project.status

    for field in changed:
        setattr(project, field, fields[field])

    if changed:
        project.save(update_fields=[*changed, "updated_at"])

    # Only a status change notifies the workspace. A rename or a reworded
    # description is not worth interrupting everyone for, and notifying on
    # every edit is how a notification list becomes something people mute.
    if "status" in changed and project.status != previous_status:
        _dispatch_status_change(project=project, actor=actor, status=project.status)

    return project


def _dispatch_status_change(*, project: Project, actor, status: str) -> None:
    """Queued on commit — see apps/tasks/services.py for why."""
    if actor is None:
        return

    from apps.notifications.tasks import notify_project_updated

    project_id, actor_id = str(project.id), str(actor.id)
    summary = f"Status changed to {project.get_status_display()}."
    transaction.on_commit(
        lambda: enqueue(
            notify_project_updated,
            project_id=project_id,
            actor_id=actor_id,
            summary=summary,
        )
    )
