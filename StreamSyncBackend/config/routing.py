"""
Top-level WebSocket routing.

The HTTP side is `config/urls.py`; this is its counterpart for sockets. Each
app contributes its own patterns, keeping this a table of contents.
"""

from apps.collaboration.routing import websocket_urlpatterns as collaboration_patterns

websocket_urlpatterns = [
    *collaboration_patterns,
]
