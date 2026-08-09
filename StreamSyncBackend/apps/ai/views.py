"""
AI endpoints.

    POST /api/ai/summarize/            summarise a document
    POST /api/ai/action-items/         propose action items
    POST /api/ai/improve/              rewrite selected text
    POST /api/ai/ask/                  answer a question about a document
    POST /api/ai/action-items/tasks/   create tasks from confirmed items

ACCESS

Every endpoint resolves its document through `scoped_to_user_workspaces`, so a
document in somebody else's workspace is *absent* rather than forbidden and the
response is 404. A 403 would confirm the document exists and let an outsider
probe for ids. (README §16, §20)

The workspace permission classes then govern what a member may do: reading the
assistant's opinion needs membership, and creating tasks needs at least editor
— the same rule as creating a task by hand, because that is what it is.

THE TWO-STEP

Extraction proposes; nothing is created until the user confirms the items on
the separate endpoint. This is a product requirement, not an implementation
detail: an assistant that files work for a colleague off a misread sentence has
done something the user cannot quietly undo. (README §45)
"""

import logging

from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.documents.models import Document
from apps.projects.models import Project
from apps.tasks.serializers import TaskSerializer
from apps.workspaces.models import MembershipStatus
from apps.workspaces.selectors import scoped_to_user_workspaces
from common.permissions import IsWorkspaceEditor, IsWorkspaceMember

from . import services
from .serializers import (
    ActionItemsSerializer,
    AnswerSerializer,
    AskSerializer,
    ConfirmActionItemsSerializer,
    DocumentOperationSerializer,
    RewriteRequestSerializer,
    RewriteSerializer,
    SummarySerializer,
)
from .throttles import AiBurstThrottle, AiSustainedThrottle

logger = logging.getLogger("streamsync.ai")

# Documented once and reused: every endpoint here can fail this way, and the
# client renders the same "AI assistance is temporarily unavailable" for all of
# them. (README §46)
UNAVAILABLE_RESPONSE = OpenApiResponse(
    description=(
        "The AI provider could not be reached, timed out, rate-limited us, or "
        "returned an unusable answer. Error codes: AI_SERVICE_UNAVAILABLE, "
        "AI_TIMEOUT, AI_RATE_LIMITED, AI_INVALID_RESPONSE, AI_NOT_CONFIGURED."
    )
)


def accessible_documents(user) -> QuerySet[Document]:
    """
    Documents the caller may reach.

    Deliberately lighter than the documents app's version of this query: the
    assistant needs the body and the workspace, and none of the contributor
    prefetching that renders a document list.
    """
    return scoped_to_user_workspaces(Document.objects.select_related("workspace"), user)


class BaseAiView(APIView):
    """Shared resolution, permissions and throttling."""

    permission_classes = [IsAuthenticated, IsWorkspaceMember]
    # Both limits on every endpoint. The rates live in settings so a deployment
    # can tune spend without a code change.
    throttle_classes = [AiBurstThrottle, AiSustainedThrottle]

    def get_document(self, data: dict) -> Document:
        document = get_object_or_404(
            accessible_documents(self.request.user), pk=data["document_id"]
        )

        # Object-level membership. The queryset above has already established
        # access; this is the second line of defence the permission classes
        # exist to be, and it keeps the rule in one place.
        self.check_object_permissions(self.request, document)

        workspace_id = data.get("workspace_id")
        if workspace_id and workspace_id != document.workspace_id:
            # Not a permission question — access came from the document — but a
            # client sending a mismatched pair is confused about which document
            # it is looking at, and silently ignoring that hides the bug.
            raise serializers.ValidationError(
                {"workspace_id": "That document is not in this workspace."}
            )

        return document

    def validated(self, serializer_class) -> dict:
        serializer = serializer_class(data=self.request.data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data


@extend_schema(
    tags=["AI"],
    summary="Summarise a document",
    request=DocumentOperationSerializer,
    responses={200: SummarySerializer, 503: UNAVAILABLE_RESPONSE},
)
class SummarizeView(BaseAiView):
    def post(self, request: Request) -> Response:
        data = self.validated(DocumentOperationSerializer)
        document = self.get_document(data)

        result = services.summarize(
            document=document, actor=request.user, content=data.get("content")
        )
        return Response(SummarySerializer(result).data)


@extend_schema(
    tags=["AI"],
    summary="Extract action items",
    description=(
        "Returns proposals only. Nothing is created until the client posts the "
        "confirmed items to /api/ai/action-items/tasks/."
    ),
    request=DocumentOperationSerializer,
    responses={200: ActionItemsSerializer, 503: UNAVAILABLE_RESPONSE},
)
class ActionItemsView(BaseAiView):
    def post(self, request: Request) -> Response:
        data = self.validated(DocumentOperationSerializer)
        document = self.get_document(data)

        result = services.extract_action_items(
            document=document, actor=request.user, content=data.get("content")
        )
        return Response(ActionItemsSerializer(result).data)


@extend_schema(
    tags=["AI"],
    summary="Rewrite selected text",
    request=RewriteRequestSerializer,
    responses={200: RewriteSerializer, 503: UNAVAILABLE_RESPONSE},
)
class ImproveView(BaseAiView):
    def post(self, request: Request) -> Response:
        data = self.validated(RewriteRequestSerializer)
        document = self.get_document(data)

        result = services.rewrite(
            document=document,
            actor=request.user,
            text=data["text"],
            mode=data["mode"],
            tone=data.get("tone"),
        )
        return Response(RewriteSerializer(result).data)


@extend_schema(
    tags=["AI"],
    summary="Ask a question about a document",
    request=AskSerializer,
    responses={200: AnswerSerializer, 503: UNAVAILABLE_RESPONSE},
)
class AskView(BaseAiView):
    def post(self, request: Request) -> Response:
        data = self.validated(AskSerializer)
        document = self.get_document(data)

        result = services.ask(
            document=document,
            actor=request.user,
            question=data["question"],
            content=data.get("content"),
        )
        return Response(AnswerSerializer(result).data)


@extend_schema(
    tags=["AI"],
    summary="Create tasks from confirmed action items",
    description=(
        "The explicit confirmation step. The items are taken as sent — after "
        "the user has edited them — and extraction is not re-run, so what is "
        "created is what was on screen."
    ),
    request=ConfirmActionItemsSerializer,
    responses={201: TaskSerializer(many=True)},
)
class ConfirmActionItemsView(BaseAiView):
    # Creating a task is an editor action whether a person typed it or accepted
    # a proposal. A viewer cannot gain write access by going through the
    # assistant.
    permission_classes = [IsAuthenticated, IsWorkspaceEditor]

    def post(self, request: Request) -> Response:
        data = self.validated(ConfirmActionItemsSerializer)
        document = self.get_document(data)

        project = get_object_or_404(
            scoped_to_user_workspaces(Project.objects.all(), request.user),
            pk=data["project_id"],
            workspace=document.workspace,
        )

        items = self._with_assignees(data["items"], document)

        tasks = services.create_tasks_from_action_items(
            workspace=document.workspace,
            project=project,
            document=document,
            actor=request.user,
            items=items,
        )

        return Response(
            TaskSerializer(tasks, many=True).data, status=status.HTTP_201_CREATED
        )

    @staticmethod
    def _with_assignees(items: list[dict], document: Document) -> list[dict]:
        """
        Swap assignee ids for user objects, in one query.

        An id that is not an active member is left as None rather than
        rejected — the task service would raise, and failing a batch of five
        because the assistant proposed one stale name loses the user four good
        tasks. The unassigned task is still on the board and still editable.
        """
        wanted = {item["assignee_id"] for item in items if item.get("assignee_id")}
        if not wanted:
            return items

        members = {
            user.id: user
            for user in User.objects.filter(
                id__in=wanted,
                workspace_memberships__workspace=document.workspace,
                workspace_memberships__status=MembershipStatus.ACTIVE,
            ).distinct()
        }

        return [
            {**item, "assignee": members.get(item.get("assignee_id"))} for item in items
        ]
