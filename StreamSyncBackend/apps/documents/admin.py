"""Internal operations view of documents. Not a product surface."""

from django.contrib import admin

from .models import Document, DocumentVersion


class DocumentVersionInline(admin.TabularInline):
    model = DocumentVersion
    extra = 0
    # Versions are immutable — the model refuses updates — so the admin must
    # not offer editable fields it cannot save.
    readonly_fields = ("version_number", "summary", "created_by", "created_at")
    fields = readonly_fields
    can_delete = False
    ordering = ("-version_number",)

    def has_add_permission(self, request, obj=None) -> bool:
        return False


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "workspace",
        "project",
        "revision",
        "updated_by",
        "updated_at",
    )
    list_filter = ("created_at",)
    search_fields = ("title", "workspace__name", "project__name")
    readonly_fields = ("id", "excerpt", "revision", "created_at", "updated_at")
    autocomplete_fields = ("workspace", "project", "created_by", "updated_by")
    inlines = [DocumentVersionInline]

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .select_related("workspace", "project", "updated_by")
        )


@admin.register(DocumentVersion)
class DocumentVersionAdmin(admin.ModelAdmin):
    list_display = ("document", "version_number", "created_by", "created_at")
    search_fields = ("document__title", "summary")
    readonly_fields = (
        "id",
        "document",
        "version_number",
        "content",
        "summary",
        "created_by",
        "created_at",
        "updated_at",
    )
    ordering = ("-created_at",)

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        """History that can be edited is not history. (README §9)"""
        return False
