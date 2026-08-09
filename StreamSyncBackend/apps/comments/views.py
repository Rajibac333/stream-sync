"""
Comment endpoints.

    GET    /api/comments/?resource_type=&resource_id=   threads on a resource
    POST   /api/comments/                               start a thread
    POST   /api/comments/<id>/replies/                  reply
    PATCH  /api/comments/<id>/                          edit body, or resolve
    DELETE /api/comments/<id>/                          delete

WHO MAY DO WHAT

    read      any active member
    comment   any active member, including viewers
    edit      the author, and nobody else
    resolve   editors and owners, or the thread's author
    delete    the author, or the workspace owner (moderation)

Viewers can comment deliberately. A "viewer" who cannot ask a question is not a
reviewer, and review is the workflow the role exists for. It remains read-only
for workspace *content* — documents, tasks and projects. (README §20)
"""

import logging

from django.db.models import Prefetch, QuerySet
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status as http_status
from rest_framework.exceptions import ValidationError
from rest_framework.generics import GenericAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.documents.models import Document
from apps.tasks.models import Task
from apps.workspaces.selectors import scoped_to_user_workspaces
from common.permissions import IsWorkspaceEditor, IsWorkspaceMember

from . import services
from .models import Comment, CommentResource
from .serializers import (
    CommentCreateSerializer,
    CommentReplyCreateSerializer,
    CommentSerializer,
    CommentUpdateSerializer,
)

logger = logging.getLogger("streamsync.comments")


def accessible_comments(user) -> QuerySet[Comment]:
    """Comments in workspaces the caller belongs to."""
    replies = (
        Comment.objects.select_related("author")
        .filter(parent__isnull=False)
        .order_by("created_at")
    )

    return (
        scoped_to_user_workspaces(Comment.objects.all(), user)
        .select_related("author", "workspace")
        # One query for every thread's replies, instead of one per thread.
        .prefetch_related(
            Prefetch("replies", queryset=replies, to_attr="prefetched_replies")
        )
    )


def resolve_target(user, resource_type: str, resource_id):
    """
    Find the document or task a comment is about.

    Scoped to the caller's workspaces, so a resource in another tenant is not
    found — the same 404-not-403 rule used everywhere else.
    """
    if resource_type == CommentResource.DOCUMENT:
        document = get_object_or_404(
            scoped_to_user_workspaces(Document.objects.all(), user), pk=resource_id
        )
        return document, None

    task = get_object_or_404(
        scoped_to_user_workspaces(Task.objects.all(), user), pk=resource_id
    )
    return None, task


class CommentListCreateView(GenericAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = CommentSerializer

    @extend_schema(
        operation_id="comments_list",
        summary="List threads on a resource",
        description=(
            "Returns thread roots with their replies nested, oldest first.\n\n"
            "Deliberately a bare array rather than the paginated envelope: the "
            "client renders a whole thread at once, and a comment panel that "
            "paged would hide half a conversation. A thread is bounded by the "
            "resource it hangs off. See SETUP.md for the README §48 deviation."
        ),
        parameters=[
            OpenApiParameter(
                "resource_type", str, enum=CommentResource.values, required=True
            ),
            OpenApiParameter("resource_id", str, required=True),
        ],
        responses={200: CommentSerializer(many=True)},
        tags=["comments"],
    )
    def get(self, request: Request) -> Response:
        resource_type = request.query_params.get("resource_type")
        resource_id = request.query_params.get("resource_id")

        if resource_type not in CommentResource.values or not resource_id:
            # Raised rather than hand-built, so it goes through the project's
            # exception handler and comes back in the same envelope as every
            # other error. (README §18)
            raise ValidationError(
                {
                    "resource_type": [
                        "Provide `resource_type` (document or task) and `resource_id`."
                    ]
                }
            )

        document, task = resolve_target(request.user, resource_type, resource_id)

        threads = accessible_comments(request.user).roots()
        threads = (
            threads.filter(document=document)
            if document is not None
            else threads.filter(task=task)
        )

        return Response(
            CommentSerializer(threads.order_by("created_at", "id"), many=True).data
        )

    @extend_schema(
        operation_id="comments_create",
        summary="Start a thread",
        description="Any active member may comment, including viewers.",
        request=CommentCreateSerializer,
        responses={
            201: CommentSerializer,
            404: OpenApiResponse(description="No such document or task."),
        },
        tags=["comments"],
    )
    def post(self, request: Request) -> Response:
        serializer = CommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        document, task = resolve_target(
            request.user, data["resource_type"], data["resource_id"]
        )
        workspace = document.workspace if document else task.workspace

        permission = IsWorkspaceMember()
        if not permission.has_object_permission(request, self, workspace):
            self.permission_denied(request, message=permission.message)

        comment = services.create_comment(
            workspace=workspace,
            # From the session, never the body.
            author=request.user,
            document=document,
            task=task,
            body=data["body"],
            mention_ids=data["mention_ids"],
            quoted_text=data["quoted_text"],
        )

        created = accessible_comments(request.user).get(pk=comment.pk)
        return Response(
            CommentSerializer(created).data, status=http_status.HTTP_201_CREATED
        )


class CommentReplyView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="comments_reply",
        summary="Reply to a thread",
        description=(
            "Returns the whole updated thread, not just the reply, so the "
            "client can re-render the panel from one response. Replying to a "
            "reply attaches to the same root — threads stay one level deep."
        ),
        request=CommentReplyCreateSerializer,
        responses={201: CommentSerializer},
        tags=["comments"],
    )
    def post(self, request: Request, comment_id) -> Response:
        parent = get_object_or_404(accessible_comments(request.user), pk=comment_id)

        permission = IsWorkspaceMember()
        if not permission.has_object_permission(request, self, parent.workspace):
            self.permission_denied(request, message=permission.message)

        serializer = CommentReplyCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        reply = services.reply_to_comment(
            parent=parent,
            author=request.user,
            body=serializer.validated_data["body"],
            mention_ids=serializer.validated_data["mention_ids"],
        )

        root = accessible_comments(request.user).get(pk=reply.parent_id)
        return Response(
            CommentSerializer(root).data, status=http_status.HTTP_201_CREATED
        )


class CommentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_comment(self, request: Request, comment_id) -> Comment:
        comment = get_object_or_404(accessible_comments(request.user), pk=comment_id)

        permission = IsWorkspaceMember()
        if not permission.has_object_permission(request, self, comment.workspace):
            self.permission_denied(request, message=permission.message)

        return comment

    @extend_schema(
        operation_id="comments_update",
        summary="Edit a comment, or resolve a thread",
        description=(
            "`body` edits the comment and is restricted to its author — not "
            "even the owner may rewrite somebody else's words. `resolved` is a "
            "workflow action available to editors, owners and the thread's "
            "author."
        ),
        request=CommentUpdateSerializer,
        responses={
            200: CommentSerializer,
            403: OpenApiResponse(description="Not the author, or role too low."),
        },
        tags=["comments"],
    )
    def patch(self, request: Request, comment_id) -> Response:
        comment = self.get_comment(request, comment_id)

        serializer = CommentUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if "body" in data:
            # Author-only; the service enforces it.
            services.edit_comment(
                comment=comment, editor=request.user, body=data["body"]
            )

        if "resolved" in data:
            is_author = comment.author_id == request.user.id
            if not is_author:
                permission = IsWorkspaceEditor()
                if not permission.has_object_permission(
                    request, self, comment.workspace
                ):
                    self.permission_denied(request, message=permission.message)

            services.set_resolved(
                comment=comment, actor=request.user, resolved=data["resolved"]
            )

        # Replies live on the root, so a reply's edit returns its thread.
        root_id = comment.parent_id or comment.id
        root = accessible_comments(request.user).get(pk=root_id)
        return Response(CommentSerializer(root).data)

    @extend_schema(
        operation_id="comments_destroy",
        summary="Delete a comment",
        description=(
            "The author may delete their own; the workspace owner may delete "
            "any, for moderation. Deleting a thread root removes its replies."
        ),
        responses={
            204: OpenApiResponse(description="Deleted."),
            403: OpenApiResponse(description="Not yours to delete."),
        },
        tags=["comments"],
    )
    def delete(self, request: Request, comment_id) -> Response:
        comment = self.get_comment(request, comment_id)

        services.delete_comment(comment=comment, actor=request.user)

        return Response(status=http_status.HTTP_204_NO_CONTENT)
