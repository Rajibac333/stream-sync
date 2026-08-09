"""
Serializer fields shared across apps.
"""

from typing import Any

from rest_framework import serializers


class EmptyAsNullCharField(serializers.CharField):
    """
    Renders an unset optional text field as null rather than "".

    The database stores "" — Django's convention for an optional CharField,
    which avoids a column that is both nullable and blank — while the frontend
    types these as `string | null` and branches on null (rendering initials for
    a missing avatar, hiding an empty description). This field is the single
    point of translation between the two conventions.
    """

    def to_representation(self, value: Any) -> str | None:
        return super().to_representation(value) if value else None
