from __future__ import annotations

import json
import threading

from services.config import DATA_DIR

# Mark a set of rels as "image edits" (image-to-image) outputs.
# Saved separately as a set: image-to-image prompts are modification instructions relative to the reference image ("change to light color", "add a hat").
# Without the reference image, it is useless text. We do not persist reference images (disk space concerns and low reuse rate), so when
# publishing to the gallery, the prompt text in the gallery entry has no value to other users. Thus, we check this set on publish,
# and if matched, force the prompt to be empty, while the gallery detail page prompts "Prompt relies on reference image and cannot be reused".
#
# File structure: { "rels": ["2026/05/22/abc.png", ...] }
# Minor chance of write loss under multi-process, but failure just falls back to "showing original prompt text",
# which is non-fatal; the next publish will still match correctly.
EDITS_FILE = DATA_DIR / "image_edits.json"

_lock = threading.RLock()


def _ensure_file() -> None:
    EDITS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not EDITS_FILE.exists():
        EDITS_FILE.write_text('{"rels": []}\n', encoding="utf-8")


def _load_set() -> set[str]:
    _ensure_file()
    try:
        data = json.loads(EDITS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return set()
    rels = data.get("rels") if isinstance(data, dict) else None
    if not isinstance(rels, list):
        return set()
    return {str(r) for r in rels if isinstance(r, str) and r}


def _save_locked(s: set[str]) -> None:
    _ensure_file()
    tmp = EDITS_FILE.with_suffix(EDITS_FILE.suffix + ".tmp")
    payload = {"rels": sorted(s)}
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(EDITS_FILE)


def mark_edits(rels: list[str]) -> None:
    """Mark this batch of rels as image edits outputs."""
    cleaned = [r.strip().lstrip("/") for r in rels if r and r.strip()]
    cleaned = [r for r in cleaned if r]
    if not cleaned:
        return
    with _lock:
        s = _load_set()
        before = len(s)
        s.update(cleaned)
        if len(s) != before:
            _save_locked(s)


def is_edit(rel: str) -> bool:
    r = (rel or "").strip().lstrip("/")
    if not r:
        return False
    return r in _load_set()


def remove_edits(rels: list[str]) -> None:
    """Used in conjunction with image deletion/cleanup paths to prevent the file from growing indefinitely."""
    cleaned = {r.strip().lstrip("/") for r in rels if r and r.strip()}
    cleaned.discard("")
    if not cleaned:
        return
    with _lock:
        s = _load_set()
        before = len(s)
        s -= cleaned
        if len(s) != before:
            _save_locked(s)
