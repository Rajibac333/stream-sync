"""
Dashboard summary endpoint.

    GET /api/dashboard/?workspace=<id>

One request rather than the dashboard firing eight and assembling the answer
itself — and correct, which a client-side sum over a paginated list cannot be.
(Frontend CLAUDE.md §31)
"""

import logging

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.workspaces.selectors import accessible_workspaces
from common.permissions import IsWorkspaceMember

from . import services
from .serializers import DashboardSummarySerializer

logger = logging.getLogger("streamsync.dashboard")


@extend_schema(
    tags=["dashboard"],
    summary="Workspace dashboard summary",
    description=(
        "Counts and the collaborator strip for one workspace. Collaborator "
        "presence is derived from recent activity, not from live WebSocket "
        "sessions."
    ),
    parameters=[
        OpenApiParameter("workspace", str, required=True, description="Workspace id.")
    ],
    responses={200: DashboardSummarySerializer},
)
class DashboardView(APIView):
    permission_classes = [IsAuthenticated, IsWorkspaceMember]

    def get(self, request: Request) -> Response:
        # Resolved through the isolation chokepoint, so a workspace the caller
        # does not belong to is 404 rather than 403 — the same rule as every
        # other workspace-scoped endpoint. (README §16)
        workspace = get_object_or_404(
            accessible_workspaces(request.user),
            pk=request.query_params.get("workspace"),
        )
        self.check_object_permissions(request, workspace)

        summary = services.summarize(workspace=workspace, viewer=request.user)
        return Response(DashboardSummarySerializer(summary).data)
