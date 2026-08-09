"""
What the client sees when the assistant cannot answer.

Every provider failure — an outage, a timeout, an upstream rate limit, a reply
that is not the shape it promised — is caught at the service boundary and
re-raised as one of these. Nothing from the SDK escapes: its exceptions carry
request bodies, URLs and header material, and one of those headers is the API
key. (README §14, §46)

Codes are stable and specific so an operator can tell a timeout from a bad
reply in the logs; the *messages* are deliberately vague, because "the model
returned malformed JSON" is not the user's problem and hints at internals.
"""

from common.exceptions import ApplicationError, ErrorCode


class AiErrorCode:
    """AI-specific additions to `common.exceptions.ErrorCode`."""

    SERVICE_UNAVAILABLE = "AI_SERVICE_UNAVAILABLE"
    TIMEOUT = "AI_TIMEOUT"
    RATE_LIMITED = "AI_RATE_LIMITED"
    INVALID_RESPONSE = "AI_INVALID_RESPONSE"
    REFUSED = "AI_REFUSED"
    NOT_CONFIGURED = "AI_NOT_CONFIGURED"


class AiUnavailableError(ApplicationError):
    """
    The provider could not be reached, or failed.

    503 rather than 500: the request was fine and retrying later is the correct
    advice. The rest of the application keeps working — a failed summary must
    never take the editor down with it. (README §46, frontend §68)
    """

    status_code = 503
    default_code = AiErrorCode.SERVICE_UNAVAILABLE
    default_detail = "AI assistance is temporarily unavailable."


class AiTimeoutError(AiUnavailableError):
    """
    The provider did not answer inside the configured budget.

    504 is the honest status: this server is a gateway to the provider, and the
    gateway timed out. Separated from the generic failure because the operator
    response differs — a timeout usually means the budget or the prompt size is
    wrong, not that the provider is down.
    """

    status_code = 504
    default_code = AiErrorCode.TIMEOUT
    default_detail = "The AI request took too long. Please try again."


class AiRateLimitedError(AiUnavailableError):
    """
    The provider rate-limited us.

    429 is passed through rather than flattened into 503 so the client can back
    off instead of retrying immediately. This is the *provider's* limit, not
    ours — ours is enforced by the throttles in throttles.py and never reaches
    the provider at all.
    """

    status_code = 429
    default_code = AiErrorCode.RATE_LIMITED
    default_detail = "AI assistance is busy right now. Please try again shortly."


class AiInvalidResponseError(AiUnavailableError):
    """
    The provider answered, but not with the structure it was asked for.

    Treated as an outage, not a bug in the caller's request: from the client's
    point of view an unusable answer and no answer are the same event. It is
    logged at error level because a sustained run of these means the schema and
    the model have drifted apart.
    """

    default_code = AiErrorCode.INVALID_RESPONSE


class AiRefusedError(AiUnavailableError):
    """
    The provider declined to answer this content.

    Kept distinct because it is not a fault: retrying the identical request
    will produce the identical refusal, so the client should show the message
    rather than offer "try again".
    """

    status_code = 422
    default_code = AiErrorCode.REFUSED
    default_detail = "The assistant could not respond to that request."


class AiNotConfiguredError(AiUnavailableError):
    """
    A live provider was selected without the credentials to reach it.

    A deployment mistake rather than a runtime failure, so it is raised at
    request time with its own code instead of crashing at import — the rest of
    the product must still boot and serve when the AI layer is misconfigured.
    """

    default_code = AiErrorCode.NOT_CONFIGURED


__all__ = [
    "AiErrorCode",
    "AiInvalidResponseError",
    "AiNotConfiguredError",
    "AiRateLimitedError",
    "AiRefusedError",
    "AiTimeoutError",
    "AiUnavailableError",
    "ErrorCode",
]
