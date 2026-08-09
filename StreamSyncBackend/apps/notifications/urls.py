from django.urls import path

from .views import (
    MarkAllReadView,
    NotificationDetailView,
    NotificationListView,
    UnreadCountView,
)

app_name = "notifications"

urlpatterns = [
    path("", NotificationListView.as_view(), name="list"),
    # Both literal routes precede the <uuid:...> route. The uuid converter
    # would not match either word, but relying on that is fragile.
    path("unread-count/", UnreadCountView.as_view(), name="unread-count"),
    path("mark-all-read/", MarkAllReadView.as_view(), name="mark-all-read"),
    path("<uuid:notification_id>/", NotificationDetailView.as_view(), name="detail"),
]
