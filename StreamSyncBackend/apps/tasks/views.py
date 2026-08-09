"""
Task endpoints.

    GET    /api/tasks/?workspace=<id>  list, filter, search
    POST   /api/tasks/                 create (editor+)
    GET    /api/tasks/<id>/            detail
    PATCH  /api/tasks/<id>/            update (editor+)
    DELETE /api/tasks/<id>/            delete (editor+)

Isolation works as everywhere else: the queryset is scoped through
`scoped_to_user_workspaces`, so a task in another tenant is absent rather than
forbidden and the response is 404. (README §16, §20)
"""

import logging

from django.db.models import Count, Q, QuerySet
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status as http_status
from rest_framework.generics import GenericAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.projects.models import Project
from apps.workspaces.selectors import accessible_workspaces, scoped_to_user_workspaces
from common.permissions import IsWorkspaceEditor, IsWorkspaceMember

from . import services
from .models import Task, TaskPriority, TaskStatus
from .serializers import TaskCreateSerializer, TaskSerializer, TaskUpdateSerializer

logger = logging.getLogger("streamsync.tasks")

ORDERING_FIELDS = {
    "title",
    "-title",
    "due_date",
    "-due_date",
    "priority",
    "-priority",
    "created_at",
    "-created_at",
    "updated_at",
    "-updated_at",
}
DEFAULT_ORDERING = "-updated_at"


def accessible_tasks(user) -> QuerySet[Task]:
    """Tasks in workspaces the caller belongs to, ready to serialise."""
    return (
        scoped_to_user_workspaces(Task.objects.all(), user)
        # project name, assignee avatar — rendered on every row.
        .select_related("project", "assignee", "workspace")
        # Counted in the queryset rather than per row. Only thread roots count:
        # a thread with ten replies is one conversation, which is what the
        # badge on a task card means.
        .annotate(
            comment_count=Count("comments", filter=Q(comments__parent__isnull=True))
        )
    )


def apply_filters(queryset: QuerySet[Task], request: Request) -> QuerySet[Task]:
    """Workspace, project, assignee, status, priority and search."""
    params = request.query_params

    workspace_id = params.get("workspace")
    if workspace_id:
        # Safe: the queryset is already scoped, so an id the caller cannot see
        # simply matches nothing.
        queryset = queryset.filter(workspace_id=workspace_id)

    project_id = params.get("project")
    if project_id:
        queryset = queryset.filter(project_id=project_id)

    assignee = params.get("assignee")
    if assignee == "none":
        queryset = queryset.filter(assignee__isnull=True)
    elif assignee == "me":
        queryset = queryset.filter(assignee=request.user)
    elif assignee:
        queryset = queryset.filter(assignee_id=assignee)

    task_status = params.get("status")
    if task_status in TaskStatus.values:
        queryset = queryset.filter(status=task_status)

    priority = params.get("priority")
    if priority in TaskPriority.values:
        queryset = queryset.filter(priority=priority)

    search = (params.get("search") or "").strip()
    if search:
        queryset = queryset.filter(
            Q(title__icontains=search) | Q(description__icontains=search)
        )

    ordering = params.get("ordering", DEFAULT_ORDERING)
    if ordering not in ORDERING_FIELDS:
        ordering = DEFAULT_ORDERING

    # `id` breaks ties so pagination cannot repeat or skip a row.
    return queryset.order_by(ordering, "id")


class TaskListCreateView(GenericAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = TaskSerializer

    def get_queryset(self) -> QuerySet[Task]:
        return apply_filters(accessible_tasks(self.request.user), self.request)

    @extend_schema(
        operation_id="tasks_list",
        summary="List tasks",
        parameters=[
            OpenApiParameter("workspace", str, description="Filter by workspace id."),
            OpenApiParameter("project", str, description="Filter by project id."),
            OpenApiParameter(
                "assignee",
                str,
                description='User id, "me" for your own, or "none" for unassigned.',
            ),
            OpenApiParameter("status", str, enum=TaskStatus.values),
            OpenApiParameter("priority", str, enum=TaskPriority.values),
            OpenApiParameter("search", str, description="Match title or description."),
            OpenApiParameter("ordering", str, enum=sorted(ORDERING_FIELDS)),
        ],
        responses={200: TaskSerializer(many=True)},
        tags=["tasks"],
    )
    def get(self, request: Request) -> Response:
        page = self.paginate_queryset(self.get_queryset())
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @extend_schema(
        operation_id="tasks_create",
        summary="Create a task",
        description="Requires the editor or owner role in the target workspace.",
        request=TaskCreateSerializer,
        responses={
            201: TaskSerializer,
            400: OpenApiResponse(description="Assignee is not a workspace member."),
            403: OpenApiResponse(description="Viewers cannot create tasks."),
            404: OpenApiResponse(description="No such workspace or project."),
        },
        tags=["tasks"],
    )
    def post(self, request: Request) -> Response:
        serializer = TaskCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        workspace = get_object_or_404(
            accessible_workspaces(request.user), pk=data["workspace_id"]
        )

        permission = IsWorkspaceEditor()
        if not permission.has_object_permission(request, self, workspace):
            self.permission_denied(request, message=permission.message)

        # Scoped, so a project id from another tenant is simply not found.
        project = get_object_or_404(
            scoped_to_user_workspaces(Project.objects.all(), request.user),
            pk=data["project_id"],
        )

        task = services.create_task(
            workspace=workspace,
            project=project,
            # From the session, never the body.
            creator=request.user,
            title=data["title"],
            description=data["description"],
            status=data["status"],
            priority=data["priority"],
            assignee=_resolve_assignee_id(request.user, data["assignee_id"]),
            due_date=data["due_date"],
        )

        created = accessible_tasks(request.user).get(pk=task.pk)
        return Response(
            self.get_serializer(created).data, status=http_status.HTTP_201_CREATED
        )


def _resolve_assignee_id(requester, assignee_id):
    """
    Turn an assignee id into a user.

    Returns the raw user; whether they may actually be assigned is decided by
    the service, which checks workspace membership. Looking the user up here
    without that check would let a caller confirm that an arbitrary user id
    exists, so a miss is reported the same way a non-member is.
    """
    if assignee_id is None:
        return None

    from django.contrib.auth import get_user_model

    user = get_user_model().objects.filter(pk=assignee_id).first()
    if user is None:
        raise services.AssigneeNotAMemberError

    return user


class TaskDetailView(GenericAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = TaskSerializer

    def get_queryset(self) -> QuerySet[Task]:
        return accessible_tasks(self.request.user)

    def get_task(self, permission=None) -> Task:
        task = get_object_or_404(self.get_queryset(), pk=self.kwargs["task_id"])
        if permission is not None and not permission.has_object_permission(
            self.request, self, task
        ):
            self.permission_denied(self.request, message=permission.message)
        return task

    @extend_schema(
        operation_id="tasks_retrieve",
        summary="Task detail",
        responses={200: TaskSerializer, 404: OpenApiResponse(description="Not found.")},
        tags=["tasks"],
    )
    def get(self, request: Request, task_id) -> Response:
        return Response(self.get_serializer(self.get_task(IsWorkspaceMember())).data)

    @extend_schema(
        operation_id="tasks_update",
        summary="Update a task",
        description=(
            "Partial. The board patches `status` alone on every drag. Moving a "
            "task into Done records a `task_completed` activity entry."
        ),
        request=TaskUpdateSerializer,
        responses={
            200: TaskSerializer,
            400: OpenApiResponse(description="Assignee is not a workspace member."),
            403: OpenApiResponse(description="Viewers cannot edit tasks."),
        },
        tags=["tasks"],
    )
    def patch(self, request: Request, task_id) -> Response:
        task = self.get_task(IsWorkspaceEditor())

        serializer = TaskUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)

        if "assignee_id" in data:
            data["assignee"] = _resolve_assignee_id(
                request.user, data.pop("assignee_id")
            )

        services.update_task(task=task, editor=request.user, **data)

        updated = self.get_queryset().get(pk=task.pk)
        return Response(self.get_serializer(updated).data)

    @extend_schema(
        operation_id="tasks_destroy",
        summary="Delete a task",
        description="Requires the editor or owner role. Removes its comments with it.",
        responses={204: OpenApiResponse(description="Deleted.")},
        tags=["tasks"],
    )
    def delete(self, request: Request, task_id) -> Response:
        task = self.get_task(IsWorkspaceEditor())

        logger.info(
            "Task deleted",
            extra={
                "workspace_id": str(task.workspace_id),
                "task_id": str(task.id),
                "user_id": str(request.user.id),
                "event": "task.deleted",
            },
        )
        task.delete()

        return Response(status=http_status.HTTP_204_NO_CONTENT)
