"""
Project endpoints.

    GET    /api/projects/?workspace=<id>   list, filter, search
    POST   /api/projects/                  create (editor+)
    GET    /api/projects/<id>/             detail
    PATCH  /api/projects/<id>/             update (editor+)
    DELETE /api/projects/<id>/             delete (owner)

Isolation works exactly as it does for workspaces: the queryset is scoped to
the caller's workspaces through `scoped_to_user_workspaces`, so a project in
someone else's workspace is absent rather than forbidden and the response is
404. Permissions then decide what a member may do. (README §16, §20)
"""

import logging

from django.db.models import Count, Prefetch, Q, QuerySet
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.generics import GenericAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.tasks.models import TaskStatus
from apps.workspaces.models import MembershipStatus, WorkspaceMembership
from apps.workspaces.selectors import accessible_workspaces, scoped_to_user_workspaces
from common.permissions import IsWorkspaceEditor, IsWorkspaceMember, IsWorkspaceOwner

from . import services
from .models import Project, ProjectStatus
from .serializers import (
    ProjectCreateSerializer,
    ProjectSerializer,
    ProjectUpdateSerializer,
)

logger = logging.getLogger("streamsync.projects")

# Only these may be ordered on. An open `?ordering=` lets a caller sort by any
# column, including ones on joined tables, which is both a performance and an
# information-disclosure surface.
ORDERING_FIELDS = {
    "name",
    "-name",
    "created_at",
    "-created_at",
    "updated_at",
    "-updated_at",
    "due_date",
    "-due_date",
}
DEFAULT_ORDERING = "-updated_at"


def accessible_projects(user) -> QuerySet[Project]:
    """Projects in workspaces the caller belongs to, ready to serialise."""
    active_members = WorkspaceMembership.objects.filter(
        status=MembershipStatus.ACTIVE
    ).select_related("user")

    return (
        scoped_to_user_workspaces(Project.objects.all(), user)
        .select_related("workspace", "owner")
        # Counted in the queryset, not per row. These were constant zeros until
        # Milestone 5 introduced the Task model. `distinct=True` because the
        # members prefetch below does not join, but a future annotation might —
        # and a silently doubled progress bar is hard to notice.
        .annotate(
            task_count=Count("tasks", distinct=True),
            completed_task_count=Count(
                "tasks", filter=Q(tasks__status=TaskStatus.DONE), distinct=True
            ),
        )
        # One extra query for every project's workspace members, instead of one
        # per project. `members` in the payload is built from this.
        .prefetch_related(
            Prefetch(
                "workspace__memberships",
                queryset=active_members,
                to_attr="active_memberships",
            )
        )
    )


def apply_filters(queryset: QuerySet[Project], request: Request) -> QuerySet[Project]:
    """Workspace, status and search, straight from the query string."""
    workspace_id = request.query_params.get("workspace")
    if workspace_id:
        # Not a trust decision: the queryset is already scoped to the caller's
        # workspaces, so an id they cannot see simply matches nothing.
        queryset = queryset.filter(workspace_id=workspace_id)

    project_status = request.query_params.get("status")
    if project_status in ProjectStatus.values:
        queryset = queryset.filter(status=project_status)

    search = (request.query_params.get("search") or "").strip()
    if search:
        # A single Q rather than `qs.filter(a) | qs.filter(b)`. Combining two
        # querysets with `|` re-applies the scoping subquery and can duplicate
        # rows once joins are involved; one WHERE clause cannot.
        #
        # icontains is honest for the current scale. A GIN/trigram index or a
        # stored tsvector is the upgrade path when these tables grow —
        # measured, not guessed. (README §27, §47)
        queryset = queryset.filter(
            Q(name__icontains=search) | Q(description__icontains=search)
        )

    ordering = request.query_params.get("ordering", DEFAULT_ORDERING)
    if ordering not in ORDERING_FIELDS:
        ordering = DEFAULT_ORDERING

    # `id` breaks ties so pagination cannot repeat or skip a row when two
    # projects share a timestamp.
    return queryset.order_by(ordering, "id")


class ProjectListCreateView(GenericAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = ProjectSerializer

    def get_queryset(self) -> QuerySet[Project]:
        return apply_filters(accessible_projects(self.request.user), self.request)

    @extend_schema(
        operation_id="projects_list",
        summary="List projects",
        parameters=[
            OpenApiParameter("workspace", str, description="Filter by workspace id."),
            OpenApiParameter(
                "status",
                str,
                enum=ProjectStatus.values,
                description="Filter by lifecycle status.",
            ),
            OpenApiParameter("search", str, description="Match name or description."),
            OpenApiParameter(
                "ordering",
                str,
                enum=sorted(ORDERING_FIELDS),
                description="Sort field. Defaults to -updated_at.",
            ),
        ],
        responses={200: ProjectSerializer(many=True)},
        tags=["projects"],
    )
    def get(self, request: Request) -> Response:
        page = self.paginate_queryset(self.get_queryset())
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @extend_schema(
        operation_id="projects_create",
        summary="Create a project",
        description="Requires the editor or owner role in the target workspace.",
        request=ProjectCreateSerializer,
        responses={
            201: ProjectSerializer,
            403: OpenApiResponse(description="Viewers cannot create projects."),
            404: OpenApiResponse(description="No such workspace for this caller."),
        },
        tags=["projects"],
    )
    def post(self, request: Request) -> Response:
        serializer = ProjectCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # 404 rather than 403 when the workspace is not the caller's: they
        # should not learn whether the id exists.
        workspace = get_object_or_404(
            accessible_workspaces(request.user), pk=data["workspace_id"]
        )

        permission = IsWorkspaceEditor()
        if not permission.has_object_permission(request, self, workspace):
            self.permission_denied(request, message=permission.message)

        project = services.create_project(
            workspace=workspace,
            # From the session, never the body.
            owner=request.user,
            name=data["name"],
            description=data["description"],
            status=data["status"],
            due_date=data["due_date"],
        )

        created = accessible_projects(request.user).get(pk=project.pk)
        return Response(
            self.get_serializer(created).data, status=status.HTTP_201_CREATED
        )


class ProjectDetailView(GenericAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = ProjectSerializer

    def get_queryset(self) -> QuerySet[Project]:
        return accessible_projects(self.request.user)

    def get_project(self, permission=None) -> Project:
        project = get_object_or_404(self.get_queryset(), pk=self.kwargs["project_id"])
        if permission is not None and not permission.has_object_permission(
            self.request, self, project
        ):
            self.permission_denied(self.request, message=permission.message)
        return project

    @extend_schema(
        operation_id="projects_retrieve",
        summary="Project detail",
        responses={
            200: ProjectSerializer,
            404: OpenApiResponse(description="Not found."),
        },
        tags=["projects"],
    )
    def get(self, request: Request, project_id) -> Response:
        return Response(self.get_serializer(self.get_project(IsWorkspaceMember())).data)

    @extend_schema(
        operation_id="projects_update",
        summary="Update a project",
        description="Requires the editor or owner role. Viewers are read-only.",
        request=ProjectUpdateSerializer,
        responses={
            200: ProjectSerializer,
            403: OpenApiResponse(description="Read-only role."),
        },
        tags=["projects"],
    )
    def patch(self, request: Request, project_id) -> Response:
        project = self.get_project(IsWorkspaceEditor())

        serializer = ProjectUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        services.update_project(
            project=project, actor=request.user, **serializer.validated_data
        )

        updated = self.get_queryset().get(pk=project.pk)
        return Response(self.get_serializer(updated).data)

    @extend_schema(
        operation_id="projects_destroy",
        summary="Delete a project",
        description=(
            "Workspace owner only. Documents filed under the project survive "
            "and become unfiled rather than being deleted with it."
        ),
        responses={204: OpenApiResponse(description="Deleted.")},
        tags=["projects"],
    )
    def delete(self, request: Request, project_id) -> Response:
        project = self.get_project(IsWorkspaceOwner())

        logger.info(
            "Project deleted",
            extra={
                "workspace_id": str(project.workspace_id),
                "project_id": str(project.id),
                "user_id": str(request.user.id),
                "event": "project.deleted",
            },
        )
        project.delete()

        return Response(status=status.HTTP_204_NO_CONTENT)
