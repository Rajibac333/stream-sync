"""
Global search endpoint.

    GET /api/search/?q=<query>&workspace=<id>

Returns a flat, ranked array — not a paginated envelope and not one bucket per
kind. The consumer is the command menu, which shows a short cross-type list and
never pages; wrapping twenty rows in pagination metadata would be ceremony the
client would have to unwrap for nothing.

The whole result set is bounded server-side (see `services.TOTAL_LIMIT`), so
"unpaginated" cannot become "unbounded".
"""

import logging

from django.core.exceptions import ValidationError
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .serializers import SearchResultSerializer

logger = logging.getLogger("streamsync.search")


@extend_schema(
    tags=["search"],
    summary="Search documents, projects, tasks and people",
    description=(
        "Scoped to the caller's workspaces. Results are ranked across types and "
        "capped; queries shorter than two characters return an empty list."
    ),
    parameters=[
        OpenApiParameter(
            "q", str, description="The query. Under two characters returns []."
        ),
        OpenApiParameter(
            "workspace",
            str,
            description="Optional workspace id to narrow the search to one workspace.",
        ),
    ],
    responses={200: SearchResultSerializer(many=True)},
)
class SearchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        query = request.query_params.get("q", "")
        # Not validated as a UUID: an unparseable id simply matches nothing,
        # and rejecting it would turn a stale bookmark into an error page.
        workspace_id = request.query_params.get("workspace") or None

        try:
            hits = services.search(
                user=request.user, query=query, workspace_id=workspace_id
            )
        except (ValidationError, ValueError, TypeError):
            # A workspace id that is not a UUID. Django raises its own
            # ValidationError when the value reaches the query, which DRF would
            # otherwise render as a 400. Empty is the better answer: nothing
            # matches an id that cannot exist, and a stale bookmark in the
            # command menu should show "no results", not an error.
            hits = []

        return Response(SearchResultSerializer(hits, many=True).data)
