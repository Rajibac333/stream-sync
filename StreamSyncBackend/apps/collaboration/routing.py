"""WebSocket routes for real-time collaboration. (README §15)"""

from django.urls import path

from .consumers import DocumentConsumer

websocket_urlpatterns = [
    # One socket per document. The id is part of the URL rather than a frame,
    # so a connection can never be moved to a document its owner did not prove
    # access to at connect time. (README §16)
    path("ws/documents/<uuid:document_id>/", DocumentConsumer.as_asgi()),
]
