"""
User creation.

Centralised here so that every path that makes a user — registration, the
`createsuperuser` command, test fixtures, data migrations — normalises the
email and hashes the password the same way. (README §5)
"""

from typing import TYPE_CHECKING, Any

from django.contrib.auth.base_user import BaseUserManager
from django.utils.translation import gettext_lazy as _

if TYPE_CHECKING:
    from .models import User


class UserManager(BaseUserManager):
    """Manager for the email-identified user model."""

    use_in_migrations = True

    def _create_user(
        self, email: str, password: str | None, **extra_fields: Any
    ) -> "User":
        if not email:
            raise ValueError(_("An email address is required."))

        # Lowercases only the domain part, which is the half that is
        # case-insensitive per RFC 5321.
        email = self.normalize_email(email).strip()

        user = self.model(email=email, **extra_fields)
        # set_password hashes; assigning to .password would store plaintext.
        # A None password produces an unusable hash, which is the correct
        # state for accounts that will only ever authenticate via SSO.
        user.set_password(password)
        user.full_clean(exclude=["password"])
        user.save(using=self._db)
        return user

    def create_user(
        self, email: str, password: str | None = None, **extra_fields: Any
    ) -> "User":
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        extra_fields.setdefault("is_active", True)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(
        self, email: str, password: str | None = None, **extra_fields: Any
    ) -> "User":
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)

        # Rejected rather than silently corrected: a caller passing
        # is_superuser=False here has a bug worth surfacing.
        if extra_fields.get("is_staff") is not True:
            raise ValueError(_("A superuser must have is_staff=True."))
        if extra_fields.get("is_superuser") is not True:
            raise ValueError(_("A superuser must have is_superuser=True."))

        return self._create_user(email, password, **extra_fields)

    def get_by_natural_key(self, username: str | None) -> "User":
        """Case-insensitive login lookup, matching the uniqueness constraint."""
        return self.get(**{f"{self.model.USERNAME_FIELD}__iexact": username})
