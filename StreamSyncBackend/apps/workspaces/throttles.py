"""
Rate limit for invitations.

README §24 names invitations alongside login and registration as an endpoint
that needs protecting, and the reason is the same as for the others: it is a
write that reaches a person. Each invitation creates a membership row and a
notification today, and will send mail once the pipeline exists — so an
unbounded invite endpoint is an unbounded way to generate messages that appear
to come from StreamSync.

Keyed per user, because the endpoint is owner-only and therefore always
authenticated. The limit is generous for onboarding a team and far below what
abuse needs.
"""

from rest_framework.throttling import UserRateThrottle


class InvitationThrottle(UserRateThrottle):
    scope = "workspace_invite"
