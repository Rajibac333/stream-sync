"""
Abstract model bases.

Every persisted entity in StreamSync is identified publicly by a UUID and
carries creation/update timestamps, so both concerns live here rather than
being retyped in each app. (README §4)
"""

import uuid

from django.db import models


class UUIDPrimaryKeyModel(models.Model):
    """
    Primary key that is safe to expose in URLs and WebSocket payloads.

    Sequential integer keys leak how many rows a table holds and let a client
    guess neighbouring records; UUIDv4 keys do neither. They are generated in
    Python so the value is known before INSERT, which matters when a service
    creates several related rows inside one transaction.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class TimeStampedModel(models.Model):
    """Creation and last-modification timestamps, both in UTC."""

    # db_index because "most recently updated first" is the default ordering
    # for documents, projects and activity feeds.
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class BaseModel(UUIDPrimaryKeyModel, TimeStampedModel):
    """The default base for StreamSync entities: UUID key plus timestamps."""

    class Meta:
        abstract = True
