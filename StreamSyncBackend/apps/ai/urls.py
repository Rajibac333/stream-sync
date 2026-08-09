"""
AI routes, mounted at /api/ai/.

Paths match `StreamSyncFrontend/src/api/ai.ts`. `action-items/tasks/` is
declared before `action-items/` for readability only — the two do not overlap,
since Django matches complete paths.
"""

from django.urls import path

from .views import (
    ActionItemsView,
    AskView,
    ConfirmActionItemsView,
    ImproveView,
    SummarizeView,
)

app_name = "ai"

urlpatterns = [
    path("summarize/", SummarizeView.as_view(), name="summarize"),
    path("action-items/", ActionItemsView.as_view(), name="action-items"),
    # The confirmation step. Separate endpoint, separate gesture: extraction
    # never creates anything. (README §45)
    path(
        "action-items/tasks/",
        ConfirmActionItemsView.as_view(),
        name="action-items-tasks",
    ),
    path("improve/", ImproveView.as_view(), name="improve"),
    path("ask/", AskView.as_view(), name="ask"),
]
