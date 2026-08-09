"""
Notification endpoints.

    GET   /api/notifications/                 my notifications
    GET   /api/notifications/unread-count/    the badge
    PATCH /api/notifications/<id>/            mark read or unread
    POST  /api/notifications/mark-all-read/   clear the badge

ISOLATION

A notification belongs to one person. Every queryset here is filtered to
`recipient=request.user` — not to a workspace, and not by a permission class.
There is no role that grants access to somebody else's notifications, so this
is the whole access rule.
"""

import logging

from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.generics import GenericAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .models import Notification, NotificationType
from .serializers import NotificationSerializer, NotificationUpdateSerializer

logger = logging.getLogger("streamsync.notifications")


def own_notifications(user) -> QuerySet[Notification]:
    """The caller's notifications, and nobody else's."""
    return (
        Notification.objects.for_user(user)
        # `actor` is rendered on every row.
        .select_related("actor")
        # `id` breaks ties: several notifications are routinely written in the
        # same tick by one fan-out, and without it pagination can repeat a row.
        .order_by("-created_at", "-id")
    )


class NotificationListView(GenericAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = NotificationSerializer

    def get_queryset(self) -> QuerySet[Notification]:
        queryset = own_notifications(self.request.user)
        params = self.request.query_params

        if params.get("unread") == "true":
            queryset = queryset.unread()

        notification_type = params.get("type")
        if notification_type in NotificationType.values:
            queryset = queryset.filter(type=notification_type)

        workspace_id = params.get("workspace")
        if workspace_id:
            queryset = queryset.filter(workspace_id=workspace_id)

        return queryset

    @extend_schema(
        operation_id="notifications_list",
        summary="List my notifications",
        parameters=[
            OpenApiParameter(
                "unread", str, description='Set to "true" for unread only.'
            ),
            OpenApiParameter("type", str, enum=NotificationType.values),
            OpenApiParameter("workspace", str, description="Filter by workspace id."),
        ],
        responses={200: NotificationSerializer(many=True)},
        tags=["notifications"],
    )
    def get(self, request: Request) -> Response:
        page = self.paginate_queryset(self.get_queryset())
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)


class UnreadCountView(APIView):
    """
    The badge.

    A dedicated endpoint rather than a field on the list response: the badge is
    polled far more often than the list is opened, and counting is much cheaper
    than serialising a page. A partial index covers exactly this query.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="notifications_unread_count",
        summary="Unread notification count",
        responses={200: OpenApiResponse(description='{"unread_count": 3}')},
        tags=["notifications"],
    )
    def get(self, request: Request) -> Response:
        return Response({"unread_count": services.unread_count(request.user)})


class NotificationDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="notifications_update",
        summary="Mark a notification read or unread",
        description=(
            "Only the read flag is writable. Idempotent — marking an "
            "already-read notification does not overwrite when it was read."
        ),
        request=NotificationUpdateSerializer,
        responses={
            200: NotificationSerializer,
            404: OpenApiResponse(description="Not yours, or does not exist."),
        },
        tags=["notifications"],
    )
    def patch(self, request: Request, notification_id) -> Response:
        # Scoped to the caller, so somebody else's notification is not found
        # rather than forbidden — the same 404-not-403 rule used everywhere.
        notification = get_object_or_404(
            own_notifications(request.user), pk=notification_id
        )

        serializer = NotificationUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        services.mark_read(
            notification=notification, read=serializer.validated_data["read"]
        )

        return Response(NotificationSerializer(notification).data)


class MarkAllReadView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="notifications_mark_all_read",
        summary="Mark everything read",
        request=None,
        responses={200: OpenApiResponse(description='{"updated": 7}')},
        tags=["notifications"],
    )
    def post(self, request: Request) -> Response:
        updated = services.mark_all_read(user=request.user)

        return Response({"updated": updated}, status=status.HTTP_200_OK)
