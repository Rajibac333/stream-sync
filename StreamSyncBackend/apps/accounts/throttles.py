"""
Rate limits for credential endpoints.

Login and registration are the endpoints an attacker hits in bulk — password
guessing and account-farming respectively — so they are throttled far more
tightly than ordinary API traffic. (README §24)
"""

import logging

from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .cookies import read_refresh_cookie

logger = logging.getLogger("streamsync.auth")


class AuthEndpointThrottle(ScopedRateThrottle):
    """
    Per-IP throttling for anonymous credential endpoints.

    ScopedRateThrottle's default key is the user id once authenticated, which
    is useless here: every request being throttled is anonymous. Keying on the
    client IP is what actually limits an attacker.

    This slows online guessing; it is not a substitute for per-account lockout
    or MFA, neither of which is in this milestone.
    """

    def get_cache_key(self, request, view) -> str | None:
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }


class RefreshThrottle(AuthEndpointThrottle):
    """
    Per-account throttling for the refresh endpoint.

    WHY THIS IS NOT KEYED ON THE IP

    Refresh is unlike login and registration. It is not something an anonymous
    attacker can do usefully — it requires a valid refresh cookie — and it fires
    on *every page load*, because that is how the client restores a session.
    Keying it on the client address therefore punishes the wrong thing: a team
    behind one office NAT shares a single budget, and the tenth person to open
    the app in an hour is signed out. That arithmetic is also what made the
    end-to-end suite fail against a correctly-configured server.

    WHY NOT THE COOKIE

    The obvious key — the refresh token itself — silently does nothing. Tokens
    rotate on every refresh (`ROTATE_REFRESH_TOKENS`), so each request arrives
    with a different cookie, lands on a different key, and the limit never
    binds. The user id inside the token is the thing that stays put.

    The token is verified rather than merely decoded, so a forged one cannot
    choose which budget it spends. A caller with no usable token falls back to
    per-IP, which is the only case an attacker can reach.
    """

    def get_cache_key(self, request, view) -> str | None:
        return self.cache_format % {
            "scope": self.scope,
            "ident": self._identify(request),
        }

    def _identify(self, request) -> str:
        token = read_refresh_cookie(request)
        if not token:
            return self.get_ident(request)

        try:
            # Signature and expiry are checked here. The view verifies again
            # when it rotates the token; this one is only deciding whose budget
            # the request spends.
            user_id = RefreshToken(token).payload.get("user_id")
        except TokenError:
            # Expired or forged. The request is going to be rejected anyway, and
            # counting it against the address is what bounds someone retrying a
            # dead token in a loop.
            return self.get_ident(request)

        return str(user_id) if user_id else self.get_ident(request)
