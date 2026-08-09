"""Internal operations view of notifications. Not a product surface."""

from django.contrib import admin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("title", "recipient", "type", "is_read", "created_at")
    list_filter = ("type", "is_read", "created_at")
    search_fields = ("title", "recipient__email", "workspace__name")
    readonly_fields = ("id", "created_at", "updated_at", "read_at")
    autocomplete_fields = ("recipient", "workspace", "actor")

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .select_related("recipient", "actor", "workspace")
        )
