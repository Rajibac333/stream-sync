"""
Global search.

One query across documents, projects, tasks and people, returned as a single
flat, ranked list rather than one array per kind. That shape is deliberate and
comes from the consumer: the command menu ranks results *across* types — a
document called "Billing" can legitimately outrank a project called "Billing
v2" — which is impossible if the transport pre-buckets them.
(README §47; frontend CLAUDE.md §30, §46)

SCOPE

Every queryset routes through `scoped_to_user_workspaces`, so search can only
ever return things the caller could already open. Search is exactly the kind of
endpoint where a missed isolation check leaks the *existence* of other tenants'
data — the titles alone would be the leak, even without access.

RANKING

Deliberately simple: a prefix match beats a substring match, and shorter titles
beat longer ones at equal quality. `ILIKE` over indexed columns is enough at
this size, and README §47 is explicit that Elasticsearch is not to be
introduced before the scale demands it. If ranking quality becomes the
complaint, PostgreSQL full-text search is the next step and this function is
the only thing that changes.
"""

from dataclasses import dataclass
from typing import Any

from django.db.models import Q

from apps.documents.models import Document
from apps.projects.models import Project
from apps.tasks.models import Task
from apps.workspaces.models import MembershipStatus, WorkspaceMembership
from apps.workspaces.selectors import accessible_workspaces, scoped_to_user_workspaces

# Per-kind cap before ranking, then an overall cap. Both exist so a one-letter
# query cannot ask the database for every row in the workspace.
PER_TYPE_LIMIT = 10
TOTAL_LIMIT = 20

# The shortest query worth running. A single character matches most of a corpus
# and ranks meaninglessly.
MIN_QUERY_LENGTH = 2


@dataclass(frozen=True)
class SearchHit:
    id: str
    type: str
    title: str
    subtitle: str | None
    href: str | None
    score: float


def _score(title: str, query: str, *, weight: float) -> float:
    """
    Relevance for one hit, in [0, 1] before weighting.

    Three tiers — exact, prefix, contains — with a small bonus for brevity so
    that "Billing" outranks "Billing migration plan Q3" on the query "billing".
    """
    lowered = (title or "").casefold()
    needle = query.casefold()

    if lowered == needle:
        base = 1.0
    elif lowered.startswith(needle):
        base = 0.8
    elif needle in lowered:
        base = 0.6
    else:
        # Matched on a field other than the title (a task description, an
        # email). Still a hit, just a weaker one.
        base = 0.4

    brevity = 0.1 * (1 / (1 + len(lowered) / 50))
    return round((base + brevity) * weight, 4)


def _workspace_filtered(queryset, workspace_id):
    return queryset.filter(workspace_id=workspace_id) if workspace_id else queryset


def search(*, user, query: str, workspace_id: Any | None = None) -> list[SearchHit]:
    """Everything matching `query` that `user` is allowed to see."""
    query = (query or "").strip()
    if len(query) < MIN_QUERY_LENGTH:
        return []

    hits: list[SearchHit] = []

    documents = _workspace_filtered(
        scoped_to_user_workspaces(Document.objects.all(), user), workspace_id
    ).filter(Q(title__icontains=query) | Q(excerpt__icontains=query))

    for document in documents.select_related("project")[:PER_TYPE_LIMIT]:
        hits.append(
            SearchHit(
                id=str(document.id),
                type="document",
                title=document.title,
                subtitle=document.project.name if document.project_id else None,
                href=(
                    f"/app/workspaces/{document.workspace_id}/documents/{document.id}"
                ),
                # Documents lead because the product is built around them, and
                # because a title match on a document is the most common
                # intent behind opening the command menu.
                score=_score(document.title, query, weight=1.0),
            )
        )

    projects = _workspace_filtered(
        scoped_to_user_workspaces(Project.objects.all(), user), workspace_id
    ).filter(Q(name__icontains=query) | Q(description__icontains=query))

    for project in projects[:PER_TYPE_LIMIT]:
        hits.append(
            SearchHit(
                id=str(project.id),
                type="project",
                title=project.name,
                subtitle=project.get_status_display(),
                href=(f"/app/workspaces/{project.workspace_id}/projects/{project.id}"),
                score=_score(project.name, query, weight=0.95),
            )
        )

    tasks = _workspace_filtered(
        scoped_to_user_workspaces(Task.objects.all(), user), workspace_id
    ).filter(Q(title__icontains=query) | Q(description__icontains=query))

    for task in tasks.select_related("project")[:PER_TYPE_LIMIT]:
        hits.append(
            SearchHit(
                id=str(task.id),
                type="task",
                title=task.title,
                subtitle=task.project.name,
                href=f"/app/workspaces/{task.workspace_id}/tasks/{task.id}",
                score=_score(task.title, query, weight=0.9),
            )
        )

    # People are found through membership rather than the user table, which is
    # what keeps search from confirming that an account exists on this
    # installation to someone who shares no workspace with them.
    memberships = _workspace_filtered(
        WorkspaceMembership.objects.filter(
            status=MembershipStatus.ACTIVE,
            workspace__in=accessible_workspaces(user),
        ),
        workspace_id,
    ).filter(Q(user__name__icontains=query) | Q(user__email__icontains=query))

    seen_people: set[str] = set()
    for membership in memberships.select_related("user", "workspace")[:PER_TYPE_LIMIT]:
        person = membership.user
        if str(person.id) in seen_people:
            # The same colleague can appear in several shared workspaces; the
            # command menu wants one row per person.
            continue
        seen_people.add(str(person.id))

        hits.append(
            SearchHit(
                id=str(person.id),
                type="person",
                title=person.name,
                subtitle=person.email,
                href=f"/app/workspaces/{membership.workspace_id}/members",
                score=_score(person.name, query, weight=0.85),
            )
        )

    hits.sort(key=lambda hit: (-hit.score, hit.title.casefold()))
    return hits[:TOTAL_LIMIT]
