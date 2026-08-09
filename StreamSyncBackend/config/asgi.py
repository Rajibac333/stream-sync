"""
ASGI entrypoint.

Serves HTTP and WebSockets from one process. The protocol router picks between
them by connection type, so `/api/...` and `/ws/...` share a deployment.

    uvicorn config.asgi:application
    daphne config.asgi:application

`get_asgi_application()` is called before importing anything that touches
models: Channels routing imports consumers, which import Django models, and
those cannot be loaded until the app registry is ready.
"""

import os

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.production")

django_asgi_application = get_asgi_application()

from config.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_application,
        # AllowedHostsOriginValidator checks the browser's Origin header
        # against ALLOWED_HOSTS. Without it any website could open a socket to
        # this server in a logged-in user's browser and read their documents —
        # the WebSocket equivalent of a missing CORS policy, and one the
        # same-origin policy does not cover.
        "websocket": AllowedHostsOriginValidator(
            URLRouter(websocket_urlpatterns),
        ),
    }
)
