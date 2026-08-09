from django.urls import path

from .views import CommentDetailView, CommentListCreateView, CommentReplyView

app_name = "comments"

urlpatterns = [
    path("", CommentListCreateView.as_view(), name="list-create"),
    path("<uuid:comment_id>/", CommentDetailView.as_view(), name="detail"),
    path("<uuid:comment_id>/replies/", CommentReplyView.as_view(), name="replies"),
]
