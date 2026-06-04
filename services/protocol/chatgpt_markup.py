"""ChatGPT 网页版下发文本中私有区(PUA)标记的清洗。

ChatGPT 返回的文本里嵌有以 U+E200..U+E203 包裹的内部标记，浏览器 UI 渲染成
卡片/脚注；作为 OpenAI 兼容 API 透传则直接显示为 'entity[...]'、
'citeturn0search0' 等乱码。本模块负责剥离/转换这些标记，并配合流式增量解析。

两类常见标记：
- ``\\ue200entity[...]\\ue201``                实体卡片（电影、歌曲、人物等）
- ``\\ue200cite\\ue202<token>\\ue203...\\ue201`` 搜索引用脚注，URL 来自上游 metadata
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


def collect_references(node: Any, references: dict[str, dict[str, Any]]) -> None:
    """递归扫描事件树，收集 ``matched_text`` 到引用元数据的映射。"""
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
    """截出已闭合的稳定前缀；尾部未闭合的标记保留到下一帧再处理。"""
    last_open = text.rfind(OPEN)
    last_close = text.rfind(CLOSE)
    if last_open > last_close:
        return text[:last_open]
    return text


def _render_entity(inner: str) -> str:
    body = inner[len("entity"):]
    try:
        arr = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        return ""
    if isinstance(arr, list) and len(arr) >= 2 and arr[1]:
        return str(arr[1])
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
    """对稳定前缀做替换并去掉孤立 PUA 字符；未闭合的标记不动。"""
    if not text or OPEN not in text:
        return _LONE_PUA.sub("", text) if text else text
    stable = split_stable(text)
    if OPEN not in stable:
        return _LONE_PUA.sub("", stable)

    def replace(match: re.Match[str]) -> str:
        block = match.group(0)
        inner = match.group(1)
        if inner.startswith("entity"):
            return _render_entity(inner)
        if inner.startswith("cite" + FIELD_SEP):
            return _render_cite(block, references, cite_numbers, cite_counter)
        return ""

    return _LONE_PUA.sub("", _BLOCK.sub(replace, stable))
