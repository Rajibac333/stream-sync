"""
Document endpoints.

    GET    /api/documents/?workspace=<id>  list, filter, search
    POST   /api/documents/                 create (editor+)
    GET    /api/documents/<id>/            detail, with body
    PATCH  /api/documents/<id>/            edit (editor+)
    DELETE /api/documents/<id>/            delete (editor+)

    GET    /api/documents/<id>/versions/                 history
    POST   /api/documents/<id>/versions/<vid>/restore/   restore (editor+)

Restore writes forward: restoring version 5 creates version 6 with version 5's
content. No existing version is ever modified. (README §9, §39)
"""

import logging

from django.db.models import Prefetch, Q, QuerySet
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.generics import GenericAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.projects.models import Project
from apps.workspaces.selectors import accessible_workspaces, scoped_to_user_workspaces
from common.permissions import IsWorkspaceEditor, IsWorkspaceMember

from . import services
from .models import Document, DocumentVersion
from .serializers import (
    DocumentCreateSerializer,
    DocumentDetailSerializer,
    DocumentSummarySerializer,
    DocumentUpdateSerializer,
    DocumentVersionSerializer,
)

logger = logging.getLogger("streamsync.documents")

ORDERING_FIELDS = {
    "title",
    "-title",
    "created_at",
    "-created_at",
    "updated_at",
    "-updated_at",
}
DEFAULT_ORDERING = "-updated_at"


def accessible_documents(user) -> QuerySet[Document]:
    """Documents in workspaces the caller belongs to."""
    version_authors = DocumentVersion.objects.select_related("created_by").only(
        "id", "document_id", "created_by_id", "version_number"
    )

    return (
        scoped_to_user_workspaces(Document.objects.all(), user)
        # Every one of these is rendered in the payload — project name, author,
        # last editor — so without select_related each row costs three queries.
        .select_related("workspace", "project", "created_by", "updated_by")
        # Contributor list. `only(...)` because the version *bodies* are large
        # and none of them are needed to render a name.
        .prefetch_related(
            Prefetch(
                "versions", queryset=version_authors, to_attr="prefetched_versions"
            )
        )
    )


def list_queryset(user) -> QuerySet[Document]:
    """
    The list view's queryset.

    `defer("content")` is the point: bodies are the largest column in the
    schema and the list does not render them. The denormalised `excerpt` is
    what the preview uses instead.
    """
    return accessible_documents(user).defer("content")


def apply_filters(queryset: QuerySet[Document], request: Request) -> QuerySet[Document]:
    """Workspace, project and search filters."""
    workspace_id = request.query_params.get("workspace")
    if workspace_id:
        queryset = queryset.filter(workspace_id=workspace_id)

    project_id = request.query_params.get("project")
    if project_id == "none":
        # Documents not filed under any project.
        queryset = queryset.filter(project__isnull=True)
    elif project_id:
        queryset = queryset.filter(project_id=project_id)

    search = (request.query_params.get("search") or "").strip()
    if search:
        # Title and body. Searching `content` means the deferred column is read
        # for the WHERE clause, but it is still not selected into the response.
        # (README §47)
        queryset = queryset.filter(
            Q(title__icontains=search) | Q(content__icontains=search)
        )

    ordering = request.query_params.get("ordering", DEFAULT_ORDERING)
    if ordering not in ORDERING_FIELDS:
        ordering = DEFAULT_ORDERING

    return queryset.order_by(ordering, "id")


class DocumentListCreateView(GenericAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = DocumentSummarySerializer

    def get_queryset(self) -> QuerySet[Document]:
        return apply_filters(list_queryset(self.request.user), self.request)

    @extend_schema(
        operation_id="documents_list",
        summary="List documents",
        description="Bodies are omitted; `excerpt` carries the preview.",
        parameters=[
            OpenApiParameter("workspace", str, description="Filter by workspace id."),
            OpenApiParameter(
                "project",
                str,
                description='Filter by project id, or "none" for unfiled documents.',
            ),
            OpenApiParameter("search", str, description="Match title or body."),
            OpenApiParameter(
                "ordering",
                str,
                enum=sorted(ORDERING_FIELDS),
                description="Sort field. Defaults to -updated_at.",
            ),
        ],
        responses={200: DocumentSummarySerializer(many=True)},
        tags=["documents"],
    )
    def get(self, request: Request) -> Response:
        page = self.paginate_queryset(self.get_queryset())
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @extend_schema(
        operation_id="documents_create",
        summary="Create a document",
        description=(
            "Creates the document and its version 1 in one transaction. "
            "Requires the editor or owner role in the target workspace."
        ),
        request=DocumentCreateSerializer,
        responses={
            201: DocumentSummarySerializer,
            400: OpenApiResponse(description="Project belongs to another workspace."),
            403: OpenApiResponse(description="Viewers cannot create documents."),
            404: OpenApiResponse(description="No such workspace for this caller."),
        },
        tags=["documents"],
    )
    def post(self, request: Request) -> Response:
        serializer = DocumentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        workspace = get_object_or_404(
            accessible_workspaces(request.user), pk=data["workspace_id"]
        )

        permission = IsWorkspaceEditor()
        if not permission.has_object_permission(request, self, workspace):
            self.permission_denied(request, message=permission.message)

        project = None
        if data["project_id"]:
            # Scoped to the caller's workspaces, so a project id from another
            # tenant is simply not found. The service then re-checks that the
            # project belongs to *this* workspace.
            project = get_object_or_404(
                scoped_to_user_workspaces(Project.objects.all(), request.user),
                pk=data["project_id"],
            )

        document = services.create_document(
            workspace=workspace,
            author=request.user,
            title=data["title"],
            content=data["content"],
            project=project,
        )

        created = accessible_documents(request.user).get(pk=document.pk)
        return Response(
            DocumentSummarySerializer(created).data, status=status.HTTP_201_CREATED
        )


class DocumentDetailView(GenericAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = DocumentDetailSerializer

    def get_queryset(self) -> QuerySet[Document]:
        return accessible_documents(self.request.user)

    def get_document(self, permission=None) -> Document:
        document = get_object_or_404(self.get_queryset(), pk=self.kwargs["document_id"])
        if permission is not None and not permission.has_object_permission(
            self.request, self, document
        ):
            self.permission_denied(self.request, message=permission.message)
        return document

    @extend_schema(
        operation_id="documents_retrieve",
        summary="Document detail",
        description="Includes the body and the current revision number.",
        responses={
            200: DocumentDetailSerializer,
            404: OpenApiResponse(
                description="Not found, or not the caller's workspace."
            ),
        },
        tags=["documents"],
    )
    def get(self, request: Request, document_id) -> Response:
        return Response(
            self.get_serializer(self.get_document(IsWorkspaceMember())).data
        )

    @extend_schema(
        operation_id="documents_update",
        summary="Edit a document",
        description=(
            "Requires the editor or owner role. Send `revision` to make the "
            "write conditional: a mismatch returns 409 instead of silently "
            "overwriting somebody else's save."
        ),
        request=DocumentUpdateSerializer,
        responses={
            200: DocumentDetailSerializer,
            403: OpenApiResponse(description="Viewers cannot edit."),
            409: OpenApiResponse(description="The document changed while editing."),
        },
        tags=["documents"],
    )
    def patch(self, request: Request, document_id) -> Response:
        document = self.get_document(IsWorkspaceEditor())

        serializer = DocumentUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)

        expected_revision = data.pop("revision", None)
        summary = data.pop("summary", "")

        if "project_id" in data:
            project_id = data.pop("project_id")
            data["project"] = (
                get_object_or_404(
                    scoped_to_user_workspaces(Project.objects.all(), request.user),
                    pk=project_id,
                )
                if project_id
                else None
            )

        services.update_document(
            document=document,
            editor=request.user,
            expected_revision=expected_revision,
            summary=summary,
            **data,
        )

        updated = self.get_queryset().get(pk=document.pk)
        return Response(self.get_serializer(updated).data)

    @extend_schema(
        operation_id="documents_destroy",
        summary="Delete a document",
        description="Requires the editor or owner role. Removes its versions with it.",
        responses={204: OpenApiResponse(description="Deleted.")},
        tags=["documents"],
    )
    def delete(self, request: Request, document_id) -> Response:
        document = self.get_document(IsWorkspaceEditor())

        logger.info(
            "Document deleted",
            extra={
                "workspace_id": str(document.workspace_id),
                "document_id": str(document.id),
                "user_id": str(request.user.id),
                "event": "document.deleted",
            },
        )
        document.delete()

        return Response(status=status.HTTP_204_NO_CONTENT)


class DocumentVersionListView(GenericAPIView):
    """A document's history, newest first."""

    permission_classes = [IsAuthenticated]
    serializer_class = DocumentVersionSerializer

    def get_document(self) -> Document:
        document = get_object_or_404(
            accessible_documents(self.request.user), pk=self.kwargs["document_id"]
        )
        permission = IsWorkspaceMember()
        if not permission.has_object_permission(self.request, self, document):
            self.permission_denied(self.request, message=permission.message)
        return document

    def get_queryset(self) -> QuerySet[DocumentVersion]:
        return (
            DocumentVersion.objects.filter(document=self.get_document())
            # `author` is rendered on every row.
            .select_related("created_by")
            # Bodies are the largest column and the list does not show them.
            .defer("content")
            .order_by("-version_number")
        )

    @extend_schema(
        operation_id="documents_versions_list",
        summary="List a document's versions",
        description=(
            "Newest first. Snapshot bodies are omitted — restore reads the "
            "content server-side, so no client needs it."
        ),
        responses={200: DocumentVersionSerializer(many=True)},
        tags=["documents"],
    )
    def get(self, request: Request, document_id) -> Response:
        queryset = self.get_queryset()

        # Resolved once for the page rather than per row. The first entry of a
        # descending list is the highest number by definition.
        first = queryset.first()
        context = {
            **self.get_serializer_context(),
            "current_version_number": first.version_number if first else None,
        }

        page = self.paginate_queryset(queryset)
        serializer = DocumentVersionSerializer(page, many=True, context=context)
        return self.get_paginated_response(serializer.data)


class DocumentVersionRestoreView(APIView):
    """Restore a previous version by writing it forward."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="documents_version_restore",
        summary="Restore a version",
        description=(
            "Restoring version 5 creates version 6 containing version 5's "
            "content. Version 5 is never modified and versions 6..N are never "
            "removed — undoing a restore is just another restore.\n\n"
            "Requires the editor or owner role. Returns the updated document."
        ),
        request=None,
        responses={
            200: DocumentDetailSerializer,
            403: OpenApiResponse(description="Viewers cannot restore."),
            404: OpenApiResponse(description="No such document or version."),
        },
        tags=["documents"],
    )
    def post(self, request: Request, document_id, version_id) -> Response:
        document = get_object_or_404(accessible_documents(request.user), pk=document_id)

        permission = IsWorkspaceEditor()
        if not permission.has_object_permission(request, self, document):
            self.permission_denied(request, message=permission.message)

        # Scoped to this document, so a version id belonging to another
        # document — in this workspace or any other — is simply not found.
        version = get_object_or_404(
            DocumentVersion.objects.filter(document=document), pk=version_id
        )

        services.restore_version(document=document, version=version, actor=request.user)

        updated = accessible_documents(request.user).get(pk=document.pk)
        return Response(DocumentDetailSerializer(updated).data)
