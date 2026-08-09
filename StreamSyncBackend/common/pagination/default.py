"""
Pagination defaults.

Every list endpoint is paginated; no endpoint returns an unbounded result set.
(README §48)
"""

from collections import OrderedDict
from typing import Any

from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class DefaultPagination(PageNumberPagination):
    """
    Page-number pagination with a client-adjustable, server-capped page size.

    `max_page_size` is the important half: without it, `?page_size=100000`
    turns any list endpoint into a denial-of-service lever.
    """

    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100

    def get_paginated_response(self, data: Any) -> Response:
        # `count` and `page_size` are included so the frontend can render
        # pagination controls without inferring totals from the result length.
        return Response(
            OrderedDict(
                [
                    ("count", self.page.paginator.count),
                    ("page", self.page.number),
                    ("page_size", self.get_page_size(self.request)),
                    ("total_pages", self.page.paginator.num_pages),
                    ("next", self.get_next_link()),
                    ("previous", self.get_previous_link()),
                    ("results", data),
                ]
            )
        )

    def get_paginated_response_schema(self, schema: dict) -> dict:
        """Keeps the generated OpenAPI document honest about the shape above."""
        return {
            "type": "object",
            "required": ["count", "page", "page_size", "total_pages", "results"],
            "properties": {
                "count": {"type": "integer", "example": 42},
                "page": {"type": "integer", "example": 1},
                "page_size": {"type": "integer", "example": 25},
                "total_pages": {"type": "integer", "example": 2},
                "next": {"type": "string", "nullable": True, "format": "uri"},
                "previous": {"type": "string", "nullable": True, "format": "uri"},
                "results": schema,
            },
        }
