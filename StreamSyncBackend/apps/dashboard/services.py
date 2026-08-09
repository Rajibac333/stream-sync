"""
The dashboard summary.

Four counts and a collaborator strip for one workspace, computed in one request.

WHY THIS IS A SERVER ENDPOINT

The client could not compute these correctly. Every list endpoint is paginated
at 25, so a client adding up the tasks it holds would report "3 due today" for a
workspace with two hundred tasks and be confidently wrong. Counts over a whole
collection belong where the whole collection is. (Frontend CLAUDE.md §31)

PRESENCE IS DERIVED, NOT LIVE

The collaborator strip reports who has *done something recently*, read from the
activity log — not who currently holds a WebSocket. Live presence exists, but it
is per-document and lives in Redis (apps/collaboration/presence.py); there is no
workspace-wide roster to read, and inventing one from an empty cache would show
an office of "offline" people who are in fact working. Recent activity is a
weaker signal, honestly labelled, rather than a stronger one that would be
wrong.
"""

from dataclasses import dataclass
from datetime import timedelta

from django.utils import timezone

from apps.activity.models import Activity, ActivityAction
from apps.projects.models import Project, ProjectStatus
from apps.tasks.models import Task, TaskStatus
from apps.workspaces.models import MembershipStatus, Workspace, WorkspaceMembership

# How recent an action has to be for someone to read as present. Chosen to match
# what the strip claims: "on it right now" for online, "around" for idle.
ONLINE_WINDOW = timedelta(minutes=5)
IDLE_WINDOW = timedelta(minutes=30)

# The strip shows a handful of faces, not the whole company.
MAX_COLLABORATORS = 8

# Statuses that mean "not finished". Kept as a set so the meaning of an open
# task lives in one place rather than being re-derived per query.
OPEN_TASK_STATUSES = (TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.REVIEW)

# "Active projects" on the dashboard means work in flight, not the literal
# `active` status. A team whose projects are all still in planning is not a team
# with zero projects, and a tile reading 0 above a list of three projects reads
# as a bug. Finished and shelved work is what the number excludes.
IN_FLIGHT_PROJECT_STATUSES = (
    ProjectStatus.PLANNING,
    ProjectStatus.ACTIVE,
    ProjectStatus.ON_HOLD,
)

# Verb phrasing for the collaborator strip. The client renders this as-is.
_ACTIVITY_PHRASES = {
    ActivityAction.DOCUMENT_EDITED: "Editing",
    ActivityAction.DOCUMENT_CREATED: "Created",
    ActivityAction.PROJECT_CREATED: "Created",
    ActivityAction.TASK_CREATED: "Added",
    ActivityAction.TASK_COMPLETED: "Completed",
    ActivityAction.COMMENT_ADDED: "Commented on",
    ActivityAction.MEMBER_INVITED: "Invited",
    ActivityAction.AI_ACTION: "Used AI on",
}


@dataclass(frozen=True)
class CollaboratorPresence:
    user: object
    status: str
    activity: str | None


@dataclass(frozen=True)
class DashboardSummary:
    active_project_count: int
    open_task_count: int
    due_today_count: int
    completed_this_week_count: int
    collaborators: list[CollaboratorPresence]


def _week_start(now):
    """Monday 00:00 in the server's timezone — everything here is UTC."""
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight - timedelta(days=midnight.weekday())


def summarize(*, workspace: Workspace, viewer) -> DashboardSummary:
    """
    One workspace's numbers.

    The caller has already proved membership — the view resolves the workspace
    through the isolation chokepoint — so this counts the workspace's whole
    contents rather than re-filtering by viewer.
    """
    now = timezone.now()
    today = timezone.localdate()

    active_projects = Project.objects.filter(
        workspace=workspace, status__in=IN_FLIGHT_PROJECT_STATUSES
    ).count()

    tasks = Task.objects.filter(workspace=workspace)

    open_tasks = tasks.filter(status__in=OPEN_TASK_STATUSES).count()

    # Overdue counts as due today: a deadline that has already passed is more
    # urgent than one arriving this afternoon, and a strip that hid it would be
    # hiding the thing the user most needs to see.
    due_today = tasks.filter(status__in=OPEN_TASK_STATUSES, due_date__lte=today).count()

    completed_this_week = tasks.filter(
        status=TaskStatus.DONE, completed_at__gte=_week_start(now)
    ).count()

    return DashboardSummary(
        active_project_count=active_projects,
        open_task_count=open_tasks,
        due_today_count=due_today,
        completed_this_week_count=completed_this_week,
        collaborators=_collaborators(workspace=workspace, now=now),
    )


def _collaborators(*, workspace: Workspace, now) -> list[CollaboratorPresence]:
    """The workspace roster, ordered by how recently each person did something."""
    memberships = (
        WorkspaceMembership.objects.filter(
            workspace=workspace, status=MembershipStatus.ACTIVE
        )
        .select_related("user")
        .order_by("created_at")[:MAX_COLLABORATORS]
    )
    members = list(memberships)
    if not members:
        return []

    user_ids = [membership.user_id for membership in members]

    # One query for everyone's latest action, rather than one per member.
    recent = (
        Activity.objects.filter(
            workspace=workspace,
            actor_id__in=user_ids,
            created_at__gte=now - IDLE_WINDOW,
        )
        .select_related("actor")
        .order_by("actor_id", "-created_at")
    )

    latest: dict[object, Activity] = {}
    for entry in recent:
        # Ordered newest-first within each actor, so the first one wins.
        latest.setdefault(entry.actor_id, entry)

    presences: list[CollaboratorPresence] = []
    for membership in members:
        entry = latest.get(membership.user_id)

        if entry is None:
            status, activity = "offline", None
        elif now - entry.created_at <= ONLINE_WINDOW:
            status, activity = "online", _describe(entry)
        else:
            status, activity = "idle", _describe(entry)

        presences.append(
            CollaboratorPresence(user=membership.user, status=status, activity=activity)
        )

    # Most recently seen first: the people to talk to are at the front.
    order = {"online": 0, "idle": 1, "offline": 2}
    presences.sort(key=lambda presence: (order[presence.status], presence.user.name))
    return presences


def _describe(entry: Activity) -> str | None:
    """ "Editing Payment Requirements" — the verb and the thing, as one line."""
    name = (entry.metadata or {}).get("name")
    if not name:
        return None

    verb = _ACTIVITY_PHRASES.get(entry.action)
    return f"{verb} {name}" if verb else name


__all__ = ["CollaboratorPresence", "DashboardSummary", "summarize"]
