"""
Activity timeline.

    GET /api/activity/?workspace=<id>   a workspace's feed, newest first

Read-only by design. Entries are written by the services that perform the
underlying operations; there is no endpoint that creates, edits or deletes one.
An audit trail with a write API is not an audit trail. (README §12, §40)
"""

from django.db.models import QuerySet
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.generics import GenericAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.workspaces.selectors import scoped_to_user_workspaces

from .models import Activity, ActivityAction, EntityType
from .serializers import ActivitySerializer


def accessible_activity(user) -> QuerySet[Activity]:
    """
    Entries from workspaces the caller belongs to.

    The same isolation chokepoint every other resource uses. It matters
    especially here: an activity feed names documents, tasks and people, so a
    leak would disclose the shape of another team's work even without exposing
    the objects themselves.
    """
    return scoped_to_user_workspaces(Activity.objects.all(), user).select_related(
        "actor"
    )


class ActivityListView(GenericAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = ActivitySerializer

    def get_queryset(self) -> QuerySet[Activity]:
        queryset = accessible_activity(self.request.user)
        params = self.request.query_params

        workspace_id = params.get("workspace")
        if workspace_id:
            # Safe: already scoped, so an id the caller cannot see matches
            # nothing rather than widening access.
            queryset = queryset.filter(workspace_id=workspace_id)

        action = params.get("action")
        if action in ActivityAction.values:
            queryset = queryset.filter(action=action)

        entity_type = params.get("entity_type")
        if entity_type in EntityType.values:
            queryset = queryset.filter(entity_type=entity_type)

        entity_id = params.get("entity")
        if entity_id:
            # "Everything that happened to this document", for a detail panel.
            queryset = queryset.filter(entity_id=entity_id)

        # `id` breaks ties so pagination cannot repeat or skip an entry when
        # two land in the same tick — which happens routinely, since several
        # entries can be written inside one request.
        return queryset.order_by("-created_at", "-id")

    @extend_schema(
        operation_id="activity_list",
        summary="Workspace activity timeline",
        description=(
            "Newest first. Read-only: entries are written by the operations "
            "they describe."
        ),
        parameters=[
            OpenApiParameter("workspace", str, description="Filter by workspace id."),
            OpenApiParameter("action", str, enum=ActivityAction.values),
            OpenApiParameter("entity_type", str, enum=EntityType.values),
            OpenApiParameter(
                "entity", str, description="Filter to one object's history."
            ),
        ],
        responses={200: ActivitySerializer(many=True)},
        tags=["activity"],
    )
    def get(self, request: Request) -> Response:
        page = self.paginate_queryset(self.get_queryset())
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)
