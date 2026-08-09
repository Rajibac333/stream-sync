"""
Rate limits for the AI endpoints.

These endpoints are the only ones in the product where a single request costs
real money at a third party and takes seconds rather than milliseconds. That
makes them the obvious target for abuse and the obvious way for a runaway
client — a retry loop, a component re-rendering in a cycle — to run up a bill
nobody authorised. (README §24, Milestone 9)

Two limits, because one cannot express both concerns:

* the burst limit stops a loop hammering the provider within a minute;
* the sustained limit bounds what one account can spend in an hour.

Keyed per user, not per IP: everything here requires authentication, and a
whole office behind one NAT address should not share one budget.
"""

from rest_framework.throttling import UserRateThrottle


class AiBurstThrottle(UserRateThrottle):
    """Short window. Catches loops before they cost anything much."""

    scope = "ai_burst"


class AiSustainedThrottle(UserRateThrottle):
    """Long window. Bounds one account's total spend."""

    scope = "ai"
