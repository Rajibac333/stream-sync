"""Internal operations view of comments. Not a product surface."""

from django.contrib import admin

from .models import Comment


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ("short_body", "author", "target", "is_resolved", "created_at")
    list_filter = ("is_resolved", "created_at")
    search_fields = ("body", "author__email", "workspace__name")
    readonly_fields = (
        "id",
        "resolved_at",
        "resolved_by",
        "edited_at",
        "created_at",
        "updated_at",
    )
    autocomplete_fields = ("workspace", "author", "parent")

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .select_related("author", "document", "task", "workspace")
        )

    @admin.display(description="Body")
    def short_body(self, comment: Comment) -> str:
        return comment.body[:60] + ("…" if len(comment.body) > 60 else "")

    @admin.display(description="Target")
    def target(self, comment: Comment) -> str:
        return f"{comment.resource_type}: {comment.document or comment.task}"
