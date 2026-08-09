"""
Django admin for the user model.

The admin is an internal operations tool, not a product surface — end users
manage their accounts through the API. It exists so support can deactivate an
account or inspect a signup without a database shell.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import UserChangeForm, UserCreationForm
from django.db import models
from django.utils.translation import gettext_lazy as _

from .models import User


class UserCreateForm(UserCreationForm):
    """Superuser-facing creation form. Password confirmation comes for free."""

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ("email", "name")


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    add_form = UserCreateForm
    # UserChangeForm is used as-is rather than subclassed with an explicit
    # Meta.model. The admin binds it to this model through modelform_factory,
    # which also routes every field through formfield_overrides below —
    # something a hand-declared ModelForm would bypass.
    form = UserChangeForm
    model = User

    list_display = ("email", "name", "title", "is_active", "is_staff", "created_at")
    list_filter = ("is_active", "is_staff", "is_superuser", "created_at")
    search_fields = ("email", "name")
    # The default UserAdmin orders by `username`, which this model does not have.
    ordering = ("email",)
    readonly_fields = ("id", "created_at", "updated_at", "last_login", "google_id")

    fieldsets = (
        (None, {"fields": ("id", "email", "password")}),
        (_("Profile"), {"fields": ("name", "title", "avatar_url")}),
        # Read-only: set only by apps.accounts.services.authenticate_with_google
        # on first Google sign-in. Shown so support can tell a Google-linked
        # account from a password-only one without a database shell.
        (_("Google Sign-In"), {"fields": ("google_id",)}),
        (
            _("Permissions"),
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                ),
            },
        ),
        (_("Important dates"), {"fields": ("last_login", "created_at", "updated_at")}),
    )

    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "name", "password1", "password2"),
            },
        ),
    )

    filter_horizontal = ("groups", "user_permissions")

    # Django 6.0 changes the default scheme for a schemeless URL from http to
    # https. Stating it explicitly adopts the future behaviour now and keeps
    # the form free of the transitional deprecation warning.
    formfield_overrides = {
        models.URLField: {"assume_scheme": "https"},
    }
