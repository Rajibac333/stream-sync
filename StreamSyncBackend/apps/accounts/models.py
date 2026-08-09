"""
The StreamSync user.

Email-identified, UUID-keyed, and defined in Milestone 1 on purpose: swapping
AUTH_USER_MODEL once other tables hold foreign keys to it is a migration
rewrite, so the shape has to be settled before anything references it.
(README §5)
"""

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from django.db.models.functions import Lower
from django.utils.translation import gettext_lazy as _

from common.models import BaseModel

from .managers import UserManager


class User(BaseModel, AbstractBaseUser, PermissionsMixin):
    """
    An authenticated person.

    AbstractBaseUser supplies `password` and `last_login`; PermissionsMixin
    supplies `is_superuser`, groups and per-object permission plumbing that the
    Django admin needs. Everything product-specific is declared below.

    Workspace roles (OWNER/EDITOR/VIEWER) are deliberately *not* fields here —
    they describe a user's relationship to one workspace, not a global property
    of the account, and belong on the membership model in Milestone 3.
    """

    email = models.EmailField(
        _("email address"),
        unique=True,
        max_length=254,  # RFC 5321 maximum
        help_text=_("Used to sign in. Case-insensitively unique."),
    )
    name = models.CharField(
        _("full name"),
        max_length=150,
        help_text=_("Display name shown to collaborators."),
    )
    # Stored as a URL rather than an uploaded image: avatars come from an
    # object store or an identity provider, so the database holds a pointer and
    # the backend needs no image-processing dependency. Serialised to the
    # frontend as `avatarUrl`.
    avatar_url = models.URLField(
        _("avatar URL"),
        max_length=500,
        blank=True,
        default="",
        help_text=_("Empty renders initials on the client."),
    )
    title = models.CharField(
        _("job title"),
        max_length=100,
        blank=True,
        default="",
        help_text=_('Role within the team, e.g. "Frontend Engineer".'),
    )

    # Google's `sub` claim: a stable, Google-guaranteed-unique identifier for
    # the account, distinct from the email address (which a person can change
    # at Google, or which could theoretically be reassigned). Null rather than
    # blank-default for a password-only account, so the uniqueness constraint
    # only ever compares real Google identities — Postgres treats every NULL as
    # distinct, unlike an empty string, which would collide on the second
    # password-only signup. Set by apps.accounts.services.authenticate_with_google.
    google_id = models.CharField(
        _("Google account ID"),
        max_length=255,
        unique=True,
        null=True,
        blank=True,
        default=None,
        help_text=_(
            "Set automatically the first time this person signs in with Google."
        ),
    )

    is_active = models.BooleanField(
        _("active"),
        default=True,
        help_text=_("Deactivate instead of deleting to preserve authored content."),
    )
    is_staff = models.BooleanField(
        _("staff status"),
        default=False,
        help_text=_("Grants access to the Django admin. Unrelated to workspace roles."),
    )

    objects = UserManager()

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    # Prompted for by `createsuperuser`; USERNAME_FIELD and password are
    # implicit and must not be repeated here.
    REQUIRED_FIELDS = ["name"]

    class Meta:
        verbose_name = _("user")
        verbose_name_plural = _("users")
        ordering = ["name", "email"]
        constraints = [
            # `unique=True` above stops byte-identical duplicates; this stops
            # "Raj@example.com" from registering alongside "raj@example.com"
            # and creating two accounts a human would read as one.
            models.UniqueConstraint(
                Lower("email"),
                name="user_email_ci_unique",
            ),
        ]

    def __str__(self) -> str:
        return self.email

    def clean(self) -> None:
        super().clean()
        self.email = self.__class__.objects.normalize_email(self.email).strip()
        self.name = self.name.strip()

    def get_full_name(self) -> str:
        """Required by the admin and by Django's auth contract."""
        return self.name

    def get_short_name(self) -> str:
        return self.name.split(" ")[0] if self.name else self.email
