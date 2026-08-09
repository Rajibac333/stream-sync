"""
Refresh-token cookie custody.

The refresh token is the durable half of the credential pair, so it is only
ever handed to the browser as a cookie with:

  HttpOnly  JavaScript cannot read it, so an XSS cannot exfiltrate a long-lived
            credential (it could still call the API as the user, but only for
            as long as the page is open)
  Secure    never transmitted over plain http (forced on in production)
  SameSite  not attached to cross-site requests, which blunts CSRF
  Path      scoped to /api/auth/, so it is not sent on ordinary API calls

Setting and clearing it lives here rather than in the views so all four flags
are decided in exactly one place. (README §19, §25)
"""

from django.conf import settings
from rest_framework.response import Response


def set_refresh_cookie(response: Response, token: str, *, persistent: bool) -> Response:
    """
    Attach the refresh token.

    `persistent` is the "remember me" choice. A persistent cookie survives
    browser restarts for the token's full lifetime; otherwise the cookie is a
    session cookie that the browser drops when it closes. Either way the token
    itself expires server-side at the same moment, so "remember me" can extend
    convenience but never the credential's actual validity.
    """
    max_age = (
        int(settings.REFRESH_TOKEN_LIFETIME.total_seconds()) if persistent else None
    )

    response.set_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        value=token,
        max_age=max_age,
        path=settings.REFRESH_COOKIE_PATH,
        secure=settings.REFRESH_COOKIE_SECURE,
        httponly=True,
        samesite=settings.REFRESH_COOKIE_SAMESITE,
    )
    return response


def clear_refresh_cookie(response: Response) -> Response:
    """
    Remove the cookie at logout.

    The path must match the one used when setting it — a delete with a
    different path silently does nothing and leaves the cookie in place.
    """
    response.delete_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        path=settings.REFRESH_COOKIE_PATH,
        samesite=settings.REFRESH_COOKIE_SAMESITE,
    )
    return response


def read_refresh_cookie(request) -> str | None:
    """
    Read the refresh token from the request.

    The cookie is the only accepted source. A token supplied in the body or a
    header would be one the page's JavaScript could read, which is exactly the
    exposure this design removes.
    """
    return request.COOKIES.get(settings.REFRESH_COOKIE_NAME) or None
