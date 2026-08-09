from django.urls import path

from .views import ProjectDetailView, ProjectListCreateView

app_name = "projects"

urlpatterns = [
    path("", ProjectListCreateView.as_view(), name="list-create"),
    path("<uuid:project_id>/", ProjectDetailView.as_view(), name="detail"),
]
