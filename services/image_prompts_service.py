from __future__ import annotations

import json
import threading
from typing import Any

from services.config import DATA_DIR

# Image -> generation prompt text. Same pattern as image_owners.json:
# A separate JSON file, quickly queried by rel path at runtime.
#
# Why not merge with image_owners:
#   - owner is a stable string, prompt is multi-line arbitrary text written by users; merging them makes reads and writes awkward
#   - missing prompt does not affect normal display and ownership of the image, only that the original text cannot be retrieved when publishing/reusing in gallery
#
# File structure: { "<rel>": "<raw prompt>" }
PROMPTS_FILE = DATA_DIR / "image_prompts.json"

_lock = threading.RLock()


def _ensure_file() -> None:
    PROMPTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not PROMPTS_FILE.exists():
        PROMPTS_FILE.write_text("{}", encoding="utf-8")


def load_prompts() -> dict[str, str]:
    _ensure_file()
    try:
        data = json.loads(PROMPTS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items() if isinstance(k, str) and isinstance(v, str)}


def _save_locked(data: dict[str, str]) -> None:
    _ensure_file()
    tmp = PROMPTS_FILE.with_suffix(PROMPTS_FILE.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(PROMPTS_FILE)


def set_prompts(rels: list[str], prompt: str) -> None:
    text = (prompt or "").strip()
    if not text:
        return
    cleaned = [r.strip().lstrip("/") for r in rels if r and r.strip()]
    if not cleaned:
        return
    with _lock:
        data = load_prompts()
        changed = False
        for rel in cleaned:
            if data.get(rel) != text:
                data[rel] = text
                changed = True
        if changed:
            _save_locked(data)


def remove_prompts(rels: list[str]) -> None:
    cleaned = [r.strip().lstrip("/") for r in rels if r and r.strip()]
    if not cleaned:
        return
    with _lock:
        data = load_prompts()
        changed = False
        for rel in cleaned:
            if data.pop(rel, None) is not None:
                changed = True
        if changed:
            _save_locked(data)


def get_prompt(image_rel: str) -> str:
    rel = (image_rel or "").strip().lstrip("/")
    if not rel:
        return ""
    return load_prompts().get(rel, "")


def _extract_rels(data: list[Any]) -> list[str]:
    """Same logic as image_owners_service._extract_rels: extract rels from the data list."""
    rels: list[str] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        if not isinstance(url, str) or not url:
            continue
        marker = "/images/"
        idx = url.find(marker)
        if idx < 0:
            continue
        rel = url[idx + len(marker):].split("?", 1)[0].split("#", 1)[0].strip().lstrip("/")
        if rel:
            rels.append(rel)
    return rels


def record_prompt_for_result(prompt: str | None, data: Any, *, is_edit: bool = False) -> None:
    """Called after successful generation/editing: save the prompt to the mapping table of all generated images.
    - prompt is empty: skip (scenes with backend moderation/assembly should not overwrite the original text, up to the caller to decide)
    - data is not a list: skip
    - is_edit=True: in addition to saving prompt, also mark these rels as "image edits outputs".
      When publishing to the gallery, finding this mark forces the prompt to be saved as an empty string, because the prompt
      in image-to-image is a modification instruction relative to the reference image, having no reuse value to other users without it.
    """
    text = (prompt or "").strip()
    if not text or not isinstance(data, list) or not data:
        # Even if prompt is empty, mark is_edit: image-to-image allows empty prompt (only referencing image),
        # in which case the gallery still needs to know it's image-to-image.
        if is_edit and isinstance(data, list) and data:
            try:
                from services.image_edits_service import mark_edits

                rels = _extract_rels(data)
                if rels:
                    mark_edits(rels)
            except Exception:
                pass
        return
    rels = _extract_rels(data)
    if not rels:
        return
    try:
        set_prompts(rels, text)
    except Exception:
        # Write failure does not affect response
        pass
    if is_edit:
        try:
            from services.image_edits_service import mark_edits

            mark_edits(rels)
        except Exception:
            pass
