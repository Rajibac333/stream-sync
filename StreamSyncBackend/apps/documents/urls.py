from django.urls import path

from .views import (
    DocumentDetailView,
    DocumentListCreateView,
    DocumentVersionListView,
    DocumentVersionRestoreView,
)

app_name = "documents"

urlpatterns = [
    path("", DocumentListCreateView.as_view(), name="list-create"),
    path("<uuid:document_id>/", DocumentDetailView.as_view(), name="detail"),
    path(
        "<uuid:document_id>/versions/",
        DocumentVersionListView.as_view(),
        name="versions",
    ),
    path(
        "<uuid:document_id>/versions/<uuid:version_id>/restore/",
        DocumentVersionRestoreView.as_view(),
        name="version-restore",
    ),
]
