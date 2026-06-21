"""Cleaning of Private Use Area (PUA) tags in the ChatGPT web version downstream text.

The text returned by ChatGPT contains internal tags wrapped in U+E200..U+E203, which are rendered
as cards/footnotes in the browser UI; when passed through as an OpenAI-compatible API, they appear
directly as garbled characters like 'entity[...]' or 'citeturn0search0'. This module is responsible
for stripping/converting these tags and cooperating with streaming incremental parsing.

Two common types of tags:
- ``\\ue200entity[...]\\ue201``                Entity cards (movies, songs, people, etc.)
- ``\\ue200cite\\ue202<token>\\ue203...\\ue201`` Search citation footnotes, URLs from upstream metadata
"""
from __future__ import annotations

import json
import re
from typing import Any

OPEN = ""
CLOSE = ""
FIELD_SEP = ""
ITEM_SEP = ""

_BLOCK = re.compile(f"{OPEN}(.*?){CLOSE}", re.DOTALL)
_LONE_PUA = re.compile(f"[{OPEN}{CLOSE}{FIELD_SEP}{ITEM_SEP}]")
_TEXT_TAG = re.compile(r"</?Text(?:\s[^>]*)?>", re.IGNORECASE)
_RICH_TEXT_TAGS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"<Bold(?:\s[^>]*)?>(.*?)</Bold>", re.IGNORECASE | re.DOTALL), r"**\1**"),
    (re.compile(r"<Strong(?:\s[^>]*)?>(.*?)</Strong>", re.IGNORECASE | re.DOTALL), r"**\1**"),
    (re.compile(r"<Italic(?:\s[^>]*)?>(.*?)</Italic>", re.IGNORECASE | re.DOTALL), r"*\1*"),
    (re.compile(r"<Emphasis(?:\s[^>]*)?>(.*?)</Emphasis>", re.IGNORECASE | re.DOTALL), r"*\1*"),
    (re.compile(r"<Code(?:\s[^>]*)?>(.*?)</Code>", re.IGNORECASE | re.DOTALL), r"`\1`"),
    (re.compile(r"<Strikethrough(?:\s[^>]*)?>(.*?)</Strikethrough>", re.IGNORECASE | re.DOTALL), r"~~\1~~"),
)
_LINE_BREAK_TAG = re.compile(r"<(?:LineBreak|br)(?:\s[^>]*)?/?>", re.IGNORECASE)
_UNKNOWN_RICH_TEXT_TAG = re.compile(
    r"</?(?:Paragraph|List|OrderedList|UnorderedList|ListItem|Item)(?:\s[^>]*)?>",
    re.IGNORECASE,
)
_TRAILING_PARTIAL_TEXT_TAG = re.compile(r"<(?:/?(?:T(?:e(?:x(?:t)?)?)?)?)?$", re.IGNORECASE)


def collect_references(node: Any, references: dict[str, dict[str, Any]]) -> None:
    """Recursively scan the event tree to collect mapping from ``matched_text`` to citation metadata."""
    if isinstance(node, dict):
        matched = node.get("matched_text")
        if isinstance(matched, str) and OPEN in matched and matched not in references:
            items: list[dict[str, str]] = []
            for raw_item in node.get("items") or []:
                if not isinstance(raw_item, dict):
                    continue
                url = str(raw_item.get("url") or "").strip()
                title = str(raw_item.get("title") or "").strip()
                if url:
                    items.append({"url": url, "title": title})
            references[matched] = {
                "url": str(node.get("url") or "").strip(),
                "title": str(node.get("title") or "").strip(),
                "items": items,
            }
        for value in node.values():
            collect_references(value, references)
    elif isinstance(node, list):
        for value in node:
            collect_references(value, references)


def split_stable(text: str) -> str:
    """Cut out the closed stable prefix; unclosed tags at the tail are kept for the next frame."""
    last_open = text.rfind(OPEN)
    last_close = text.rfind(CLOSE)
    if last_open > last_close:
        text = text[:last_open]
    partial = _TRAILING_PARTIAL_TEXT_TAG.search(text)
    if partial:
        return text[:partial.start()]
    return text


def _render_rich_text_tags(text: str) -> str:
    """Convert upstream rich text wrappers into Markdown to avoid losing bold or other semantics when stripping tags."""
    if "<" not in text:
        return text
    out = text
    for pattern, replacement in _RICH_TEXT_TAGS:
        out = pattern.sub(replacement, out)
    out = _LINE_BREAK_TAG.sub("\n", out)
    out = _TEXT_TAG.sub("", out)
    return _UNKNOWN_RICH_TEXT_TAG.sub("", out)


def _first_readable(values: list[Any]) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _render_entity(inner: str) -> str:
    body = inner[len("entity"):]
    try:
        arr = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        quoted = re.findall(r'"([^"]+)"', body)
        return _first_readable(quoted[1:] + quoted[:1])
    if isinstance(arr, list):
        return _first_readable(arr[1:] + arr[:1])
    if isinstance(arr, dict):
        return _first_readable([arr.get("name"), arr.get("title"), arr.get("text"), arr.get("label")])
    return ""


def _render_cite(
    block: str,
    references: dict[str, dict[str, Any]],
    cite_numbers: dict[str, int],
    cite_counter: list[int],
) -> str:
    info = references.get(block)
    if not info:
        return ""
    urls = [item["url"] for item in info.get("items") or [] if item.get("url")]
    if not urls and info.get("url"):
        urls = [info["url"]]
    if not urls:
        return ""
    if block not in cite_numbers:
        cite_counter[0] += 1
        cite_numbers[block] = cite_counter[0]
    return f"[[{cite_numbers[block]}]]({urls[0]})"


def sanitize(
    text: str,
    references: dict[str, dict[str, Any]],
    cite_numbers: dict[str, int],
    cite_counter: list[int],
) -> str:
    """Replace stable prefixes and remove isolated PUA characters; unclosed tags are left untouched."""
    if not text:
        return text
    stable = split_stable(text)
    if OPEN not in stable:
        return _render_rich_text_tags(_LONE_PUA.sub("", stable))

    def replace(match: re.Match[str]) -> str:
        block = match.group(0)
        inner = match.group(1)
        if inner.startswith("entity"):
            return _render_entity(inner)
        if inner.startswith("cite" + FIELD_SEP):
            return _render_cite(block, references, cite_numbers, cite_counter)
        return ""

    return _render_rich_text_tags(_LONE_PUA.sub("", _BLOCK.sub(replace, stable)))
