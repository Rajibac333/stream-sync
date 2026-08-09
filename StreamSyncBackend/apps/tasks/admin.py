"""Internal operations view of tasks. Not a product surface."""

from django.contrib import admin

from .models import Task


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "project",
        "status",
        "priority",
        "assignee",
        "due_date",
        "updated_at",
    )
    list_filter = ("status", "priority", "created_at")
    search_fields = ("title", "project__name", "workspace__name", "assignee__email")
    readonly_fields = ("id", "completed_at", "created_at", "updated_at")
    autocomplete_fields = ("workspace", "project", "assignee", "creator")

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .select_related("workspace", "project", "assignee")
        )
