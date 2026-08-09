from django.urls import path

from .views import (
    AcceptInvitationView,
    MyInvitationListView,
    WorkspaceDetailView,
    WorkspaceInvitationView,
    WorkspaceListCreateView,
    WorkspaceMemberDetailView,
    WorkspaceMemberListView,
)

app_name = "workspaces"

urlpatterns = [
    path("", WorkspaceListCreateView.as_view(), name="list-create"),
    # Declared before the <uuid:workspace_id> routes. The uuid converter would
    # not match "invitations" anyway, but relying on that is fragile if the
    # converter ever loosens.
    path("invitations/", MyInvitationListView.as_view(), name="my-invitations"),
    path("<uuid:workspace_id>/", WorkspaceDetailView.as_view(), name="detail"),
    path(
        "<uuid:workspace_id>/members/",
        WorkspaceMemberListView.as_view(),
        name="members",
    ),
    path(
        "<uuid:workspace_id>/members/<uuid:membership_id>/",
        WorkspaceMemberDetailView.as_view(),
        name="member-detail",
    ),
    path(
        "<uuid:workspace_id>/invitations/",
        WorkspaceInvitationView.as_view(),
        name="invite",
    ),
    path(
        "<uuid:workspace_id>/invitations/accept/",
        AcceptInvitationView.as_view(),
        name="invitation-accept",
    ),
]
