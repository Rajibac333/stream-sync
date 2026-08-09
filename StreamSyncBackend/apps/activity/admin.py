"""
Read-only operations view of the activity log.

Every mutation is disabled: the model refuses updates, and an admin that
offered edit forms it cannot save would be misleading. (README §12)
"""

from django.contrib import admin

from .models import Activity


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display = ("action", "actor", "entity_type", "workspace", "created_at")
    list_filter = ("action", "entity_type", "created_at")
    search_fields = ("workspace__name", "actor__email")
    readonly_fields = (
        "id",
        "workspace",
        "actor",
        "action",
        "entity_type",
        "entity_id",
        "metadata",
        "created_at",
        "updated_at",
    )
    ordering = ("-created_at",)

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("workspace", "actor")

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        """Append-only means append-only, including from the admin."""
        return False
