from django.urls import path

from .views import TaskDetailView, TaskListCreateView

app_name = "tasks"

urlpatterns = [
    path("", TaskListCreateView.as_view(), name="list-create"),
    path("<uuid:task_id>/", TaskDetailView.as_view(), name="detail"),
]
