from django.urls import path

from .views import ActivityListView

app_name = "activity"

urlpatterns = [
    path("", ActivityListView.as_view(), name="list"),
]
