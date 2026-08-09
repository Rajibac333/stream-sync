"""
Root URL configuration.

Every application endpoint lives under /api/. Per-app routers are included
here as their milestones land, keeping this module a table of contents rather
than a place where views are defined. (README §33)
"""

from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

api_patterns = [
    # Operational endpoints: liveness and readiness. (README §32, Milestone 1)
    path("", include("apps.core.urls")),
    # Registration, login, token refresh, logout, current user. (README §19)
    path("auth/", include("apps.accounts.urls")),
    # Workspaces, membership, roles and invitations. (README §6, §20)
    path("workspaces/", include("apps.workspaces.urls")),
    # Projects and documents, both workspace-scoped. (README §7, §8)
    path("projects/", include("apps.projects.urls")),
    path("documents/", include("apps.documents.urls")),
    # Tasks and comments, both workspace-scoped. (README §10, §11)
    path("tasks/", include("apps.tasks.urls")),
    path("comments/", include("apps.comments.urls")),
    # Read-only workspace timeline. (README §12)
    path("activity/", include("apps.activity.urls")),
    # Per-user notifications. (README §13, §45)
    path("notifications/", include("apps.notifications.urls")),
    # Document assistance. The key lives here, never in the browser.
    # (README §14, §50)
    path("ai/", include("apps.ai.urls")),
    # Cross-entity search backing the command menu. (README §47)
    path("search/", include("apps.search.urls")),
    # Workspace summary for the dashboard screen. Counts over whole
    # collections cannot be computed correctly from a paginated client.
    path("dashboard/", include("apps.dashboard.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include(api_patterns)),
    # OpenAPI schema and its two viewers. (README §28)
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
    path(
        "api/redoc/",
        SpectacularRedocView.as_view(url_name="schema"),
        name="redoc",
    ),
]

if settings.DEBUG:
    from django.conf.urls.static import static

    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# Errors raised before a request reaches a DRF view — an unrouted URL, a
# rejected Host header, a middleware crash — bypass DRF's exception handler.
# These keep such responses in the same JSON envelope for /api/ paths, while
# the admin continues to render Django's HTML pages. (README §18)
handler400 = "common.exceptions.views.bad_request"
handler403 = "common.exceptions.views.permission_denied"
handler404 = "common.exceptions.views.not_found"
handler500 = "common.exceptions.views.server_error"
