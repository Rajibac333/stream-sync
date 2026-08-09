"""
User model and manager.

The invariants here are security-critical — password hashing, email
uniqueness, superuser flags — and every later milestone builds on them.
"""

import uuid

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from tests.conftest import DEFAULT_TEST_PASSWORD

User = get_user_model()

pytestmark = pytest.mark.django_db


class TestUserCreation:
    def test_creates_user_with_email_and_password(self) -> None:
        user = User.objects.create_user(
            email="raj@streamsync.test", name="Raj", password=DEFAULT_TEST_PASSWORD
        )

        assert user.email == "raj@streamsync.test"
        assert user.name == "Raj"
        assert user.is_active is True
        assert user.is_staff is False
        assert user.is_superuser is False

    def test_primary_key_is_a_uuid(self) -> None:
        """Sequential ids would leak signup volume and be guessable in URLs."""
        user = User.objects.create_user(
            email="raj@streamsync.test", name="Raj", password=DEFAULT_TEST_PASSWORD
        )

        assert isinstance(user.id, uuid.UUID)

    def test_password_is_hashed_not_stored_in_plaintext(self) -> None:
        user = User.objects.create_user(
            email="raj@streamsync.test", name="Raj", password=DEFAULT_TEST_PASSWORD
        )

        assert user.password != DEFAULT_TEST_PASSWORD
        assert user.check_password(DEFAULT_TEST_PASSWORD) is True

    def test_rejects_blank_email(self) -> None:
        with pytest.raises(ValueError, match="email address is required"):
            User.objects.create_user(
                email="", name="Nobody", password=DEFAULT_TEST_PASSWORD
            )

    def test_rejects_malformed_email(self) -> None:
        """full_clean runs in the manager, so bad data never reaches the table."""
        with pytest.raises(ValidationError):
            User.objects.create_user(
                email="not-an-email", name="Nobody", password=DEFAULT_TEST_PASSWORD
            )

    def test_normalises_email_domain_case(self) -> None:
        user = User.objects.create_user(
            email="raj@STREAMSYNC.TEST", name="Raj", password=DEFAULT_TEST_PASSWORD
        )

        assert user.email == "raj@streamsync.test"

    def test_strips_surrounding_whitespace(self) -> None:
        user = User.objects.create_user(
            email="  raj@streamsync.test  ",
            name="  Raj Kumar  ",
            password=DEFAULT_TEST_PASSWORD,
        )

        assert user.email == "raj@streamsync.test"
        assert user.name == "Raj Kumar"

    def test_password_may_be_unusable(self) -> None:
        """SSO-only accounts have no local password but must still be valid."""
        user = User.objects.create_user(
            email="sso@streamsync.test", name="SSO User", password=None
        )

        assert user.has_usable_password() is False


class TestEmailUniqueness:
    def test_rejects_duplicate_email(self) -> None:
        User.objects.create_user(
            email="raj@streamsync.test", name="Raj", password=DEFAULT_TEST_PASSWORD
        )

        with pytest.raises(ValidationError):
            User.objects.create_user(
                email="raj@streamsync.test",
                name="Impostor",
                password=DEFAULT_TEST_PASSWORD,
            )

    def test_rejects_email_differing_only_by_case(self) -> None:
        """
        Two accounts a human reads as one is an account-takeover vector.

        Enforced by a database constraint, not only by application code, so it
        holds regardless of which code path does the insert.
        """
        User.objects.create_user(
            email="raj@streamsync.test", name="Raj", password=DEFAULT_TEST_PASSWORD
        )

        # transaction.atomic keeps the failed INSERT from poisoning the outer
        # test transaction.
        with (
            pytest.raises((IntegrityError, ValidationError)),
            transaction.atomic(),
        ):
            User.objects.create_user(
                email="RAJ@streamsync.test",
                name="Impostor",
                password=DEFAULT_TEST_PASSWORD,
            )

    def test_lookup_by_natural_key_is_case_insensitive(self) -> None:
        """Login must succeed whatever case the user types."""
        created = User.objects.create_user(
            email="raj@streamsync.test", name="Raj", password=DEFAULT_TEST_PASSWORD
        )

        found = User.objects.get_by_natural_key("RAJ@Streamsync.Test")

        assert found.pk == created.pk


class TestSuperuserCreation:
    def test_creates_superuser_with_staff_and_superuser_flags(self) -> None:
        admin = User.objects.create_superuser(
            email="admin@streamsync.test",
            name="Admin",
            password=DEFAULT_TEST_PASSWORD,
        )

        assert admin.is_staff is True
        assert admin.is_superuser is True
        assert admin.is_active is True

    def test_rejects_superuser_without_staff_flag(self) -> None:
        with pytest.raises(ValueError, match="is_staff=True"):
            User.objects.create_superuser(
                email="admin@streamsync.test",
                name="Admin",
                password=DEFAULT_TEST_PASSWORD,
                is_staff=False,
            )

    def test_rejects_superuser_without_superuser_flag(self) -> None:
        with pytest.raises(ValueError, match="is_superuser=True"):
            User.objects.create_superuser(
                email="admin@streamsync.test",
                name="Admin",
                password=DEFAULT_TEST_PASSWORD,
                is_superuser=False,
            )


class TestUserContract:
    def test_authentication_uses_email(self) -> None:
        assert User.USERNAME_FIELD == "email"

    def test_createsuperuser_prompts_for_name(self) -> None:
        """USERNAME_FIELD and password must not be repeated in REQUIRED_FIELDS."""
        assert User.REQUIRED_FIELDS == ["name"]

    def test_optional_profile_fields_default_to_empty(self) -> None:
        """Serialised to the frontend as null; never absent from the payload."""
        user = User.objects.create_user(
            email="raj@streamsync.test", name="Raj", password=DEFAULT_TEST_PASSWORD
        )

        assert user.avatar_url == ""
        assert user.title == ""

    def test_records_timestamps(self) -> None:
        user = User.objects.create_user(
            email="raj@streamsync.test", name="Raj", password=DEFAULT_TEST_PASSWORD
        )

        assert user.created_at is not None
        assert user.updated_at is not None

    def test_string_representation_is_the_email(self) -> None:
        user = User.objects.create_user(
            email="raj@streamsync.test", name="Raj", password=DEFAULT_TEST_PASSWORD
        )

        assert str(user) == "raj@streamsync.test"

    def test_short_name_is_the_first_name(self) -> None:
        user = User.objects.create_user(
            email="raj@streamsync.test",
            name="Raj Kumar",
            password=DEFAULT_TEST_PASSWORD,
        )

        assert user.get_short_name() == "Raj"
        assert user.get_full_name() == "Raj Kumar"
