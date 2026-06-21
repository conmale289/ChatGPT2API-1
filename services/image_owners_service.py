from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from services.config import DATA_DIR

# Image -> Creator user key ID ownership map.
# Stored in a separate JSON rather than merged with image_tags:
#   - tags are manually added by user/admin, owner is written by backend when task succeeds; semantics are different, merging them complicates future maintenance
#   - the absence of an owner does not affect normal rendering of the image itself, it just prevents filtering by user
# File structure: { "<rel>": "<owner_key_id>" }
OWNERS_FILE = DATA_DIR / "image_owners.json"

_lock = threading.RLock()


def _ensure_file() -> None:
    OWNERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not OWNERS_FILE.exists():
        OWNERS_FILE.write_text("{}", encoding="utf-8")


def load_owners() -> dict[str, str]:
    _ensure_file()
    try:
        data = json.loads(OWNERS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    # Defense: keep only str -> str mapping
    return {str(k): str(v) for k, v in data.items() if isinstance(k, str) and v}


def _save_locked(data: dict[str, str]) -> None:
    _ensure_file()
    tmp = OWNERS_FILE.with_suffix(OWNERS_FILE.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(OWNERS_FILE)


def set_owner(image_rel: str, owner_id: str) -> None:
    rel = (image_rel or "").strip().lstrip("/")
    owner = (owner_id or "").strip()
    if not rel or not owner:
        return
    with _lock:
        data = load_owners()
        if data.get(rel) == owner:
            return
        data[rel] = owner
        _save_locked(data)


def set_owners(rels: list[str], owner_id: str) -> None:
    owner = (owner_id or "").strip()
    if not owner:
        return
    cleaned = [r.strip().lstrip("/") for r in rels if r and r.strip()]
    if not cleaned:
        return
    with _lock:
        data = load_owners()
        changed = False
        for rel in cleaned:
            if data.get(rel) != owner:
                data[rel] = owner
                changed = True
        if changed:
            _save_locked(data)


def remove_owner(image_rel: str) -> None:
    rel = (image_rel or "").strip().lstrip("/")
    if not rel:
        return
    with _lock:
        data = load_owners()
        if data.pop(rel, None) is not None:
            _save_locked(data)


def remove_owners(rels: list[str]) -> None:
    cleaned = [r.strip().lstrip("/") for r in rels if r and r.strip()]
    if not cleaned:
        return
    with _lock:
        data = load_owners()
        changed = False
        for rel in cleaned:
            if data.pop(rel, None) is not None:
                changed = True
        if changed:
            _save_locked(data)


def get_owner(image_rel: str) -> str:
    rel = (image_rel or "").strip().lstrip("/")
    if not rel:
        return ""
    return load_owners().get(rel, "")


def owner_counts() -> dict[str, int]:
    """Count the number of images currently owned by each owner.
    It is more lightweight for the upper layer to read here directly before aligning with list_images results;
    strict file existence matching is left to the upper layer."""
    counts: dict[str, int] = {}
    for owner in load_owners().values():
        if not owner:
            continue
        counts[owner] = counts.get(owner, 0) + 1
    return counts


def _extract_rels(data: list[Any]) -> list[str]:
    """Extract `/images/<rel>` from the image URL in the output data list.
    Upstream might provide absolute URLs or relative paths; any containing `/images/` will match."""
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


def record_owner_for_result(identity: Any, data: list[Any] | None) -> None:
    """Called after successful generation/editing: attach owner to the generated images based on identity.
    - Standard user: owner = user key ID
    - Admin: owner = "admin" (legacy auth_key) or specific admin key ID, grouped under "Admin" in dropdowns
    - No identity/ID found: do nothing, making the batch of images orphans (frontend "Unowned" group)
    """
    if not isinstance(identity, dict) or not isinstance(data, list) or not data:
        return
    owner_id = str(identity.get("id") or "").strip()
    if not owner_id:
        return
    rels = _extract_rels(data)
    if not rels:
        return
    try:
        set_owners(rels, owner_id)
    except Exception:
        # Owner table write failure does not affect upstream response; the image will appear as "Unowned" in subsequent listings
        pass
