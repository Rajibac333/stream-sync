"""
Search result representation.

Field names match `StreamSyncFrontend/src/api/search.ts`. One flat shape for
every kind, with `type` as the discriminator, so the command menu can rank a
document against a project without unpacking two different payloads.
"""

from rest_framework import serializers

SEARCH_RESULT_TYPES = ["document", "project", "task", "person"]


class SearchResultSerializer(serializers.Serializer):
    id = serializers.CharField(read_only=True)
    type = serializers.ChoiceField(choices=SEARCH_RESULT_TYPES, read_only=True)
    title = serializers.CharField(read_only=True)
    subtitle = serializers.CharField(read_only=True, allow_null=True)
    href = serializers.CharField(read_only=True, allow_null=True)
    # Server-side relevance. The client renders in the order given and never
    # re-sorts, so this is the single place ranking is decided.
    score = serializers.FloatField(read_only=True)
