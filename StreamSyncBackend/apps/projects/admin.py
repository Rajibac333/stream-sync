"""Internal operations view of projects. Not a product surface."""

from django.contrib import admin

from .models import Project


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "workspace", "status", "owner", "due_date", "updated_at")
    list_filter = ("status", "created_at")
    search_fields = ("name", "slug", "workspace__name")
    readonly_fields = ("id", "slug", "created_at", "updated_at")
    autocomplete_fields = ("workspace", "owner")

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("workspace", "owner")
