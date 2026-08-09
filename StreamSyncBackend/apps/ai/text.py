"""
Turning a stored document into something a model can read.

Documents are stored as HTML (see apps/documents/models.py). Sending that HTML
straight to a provider wastes tokens on markup and invites the model to answer
in markup, so it is flattened first.

This deliberately does *not* reuse `documents.services.build_excerpt`. That
function collapses everything to a single line, which is right for a list
preview and wrong here: the assistant is asked to cite the section a quote came
from, and section structure is exactly what collapsing destroys.
"""

import re
from html import unescape

from django.utils.html import strip_tags

# Headings become "# Heading" lines, so the flattened text still shows where one
# section ends and the next begins. The backreference keeps `<h2>…</h2>` from
# matching across a later `</h3>`.
_HEADING = re.compile(r"<h([1-6])\b[^>]*>(.*?)</h\1>", re.IGNORECASE | re.DOTALL)

# List items become "- item" lines. Bullet lists are where action items live,
# and a bullet that has lost its marker reads as prose.
_LIST_ITEM = re.compile(r"<li\b[^>]*>", re.IGNORECASE)

# Everything else that implies a line break. Inline tags (<strong>, <em>, <a>)
# are absent on purpose — they are removed by strip_tags without contributing
# whitespace, so "Body <strong>text</strong>." does not become "Body text .".
_BLOCK_BOUNDARY = re.compile(
    r"</?(?:p|div|br|hr|ul|ol|dl|dt|dd|table|thead|tbody|tr|td|th"
    r"|blockquote|pre|section|article|aside|header|footer|figure|figcaption)"
    r"\b[^>]*>",
    re.IGNORECASE,
)

HEADING_PREFIX = "# "


def document_to_text(content: str) -> str:
    """
    Flatten document HTML to line-structured plain text.

    Headings survive as `# Heading`, list items as `- item`, and every other
    block boundary as a newline. Runs of blank lines collapse so an editor's
    empty paragraphs do not pad the prompt.
    """
    text = _HEADING.sub(
        lambda match: f"\n\n{HEADING_PREFIX}{match.group(2)}\n", content or ""
    )
    text = _LIST_ITEM.sub("\n- ", text)
    text = _BLOCK_BOUNDARY.sub("\n", text)
    text = unescape(strip_tags(text))

    lines = [" ".join(line.split()) for line in text.split("\n")]

    cleaned: list[str] = []
    for line in lines:
        if not line and (not cleaned or not cleaned[-1]):
            # Skip leading blanks and runs of them; a single blank line between
            # blocks is kept because it is what separates sections.
            continue
        cleaned.append(line)

    return "\n".join(cleaned).strip()


def truncate(text: str, limit: int) -> tuple[str, bool]:
    """
    Cut `text` to `limit` characters at a line boundary.

    Returns the text and whether anything was dropped, because the caller has
    to tell the model that it is reading a fragment. A model that believes it
    has the whole document will happily assert that something is not mentioned
    in it.
    """
    if len(text) <= limit:
        return text, False

    head = text[:limit]
    boundary = head.rfind("\n")
    # Only honour the boundary if it leaves most of the budget used; otherwise a
    # single very long paragraph would be cut back to almost nothing.
    if boundary > limit // 2:
        head = head[:boundary]

    return head.rstrip(), True


def sentences(text: str) -> list[str]:
    """
    Split prose into sentences.

    Used only by the mock provider's heuristics. It is a regex, not a parser:
    good enough to pick quotable lines out of a requirements document, and
    wrong on abbreviations. Nothing that ships to a user depends on it being
    linguistically correct.
    """
    parts = re.split(r"(?<=[.!?])\s+", text.replace("\n", " "))
    return [part.strip() for part in parts if part.strip()]
