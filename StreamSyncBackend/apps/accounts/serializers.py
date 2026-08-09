"""
Validation and representation for the authentication endpoints.

Serializers validate input and shape output. They do not create sessions,
issue tokens or touch cookies — those are workflows and live in
`services.py`. (README §34, §36)

The output field names are the wire contract the frontend already codes
against in `StreamSyncFrontend/src/api/auth.ts`: snake_case, with
`avatar_url` and `title` nullable.
"""

from typing import Any

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models.functions import Lower
from rest_framework import serializers

from common.serializers import EmptyAsNullCharField

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """
    The public shape of a user.

    Explicit `fields` rather than `exclude`: a field added to the model must
    never appear in an API response merely because someone forgot to hide it.
    That is how password hashes and internal flags leak.
    """

    avatar_url = EmptyAsNullCharField(read_only=True)
    title = EmptyAsNullCharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "name", "email", "avatar_url", "title", "created_at"]
        read_only_fields = fields


class CollaboratorSerializer(serializers.ModelSerializer):
    """
    The minimal user shape used inside other resources.

    Avatar stacks, "last edited by" labels and member lists need a name and a
    picture, not an email address. Keeping this separate from UserSerializer
    means embedding a user somewhere new does not quietly widen how much
    personal data that endpoint discloses.
    """

    avatar_url = EmptyAsNullCharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "name", "avatar_url"]
        read_only_fields = fields


class RegisterSerializer(serializers.Serializer):
    """
    Registration input.

    A plain Serializer rather than a ModelSerializer: a ModelSerializer would
    expose every writable model field by default, so `is_staff` would be one
    forgotten line away from being settable by an anonymous request.
    """

    name = serializers.CharField(max_length=150, trim_whitespace=True)
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(
        write_only=True,
        # Long enough for a passphrase; the cap stops a multi-megabyte body
        # from being fed to the password hasher.
        max_length=128,
        style={"input_type": "password"},
    )

    def validate_name(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Please enter your name.")
        return value.strip()

    def validate_email(self, value: str) -> str:
        email = User.objects.normalize_email(value).strip()

        # Case-insensitive, matching the database constraint. Without this the
        # duplicate surfaces as an IntegrityError — a 500 — instead of a
        # field error the signup form can render.
        if (
            User.objects.annotate(email_lower=Lower("email"))
            .filter(email_lower=email.lower())
            .exists()
        ):
            raise serializers.ValidationError(
                "An account with this email already exists."
            )
        return email

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        """
        Run Django's configured password validators.

        Deferred to `validate` rather than `validate_password` so the email and
        name are already available: UserAttributeSimilarityValidator needs them
        to reject a password that is simply the user's own email.
        """
        password = attrs["password"]
        candidate = User(email=attrs.get("email", ""), name=attrs.get("name", ""))

        try:
            validate_password(password, user=candidate)
        except DjangoValidationError as exc:
            # Reported against the password field so the form can show it in
            # the right place.
            raise serializers.ValidationError({"password": list(exc.messages)}) from exc

        return attrs


class LoginSerializer(serializers.Serializer):
    """
    Login input.

    Credentials are only checked for shape here. Verifying them is
    authentication, which belongs to the service layer.
    """

    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(
        write_only=True,
        max_length=128,
        style={"input_type": "password"},
    )
    # Chooses a persistent refresh cookie over a session cookie. Named to match
    # the frontend's `remember_me` wire field.
    remember_me = serializers.BooleanField(required=False, default=False)


class GoogleLoginSerializer(serializers.Serializer):
    """
    Google sign-in input.

    `credential` matches the field name Google's own Identity Services library
    hands the frontend's callback — keeping it means the client forwards the
    button's payload unchanged rather than renaming a key for no reason. It is
    the signed ID token JWT, verified server-side in `services.py`; nothing
    about it is trusted until that verification passes.
    """

    credential = serializers.CharField(trim_whitespace=True)
    # Matches LoginSerializer's field, for the same reason: cookie lifetime is
    # a user decision, not something Google's response can express.
    remember_me = serializers.BooleanField(required=False, default=False)


class SessionSerializer(serializers.Serializer):
    """
    What every successful authentication returns.

    The refresh token is deliberately absent: it travels only as an httpOnly
    cookie. Putting it in the body would hand it to any script on the page and
    defeat the reason for the cookie. (README §25)
    """

    user = UserSerializer(read_only=True)
    access = serializers.CharField(read_only=True)
    expires_at = serializers.DateTimeField(read_only=True)
