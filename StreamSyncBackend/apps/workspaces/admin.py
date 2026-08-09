"""Internal operations view of workspaces. Not a product surface."""

from django.contrib import admin

from .models import Workspace, WorkspaceMembership


class WorkspaceMembershipInline(admin.TabularInline):
    model = WorkspaceMembership
    extra = 0
    autocomplete_fields = ("user", "invited_by")
    readonly_fields = ("created_at", "joined_at")


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "owner", "member_total", "created_at")
    list_filter = ("created_at",)
    search_fields = ("name", "slug", "owner__email")
    readonly_fields = ("id", "slug", "created_at", "updated_at")
    autocomplete_fields = ("owner",)
    inlines = [WorkspaceMembershipInline]

    def get_queryset(self, request):
        # member_total would otherwise be one query per row.
        return super().get_queryset(request).select_related("owner")

    @admin.display(description="Members")
    def member_total(self, workspace: Workspace) -> int:
        return workspace.memberships.count()


@admin.register(WorkspaceMembership)
class WorkspaceMembershipAdmin(admin.ModelAdmin):
    list_display = ("user", "workspace", "role", "status", "joined_at")
    list_filter = ("role", "status")
    search_fields = ("user__email", "workspace__name")
    readonly_fields = ("id", "created_at", "updated_at")
    autocomplete_fields = ("workspace", "user", "invited_by")
