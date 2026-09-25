"""Reusable speech-text sanitizer.

Turns the *visible* chat response into something that sounds natural when spoken,
WITHOUT altering the visible text the console shows. This is a separate concern
from the chat pipeline: the console keeps rendering the real Markdown response,
and only the text handed to the TTS engine passes through here.

Rules:
  * Markdown is flattened (headings, list markers, emphasis, tables, rules).
  * Fenced code blocks are removed from spoken output. A substantial code block
    is replaced with one short, natural phrase; a tiny snippet is dropped.
  * Inline ``code`` keeps its wording but loses the backticks.
  * Raw URLs are not read out character-by-character; they become a short phrase.
  * Model ids / metadata are simply never *added* to the spoken text.
"""

from __future__ import annotations

import re

DEFAULT_CODE_PHRASE = "I've included the code in the console."
DEFAULT_LINK_PHRASE = "a link"

# A fenced block, with an optional language tag on the opening fence line.
_FENCE_RE = re.compile(r"```[^\n`]*\n?(.*?)```", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`([^`]+)`")
_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_BARE_URL_RE = re.compile(r"<?(?:https?://|www\.)[^\s>)\]]+>?", re.IGNORECASE)
_HR_RE = re.compile(r"^[ \t]{0,3}(?:[-*_][ \t]*){3,}$", re.MULTILINE)
_TABLE_SEP_RE = re.compile(r"^[ \t]*\|?[ \t:|-]+\|[ \t:|-]*$", re.MULTILINE)
_HEADING_RE = re.compile(r"^[ \t]{0,3}#{1,6}[ \t]*", re.MULTILINE)
_BLOCKQUOTE_RE = re.compile(r"^[ \t]{0,3}>[ \t]?", re.MULTILINE)
_LIST_RE = re.compile(r"^[ \t]{0,3}(?:[-*+]|\d{1,3}[.)])[ \t]+", re.MULTILINE)
_EMPHASIS_RE = re.compile(r"(\*\*\*|\*\*|\*|___|__|_|~~)")
_MULTISPACE_RE = re.compile(r"[ \t]{2,}")
_MULTINEWLINE_RE = re.compile(r"\n{2,}")


def _is_substantial_code(body: str) -> bool:
    """A code block is 'substantial' if it spans lines or is long."""

    lines = [line for line in body.splitlines() if line.strip()]
    return len(lines) >= 2 or len(body.strip()) >= 120


def sanitize_for_speech(
    text: str,
    code_phrase: str = DEFAULT_CODE_PHRASE,
    link_phrase: str = DEFAULT_LINK_PHRASE,
) -> str:
    """Return a natural-language version of ``text`` suitable for TTS."""

    if not text:
        return ""

    def _replace_fence(match: re.Match) -> str:
        body = match.group(1) or ""
        if _is_substantial_code(body):
            return f" {code_phrase} "
        return " "

    out = _FENCE_RE.sub(_replace_fence, text)
    out = _MD_LINK_RE.sub(lambda m: m.group(1), out)
    out = _BARE_URL_RE.sub(link_phrase, out)
    out = _INLINE_CODE_RE.sub(lambda m: m.group(1), out)

    out = _HR_RE.sub(" ", out)
    out = _TABLE_SEP_RE.sub(" ", out)
    out = _HEADING_RE.sub("", out)
    out = _BLOCKQUOTE_RE.sub("", out)
    out = _LIST_RE.sub("", out)

    # Table cell separators become short pauses rather than spoken pipes.
    out = out.replace("|", ", ")
    out = _EMPHASIS_RE.sub("", out)

    out = _MULTISPACE_RE.sub(" ", out)
    out = _MULTINEWLINE_RE.sub("\n", out)
    out = "\n".join(line.strip() for line in out.splitlines())
    out = re.sub(r"\n+", " ", out)
    return out.strip()


def truncate_for_speech(text: str, max_chars: int) -> str:
    """Bound the spoken text, preferring to cut at a sentence boundary."""

    if max_chars <= 0 or len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    for separator in (". ", "! ", "? ", "; ", ", "):
        index = cut.rfind(separator)
        if index > max_chars * 0.5:
            return cut[: index + 1].strip()
    return cut.strip()